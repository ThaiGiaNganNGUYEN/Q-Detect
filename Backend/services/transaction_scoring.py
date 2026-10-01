"""Score a batch of staging transactions with the IBM HI-Medium mule-hunter GraphSAGE model.

The whole batch is scored at once, with no sampling or filtering: the model is
2-hop GraphSAGE, so every row is also neighborhood context for the others.

infer_transactions() expects the raw IBM CSV column names and a
"%Y/%m/%d %H:%M" timestamp string, so the staging DataFrame's camelCase
columns are mapped back to that shape first. Extra columns (like id) pass
straight through to the scored frame, in input row order.
"""

from functools import lru_cache
from pathlib import Path

import pandas as pd

from scripts.backup_model import infer_transactions, load_infer_bundle

BUNDLE_PATH = Path(__file__).resolve().parents[2] / "ML" / "model" / "ibm_hi_medium_infer_750k_auprc80.pt"
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


@lru_cache(maxsize=1)
def get_bundle() -> dict:
    """Load the model bundle once and reuse it for every batch."""
    return load_infer_bundle(path=BUNDLE_PATH)


def get_decision_threshold() -> float:
    """Score at or above which the model flags a transaction."""
    return float(get_bundle()["config"]["decision_threshold"])


def to_model_input(df: pd.DataFrame) -> pd.DataFrame:
    model_df = df.rename(columns=STAGING_TO_MODEL_COLUMNS)
    model_df["Timestamp"] = model_df["Timestamp"].dt.strftime("%Y/%m/%d %H:%M")
    return model_df


def score_transactions(df: pd.DataFrame) -> dict:
    """Run the model over every row in df.

    Returns infer_transactions' "both" output: scores, flagged (score >=
    the bundle's decision_threshold), frame (polars DataFrame of the input
    plus risk_score), payload, json, n_nodes, n_edges.
    """
    return infer_transactions(to_model_input(df), bundle=get_bundle(), output="both")


def save_output(result: dict, first_id: int, last_id: int) -> Path:
    """Testing only: write the model's JSON output for one batch to a text file."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / f"batch_{first_id}-{last_id}.txt"
    path.write_text(result["json"], encoding="utf-8")
    return path
