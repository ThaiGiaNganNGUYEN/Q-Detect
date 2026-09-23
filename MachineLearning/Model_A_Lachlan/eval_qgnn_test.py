"""Score the QGNN out-of-time test split and print the 750k metric suite.

Uses split-prefix message passing from ibm_graph_cache.pt (MP = train+val,
query = test) and the frozen val max-F1 threshold stored in ibm_graph.pt.

    python eval_qgnn_test.py \
      --cache ibm_graph_cache.pt \
      --weights ibm_graph.pt \
      --test-csv ibm_hi_medium_test.csv

Train first in main_quantumconv.ipynb so those artifacts exist. Full test
forward is slow because of the VQC.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parent
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

from main import (  # noqa: E402
    BATCH_SIZE,
    FANOUTS,
    MAX_Q_EDGES,
    N_QUBITS_DEFAULT,
    build_incident_csr,
    make_qdevice,
    make_qgnn,
    pick_device,
    to_torch_device,
    torch_load,
)

DEFAULT_CACHE = "ibm_graph_cache.pt"
DEFAULT_WEIGHTS = "ibm_graph.pt"
DEFAULT_TEST_CSV = "ibm_hi_medium_test.csv"


def resolve_path(path: str | Path) -> Path:
    raw = Path(path).expanduser()
    if raw.is_file():
        return raw.resolve()
    candidates = [
        Path.cwd() / raw,
        HERE / raw.name,
        ML_ROOT / raw.name,
        ML_ROOT / "Model_A_Lachlan" / raw.name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    tried = ", ".join(str(p) for p in [raw, *candidates])
    raise FileNotFoundError(f"{path} not found. Looked in: {tried}")


def specificity_score(y_true, y_bin) -> float:
    tn, fp, fn, tp = confusion_matrix(y_true, y_bin, labels=[0, 1]).ravel()
    return float(tn / max(tn + fp, 1))


def print_split_metrics(name, y_true, y_prob, threshold, loss=None):
    y_bin = (y_prob >= threshold).astype(int)
    auprc = average_precision_score(y_true, y_prob)
    auroc = roc_auc_score(y_true, y_prob)
    acc = accuracy_score(y_true, y_bin)
    prec = precision_score(y_true, y_bin, zero_division=0)
    rec = recall_score(y_true, y_bin, zero_division=0)
    f1 = f1_score(y_true, y_bin, zero_division=0)
    spec = specificity_score(y_true, y_bin)
    base = float(np.mean(y_true))
    print("=" * 60)
    print(f" {name}")
    print("=" * 60)
    print(f"  n:            {len(y_true):,}")
    print(f"  base rate:    {base:.4%}   (dummy AUPRC ≈ this)")
    print(f"  threshold:    {threshold:.4f}  (max-F1 on val, frozen)")
    if loss is not None:
        print(f"  loss:         {loss:.4f}")
    print(f"  AUPRC:        {auprc:.4f}")
    print(f"  AUROC:        {auroc:.4f}")
    print(f"  Accuracy:     {acc:.4f}")
    print(f"  Precision:    {prec:.4f}")
    print(f"  Recall:       {rec:.4f}")
    print(f"  F1:           {f1:.4f}")
    print(f"  Specificity:  {spec:.4f}")
    print()
    print(
        classification_report(
            y_true,
            y_bin,
            digits=4,
            zero_division=0,
            target_names=["legit", "laundering"],
        )
    )
    cm = confusion_matrix(y_true, y_bin, labels=[0, 1])
    print("Confusion matrix [[TN FP] [FN TP]]:")
    print(cm)
    return {
        "auprc": auprc,
        "auroc": auroc,
        "accuracy": acc,
        "precision": prec,
        "recall": rec,
        "f1": f1,
        "specificity": spec,
        "threshold": threshold,
        "base_rate": base,
        "cm": cm,
        "loss": loss,
        "n": int(len(y_true)),
    }


def load_qgnn(weights_path: Path):
    bundle = torch_load(weights_path, map_location="cpu")
    arch = str(bundle.get("architecture") or "")
    if arch != "QGNN":
        raise ValueError(
            f"{weights_path} architecture={arch!r}; expected 'QGNN'. "
            "Retrain main_quantumconv.ipynb or pass the QGNN serving bundle."
        )
    state = bundle.get("model_state") or bundle.get("model_state_dict")
    if state is None:
        raise KeyError(f"{weights_path} has no model_state")

    n_qubits = int(bundle.get("n_qubits", N_QUBITS_DEFAULT))
    qdev = make_qdevice(n_qubits)
    device = pick_device(qdev)
    fanouts = tuple(bundle.get("fanouts", FANOUTS))
    max_q_edges = int(bundle.get("max_q_edges", MAX_Q_EDGES))
    dropout = float(bundle.get("dropout", 0.3))
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
    threshold = float(bundle.get("decision_threshold", 0.5))
    print(
        f"Loaded {weights_path} | QGNN | "
        f"node_dim={bundle['node_attr_dim']} | edge_dim={bundle['edge_attr_dim']} | "
        f"hidden={bundle['hidden_dim']} | n_qubits={n_qubits} | "
        f"FANOUTS={fanouts} | MAX_Q_EDGES={max_q_edges} | "
        f"threshold={threshold:.4f} | device={device}"
    )
    return model, device, threshold


def score_test_edges(model, cache: dict, device: torch.device, batch_size: int):
    """Split-prefix test: MP = train+val, query = test_mask edges."""
    edge_index = cache["edge_index"].to(device)
    edge_attr = cache["edge_attr"].to(device)
    edge_labels = cache["edge_labels"].to(device)
    node_features = cache["node_features"].to(device)
    test_mask = cache["test_mask"].to(device)
    mp_ei = cache["val_edge_index"].to(device)
    mp_ea = cache["val_edge_attr"].to(device)
    num_nodes = int(cache.get("num_nodes") or len(cache["node_mapping"]))
    mp_ptr, mp_eids = build_incident_csr(mp_ei, num_nodes)
    test_idx = test_mask.nonzero(as_tuple=False).view(-1)

    model.eval()
    logits_all = []
    n_batches = int(np.ceil(test_idx.numel() / batch_size)) if test_idx.numel() else 0
    with torch.no_grad():
        for i, start in enumerate(range(0, test_idx.size(0), batch_size), start=1):
            batch = test_idx[start : start + batch_size]
            logits = model(
                node_features, mp_ei, mp_ea, edge_index, edge_attr, batch, mp_ptr, mp_eids
            )
            logits_all.append(logits.cpu())
            if i == 1 or i % 50 == 0 or i == n_batches:
                print(f"  [test] batch {i}/{n_batches}", flush=True)
    logits = torch.cat(logits_all) if logits_all else torch.zeros(0)
    true = edge_labels[test_idx].detach().cpu()
    return logits, true


def maybe_bce_loss(logits: torch.Tensor, true: torch.Tensor, cache: dict):
    pos_weight = cache.get("pos_weight_train")
    if pos_weight is None or logits.numel() == 0:
        return None
    criterion = nn.BCEWithLogitsLoss(
        pos_weight=torch.tensor([float(pos_weight)], dtype=logits.dtype)
    )
    return float(criterion(logits, true.to(dtype=logits.dtype)).item())


def check_csv_labels(csv_path: Path, test_true: np.ndarray, test_prob: np.ndarray, write_scores: bool):
    df = pd.read_csv(csv_path)
    if "Is Laundering" not in df.columns:
        print(f"CSV {csv_path} has no Is Laundering column — skip label check")
        return
    csv_y = df["Is Laundering"].to_numpy().astype(int)
    cache_y = test_true.astype(int)
    if csv_y.shape[0] != cache_y.shape[0]:
        print(
            f"CSV row count {csv_y.shape[0]:,} != test n {cache_y.shape[0]:,} — skip label check"
        )
        return
    n_diff = int(np.sum(csv_y != cache_y))
    if n_diff:
        print(f"WARNING: CSV Is Laundering disagrees with graph cache on {n_diff:,} rows")
    else:
        print("CSV Is Laundering matches graph-cache test labels")
    if write_scores:
        df["risk_score"] = np.asarray(test_prob, dtype=np.float64)
        df.to_csv(csv_path, index=False)
        print(f"Updated risk_score in {csv_path}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="QGNN out-of-time test metrics (same suite as 750k_row_trial.ipynb)."
    )
    parser.add_argument("--cache", default=DEFAULT_CACHE, help="ibm_graph_cache.pt")
    parser.add_argument("--weights", default=DEFAULT_WEIGHTS, help="ibm_graph.pt serving bundle")
    parser.add_argument(
        "--test-csv",
        default=DEFAULT_TEST_CSV,
        help="held-out test CSV from main_quantumconv.ipynb (optional check)",
    )
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument(
        "--no-write-scores",
        action="store_true",
        help="do not refresh risk_score on the test CSV",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    cache_path = resolve_path(args.cache)
    weights_path = resolve_path(args.weights)
    csv_arg = Path(args.test_csv).expanduser()
    try:
        csv_path = resolve_path(args.test_csv)
    except FileNotFoundError:
        csv_path = None
        print(f"No test CSV at {csv_arg} — scoring from graph cache labels only")

    print(f"Loading graph cache {cache_path}")
    cache = torch_load(cache_path, map_location="cpu")
    required = (
        "edge_index",
        "edge_attr",
        "edge_labels",
        "node_features",
        "test_mask",
        "val_edge_index",
        "val_edge_attr",
    )
    missing = [k for k in required if k not in cache]
    if missing:
        raise KeyError(f"{cache_path} is missing {missing}. Rebuild from main_quantumconv.ipynb.")

    model, device, threshold = load_qgnn(weights_path)
    n_test = int(cache["test_mask"].sum().item())
    print(f"Scoring {n_test:,} test edges (MP=train+val, query=test)...")
    logits, true = score_test_edges(model, cache, device, args.batch_size)
    test_prob = torch.sigmoid(logits).numpy()
    test_true = true.numpy()
    test_loss = maybe_bce_loss(logits, true, cache)

    print_split_metrics(
        "OUT-OF-TIME TEST (MP=train+val, query=test)",
        test_true,
        test_prob,
        threshold,
        test_loss,
    )

    if csv_path is not None:
        check_csv_labels(csv_path, test_true, test_prob, write_scores=not args.no_write_scores)


if __name__ == "__main__":
    main()
