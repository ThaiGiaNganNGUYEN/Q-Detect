"""Measure every ML-service model's real accuracy on staging transactions.

Scores the same staging batches with each model through the running ML
service -- the exact path the poller uses (50k consecutive transactions per
request) -- and compares the scores with staging's Is Laundering labels.
Nothing is written to the cache DB.

Staging is IBM HI-Small; every model was trained on HI-Medium, so all of it
is unseen data. Its rows after 10 Sep are a dataset artifact (~60%
laundering) and are left out.

Needs the ML service and the staging DB running (the backend app doesn't):
    uv run python -m scripts.evaluate_models
    uv run python -m scripts.evaluate_models --batches 40 --models amlgnn graphsage

Writes output/evaluation/evaluation_<timestamp>.json and prints a summary.
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

import httpx
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score
from sqlmodel import text

from db import get_staging_engine
from services.transaction_scoring import MODEL_COLUMNS, ML_SERVICE_URL, to_model_input

BATCH_SIZE = 50_000  # the poller's batch size
WINDOW_END = "2022-09-10 23:59"  # later rows are HI-Small's laundering-only tail
REVIEW_BUDGET = 50  # alerts analysts could review per 50k batch (0.1%)
OUT_DIR = Path(__file__).resolve().parents[1] / "output" / "evaluation"


def pick_batches(n: int) -> list[tuple[int, int]]:
    """n batches of 50k consecutive staging ids, spread evenly over 1-10 Sep."""
    with get_staging_engine().connect() as conn:
        last_id = conn.execute(
            text("SELECT max(id) FROM staging_transaction WHERE timestamp <= :end"), {"end": WINDOW_END}
        ).scalar()
    full = last_id // BATCH_SIZE
    starts = np.linspace(0, full - 1, num=min(n, full)).round().astype(int)
    return [(int(s) * BATCH_SIZE, int(s + 1) * BATCH_SIZE) for s in starts]


def fetch(first: int, last: int) -> pd.DataFrame:
    return pd.read_sql(
        text("SELECT * FROM staging_transaction WHERE id > :first AND id <= :last ORDER BY id"),
        get_staging_engine(),
        params={"first": first, "last": last},
    )


def score(client: httpx.Client, model: str, rows_json: str) -> tuple[list[float], list[bool], float]:
    t = time.time()
    response = client.post(
        f"/models/{model}/predict",
        content=f'{{"transactions": {rows_json}}}',
        headers={"Content-Type": "application/json"},
    )
    response.raise_for_status()
    body = response.json()
    return body["scores"], body["flagged"], time.time() - t


def summarize(y: np.ndarray, scores: np.ndarray, flagged: np.ndarray, batch_ids: np.ndarray, seconds: float) -> dict:
    tp = int((flagged & (y == 1)).sum())
    alerts = int(flagged.sum())
    positives = int(y.sum())
    # Catch rate if analysts only review the REVIEW_BUDGET riskiest transactions of each batch.
    caught_in_budget = 0
    for b in np.unique(batch_ids):
        idx = np.flatnonzero(batch_ids == b)
        top = idx[np.argsort(-scores[idx])[:REVIEW_BUDGET]]
        caught_in_budget += int(y[top].sum())
    n_batches = len(np.unique(batch_ids))
    return {
        "auprc": float(average_precision_score(y, scores)),
        "auroc": float(roc_auc_score(y, scores)),
        "alerts": alerts,
        "true_alerts": tp,
        "false_alerts": alerts - tp,
        "precision": tp / alerts if alerts else 0.0,
        "recall": tp / positives if positives else 0.0,
        "f1": 2 * tp / (alerts + positives) if alerts + positives else 0.0,
        "alerts_per_batch": alerts / n_batches,
        "recall_at_budget": caught_in_budget / positives if positives else 0.0,
        "precision_at_budget": caught_in_budget / (REVIEW_BUDGET * n_batches),
        "seconds_per_batch": seconds / n_batches,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--batches", type=int, default=20, help="50k batches to score (default 20 = 1M transactions)")
    parser.add_argument("--models", nargs="*", help="models to compare (default: every model the service has loaded)")
    args = parser.parse_args()

    client = httpx.Client(base_url=ML_SERVICE_URL, timeout=900)
    loaded = client.get("/health").json()["modelsLoaded"]
    models = args.models or loaded
    thresholds = {m: client.get(f"/models/{m}/info").json()["decisionThreshold"] for m in models}
    batches = pick_batches(args.batches)
    print(f"Scoring {len(batches)} batches x {BATCH_SIZE:,} transactions with {', '.join(models)}")

    labels, batch_ids = [], []
    results = {m: {"scores": [], "flagged": [], "seconds": 0.0} for m in models}
    for i, (first, last) in enumerate(batches, 1):
        df = fetch(first, last)
        rows_json = to_model_input(df)[MODEL_COLUMNS].to_json(orient="records")
        labels.append(df["isLaundering"].to_numpy().astype(int))
        batch_ids.append(np.full(len(df), i))
        line = []
        for m in models:
            s, f, secs = score(client, m, rows_json)
            results[m]["scores"] += s
            results[m]["flagged"] += f
            results[m]["seconds"] += secs
            line.append(f"{m} {secs:.1f}s")
        print(f"  batch {i:2d}/{len(batches)} ids {first + 1:,}-{last:,} "
              f"({int(labels[-1].sum())} laundering): {', '.join(line)}", flush=True)

    y, batch_ids = np.concatenate(labels), np.concatenate(batch_ids)
    summary = {
        m: summarize(y, np.array(r["scores"]), np.array(r["flagged"]), batch_ids, r["seconds"])
        | {"threshold": thresholds[m]}
        for m, r in results.items()
    }

    print(f"\n=== {len(y):,} transactions, {int(y.sum()):,} laundering ({y.mean():.3%}) ===")
    print(f"{'model':10s} {'AUPRC':>6s} {'alerts':>7s} {'real':>5s} {'prec':>6s} {'recall':>6s} "
          f"{'catch@50':>8s} {'s/batch':>7s}")
    for m, s in summary.items():
        print(f"{m:10s} {s['auprc']:6.3f} {s['alerts']:7,} {s['true_alerts']:5,} {s['precision']:6.1%} "
              f"{s['recall']:6.1%} {s['recall_at_budget']:8.1%} {s['seconds_per_batch']:7.1f}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"evaluation_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps({
        "created": datetime.now().isoformat(timespec="seconds"),
        "data": "staging (IBM HI-Small), 1-10 Sep 2022; models trained on HI-Medium",
        "batches": [{"first_id": a + 1, "last_id": b} for a, b in batches],
        "transactions": int(len(y)),
        "laundering": int(y.sum()),
        "review_budget_per_batch": REVIEW_BUDGET,
        "models": summary,
    }, indent=2))
    print(f"\nWrote {out}")


if __name__ == "__main__":
    main()
