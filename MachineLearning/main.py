"""FastAPI inference server for the QGNN trained in Model_A_Lachlan/main_quantumconv.ipynb.

Startup loads one serving bundle `ibm_graph.pt` (weights + scaler/encoder + dims).
`/predict` scores a neighbourhood of cleaned payments: every row is an edge, every
edge gets a score. Known and unknown accounts are opaque strings. Send the target
txs plus k-hop neighbors; one lonely edge is not enough.

Override the path with IBM_GRAPH_PATH.
"""

from __future__ import annotations

import json
import math
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import numpy as np
import pennylane as qml
import polars as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from torch_geometric.utils import degree, softmax

HERE = Path(__file__).resolve().parent

FANOUTS = (2,)  # one hop, sampled inside the pre-sliced train/val graph
MAX_Q_EDGES = 256  # hard cap on VQC edges per forward (same as the notebook)
BATCH_SIZE = 512
N_QUBITS_DEFAULT = 2
MP_POLICY = "split_prefix_v1"
NODE_FEAT_POLICY = "train_log1p_degree_v1"
CONT_COLS = ["amount", "hours_from_start"]
CAT_COLS = ["Payment Format"]
BIN_COLS = ["is_self_transfer", "is_cross_bank", "is_cross_currency"]
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
FALLBACK_BEST_PARAMS = {
    "optimizer": "AdamW",
    "lr": 0.009378125543991336,
    "weight_decay": 7.476801079666406e-05,
    "hidden_dim": 64,
    "dropout": 0.11156817334385223,
    "pos_weight_factor": 0.8048234311904515,
}
INDUCTIVE_REBUILD_MSG = (
    "ibm_graph.pt is missing scaler/cat_encoder/t0. Re-run the train cell in "
    "Model_A_Lachlan/main_quantumconv.ipynb so the serving bundle is written."
)


def _candidate_paths(env_key: str, filename: str) -> list[Path]:
    paths: list[Path] = []
    env = os.environ.get(env_key)
    if env:
        paths.append(Path(env).expanduser())
    paths.extend(
        [
            HERE / "Model_A_Lachlan" / filename,
            HERE / filename,
            Path.cwd() / filename,
            Path.cwd() / "Model_A_Lachlan" / filename,
        ]
    )
    seen: set[str] = set()
    uniq: list[Path] = []
    for path in paths:
        key = str(path.resolve()) if path.exists() else str(path)
        if key not in seen:
            seen.add(key)
            uniq.append(path)
    return uniq


def resolve_existing(env_key: str, filename: str) -> Path | None:
    for path in _candidate_paths(env_key, filename):
        if path.is_file():
            return path
    return None


def pick_device(qdev=None) -> torch.device:
    """Match the notebook: keep tensors on CPU unless the PennyLane device is GPU."""
    if qdev is not None:
        name = str(getattr(qdev, "name", qdev)).lower()
        if "gpu" in name and torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def make_qdevice(n_qubits: int):
    if torch.cuda.is_available():
        try:
            return qml.device("lightning.gpu", wires=n_qubits)
        except Exception as err:
            print("lightning.gpu unavailable:", err)
    try:
        return qml.device("lightning.qubit", wires=n_qubits)
    except Exception as err:
        print("lightning.qubit unavailable:", err)
        return qml.device("default.qubit", wires=n_qubits)


def to_torch_device(module: nn.Module, device: torch.device) -> nn.Module:
    module.to(device)
    for child in module.modules():
        if isinstance(child, qml.qnn.TorchLayer):
            child.to(device)
    return module


def build_incident_csr(edge_index: torch.Tensor, num_nodes: int):
    src, dst = edge_index[0], edge_index[1]
    eids = torch.arange(edge_index.size(1), device=edge_index.device)
    nodes = torch.cat([src, dst])
    edges = torch.cat([eids, eids])
    order = torch.argsort(nodes)
    nodes = nodes[order]
    edges = edges[order]
    counts = torch.bincount(nodes, minlength=num_nodes)
    ptr = torch.empty(num_nodes + 1, dtype=torch.long, device=edge_index.device)
    ptr[0] = 0
    ptr[1:] = torch.cumsum(counts, dim=0)
    return ptr, edges


def gather_incident_eids(node_set, ptr, eids):
    if node_set.numel() == 0:
        return eids.new_empty(0)
    starts = ptr[node_set]
    deg = ptr[node_set + 1] - starts
    nz = deg > 0
    if not torch.any(nz):
        return eids.new_empty(0)
    starts = starts[nz]
    deg = deg[nz]
    total = int(deg.sum().item())
    row = torch.repeat_interleave(torch.arange(starts.numel(), device=node_set.device), deg)
    inner = torch.arange(total, device=node_set.device) - torch.repeat_interleave(
        torch.cumsum(deg, 0) - deg, deg
    )
    return eids[starts[row] + inner].unique()


def sample_subgraph(seed_nodes, edge_index, edge_attr, fanouts, ptr, eids):
    node_set = seed_nodes.unique()
    keep_parts = []
    for fanout in fanouts:
        inc = gather_incident_eids(node_set, ptr, eids)
        if inc.numel() == 0:
            break
        cap = fanout * int(node_set.numel())
        if inc.numel() > cap:
            pick = torch.randperm(inc.numel(), device=inc.device)[:cap]
            inc = inc[pick]
        keep_parts.append(inc)
        node_set = torch.cat([node_set, edge_index[0, inc], edge_index[1, inc]]).unique()
    if not keep_parts:
        return edge_index[:, :0], edge_attr[:0]
    keep = torch.cat(keep_parts).unique()
    return edge_index[:, keep], edge_attr[keep]


def compact_nodes(sub_index, extra_nodes):
    used = torch.cat([extra_nodes, sub_index.reshape(-1)]).unique()
    mapper = torch.empty(int(used.max().item()) + 1, dtype=torch.long, device=used.device)
    mapper[used] = torch.arange(used.numel(), device=used.device)
    sub_local = mapper[sub_index] if sub_index.numel() else sub_index
    return used, mapper, sub_local


def make_qgnn(
    n_qubits: int,
    node_attr_dim: int,
    edge_attr_dim: int,
    hidden_dim: int,
    dropout: float,
    num_nodes: int = 0,
    fanouts=FANOUTS,
    max_q_edges: int = MAX_Q_EDGES,
) -> nn.Module:
    """QGNN from main_quantumconv.ipynb, with the VQC closed over this n_qubits."""
    qdev = make_qdevice(n_qubits)

    @qml.qnode(qdev, interface="torch", diff_method="adjoint")
    def quantum_circuit(inputs, weights):
        for i in range(n_qubits):
            qml.RY(inputs[..., i], wires=i)
        qml.templates.StronglyEntanglingLayers(weights, wires=range(n_qubits))
        return [qml.expval(qml.PauliZ(i)) for i in range(n_qubits)]

    class QuantumLayer(nn.Module):
        def __init__(self):
            super().__init__()
            self.qlayer = qml.qnn.TorchLayer(
                quantum_circuit, {"weights": (1, n_qubits, 3)}
            )

        def forward(self, x):
            return self.qlayer(x).to(x.device)

    class QuantumWeightedConv(nn.Module):
        def __init__(self, hidden_dim):
            super().__init__()
            self.update = nn.Linear(hidden_dim * 2, hidden_dim)

        def forward(self, x, edge_index, alpha):
            if edge_index.size(1) == 0:
                return x
            src, dst = edge_index[0], edge_index[1]
            msg = x[src] * alpha.unsqueeze(-1)
            agg = torch.zeros_like(x)
            agg.index_add_(0, dst, msg)
            return F.relu(self.update(torch.cat([x, agg], dim=-1)))

    class QGNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.num_nodes = num_nodes
            self.fanouts = fanouts
            self.max_q_edges = max_q_edges
            self.dropout = dropout
            self.node_enc = nn.Linear(node_attr_dim, hidden_dim)
            self.q_layer = QuantumLayer()
            self.to_qubits = nn.Linear(hidden_dim * 2 + edge_attr_dim, n_qubits)
            self.att = nn.Linear(n_qubits, 1)
            # classical attention on every subgraph edge; VQC scores are added on a capped subset
            self.gat_att = nn.Linear(hidden_dim * 2 + edge_attr_dim, 1)
            self.convs = nn.ModuleList(
                [QuantumWeightedConv(hidden_dim) for _ in fanouts]
            )
            self.classifier = nn.Linear(hidden_dim * 2 + edge_attr_dim, 1)

        def quantum_alphas(self, x, edge_index, edge_attr):
            if edge_index.size(1) == 0:
                return edge_index.new_zeros(0)
            src, dst = edge_index[0], edge_index[1]
            pair = torch.cat([x[src], x[dst], edge_attr], dim=-1)
            logits = F.leaky_relu(self.gat_att(pair).squeeze(-1), 0.2)
            angles = math.pi * torch.tanh(self.to_qubits(pair))
            n = angles.size(0)
            if n > self.max_q_edges:
                keep = torch.randperm(n, device=angles.device)[: self.max_q_edges]
                q_logits = F.leaky_relu(self.att(self.q_layer(angles[keep])).squeeze(-1), 0.2)
                logits = logits.clone()
                logits[keep] = logits[keep] + q_logits
            else:
                q_logits = F.leaky_relu(self.att(self.q_layer(angles)).squeeze(-1), 0.2)
                logits = logits + q_logits
            return softmax(logits, dst)

        def forward(self, x, mp_edge_index, mp_edge_attr, edge_index, edge_attr, edge_batch, mp_ptr, mp_eids):
            src, dst = edge_index[0, edge_batch], edge_index[1, edge_batch]
            seeds = torch.cat([src, dst])
            sub_index, sub_attr = sample_subgraph(
                seeds, mp_edge_index, mp_edge_attr, self.fanouts, mp_ptr, mp_eids
            )
            used, mapper, sub_local = compact_nodes(sub_index, seeds)
            src_l, dst_l = mapper[src], mapper[dst]
            h = F.relu(self.node_enc(x[used]))
            h = F.dropout(h, p=self.dropout, training=self.training)
            alpha = self.quantum_alphas(h, sub_local, sub_attr)
            for conv in self.convs:
                h = conv(h, sub_local, alpha)
                h = F.dropout(h, p=self.dropout, training=self.training)
            ea = edge_attr[edge_batch]
            return self.classifier(torch.cat([h[src_l], h[dst_l], ea], dim=-1)).squeeze(-1)

    return QGNN()


def load_best_params() -> dict:
    path = resolve_existing("QGNN_BEST_PARAMS_PATH", "best_params.json")
    if path is None:
        nested = HERE / "Model_A_Lachlan" / "best_params.json"
        path = nested if nested.is_file() else None
    if path is None:
        return dict(FALLBACK_BEST_PARAMS)
    with path.open() as handle:
        return json.load(handle)


def torch_load(path: Path, map_location="cpu"):
    try:
        return torch.load(path, map_location=map_location, weights_only=False)
    except TypeError:
        return torch.load(path, map_location=map_location)


def build_edge_lookup(edge_index: torch.Tensor) -> dict[tuple[int, int], list[int]]:
    src = edge_index[0].tolist()
    dst = edge_index[1].tolist()
    lookup: dict[tuple[int, int], list[int]] = {}
    for i, (s, d) in enumerate(zip(src, dst)):
        lookup.setdefault((int(s), int(d)), []).append(i)
    return lookup


def risk_label(score: float) -> str:
    if score > 0.90:
        return "CRITICAL"
    if score > 0.75:
        return "HIGH"
    if score > 0.50:
        return "MEDIUM"
    return "LOW"



def _parse_t0(value) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        # seconds since epoch (also accept ms if clearly too large)
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts)
    text = str(value).replace("Z", "").strip()
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        pass
    try:
        return datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        pass
    try:
        ts = float(text)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts)
    except ValueError as err:
        raise ValueError(
            f"Could not parse t0/ts {value!r}; expected ISO datetime or Unix epoch"
        ) from err


def _as_polars(records) -> pl.DataFrame:
    if isinstance(records, pl.DataFrame):
        return records
    if isinstance(records, (list, tuple)):
        return pl.DataFrame(list(records))
    raise TypeError("prepare_inference_graph expected a DataFrame or list of dicts")


def ensure_graph_fields(records) -> pl.DataFrame:
    """Require cleaned neighbourhood columns. Flags must already be filled."""
    df = _as_polars(records)
    needed = {"sender_id", "receiver_id", "amount", "Payment Format", "ts"}
    flags = {"is_self_transfer", "is_cross_bank", "is_cross_currency"}
    missing = sorted((needed | flags) - set(df.columns))
    if missing:
        raise KeyError("inference graph missing columns: " + ", ".join(missing))
    if df.schema["ts"] == pl.Utf8:
        parsed = pl.col("ts").str.to_datetime("%Y-%m-%dT%H:%M:%S", strict=False)
        ibm = pl.col("ts").str.to_datetime("%Y/%m/%d %H:%M", strict=False)
        df = df.with_columns(parsed.fill_null(ibm))
    return df


def prepare_inference_graph(records, bundle: dict) -> dict:
    """Train-fit transform of a local neighbourhood (same 11-d edge recipe as the notebook)."""
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

    work = ensure_graph_fields(records)
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


def build_graph_payload(df_subset, graph_id="inference") -> dict:
    """Per-edge risk JSON for the backend / UI. true_label is null when absent."""
    n_nodes = pl.concat([df_subset["sender_id"], df_subset["receiver_id"]]).n_unique()
    n_edges = df_subset.height
    payload = {
        "graph_id": graph_id,
        "topology_metrics": {
            "node_count": int(n_nodes),
            "edge_count": int(n_edges),
            "density": round(n_edges / (n_nodes * (n_nodes - 1)), 6) if n_nodes > 1 else 0.0,
        },
        "edges": [],
    }
    has_label = "Is Laundering" in df_subset.columns
    for row in df_subset.iter_rows(named=True):
        score = float(row["risk_score"])
        payload["edges"].append(
            {
                "source_node": row["sender_id"],
                "destination_node": row["receiver_id"],
                "edge_features": {
                    "amount": float(row["amount"]),
                    "payment_format": str(row["Payment Format"]),
                    "hours_from_start": float(row["hours_from_start"]),
                    "is_cross_bank": int(row["is_cross_bank"]),
                    "is_cross_currency": int(row["is_cross_currency"]),
                    "is_self_transfer": int(row["is_self_transfer"]),
                },
                "fraud_risk_score": round(score, 4),
                "risk_label": risk_label(score),
            }
        )
    return payload


def build_infer_cfg(bundle: dict, feature_names: list[str]) -> dict | None:
    if bundle.get("scaler") is None or bundle.get("cat_encoder") is None or bundle.get("t0") is None:
        return None
    return {
        "t0": bundle["t0"],
        "clip": float(bundle.get("clip", 10.0)),
        "cont_cols": list(bundle.get("cont_cols") or CONT_COLS),
        "cat_cols": list(bundle.get("cat_cols") or CAT_COLS),
        "bin_cols": list(bundle.get("bin_cols") or BIN_COLS),
        "feature_names": list(feature_names),
        "rates": dict(bundle.get("rates") or RATES),
        "src_col": "sender_id",
        "dst_col": "receiver_id",
        "time_col": "ts",
        "label_col": "Is Laundering",
    }


@dataclass
class Runtime:
    graph_path: Path
    device: torch.device
    model: nn.Module
    scaler: object
    cat_encoder: object
    infer_cfg: dict
    decision_threshold: float
    architecture: str


def load_runtime() -> Runtime:
    graph_path = resolve_existing("IBM_GRAPH_PATH", "ibm_graph.pt")
    if graph_path is None:
        tried = ", ".join(str(p) for p in _candidate_paths("IBM_GRAPH_PATH", "ibm_graph.pt"))
        raise FileNotFoundError(
            "ibm_graph.pt not found. Train in Model_A_Lachlan/main_quantumconv.ipynb "
            f"so the serving bundle is written. Looked in: {tried}"
        )

    bundle = torch_load(graph_path, map_location="cpu")
    arch = str(bundle.get("architecture") or "")
    if arch != "QGNN":
        raise ValueError(
            f"{graph_path} architecture={arch!r}; main.py expects architecture 'QGNN'. "
            "Use main_750k.py for MuleHunterGNN, or retrain main_quantumconv.ipynb."
        )

    required = (
        "scaler",
        "cat_encoder",
        "t0",
        "hidden_dim",
        "edge_attr_dim",
        "n_qubits",
        "node_attr_dim",
    )
    missing = [k for k in required if k not in bundle]
    if missing:
        raise KeyError(
            f"{graph_path} is missing keys {missing}. Rebuild the serving ibm_graph.pt "
            "from Model_A_Lachlan/main_quantumconv.ipynb."
        )
    state = bundle.get("model_state") or bundle.get("model_state_dict")
    if state is None:
        raise KeyError(f"{graph_path} has no model_state")

    feature_names = [str(n) for n in bundle.get("feature_names", [])]
    infer_cfg = build_infer_cfg(bundle, feature_names)
    if infer_cfg is None:
        raise ValueError(INDUCTIVE_REBUILD_MSG)

    n_qubits = int(bundle.get("n_qubits", N_QUBITS_DEFAULT))
    probe_qdev = make_qdevice(n_qubits)
    device = pick_device(probe_qdev)
    params = bundle.get("best_params") or load_best_params()
    dropout = float(bundle.get("dropout", params.get("dropout", 0.3)))
    fanouts = tuple(bundle.get("fanouts", FANOUTS))
    max_q_edges = int(bundle.get("max_q_edges", MAX_Q_EDGES))
    model = make_qgnn(
        n_qubits=n_qubits,
        node_attr_dim=int(bundle["node_attr_dim"]),
        edge_attr_dim=int(bundle["edge_attr_dim"]),
        hidden_dim=int(bundle["hidden_dim"]),
        dropout=dropout,
        num_nodes=0,
        fanouts=fanouts,
        max_q_edges=max_q_edges,
    )
    model.load_state_dict(state)
    model = to_torch_device(model, device)
    model.eval()

    decision_threshold = float(bundle.get("decision_threshold", 0.5))
    print(
        f"Loaded {graph_path.resolve()} | QGNN | "
        f"node_dim={bundle['node_attr_dim']} | edge_dim={bundle['edge_attr_dim']} | "
        f"hidden={bundle['hidden_dim']} | n_qubits={n_qubits} | "
        f"FANOUTS={fanouts} | MAX_Q_EDGES={max_q_edges} | "
        f"threshold={decision_threshold} | device={device}"
    )
    return Runtime(
        graph_path=graph_path,
        device=device,
        model=model,
        scaler=bundle["scaler"],
        cat_encoder=bundle["cat_encoder"],
        infer_cfg=infer_cfg,
        decision_threshold=decision_threshold,
        architecture=arch,
    )


@torch.no_grad()
def score_local_graph(rt: Runtime, graph: dict) -> torch.Tensor:
    """Score every edge in a local neighbourhood graph with the QGNN."""
    edge_index = graph["edge_index"].to(rt.device)
    edge_attr = graph["edge_attr"].to(rt.device)
    node_features = graph["node_features"].to(rt.device)
    n_edges = int(edge_index.size(1))
    if n_edges == 0:
        return edge_index.new_zeros(0, dtype=torch.float)
    mp_ptr, mp_eids = build_incident_csr(edge_index, int(graph["num_nodes"]))
    rt.model.eval()
    logits_all = []
    idx = torch.arange(n_edges, device=rt.device)
    for start in range(0, n_edges, BATCH_SIZE):
        batch = idx[start : start + BATCH_SIZE]
        logits = rt.model(
            node_features,
            edge_index,
            edge_attr,
            edge_index,
            edge_attr,
            batch,
            mp_ptr,
            mp_eids,
        )
        logits_all.append(logits)
    return torch.sigmoid(torch.cat(logits_all))


def inductive_bundle(rt: Runtime) -> dict:
    return {"scaler": rt.scaler, "cat_encoder": rt.cat_encoder, "config": rt.infer_cfg}


class Transaction(BaseModel):
    """One neighbourhood edge. Known and unknown accounts are opaque strings."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    sender_id: str
    receiver_id: str
    amount: float
    payment_format: str = Field(alias="Payment Format")
    ts: datetime
    transaction_id: str | None = None
    is_self_transfer: int | None = None
    is_cross_bank: int | None = None
    is_cross_currency: int | None = None


class Transactions(BaseModel):
    transactions: list[Transaction] = Field(min_length=1)
    top_k: int | None = None
    graph_id: str = "inference"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.runtime = load_runtime()
    yield
    app.state.runtime = None


app = FastAPI(lifespan=lifespan, title="Q-Detect QGNN inference")


def get_runtime(request: Request) -> Runtime:
    rt = getattr(request.app.state, "runtime", None)
    if rt is None:
        raise HTTPException(status_code=503, detail="ibm_graph.pt is not loaded yet")
    return rt


@app.get("/")
async def home(request: Request):
    rt = get_runtime(request)
    return {
        "message": "Q-Detect QGNN inference",
        "graph_path": str(rt.graph_path.resolve()),
        "architecture": rt.architecture,
        "checkpoint": str(rt.graph_path.resolve()),
        "decision_threshold": rt.decision_threshold,
        "device": str(rt.device),
        "inductive": True,
    }


@app.post("/predict")
async def predict(request: Request, body: Transactions):
    """Score every edge in a neighbourhood of cleaned payments.

    Each row needs `sender_id`, `receiver_id`, `amount`, `Payment Format`, and `ts`.
    Unknown accounts are allowed. Send k-hop neighbors in the same list.
    Returns Graph JSON (`graph_id`, `topology_metrics`, `edges`) for edges with
    score > 0.5 only. Optional `top_k` further trims that filtered set by score.
    """
    rt = get_runtime(request)
    rows = [
        tx.model_dump(exclude_none=True, by_alias=True)
        for tx in body.transactions
    ]
    try:
        graph = prepare_inference_graph(rows, inductive_bundle(rt))
    except Exception as err:
        raise HTTPException(
            status_code=400,
            detail=f"Could not encode transactions: {err}",
        ) from err
    probs = score_local_graph(rt, graph).detach().cpu().tolist()
    scored = graph["df"].with_columns(pl.Series("risk_score", probs))
    payload_df = scored.filter(pl.col("risk_score") > 0.5)
    if body.top_k is not None:
        payload_df = payload_df.sort("risk_score", descending=True).head(int(body.top_k))
    return build_graph_payload(payload_df, graph_id=body.graph_id)
