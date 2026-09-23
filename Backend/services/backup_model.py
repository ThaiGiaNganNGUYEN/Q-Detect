"""Backend inference for the IBM HI-Medium mule-hunter GraphSAGE.

The backend sends a neighborhood of transactions (not one isolated edge).
The GNN is 2-hop GraphSAGE, so surrounding accounts change the scores.

    from mule_hunter_infer import load_infer_bundle, infer_transactions

    bundle = load_infer_bundle("ibm_hi_medium_infer.pt")
    body = infer_transactions(payload["transactions"], bundle=bundle, output="json")

`output`:
    "scores" — list[float] aligned with input row order
    "json"   — graph payload string (per-edge fraud_risk_score, risk_label, flagged)
    "both"   — dict with scores, labels, flagged, frame, payload, json

Copy this file plus the trained `*.pt` bundle (weights + scaler + encoder +
decision_threshold). There is no separate model.py. Flag an edge when
`score >= bundle["config"]["decision_threshold"]` (also returned as `flagged`).
"""

from __future__ import annotations

import json
from datetime import datetime as _dt
from pathlib import Path

import numpy as np
import polars as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import SAGEConv
from torch_geometric.utils import degree

__all__ = [
    "RATES",
    "INFER_BUNDLE_PATH",
    "MuleHunterGNN",
    "pick_device",
    "with_graph_fields",
    "save_infer_bundle",
    "load_infer_bundle",
    "infer_transactions",
    "build_graph_payload",
]

RATES = {
    "US Dollar": 1.4,
    "Euro": 1.64,
    "Bitcoin": 90000.0,
    "Yuan": 0.2,
    "Yen": 0.0067,
    "UK Pound": 2.0,
    "Brazil Real": 0.2,
    "Australian Dollar": 1.0,
    "Rupee": 0.01,
    "Ruble": 0.01,
    "Canadian Dollar": 1.25,
    "Mexican Peso": 0.07,
    "Swiss Franc": 1.5,
    "Shekel": 0.25,
    "Saudi Riyal": 0.25,
}

INFER_BUNDLE_PATH = Path("ibm_hi_medium_infer.pt")

CONT_COLS = ["amount", "hours_from_start"]
CAT_COLS = ["Payment Format"]
BIN_COLS = ["is_self_transfer", "is_cross_bank", "is_cross_currency"]


def pick_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class MuleHunterGNN(nn.Module):
    """Edge classifier: GraphSAGE on a message-passing edge set, MLP on query edges."""

    def __init__(self, node_in_dim, edge_attr_dim, hidden_dim=64, dropout=0.2):
        super().__init__()
        self.dropout_p = dropout
        self.node_proj = nn.Linear(node_in_dim, hidden_dim)
        self.conv1 = SAGEConv(hidden_dim, hidden_dim)
        self.conv2 = SAGEConv(hidden_dim, hidden_dim)
        self.predictor = nn.Sequential(
            nn.Linear(hidden_dim * 2 + edge_attr_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, 1),
        )

    def encode(self, x, mp_edge_index):
        """Node embeddings after 2-hop SAGE (used for Laplacian regularisation)."""
        x = self.node_proj(x)
        x = F.relu(self.conv1(x, mp_edge_index))
        x = F.dropout(x, p=self.dropout_p, training=self.training)
        x = F.relu(self.conv2(x, mp_edge_index))
        return x

    def predict_edges(self, h, query_index, query_attr):
        edge_input = torch.cat([h[query_index[0]], h[query_index[1]], query_attr], dim=-1)
        return self.predictor(edge_input).squeeze(-1)

    def forward(self, x, mp_edge_index, query_index, query_attr):
        h = self.encode(x, mp_edge_index)
        return self.predict_edges(h, query_index, query_attr)

    @torch.no_grad()
    def inference(self, x, edge_index, edge_attr):
        self.eval()
        probs = torch.sigmoid(self.forward(x, edge_index, edge_index, edge_attr))
        return probs, probs.max()


def dest_account_col(names):
    """Polars may keep CSV 'Account.1' or rename the 2nd Account column."""
    for name in ("Account.1", "Account_duplicated_0", "Account_right"):
        if name in names:
            return name
    raise KeyError(
        "Could not find destination account column. Schema names: " + ", ".join(names)
    )


def with_graph_fields(lazy: pl.LazyFrame, rates=None, verbose=False) -> pl.LazyFrame:
    """Composite node IDs, timestamps, AUD amounts, and AML flags."""
    rates = rates or RATES
    names = list(lazy.collect_schema().names())
    dest_col = dest_account_col(names)
    if verbose:
        print(f"Destination account column: {dest_col!r}")
    return (
        lazy.with_columns(
            pl.col("From Bank").cast(pl.Utf8),
            pl.col("To Bank").cast(pl.Utf8),
            pl.col("Account").cast(pl.Utf8),
            pl.col(dest_col).cast(pl.Utf8).alias("_dest_acct"),
        )
        .with_columns(
            (pl.col("Account") + "_" + pl.col("From Bank")).alias("sender_id"),
            (pl.col("_dest_acct") + "_" + pl.col("To Bank")).alias("receiver_id"),
            pl.col("Timestamp").str.to_datetime("%Y/%m/%d %H:%M", strict=False).alias("ts"),
            (
                pl.col("Amount Paid")
                * pl.col("Payment Currency").replace_strict(rates, default=1.0)
            ).alias("amount_paid_aud"),
            (
                pl.col("Amount Received")
                * pl.col("Receiving Currency").replace_strict(rates, default=1.0)
            ).alias("amount_received_aud"),
        )
        .with_columns(
            ((pl.col("amount_paid_aud") + pl.col("amount_received_aud")) / 2).alias("amount"),
            (pl.col("sender_id") == pl.col("receiver_id")).cast(pl.Int8).alias("is_self_transfer"),
            (pl.col("From Bank") != pl.col("To Bank")).cast(pl.Int8).alias("is_cross_bank"),
            (pl.col("Payment Currency") != pl.col("Receiving Currency"))
            .cast(pl.Int8)
            .alias("is_cross_currency"),
        )
    )


def _json_t0(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _parse_t0(value):
    if isinstance(value, _dt):
        return value
    text = str(value).replace("Z", "")
    try:
        return _dt.fromisoformat(text)
    except ValueError:
        return _dt.strptime(text[:19], "%Y-%m-%d %H:%M:%S")


def _as_polars(records):
    if isinstance(records, pl.DataFrame):
        return records
    if isinstance(records, pl.LazyFrame):
        return records.collect()
    if isinstance(records, (list, tuple)):
        return pl.DataFrame(list(records))
    try:
        import pandas as pd

        if isinstance(records, pd.DataFrame):
            return pl.from_pandas(records)
    except ImportError:
        pass
    raise TypeError("infer_transactions expected a DataFrame or list of dicts")




def save_infer_bundle(
    path=None,
    model=None,
    pack=None,
    params=None,
    rates=None,
    cont_cols=None,
    cat_cols=None,
    bin_cols=None,
    decision_threshold=0.5,
):
    """Persist weights + the fitted scaler/encoder so serving does not re-fit."""
    path = Path(path or INFER_BUNDLE_PATH)
    if model is None or pack is None:
        raise ValueError("save_infer_bundle requires model and pack.")
    if pack.scaler is None or pack.cat_encoder is None:
        raise ValueError("pack.scaler / pack.cat_encoder missing — run prepare_gnn_data first.")
    params = params or {}
    t0 = pack.df["ts"].min()
    clip = 10.0
    blob = {
        "model_state": {k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()},
        "scaler": pack.scaler,
        "cat_encoder": pack.cat_encoder,
        "config": {
            "node_in_dim": int(pack.node_features.shape[1]),
            "edge_attr_dim": int(pack.edge_attr.shape[1]),
            "hidden_dim": int(params.get("hidden_dim", model.conv1.out_channels)),
            "dropout": float(params.get("dropout", getattr(model, "dropout_p", 0.2))),
            "clip": clip,
            "t0": _json_t0(t0),
            "cont_cols": list(cont_cols or CONT_COLS),
            "cat_cols": list(cat_cols or CAT_COLS),
            "bin_cols": list(bin_cols or BIN_COLS),
            "feature_names": list(pack.feature_names),
            "rates": dict(rates or RATES),
            "src_col": "sender_id",
            "dst_col": "receiver_id",
            "time_col": "ts",
            "label_col": "Is Laundering",
            "decision_threshold": float(decision_threshold),
            "mp_policy": "split_prefix_v1",
            "seed_policy": "train_fraud_v1",
        },
    }
    torch.save(blob, path)
    print(f"Wrote inference bundle → {path.resolve()}")
    return path


def load_infer_bundle(path=None, device=None):
    """Load scaler, one-hot, config, and a CPU/GPU-ready MuleHunterGNN."""
    path = Path(path or INFER_BUNDLE_PATH)
    if not path.is_file():
        raise FileNotFoundError(
            f"{path} not found. Train mule_hunter_ibm.ipynb first so the bundle is written."
        )
    device = device or pick_device()
    try:
        blob = torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        blob = torch.load(path, map_location="cpu")

    cfg = blob["config"]
    net = MuleHunterGNN(
        node_in_dim=cfg["node_in_dim"],
        edge_attr_dim=cfg["edge_attr_dim"],
        hidden_dim=cfg["hidden_dim"],
        dropout=cfg["dropout"],
    )
    net.load_state_dict(blob["model_state"])
    net.to(device)
    net.eval()
    return {
        "model": net,
        "scaler": blob["scaler"],
        "cat_encoder": blob["cat_encoder"],
        "config": cfg,
        "device": device,
        "path": path,
    }


def ensure_graph_fields(records, rates=None) -> pl.DataFrame:
    """IBM CSV columns → sender_id / amount / flags. No-op if already cleaned."""
    df = _as_polars(records)
    needed = {"sender_id", "receiver_id", "amount", "Payment Format", "ts"}
    flags = {"is_self_transfer", "is_cross_bank", "is_cross_currency"}
    if needed.issubset(df.columns) and flags.issubset(df.columns):
        if df.schema["ts"] == pl.Utf8:
            df = df.with_columns(
                pl.col("ts").str.to_datetime("%Y/%m/%d %H:%M", strict=False)
            )
        return df
    return with_graph_fields(df.lazy(), rates=rates, verbose=False).collect()


def prepare_inference_graph(records, bundle):
    """Same edge_attr recipe as training, but transform-only and local node ids."""
    cfg = bundle["config"]
    src_col = cfg["src_col"]
    dst_col = cfg["dst_col"]
    time_col = cfg["time_col"]
    cont_cols = cfg["cont_cols"]
    cat_cols = cfg["cat_cols"]
    bin_cols = cfg["bin_cols"]
    clip = float(cfg.get("clip", 10.0))
    t0 = _parse_t0(cfg["t0"])
    label_col = cfg.get("label_col", "Is Laundering")
    rates = cfg.get("rates") or RATES

    work = ensure_graph_fields(records, rates=rates)
    if work.height == 0:
        raise ValueError("No rows to score.")

    work = work.with_columns(
        ((pl.col(time_col) - pl.lit(t0)).dt.total_seconds() / 3600.0).alias("hours_from_start")
    )

    missing = [
        c for c in cont_cols + cat_cols + bin_cols + [src_col, dst_col] if c not in work.columns
    ]
    if missing:
        raise KeyError("inference graph missing columns: " + ", ".join(missing))

    X_cont = work.select(list(cont_cols)).cast(pl.Float64).to_numpy()
    X_cont_scaled = np.clip(bundle["scaler"].transform(X_cont), -clip, clip).astype(np.float32)

    X_cat_raw = work.select(list(cat_cols)).cast(pl.Utf8).to_numpy()
    if X_cat_raw.ndim == 1:
        X_cat_raw = X_cat_raw.reshape(-1, 1)
    X_cat = bundle["cat_encoder"].transform(X_cat_raw).astype(np.float32)
    X_bin = work.select(list(bin_cols)).cast(pl.Float32).to_numpy()
    edge_features = np.hstack([X_cont_scaled, X_cat, X_bin])

    src_names = work[src_col].to_numpy()
    dst_names = work[dst_col].to_numpy()
    all_nodes = np.unique(np.concatenate([src_names, dst_names]))
    nodes_df = pl.DataFrame({"name": all_nodes}).with_row_index("node_id")
    work = (
        work.with_row_index("_row_ord")
        .join(nodes_df, left_on=src_col, right_on="name", how="left")
        .rename({"node_id": "src_id"})
        .join(nodes_df, left_on=dst_col, right_on="name", how="left")
        .rename({"node_id": "dst_id"})
        .sort("_row_ord")
        .drop("_row_ord")
    )
    src = work["src_id"].to_numpy()
    dst = work["dst_id"].to_numpy()
    num_nodes = len(all_nodes)

    edge_index = torch.tensor(np.vstack([src, dst]), dtype=torch.long)
    edge_attr = torch.tensor(edge_features, dtype=torch.float)
    out_deg = torch.log1p(degree(edge_index[0], num_nodes=num_nodes, dtype=torch.float))
    in_deg = torch.log1p(degree(edge_index[1], num_nodes=num_nodes, dtype=torch.float))
    node_features = torch.stack([in_deg, out_deg], dim=1)

    labels = None
    if label_col in work.columns:
        labels = work[label_col].cast(pl.Int8).to_numpy()

    return {
        "df": work,
        "edge_index": edge_index,
        "edge_attr": edge_attr,
        "node_features": node_features,
        "labels": labels,
        "num_nodes": num_nodes,
    }


def build_graph_payload(df_subset):
    """Per-edge risk JSON for the backend / UI. true_label is null when absent."""
    n_nodes = pl.concat([df_subset["sender_id"], df_subset["receiver_id"]]).n_unique()
    n_edges = df_subset.height
    payload = {
        "topology_metrics": {
            "account_count": int(n_nodes),
            "transaction_count": int(n_edges),
        },
        "transactions": [],
    }
    for row in df_subset.iter_rows(named=True):
        score = float(row["risk_score"])

        payload["transactions"].append(
            {
                "source_account": row["sender_id"],
                "destination_account": row["receiver_id"],
                "transaction_features": {
                    "amount": float(row["amount"]),
                    "payment_format": str(row["Payment Format"]),
                    "hours_from_start": float(row["hours_from_start"]),
                    "is_cross_bank": int(row["is_cross_bank"]),
                    "is_cross_currency": int(row["is_cross_currency"]),
                    "is_self_transfer": int(row["is_self_transfer"]),
                },
                "fraud_risk_score": round(score, 4),
            }
        )
    return payload


def infer_transactions(
    records,
    bundle=None,
    output="both",
    graph_id="inference",
    top_k=None,
    path=None,
):
    """Score raw (or cleaned) transactions.

    Parameters
    ----------
    records : list[dict] | polars/pandas DataFrame
        Send the target txs plus k-hop neighbors. One lonely edge is not enough.
    bundle : dict from load_infer_bundle, or None to load from `path`
    output : {"scores", "json", "both"}
    graph_id : str
    top_k : int or None
        If set, the JSON only keeps the highest-scoring edges (full scores still returned).
    path : bundle path used when bundle is None
    """
    if bundle is None:
        bundle = load_infer_bundle(path=path)
    output = output.lower()
    if output not in {"scores", "json", "both"}:
        raise ValueError("output must be 'scores', 'json', or 'both'")

    graph = prepare_inference_graph(records, bundle)
    device = bundle["device"]
    net = bundle["model"]
    x = graph["node_features"].to(device)
    edge_index = graph["edge_index"].to(device)
    edge_attr = graph["edge_attr"].to(device)

    net.eval()
    with torch.no_grad():
        logits = net(x, edge_index, edge_index, edge_attr)
        probs = torch.sigmoid(logits).detach().cpu().numpy().astype(np.float64)

    scored = graph["df"].with_columns(pl.Series("risk_score", probs))
    scores = probs.tolist()
    thr = float(bundle["config"].get("decision_threshold", 0.5))
    flagged = [bool(s >= thr) for s in scores]

    payload_df = scored
    if top_k is not None:
        payload_df = scored.sort("risk_score", descending=True).head(int(top_k))
    payload = build_graph_payload(payload_df)

    if output == "scores":
        return scores
    if output == "json":
        return json.dumps(payload, indent=2)

    return {
        "scores": scores,
        "flagged": flagged,
        "n_nodes": graph["num_nodes"],
        "n_edges": scored.height,
        "frame": scored,
        "payload": payload,
        "json": json.dumps(payload, indent=2),
    }
