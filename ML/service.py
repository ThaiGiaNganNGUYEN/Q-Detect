"""Model-serving microservice for the Q-Detect fraud models.

Loads every model in MODELS once at startup and keeps them in memory, so
callers like the backend's transaction poller don't pay the torch import and
weight load on every batch. Each model has its own URL, so a caller switches
models by changing the name in the path.

    uv run main.py    (or: uv run uvicorn service:app --port 8001)

Endpoints:
    GET  /health                  -- liveness, and which models are loaded
    GET  /models                  -- every model's name and decision threshold
    GET  /models/{name}/info      -- bundle path, device, threshold, feature config
    POST /models/{name}/predict   -- score a batch of transactions (raw IBM CSV columns)
    GET  /model/info, POST /predict -- the same, for DEFAULT_MODEL

Models:
    graphsage -- IBM HI-Medium mule-hunter GraphSAGE (inference.py)
    qgnn      -- quantum GNN from model_details_ver66 (qgnn_inference.py)
    amlgnn    -- our own GNN, trained by train_amlgnn.py (amlgnn.py); latest version (v2)
    amlgnn-v1 -- its first version, kept for comparison

All models take the same request and return the same response shape. A
model whose bundle file is missing is skipped at startup (its URLs return 503).
"""

from contextlib import asynccontextmanager
from typing import Any

import polars as pl
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from amlgnn import MODEL_DIR, infer_amlgnn, load_amlgnn_bundle
from inference import infer_transactions, load_infer_bundle
from qgnn_inference import infer_qgnn, load_qgnn_bundle


def _infer_graphsage(records, bundle, top_k):
    return infer_transactions(records, bundle=bundle, output="both", top_k=top_k)


# name -> (load the bundle, score records with it). Every infer function
# returns infer_transactions' "both" dict.
MODELS = {
    "graphsage": (load_infer_bundle, _infer_graphsage),
    "qgnn": (load_qgnn_bundle, infer_qgnn),
    "amlgnn": (load_amlgnn_bundle, infer_amlgnn),  # latest (v2)
    "amlgnn-v1": (lambda: load_amlgnn_bundle(MODEL_DIR / "amlgnn_v1.pt"), infer_amlgnn),
}
DEFAULT_MODEL = "graphsage"

# Columns infer_transactions derives from the input that callers need back
# (the backend stores them in the cache DB), returned in input row order.
DERIVED_COLUMNS = [
    "sender_id",
    "receiver_id",
    "hours_from_start",
    "is_cross_bank",
    "is_cross_currency",
    "is_self_transfer",
]

_bundles: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    for name, (load, _) in MODELS.items():
        try:
            _bundles[name] = load()
        except FileNotFoundError as e:
            print(f"[ml-service] Skipped {name}: {e}")
            continue
        print(f"[ml-service] Loaded {name}: {_bundles[name]['path'].name} on {_bundles[name]['device']}")
    yield
    _bundles.clear()


app = FastAPI(title="Q-Detect ML service", lifespan=lifespan)


class PredictRequest(BaseModel):
    transactions: list[dict[str, Any]] = Field(
        min_length=1,
        description=(
            "Rows with the raw IBM CSV columns: Timestamp ('%Y/%m/%d %H:%M'), From Bank, "
            "Account, To Bank, Account.1, Amount Received, Receiving Currency, Amount Paid, "
            "Payment Currency, Payment Format, and optionally Is Laundering. Send the whole "
            "neighborhood -- every row is message-passing context for the others."
        ),
    )
    top_k: int | None = Field(default=None, description="Keep only the top-k edges in payload.")
    include_payload: bool = Field(default=False, description="Also return the per-edge graph payload.")


class PredictResponse(BaseModel):
    model: str
    n_nodes: int
    n_edges: int
    decision_threshold: float
    scores: list[float]
    flagged: list[bool]
    features: dict[str, list[Any]]
    payload: dict[str, Any] | None = None


def get_bundle(name: str) -> dict:
    if name not in MODELS:
        raise HTTPException(status_code=404, detail=f"Unknown model {name!r}. Available: {', '.join(MODELS)}")
    if name not in _bundles:
        raise HTTPException(status_code=503, detail=f"Model {name!r} not loaded")
    return _bundles[name]


@app.get("/health")
def health():
    return {"status": "ok", "modelsLoaded": list(_bundles)}


@app.get("/models")
def list_models():
    return {
        "default": DEFAULT_MODEL,
        "models": [
            {"name": name, "decisionThreshold": float(bundle["config"]["decision_threshold"])}
            for name, bundle in _bundles.items()
        ],
    }


@app.get("/models/{name}/info")
def model_info(name: str):
    bundle = get_bundle(name)
    cfg = bundle["config"]
    return {
        "name": name,
        "path": str(bundle["path"]),
        "device": str(bundle["device"]),
        "decisionThreshold": float(cfg["decision_threshold"]),
        "featureNames": cfg["feature_names"],
        "contCols": cfg["cont_cols"],
        "catCols": cfg["cat_cols"],
        "binCols": cfg["bin_cols"],
        # Per-account features, for models whose bundle lists them (amlgnn).
        "nodeFeatures": cfg.get("node_features", []),
        "t0": cfg["t0"],
    }


# Plain def: FastAPI runs it in a worker thread, so a long batch doesn't
# block /health.
@app.post("/models/{name}/predict", response_model=PredictResponse)
def predict(name: str, req: PredictRequest):
    bundle = get_bundle(name)
    _, infer = MODELS[name]
    # Scan every row for the schema -- the default (first 100 rows) can guess
    # Int64 for an amount column that has floats further down.
    records = pl.DataFrame(req.transactions, infer_schema_length=None)
    try:
        result = infer(records, bundle, req.top_k)
    except (KeyError, ValueError, TypeError, pl.exceptions.ColumnNotFoundError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    frame = result["frame"]
    return PredictResponse(
        model=name,
        n_nodes=result["n_nodes"],
        n_edges=result["n_edges"],
        decision_threshold=float(bundle["config"]["decision_threshold"]),
        scores=result["scores"],
        flagged=result["flagged"],
        features={col: frame[col].to_list() for col in DERIVED_COLUMNS},
        payload=result["payload"] if req.include_payload else None,
    )


@app.get("/model/info")
def default_model_info():
    return model_info(DEFAULT_MODEL)


@app.post("/predict", response_model=PredictResponse)
def default_predict(req: PredictRequest):
    return predict(DEFAULT_MODEL, req)
