"""Train AML-GNN (amlgnn.py) on IBM HI-Medium and compare it with the other models.

    uv run python train_amlgnn.py                       # v2 settings -> model/amlgnn_v2.pt
    uv run python train_amlgnn.py --context-batches 1 --name v3
    uv run python train_amlgnn.py --with-qgnn           # also compare QGNN (adds ~10 minutes)
    uv run python train_amlgnn.py --help                # all options

1. Download HI-Medium_Trans.csv with kagglehub (cached after the first run).
2. Keep the primary window, 1-16 Sep 2022 (later rows are almost all
   laundering), and cut it into 50k-transaction batches in time order -- the
   same batches the backend's poller sends to the ML service.
3. Split batches by time, using the cut-offs GraphSAGE and QGNN were trained
   with, so the test period is unseen by every model:
       train <= 2022-09-09 20:41 < val <= 2022-09-14 05:42 < test
4. Train on a sample of the train batches, early-stop on validation AUPRC, and
   pick the decision threshold (max F1) on validation.
5. Score the test batches with every model and print the comparison.
6. Save model/amlgnn_<name>.pt.

With --context-batches K, each batch's graph also includes the K batches
before it as context: they take part in message passing and account
statistics but aren't scored -- the backend sends the same earlier rows from
staging at serve time.

The file is 32M rows, too big for memory here, so it's read with Polars in
streaming passes: timestamps only (to pick batches), then just the rows of the
needed batches, written to data/. Each batch's graph is built once and saved
under data/graphs_*/, and training loads one graph at a time. Training saves a
checkpoint every epoch (data/amlgnn_<name>_checkpoint.pt), so if it's
interrupted, running the same command again carries on from the last finished
epoch.

Every run uses the same validation and test batches (first chosen for v1), so
results compare directly.
"""

import argparse
import ctypes
import math
import random
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import polars as pl
import torch
import torch.nn as nn
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

from amlgnn import ALL_EDGE_FEATURES, AMLGNN, MODEL_DIR, NODE_FEATURES, build_graph, edge_columns, scale

DATA_DIR = Path(__file__).resolve().parent / "data"
V1_BATCHES_PATH = DATA_DIR / "hi_medium_batches.parquet"
BATCHES_PATH = DATA_DIR / "hi_medium_batches_v2.parquet"  # rows of the chosen batches

BATCH_SIZE = 50_000  # transactions per graph -- the backend poller's batch size
N_BATCHES = {"train": 200, "val": 20, "test": 20}
PRIMARY_START = datetime(2022, 9, 1)
PRIMARY_END = datetime(2022, 9, 16, 23, 59)
T_TRAIN_END = datetime(2022, 9, 9, 20, 41)
T_VAL_END = datetime(2022, 9, 14, 5, 42)

EDGE_FEATURES = ALL_EDGE_FEATURES  # v1's 17 + the 6 pattern features
EDGE_UPDATES = True
HIDDEN_DIM = 64
NUM_LAYERS = 2
DROPOUT = 0.2
LR = 1e-3
MAX_EPOCHS = 25
PATIENCE = 5
SEED = 42

RAW_COLUMNS = [
    "Timestamp", "From Bank", "Account", "To Bank", "Account.1", "Amount Received",
    "Receiving Currency", "Amount Paid", "Payment Currency", "Payment Format", "Is Laundering",
]


# --- Data ---------------------------------------------------------------------

def download() -> str:
    import kagglehub

    return kagglehub.dataset_download(
        "ealtman2019/ibm-transactions-for-anti-money-laundering-aml", path="HI-Medium_Trans.csv"
    )


def scan(path: str) -> pl.LazyFrame:
    # Read every column as text (account ids are hex, and the first rows can
    # look numeric), then cast the numeric ones.
    lf = pl.scan_csv(path, infer_schema=False)
    dest = next(n for n in lf.collect_schema().names() if n.startswith("Account") and n != "Account")
    return (
        lf.rename({dest: "Account.1"})
        .with_columns(
            pl.col("Amount Received", "Amount Paid").cast(pl.Float64),
            pl.col("Is Laundering").cast(pl.Int8),
        )
        .with_row_index("row")
    )


def batch_window(lf: pl.LazyFrame) -> pl.DataFrame:
    """Pass 1: every row in 1-16 Sep, in time order, with its position and batch number."""
    print("Pass 1: timestamps, to cut the primary window into batches ...")
    window = (
        lf.select("row", pl.col("Timestamp").str.to_datetime("%Y/%m/%d %H:%M").alias("ts"))
        .filter(pl.col("ts").is_between(pl.lit(PRIMARY_START), pl.lit(PRIMARY_END)))
        .collect(engine="streaming")
        .sort("ts", "row")
        .with_columns(pl.int_range(pl.len()).alias("pos"))
        .with_columns((pl.col("pos") // BATCH_SIZE).alias("batch"))
    )
    print(f"  {window.height:,} rows in 1-16 Sep -> {window.height // BATCH_SIZE:,} full batches")
    return window


def read_rows(lf: pl.LazyFrame, wanted: pl.DataFrame, out: Path) -> None:
    """Pass 2: stream just the wanted rows (row, pos, batch, split) to a parquet file."""
    print(f"Pass 2: reading {wanted.height:,} rows ...")
    DATA_DIR.mkdir(exist_ok=True)
    lf.join(wanted.lazy(), on="row").select("split", "batch", "pos", *RAW_COLUMNS).sink_parquet(out)
    print(f"  wrote {out}")


def prepare_batches(path: str) -> None:
    """Pick the train / val / test batches (val and test reused from v1) and save their rows."""
    lf = scan(path)
    window = batch_window(lf)
    info = (
        window.group_by("batch", maintain_order=True)
        .agg(pl.col("ts").min().alias("start"), pl.col("ts").max().alias("end"), pl.len().alias("n"))
        .filter(pl.col("n") == BATCH_SIZE)
        .with_columns(
            pl.when(pl.col("end") <= T_TRAIN_END).then(pl.lit("train"))
            .when((pl.col("start") > T_TRAIN_END) & (pl.col("end") <= T_VAL_END)).then(pl.lit("val"))
            .when(pl.col("start") > T_VAL_END).then(pl.lit("test"))
            .alias("split")
        )
        .drop_nulls("split")
    )
    fixed = {}
    if V1_BATCHES_PATH.exists():
        ids = pl.read_parquet(V1_BATCHES_PATH, columns=["split", "batch"]).unique()
        fixed = {s: ids.filter(pl.col("split") == s)["batch"].to_list() for s in ("val", "test")}
    chosen = []
    for split, k in N_BATCHES.items():
        available = info.filter(pl.col("split") == split)
        if split in fixed:
            picked = available.filter(pl.col("batch").is_in(fixed[split]))
            print(f"  {split}: reusing v1's {picked.height} batches")
        else:
            picked = available.sample(n=min(k, available.height), seed=SEED)
            print(f"  {split}: {available.height} batches available, using {picked.height}")
        chosen.append(picked)
    wanted = window.join(pl.concat(chosen).select("batch", "split"), on="batch")
    read_rows(lf, wanted.select("row", "pos", "batch", "split"), BATCHES_PATH)


def chosen_batches() -> pl.DataFrame:
    """(split, batch) of every chosen batch."""
    return pl.read_parquet(BATCHES_PATH, columns=["split", "batch"]).unique().sort("batch")


def prepare_context(path: str, context_batches: int, out: Path) -> None:
    """Save the rows of the K batches before each chosen batch (split = "context")."""
    chosen = chosen_batches()
    have = set(chosen["batch"].to_list())
    need = sorted({b - k for b in have for k in range(1, context_batches + 1)} - have)
    need = [b for b in need if b >= 0]
    window = batch_window(scan(path))
    wanted = window.filter(pl.col("batch").is_in(need)).with_columns(pl.lit("context").alias("split"))
    read_rows(scan(path), wanted.select("row", "pos", "batch", "split"), out)


def batch_rows(files: list[Path], batches: list[int]) -> pl.DataFrame:
    return (
        pl.scan_parquet(files).filter(pl.col("batch").is_in(batches)).collect()
        .sort("batch", "pos").select(RAW_COLUMNS)
    )


def prepare_graphs(context_batches: int, path_for_download) -> dict[str, list[Path]]:
    """Build each chosen batch's graph once and save it; returns the graph files per split."""
    sources = [BATCHES_PATH]
    if context_batches:
        ctx_path = DATA_DIR / f"hi_medium_context_{context_batches}.parquet"
        if not ctx_path.exists():
            prepare_context(path_for_download(), context_batches, ctx_path)
        sources.append(ctx_path)
    graphs_dir = DATA_DIR / ("graphs_v2" if context_batches == 0 else f"graphs_ctx{context_batches}")
    graphs_dir.mkdir(exist_ok=True)

    files = {s: [] for s in N_BATCHES}
    t, built = time.time(), 0
    for split, batch in chosen_batches().iter_rows():
        if batch < context_batches:
            continue  # not enough earlier batches for its context
        file = graphs_dir / f"{split}_{batch}.pt"
        files[split].append(file)
        if file.exists():
            continue
        rows = batch_rows(sources, [batch])
        context = batch_rows(sources, list(range(batch - context_batches, batch))) if context_batches else None
        graph = build_graph(rows, context)
        del graph["frame"]
        graph["y"] = torch.from_numpy(rows["Is Laundering"].to_numpy().astype(np.float32))
        torch.save(graph, file)
        built += 1
    if built:
        print(f"Built {built} graphs in {time.time() - t:.0f}s ({graphs_dir})")
    return files


def load_graph(file: Path) -> dict:
    return torch.load(file, weights_only=False)


# --- Training -----------------------------------------------------------------

def feature_stats(files: list[Path], edge_cols: list[int]) -> dict:
    """Mean / std of node and edge features over the training graphs, one graph at a time."""
    sums = {}
    for file in files:
        g = load_graph(file)
        for key, x in (("node", g["node_x"].double()), ("edge", g["edge_x"][:, edge_cols].double())):
            n, s, sq = sums.get(key, (0, 0.0, 0.0))
            sums[key] = (n + len(x), s + x.sum(0), sq + (x ** 2).sum(0))
    stats = {}
    for key, (n, s, sq) in sums.items():
        mean = s / n
        stats[f"{key}_mean"] = mean.float()
        stats[f"{key}_std"] = (sq / n - mean ** 2).clamp_min(1e-12).sqrt().float().clamp_min(1e-6)
    return stats


def logits_for(model: nn.Module, g: dict, stats: dict, edge_cols: list[int]) -> torch.Tensor:
    node_x, edge_x = scale(g, stats, edge_cols)
    return model(node_x, g["edge_index"], edge_x, query_from=g.get("n_context", 0))


def predict(model: nn.Module, files: list[Path], stats: dict, edge_cols: list[int]) -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    probs, labels = [], []
    with torch.no_grad():
        for file in files:
            g = load_graph(file)
            probs.append(torch.sigmoid(logits_for(model, g, stats, edge_cols)))
            labels.append(g["y"])
    return torch.cat(probs).numpy(), torch.cat(labels).numpy()


def train(files: dict[str, list[Path]], stats: dict, edge_cols: list[int], args) -> tuple[AMLGNN, float]:
    torch.manual_seed(SEED)
    random.seed(SEED)
    model = AMLGNN(len(NODE_FEATURES), len(edge_cols), HIDDEN_DIM, args.layers, DROPOUT, EDGE_UPDATES)
    optimizer = torch.optim.Adam(model.parameters(), lr=LR, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=2)

    n_edges = n_pos = 0
    for file in files["train"]:
        y = load_graph(file)["y"]
        n_edges, n_pos = n_edges + len(y), n_pos + float(y.sum())
    # sqrt of the class ratio: full weighting (~1000x) makes training unstable.
    pos_weight = torch.tensor(math.sqrt((n_edges - n_pos) / max(n_pos, 1)))
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    print(f"\nTraining {args.name}: {len(files['train'])} graphs, {n_edges:,} scored edges, "
          f"{int(n_pos):,} laundering ({n_pos / n_edges:.3%}), pos_weight {pos_weight:.1f}, "
          f"{args.layers} layers, context batches {args.context_batches}, "
          f"{sum(p.numel() for p in model.parameters()):,} parameters")

    checkpoint_path = DATA_DIR / f"amlgnn_{args.name}_checkpoint.pt"
    best_auprc, best_state, since_best, start = -1.0, None, 0, 1
    if checkpoint_path.exists():
        ckpt = torch.load(checkpoint_path, weights_only=False)
        model.load_state_dict(ckpt["model"])
        optimizer.load_state_dict(ckpt["optimizer"])
        scheduler.load_state_dict(ckpt["scheduler"])
        random.setstate(ckpt["random"])
        torch.set_rng_state(ckpt["torch_random"])
        best_auprc, best_state, since_best = ckpt["best_auprc"], ckpt["best_state"], ckpt["since_best"]
        start = ckpt["epoch"] + 1
        print(f"  resuming after epoch {ckpt['epoch']} (best val AUPRC {best_auprc:.4f})")

    for epoch in range(start, args.max_epochs + 1):
        if since_best >= PATIENCE:
            break
        t = time.time()
        model.train()
        order = list(files["train"])
        random.shuffle(order)
        total = 0.0
        for file in order:
            g = load_graph(file)
            optimizer.zero_grad()
            loss = criterion(logits_for(model, g, stats, edge_cols), g["y"])
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += loss.item()

        val_auprc = average_precision_score(*reversed(predict(model, files["val"], stats, edge_cols)))
        scheduler.step(val_auprc)
        if val_auprc > best_auprc:
            best_auprc, since_best = val_auprc, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            since_best += 1
        print(f"  epoch {epoch:2d} | loss {total / len(order):.4f} | val AUPRC {val_auprc:.4f} "
              f"(best {best_auprc:.4f}) | lr {optimizer.param_groups[0]['lr']:.1e} | {time.time() - t:.0f}s",
              flush=True)
        torch.save({
            "epoch": epoch, "model": model.state_dict(), "optimizer": optimizer.state_dict(),
            "scheduler": scheduler.state_dict(), "random": random.getstate(),
            "torch_random": torch.get_rng_state(), "best_auprc": best_auprc,
            "best_state": best_state, "since_best": since_best,
        }, checkpoint_path)
        if since_best >= PATIENCE:
            print(f"  early stop: no improvement for {PATIENCE} epochs")
            break

    model.load_state_dict(best_state)
    return model, best_auprc


def max_f1_threshold(y_true, y_prob) -> float:
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-12, None)
    return float(thresholds[int(np.nanargmax(f1[:-1]))])


def metrics(y_true, y_prob, threshold) -> dict:
    flagged = (y_prob >= threshold).astype(int)
    return {
        "auprc": float(average_precision_score(y_true, y_prob)),
        "auroc": float(roc_auc_score(y_true, y_prob)),
        "precision": float(precision_score(y_true, flagged, zero_division=0)),
        "recall": float(recall_score(y_true, flagged)),
        "f1": float(f1_score(y_true, flagged)),
        "flagged": int(flagged.sum()),
    }


# --- Main ---------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--name", default="v2", help="saves model/amlgnn_<name>.pt (default v2)")
    parser.add_argument("--context-batches", type=int, default=0,
                        help="earlier 50k batches added to each graph as unscored context (default 0)")
    parser.add_argument("--layers", type=int, default=NUM_LAYERS, help=f"graph layers (default {NUM_LAYERS})")
    parser.add_argument("--train-batches", type=int, default=None,
                        help="train on only this many of the chosen train batches (quick experiments)")
    parser.add_argument("--max-epochs", type=int, default=MAX_EPOCHS, help=f"default {MAX_EPOCHS}")
    parser.add_argument("--quick", action="store_true", help="only score this model on test (no comparison)")
    parser.add_argument("--with-qgnn", action="store_true", help="also compare QGNN (slow)")
    args = parser.parse_args()
    if sys.platform == "win32":
        # Keep Windows from sleeping while this runs (ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        # released automatically when the process exits.
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)

    def download_logged() -> str:
        t = time.time()
        path = download()
        print(f"HI-Medium_Trans.csv: {path} ({time.time() - t:.0f}s)")
        return path

    if not BATCHES_PATH.exists():
        prepare_batches(download_logged())
    files = prepare_graphs(args.context_batches, download_logged)
    if args.train_batches:
        rng = random.Random(SEED)
        files["train"] = sorted(rng.sample(files["train"], min(args.train_batches, len(files["train"]))))
    edge_cols = edge_columns(EDGE_FEATURES)
    stats = feature_stats(files["train"], edge_cols)

    model, val_auprc = train(files, stats, edge_cols, args)
    threshold = max_f1_threshold(*reversed(predict(model, files["val"], stats, edge_cols)))
    print(f"\nDecision threshold (max F1 on validation): {threshold:.4f}")

    # Compare on the unseen test batches, each batch scored as its own graph.
    results = {}
    t = time.time()
    p, y_test = predict(model, files["test"], stats, edge_cols)
    results[f"amlgnn {args.name}"] = (metrics(y_test, p, threshold), time.time() - t)

    if not args.quick:
        from amlgnn import infer_amlgnn, load_amlgnn_bundle
        from inference import infer_transactions, load_infer_bundle

        test_batches = [batch_rows([BATCHES_PATH], [int(f.stem.split("_")[1])]) for f in files["test"]]
        others = {}
        for path in sorted(MODEL_DIR.glob("amlgnn_v*.pt")):
            bundle = load_amlgnn_bundle(path)
            if bundle["config"].get("context_batches", 0) == 0 and path.stem != f"amlgnn_{args.name}":
                others[path.stem.replace("_", " ")] = (
                    lambda b, bundle=bundle: infer_amlgnn(b, bundle)["scores"],
                    bundle["config"]["decision_threshold"],
                )
        sage = load_infer_bundle()
        others["graphsage"] = (lambda b: infer_transactions(b, bundle=sage, output="scores"),
                               sage["config"]["decision_threshold"])
        if args.with_qgnn:
            from qgnn_inference import infer_qgnn, load_qgnn_bundle

            qgnn = load_qgnn_bundle()
            others["qgnn"] = (lambda b: infer_qgnn(b, qgnn)["scores"], qgnn["config"]["decision_threshold"])
        for name, (score, thr) in others.items():
            t = time.time()
            p = np.concatenate([score(b) for b in test_batches])
            results[name] = (metrics(y_test, p, thr), time.time() - t)

    print(f"\n=== Test: {len(files['test'])} unseen batches, {len(y_test):,} transactions, "
          f"{int(y_test.sum()):,} laundering ({y_test.mean():.3%}) ===")
    print(f"{'model':12s} {'AUPRC':>7s} {'AUROC':>7s} {'prec':>7s} {'recall':>7s} {'F1':>7s} {'flagged':>8s} {'time':>6s}")
    for name, (m, secs) in results.items():
        print(f"{name:12s} {m['auprc']:7.4f} {m['auroc']:7.4f} {m['precision']:7.4f} {m['recall']:7.4f} "
              f"{m['f1']:7.4f} {m['flagged']:8,} {secs:5.0f}s")

    out = MODEL_DIR / f"amlgnn_{args.name}.pt"
    torch.save(
        {
            "model_state": model.state_dict(),
            "stats": stats,
            "config": {
                "architecture": "AMLGNN",
                "version": args.name,
                "node_features": NODE_FEATURES,
                "edge_features": EDGE_FEATURES,
                "edge_updates": EDGE_UPDATES,
                "hidden_dim": HIDDEN_DIM,
                "num_layers": args.layers,
                "dropout": DROPOUT,
                "context_batches": args.context_batches,
                "decision_threshold": threshold,
                "batch_size": BATCH_SIZE,
                "train_batches": len(files["train"]),
                "trained_on": "IBM HI-Medium_Trans.csv",
                "t_train_end": T_TRAIN_END.isoformat(),
                "t_val_end": T_VAL_END.isoformat(),
                "val_auprc": float(val_auprc),
                "test_metrics": results[f"amlgnn {args.name}"][0],
            },
        },
        out,
    )
    print(f"\nSaved {out}")
    (DATA_DIR / f"amlgnn_{args.name}_checkpoint.pt").unlink()  # finished: the next run trains from scratch


if __name__ == "__main__":
    main()
