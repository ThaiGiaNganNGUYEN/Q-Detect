"""AML-GNN: our own edge-classification GNN, built from aml-graph-gnn-detection.ipynb.

Same idea as the notebook -- accounts are nodes, transactions are edges, a GNN
builds account embeddings and an MLP classifies each transaction from
[sender embedding, receiver embedding, transaction features] -- with three
changes that matter for how the backend uses it:

1. Trained the way it is served. The backend scores 50k-transaction batches,
   and each batch is its own graph. Training uses the same 50k-row graphs, so
   node features and neighbourhoods look the same at train and serve time
   (GraphSAGE and QGNN were trained on one big graph, and lose accuracy when
   served on batches).
2. Edge-aware, two-direction message passing. GINEConv mixes each
   transaction's features into the message, and separate layers pass messages
   along and against the money flow, so "who paid me" and "who I paid" are
   learned separately. The notebook's GCN/GAT/SAGE ignored edge features and
   direction inside the graph layers.
3. No time-drift feature. Features are amounts (in AUD), currency/bank/self
   flags, hour/weekend/night and payment format -- not hours since the start
   of the data, which keeps growing and never matches training.

Feature scaling is stored as plain tensors (no pickled scikit-learn objects),
so the bundle loads with any library version.

    from amlgnn import load_amlgnn_bundle, infer_amlgnn

    bundle = load_amlgnn_bundle()  # model/amlgnn_v1.pt
    result = infer_amlgnn(records, bundle)
"""

import math
from pathlib import Path

import numpy as np
import polars as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GINEConv

from inference import RATES, build_graph_payload, with_graph_fields

MODEL_DIR = Path(__file__).resolve().parent / "model"
AMLGNN_BUNDLE_PATH = MODEL_DIR / "amlgnn_v2.pt"

# Only used to fill hours_from_start, which callers store; it's not a model feature.
T0 = "2022-09-01T00:00:00"

PAYMENT_FORMATS = ["ACH", "Bitcoin", "Cash", "Cheque", "Credit Card", "Reinvestment", "Wire"]
EDGE_FEATURES = [
    "log_amount_paid",
    "log_amount_received",
    "log_amount_ratio",
    "is_cross_currency",
    "is_cross_bank",
    "is_self_transfer",
    "hour_sin",
    "hour_cos",
    "is_weekend",
    "is_night",
    *[f"format_{f}" for f in PAYMENT_FORMATS],
]
# Added in v2: how a transaction sits among the batch's other transactions --
# repeated transfers, money flowing back, unusual amounts for the account,
# and bursts of activity (fan-in / fan-out, cycles, scatter-gather).
PATTERN_FEATURES = [
    "log_pair_count",
    "has_reverse_flow",
    "log_amount_vs_sender_avg",
    "log_amount_vs_receiver_avg",
    "log_minutes_since_sender_prev",
    "log_minutes_since_receiver_prev",
]
# build_graph computes all of these; a bundle's config lists the ones its model uses.
ALL_EDGE_FEATURES = EDGE_FEATURES + PATTERN_FEATURES
NO_PREVIOUS_MINUTES = 16 * 24 * 60  # gap used when the account has no earlier transaction
NODE_FEATURES = [
    "log_total_sent",
    "log_total_received",
    "log_tx_count_out",
    "log_tx_count_in",
    "log_unique_counterparties_out",
    "log_unique_counterparties_in",
    "log_avg_sent",
    "log_avg_received",
]


# --- Features -----------------------------------------------------------------

def _minutes_since_previous(account: np.ndarray, minutes: np.ndarray) -> np.ndarray:
    """Per transaction: minutes since the same account's previous transaction in the batch."""
    order = np.lexsort((minutes, account))
    acc, mins = account[order], minutes[order]
    gap = np.full(len(mins), NO_PREVIOUS_MINUTES, dtype=np.float64)
    same = acc[1:] == acc[:-1]
    gap[1:][same] = mins[1:][same] - mins[:-1][same]
    out = np.empty_like(gap)
    out[order] = gap
    return out


def build_graph(records) -> dict:
    """Raw IBM rows -> one graph: edge/node feature tensors plus the enriched frame.

    records needs the raw IBM CSV columns (Timestamp as "%Y/%m/%d %H:%M").
    Rows stay in input order, so edge i is records row i.
    """
    df = records if isinstance(records, pl.DataFrame) else pl.DataFrame(records)
    if df.height == 0:
        raise ValueError("No rows to score.")
    df = with_graph_fields(df.lazy(), rates=RATES).collect()
    df = df.with_columns(
        ((pl.col("ts") - pl.lit(T0).str.to_datetime()).dt.total_seconds() / 3600.0).alias("hours_from_start")
    )

    hour = df["ts"].dt.hour().to_numpy().astype(np.float32)
    weekday = df["ts"].dt.weekday().to_numpy()  # 1 = Monday ... 7 = Sunday
    paid = df["amount_paid_aud"].to_numpy().astype(np.float64)
    received = df["amount_received_aud"].to_numpy().astype(np.float64)
    payment_format = df["Payment Format"].cast(pl.Utf8).to_numpy()

    minutes = (df["ts"].dt.epoch("s") // 60).fill_null(0).to_numpy().astype(np.int64)

    # Local node ids for this graph only.
    nodes, inverse = np.unique(
        np.concatenate([df["sender_id"].to_numpy(), df["receiver_id"].to_numpy()]), return_inverse=True
    )
    n_edges, n_nodes = df.height, len(nodes)
    src, dst = inverse[:n_edges], inverse[n_edges:]

    # The notebook's 8 account aggregates, from this graph's transactions only.
    sent = np.bincount(src, weights=paid, minlength=n_nodes)
    received_total = np.bincount(dst, weights=received, minlength=n_nodes)
    out_count = np.bincount(src, minlength=n_nodes).astype(np.float64)
    in_count = np.bincount(dst, minlength=n_nodes).astype(np.float64)
    pairs = np.unique(np.stack([src, dst], axis=1), axis=0)
    unique_out = np.bincount(pairs[:, 0], minlength=n_nodes).astype(np.float64)
    unique_in = np.bincount(pairs[:, 1], minlength=n_nodes).astype(np.float64)
    avg_sent = np.divide(sent, out_count, out=np.zeros(n_nodes), where=out_count > 0)
    avg_received = np.divide(received_total, in_count, out=np.zeros(n_nodes), where=in_count > 0)
    node_x = np.log1p(np.column_stack([
        sent, received_total, out_count, in_count, unique_out, unique_in, avg_sent, avg_received,
    ])).astype(np.float32)

    pair_key = src.astype(np.int64) * n_nodes + dst
    _, pair_inverse, pair_counts = np.unique(pair_key, return_inverse=True, return_counts=True)
    reverse_key = dst.astype(np.int64) * n_nodes + src

    edge_x = np.column_stack([
        np.log1p(paid),
        np.log1p(received),
        np.clip(np.log((received + 1) / (paid + 1)), -5, 5),
        df["is_cross_currency"].to_numpy(),
        df["is_cross_bank"].to_numpy(),
        df["is_self_transfer"].to_numpy(),
        np.sin(2 * math.pi * hour / 24),
        np.cos(2 * math.pi * hour / 24),
        weekday >= 6,
        (hour >= 22) | (hour <= 5),
        *[payment_format == f for f in PAYMENT_FORMATS],
        # PATTERN_FEATURES
        np.log1p(pair_counts[pair_inverse]),
        np.isin(reverse_key, pair_key),
        np.clip(np.log((paid + 1) / (avg_sent[src] + 1)), -5, 5),
        np.clip(np.log((received + 1) / (avg_received[dst] + 1)), -5, 5),
        np.log1p(_minutes_since_previous(src, minutes)),
        np.log1p(_minutes_since_previous(dst, minutes)),
    ]).astype(np.float32)

    return {
        "frame": df,
        "edge_index": torch.from_numpy(np.stack([src, dst])).long(),
        "edge_x": torch.from_numpy(edge_x),
        "node_x": torch.from_numpy(node_x),
        "num_nodes": n_nodes,
    }


# --- Model --------------------------------------------------------------------

class TwoWayLayer(nn.Module):
    """One hop of message passing along and against the money flow, with edge features.

    With edge_updates, each transaction's hidden state is also refreshed from
    its two accounts' new states, so the next hop passes richer messages.
    """

    def __init__(self, hidden_dim, edge_dim, edge_updates=False):
        super().__init__()

        def gine():
            mlp = nn.Sequential(nn.Linear(hidden_dim, hidden_dim), nn.ReLU(), nn.Linear(hidden_dim, hidden_dim))
            return GINEConv(mlp, edge_dim=edge_dim)

        self.forward_conv = gine()  # receiver hears from sender
        self.reverse_conv = gine()  # sender hears from receiver
        self.norm = nn.BatchNorm1d(hidden_dim)
        self.edge_update = None
        if edge_updates:
            self.edge_update = nn.Sequential(
                nn.Linear(hidden_dim * 2 + edge_dim, edge_dim), nn.ReLU(), nn.Linear(edge_dim, edge_dim)
            )
            self.edge_norm = nn.BatchNorm1d(edge_dim)

    def forward(self, h, edge_index, e):
        out = self.forward_conv(h, edge_index, e) + self.reverse_conv(h, edge_index.flip(0), e)
        h = h + F.relu(self.norm(out))
        if self.edge_update is not None:
            src, dst = edge_index
            e = e + F.relu(self.edge_norm(self.edge_update(torch.cat([h[src], h[dst], e], dim=-1))))
        return h, e


class AMLGNN(nn.Module):
    def __init__(self, node_dim, edge_dim, hidden_dim=64, num_layers=2, dropout=0.2, edge_updates=False):
        super().__init__()
        self.dropout = dropout
        self.node_in = nn.Linear(node_dim, hidden_dim)
        # With edge updates, transactions get a hidden state of their own (hidden_dim wide).
        self.edge_in = nn.Linear(edge_dim, hidden_dim) if edge_updates else None
        layer_edge_dim = hidden_dim if edge_updates else edge_dim
        self.layers = nn.ModuleList(
            [TwoWayLayer(hidden_dim, layer_edge_dim, edge_updates) for _ in range(num_layers)]
        )
        head_in = hidden_dim * 2 + edge_dim + (hidden_dim if edge_updates else 0)
        self.edge_mlp = nn.Sequential(
            nn.Linear(head_in, 128),
            nn.ReLU(),
            nn.BatchNorm1d(128),
            nn.Dropout(dropout),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(64, 1),
        )

    def forward(self, node_x, edge_index, edge_x):
        h = F.relu(self.node_in(node_x))
        e = F.relu(self.edge_in(edge_x)) if self.edge_in is not None else edge_x
        for layer in self.layers:
            h, e = layer(h, edge_index, e)
            h = F.dropout(h, p=self.dropout, training=self.training)
        src, dst = edge_index
        parts = [h[src], h[dst], edge_x] + ([e] if self.edge_in is not None else [])
        return self.edge_mlp(torch.cat(parts, dim=-1)).squeeze(-1)


def edge_columns(edge_features: list[str]) -> list[int]:
    """Positions of a model's edge features in build_graph's edge_x."""
    return [ALL_EDGE_FEATURES.index(name) for name in edge_features]


def scale(graph: dict, stats: dict, edge_cols: list[int]) -> tuple[torch.Tensor, torch.Tensor]:
    """Pick the model's edge features and standardize with the training mean / std."""
    node_x = (graph["node_x"] - stats["node_mean"]) / stats["node_std"]
    edge_x = (graph["edge_x"][:, edge_cols] - stats["edge_mean"]) / stats["edge_std"]
    return node_x, edge_x


# --- Serving ------------------------------------------------------------------

def _feature_groups(edge_features: list[str]) -> dict:
    """Group a model's edge features the way /models/{name}/info reports them.

    All features are standardized the same way; this is only for reporting.
    Payment Format is listed once as categorical (it becomes the format_* one-hot columns).
    """
    binary = [f for f in edge_features if f.startswith(("is_", "has_"))]
    formats = [f for f in edge_features if f.startswith("format_")]
    return {
        "cont_cols": [f for f in edge_features if f not in binary and f not in formats],
        "cat_cols": ["Payment Format"] if formats else [],
        "bin_cols": binary,
    }


def load_amlgnn_bundle(path=None) -> dict:
    """Load a trained bundle. Returns model, config, stats, device, path."""
    path = Path(path or AMLGNN_BUNDLE_PATH)
    blob = torch.load(path, map_location="cpu", weights_only=False)
    cfg = blob["config"]
    net = AMLGNN(
        node_dim=len(cfg["node_features"]),
        edge_dim=len(cfg["edge_features"]),
        hidden_dim=cfg["hidden_dim"],
        num_layers=cfg["num_layers"],
        dropout=cfg["dropout"],
        edge_updates=cfg.get("edge_updates", False),
    )
    net.load_state_dict(blob["model_state"])
    net.eval()
    return {
        "model": net,
        "stats": blob["stats"],
        "edge_cols": edge_columns(cfg["edge_features"]),
        # model_info in service.py reads these from config.
        "config": {**cfg, "feature_names": cfg["edge_features"], "t0": T0,
                   **_feature_groups(cfg["edge_features"])},
        "device": torch.device("cpu"),
        "path": path,
    }


def infer_amlgnn(records, bundle, top_k=None) -> dict:
    """Score every transaction in records as one graph.

    Returns the same dict as inference.infer_transactions(output="both"),
    minus "json": scores, flagged, n_nodes, n_edges, frame, payload.
    """
    graph = build_graph(records)
    node_x, edge_x = scale(graph, bundle["stats"], bundle["edge_cols"])
    with torch.no_grad():
        probs = torch.sigmoid(bundle["model"](node_x, graph["edge_index"], edge_x)).numpy().astype(np.float64)

    scored = graph["frame"].with_columns(pl.Series("risk_score", probs))
    scores = probs.tolist()
    threshold = float(bundle["config"]["decision_threshold"])
    payload_df = scored if top_k is None else scored.sort("risk_score", descending=True).head(int(top_k))
    return {
        "scores": scores,
        "flagged": [s >= threshold for s in scores],
        "n_nodes": graph["num_nodes"],
        "n_edges": scored.height,
        "frame": scored,
        "payload": build_graph_payload(payload_df),
    }