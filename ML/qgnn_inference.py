"""Inference for the QGNN (quantum graph neural network) from model_details_ver66.

The model code is copied from qgnn-ibm-aml_22.ipynb (cell 27): a 2-qubit
PennyLane circuit adds to the attention weight of each edge, then one
attention-weighted message-passing hop and a linear edge classifier.

Serving follows the same recipe as inference.py (GraphSAGE): the request's
transactions are the graph -- local node ids, log1p in/out degree as node
features, the same scaled / one-hot edge features -- and every edge is scored.
That feature prep is shared with inference.py, since both models were trained
on the same 11 edge features.

Two steps of the notebook's forward pass are random: neighbour sampling
(FANOUTS) and which edges go through the quantum circuit (MAX_Q_EDGES per
forward). infer_qgnn seeds torch's RNG first, so the same batch always gets
the same scores.

    from qgnn_inference import load_qgnn_bundle, infer_qgnn

    bundle = load_qgnn_bundle()  # model/qgnn_ibm_graph_v66.pt
    result = infer_qgnn(records, bundle)
"""

import math
import threading
from pathlib import Path

import numpy as np
import pennylane as qml
import polars as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.utils import softmax

from inference import build_graph_payload, prepare_inference_graph

QGNN_BUNDLE_PATH = Path(__file__).resolve().parent / "model" / "qgnn_ibm_graph_v67.pt"

N_QUBITS = 2
FANOUTS = (2,)  # one hop, sampled inside the message-passing graph
MAX_Q_EDGES = 128  # cap on edges sent through the quantum circuit per forward
QUERY_BATCH_SIZE = 512  # edges scored per forward -- the notebook's BATCH_SIZE
SEED = 0

# torch's global RNG drives the sampling above; the lock keeps two requests
# from reseeding it under each other.
_rng_lock = threading.Lock()


# --- Model (from the notebook) ------------------------------------------------

def make_qdevice(n_qubits):
    try:
        return qml.device("lightning.qubit", wires=n_qubits)
    except Exception:
        return qml.device("default.qubit", wires=n_qubits)


dev = make_qdevice(N_QUBITS)


@qml.qnode(dev, interface="torch", diff_method="adjoint")
def quantum_circuit(inputs, weights):
    for i in range(N_QUBITS):
        qml.RY(inputs[..., i], wires=i)
    qml.templates.StronglyEntanglingLayers(weights, wires=range(N_QUBITS))
    return [qml.expval(qml.PauliZ(i)) for i in range(N_QUBITS)]


class QuantumLayer(nn.Module):
    def __init__(self):
        super().__init__()
        self.qlayer = qml.qnn.TorchLayer(quantum_circuit, {"weights": (1, N_QUBITS, 3)})

    def forward(self, x):
        return self.qlayer(x).to(x.device)


def build_incident_csr(edge_index, num_nodes):
    """CSR of incident edge ids (src or dst) for O(degree) neighbor lookup."""
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
    """k-hop subgraph around the batch, keeping at most fanout * |nodes| edges per hop."""
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


class QuantumWeightedConv(nn.Module):
    """One hop: attention-weighted aggregate + classical update."""

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
    def __init__(self, node_attr_dim, edge_attr_dim, hidden_dim, fanouts=FANOUTS, dropout=0.3):
        super().__init__()
        self.fanouts = fanouts
        self.dropout = dropout
        self.node_enc = nn.Linear(node_attr_dim, hidden_dim)
        self.q_layer = QuantumLayer()
        self.to_qubits = nn.Linear(hidden_dim * 2 + edge_attr_dim, N_QUBITS)
        self.att = nn.Linear(N_QUBITS, 1)
        self.gat_att = nn.Linear(hidden_dim * 2 + edge_attr_dim, 1)
        self.convs = nn.ModuleList([QuantumWeightedConv(hidden_dim) for _ in fanouts])
        self.classifier = nn.Linear(hidden_dim * 2 + edge_attr_dim, 1)

    def quantum_alphas(self, x, edge_index, edge_attr):
        """Classical attention logits plus quantum logits on up to MAX_Q_EDGES edges -> softmax."""
        if edge_index.size(1) == 0:
            return edge_index.new_zeros(0)
        src, dst = edge_index[0], edge_index[1]
        pair = torch.cat([x[src], x[dst], edge_attr], dim=-1)
        logits = F.leaky_relu(self.gat_att(pair).squeeze(-1), 0.2)

        angles = math.pi * torch.tanh(self.to_qubits(pair))
        n = angles.size(0)
        if n > MAX_Q_EDGES:
            keep = torch.randperm(n, device=angles.device)[:MAX_Q_EDGES]
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


# --- Serving ------------------------------------------------------------------

def load_qgnn_bundle(path=None):
    """Load the notebook's serving bundle (ibm_graph.pt) into a ready QGNN.

    Returns the same shape as inference.load_infer_bundle -- model, scaler,
    cat_encoder, config, device, path -- so the shared feature prep works on it.
    """
    path = Path(path or QGNN_BUNDLE_PATH)
    blob = torch.load(path, map_location="cpu", weights_only=False)
    if blob.get("architecture") != "QGNN" or int(blob["n_qubits"]) != N_QUBITS:
        raise ValueError(f"{path} is not a {N_QUBITS}-qubit QGNN bundle")

    net = QGNN(
        node_attr_dim=blob["node_attr_dim"],
        edge_attr_dim=blob["edge_attr_dim"],
        hidden_dim=blob["hidden_dim"],
        fanouts=tuple(blob["fanouts"]),
        dropout=blob["dropout"],
    )
    net.load_state_dict(blob["model_state"])
    net.eval()

    config = {
        key: blob[key]
        for key in ("t0", "clip", "cont_cols", "cat_cols", "bin_cols", "feature_names", "rates", "decision_threshold")
    }
    config.update(src_col="sender_id", dst_col="receiver_id", time_col="ts", label_col="Is Laundering")
    return {
        "model": net,
        "scaler": blob["scaler"],
        "cat_encoder": blob["cat_encoder"],
        "config": config,
        # PennyLane's lightning.qubit simulates on the CPU.
        "device": torch.device("cpu"),
        "path": path,
    }


def infer_qgnn(records, bundle, top_k=None):
    """Score every transaction in records.

    Returns the same dict as inference.infer_transactions(output="both"),
    minus "json": scores, flagged, n_nodes, n_edges, frame, payload.
    """
    graph = prepare_inference_graph(records, bundle)
    net = bundle["model"]
    x = graph["node_features"]
    edge_index = graph["edge_index"]
    edge_attr = graph["edge_attr"]
    # The whole request is the message-passing graph; edges are scored in
    # batches like the notebook's eval loop.
    ptr, eids = build_incident_csr(edge_index, graph["num_nodes"])
    all_edges = torch.arange(edge_index.size(1))

    logits = []
    with _rng_lock, torch.no_grad():
        torch.manual_seed(SEED)
        for start in range(0, all_edges.numel(), QUERY_BATCH_SIZE):
            batch = all_edges[start:start + QUERY_BATCH_SIZE]
            logits.append(net(x, edge_index, edge_attr, edge_index, edge_attr, batch, ptr, eids))
    probs = torch.sigmoid(torch.cat(logits)).numpy().astype(np.float64)

    scored = graph["df"].with_columns(pl.Series("risk_score", probs))
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
