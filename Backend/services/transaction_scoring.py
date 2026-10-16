"""Score a batch of staging transactions with the IBM HI-Medium mule-hunter GraphSAGE.

The model runs in the ML microservice (ML/service.py), which keeps the weights
loaded between batches; this module calls its POST /models/{ML_MODEL}/predict
over HTTP. Set ML_MODEL in .env to switch models.

The whole batch is scored at once, with no sampling or filtering: the model is
2-hop GraphSAGE, so every row is also neighborhood context for the others.

The service expects the raw IBM CSV column names and a "%Y/%m/%d %H:%M"
timestamp string, so the staging DataFrame's camelCase columns are mapped back
to that shape first. Scores come back in input row order and are joined onto
the batch locally, so ids and other staging columns never leave the backend.
"""

import json
import os
from pathlib import Path

import httpx
import pandas as pd
import polars as pl
from dotenv import load_dotenv

load_dotenv()

ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://127.0.0.1:8001")
# Which model scores batches: "amlgnn", "amlgnn-v1", "graphsage" or "qgnn"
# (see GET /models on the ML service).
ML_MODEL = os.getenv("ML_MODEL", "graphsage")
# A 50k-row batch takes a while on CPU.
ML_SERVICE_TIMEOUT_SECONDS = float(os.getenv("ML_SERVICE_TIMEOUT_SECONDS", "600"))
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output" / "scoring"

# staging_transaction column -> raw IBM CSV column the model expects
STAGING_TO_MODEL_COLUMNS = {
    "timestamp": "Timestamp",
    "fromBank": "From Bank",
    "fromAccount": "Account",
    "toBank": "To Bank",
    "toAccount": "Account.1",
    "amountReceived": "Amount Received",
    "receivingCurrency": "Receiving Currency",
    "amountPaid": "Amount Paid",
    "paymentCurrency": "Payment Currency",
    "paymentFormat": "Payment Format",
    "isLaundering": "Is Laundering",
}
MODEL_COLUMNS = list(STAGING_TO_MODEL_COLUMNS.values())

_client = httpx.Client(base_url=ML_SERVICE_URL, timeout=ML_SERVICE_TIMEOUT_SECONDS)


def to_model_input(df: pd.DataFrame) -> pd.DataFrame:
    model_df = df.rename(columns=STAGING_TO_MODEL_COLUMNS)
    model_df["Timestamp"] = model_df["Timestamp"].dt.strftime("%Y/%m/%d %H:%M")
    return model_df


def _predict(model_df: pd.DataFrame) -> dict:
    # pandas' to_json is far faster than json.dumps over to_dict("records")
    # for a 50k-row batch, so the body is assembled around it.
    rows = model_df[MODEL_COLUMNS].to_json(orient="records")
    body = f'{{"transactions": {rows}, "include_payload": true}}'
    try:
        response = _client.post(
            f"/models/{ML_MODEL}/predict", content=body, headers={"Content-Type": "application/json"}
        )
    except httpx.ConnectError as e:
        raise RuntimeError(
            f"ML service not reachable at {ML_SERVICE_URL} -- start it with "
            "`uv run main.py` in ML/"
        ) from e
    response.raise_for_status()
    return response.json()


def score_transactions(df: pd.DataFrame) -> dict:
    """Run the model over every row in df.

    Returns scores, flagged (score >= decision_threshold), decision_threshold,
    frame (polars DataFrame of the input plus the model's derived columns and
    risk_score), payload, json (the full /predict response), n_nodes, n_edges.
    """
    model_df = to_model_input(df)
    body = _predict(model_df)
    frame = pl.from_pandas(model_df).with_columns(
        # Same parse the model applies, so ts matches what it scored on.
        pl.col("Timestamp").str.to_datetime("%Y/%m/%d %H:%M", strict=False).alias("ts"),
        *(pl.Series(name, values) for name, values in body["features"].items()),
        pl.Series("risk_score", body["scores"], dtype=pl.Float64),
    )
    return {
        "scores": body["scores"],
        "flagged": body["flagged"],
        "decision_threshold": body["decision_threshold"],
        "n_nodes": body["n_nodes"],
        "n_edges": body["n_edges"],
        "frame": frame,
        "payload": body["payload"],
        "json": json.dumps(body, indent=2),
    }


def save_output(result: dict, first_id: int, last_id: int) -> Path:
    """Testing only: write the ML service's full /predict response for one batch to a text file."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"batch_{first_id}-{last_id}.txt"
    path.write_text(result["json"], encoding="utf-8")
    return path
