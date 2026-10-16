# AML-GNN v3 experiment: earlier transactions as context (paused)

Paused on 2026-10-02 and rolled back to v2. Everything needed to start it again is in this folder.

## Goal

Raise test AUPRC above v2's **0.452**.

A 50k batch covers only ~35 minutes of HI-Medium traffic, but laundering patterns (fan-out, cycles,
scatter-gather) play out over hours. The idea is to give each batch's graph the previous batch(es) as
**context**. Context transactions take part in message passing, account totals and "time since
previous transaction", but they aren't scored. At serve time the backend sends the same earlier rows
from staging.

## Settings

| Setting | Value | How it's set |
|---|---|---|
| Context batches | 1 (50,000 earlier transactions per batch) | `--context-batches 1` |
| Graph layers | 2, and 3 to test 3-hop patterns | `--layers 3` |
| Everything else | same as v2: 23 edge features, edge updates, hidden 64, dropout 0.2, lr 1e-3, pos_weight = sqrt(neg/pos), early stopping on validation AUPRC (patience 5) | constants in `train_amlgnn.py` |
| Batches | same 200 train / 20 val / 20 test as v2, plus each one's previous batch as context | `data/hi_medium_context_1.parquet` |

## Plan

1. **Screening** (60 train batches, 8 epochs, test this model only):

   | Run | Command | Status |
   |---|---|---|
   | exp-base (v2, no context) | `--name exp-base --train-batches 60 --max-epochs 8 --quick` | **done**: val AUPRC 0.472, test AUPRC **0.401**, F1 0.470, threshold 0.6955 (`amlgnn_exp-base.pt` in this folder) |
   | exp-ctx1 | `--name exp-ctx1 --context-batches 1 --train-batches 60 --max-epochs 8 --quick` | not started (stopped while building graphs) |
   | exp-ctx1-l3 | `--name exp-ctx1-l3 --context-batches 1 --layers 3 --train-batches 60 --max-epochs 8 --quick` | not started |

   Compare exp-ctx1 and exp-ctx1-l3 against exp-base (test AUPRC 0.401). Validation AUPRC moves
   about +-0.02 between epochs, so treat gains smaller than that as noise.

2. **Full run** with whatever helped, for example:
   `uv run python train_amlgnn.py --name v3 --context-batches 1` (all 200 train batches). Expect about
   8-9 minutes per epoch with context, about 2-3 hours in total. It checkpoints every epoch, so if it's
   interrupted, rerun the same command to continue.

3. If v3 beats v2 on test AUPRC: point `amlgnn` in `ML/service.py` at `amlgnn_v3.pt`, keep v2 as
   `amlgnn-v2`, and restart the ML service. The backend then sends context automatically, because
   it reads `contextRows` from `GET /models/amlgnn/info`.

## Files

`files/` holds the experiment versions of every file the experiment changed. The live files are back
at v2.

| Experiment file | Replaces | What changed |
|---|---|---|
| `files/ML/amlgnn.py` | `ML/amlgnn.py` | `build_graph(records, context=None)`; `AMLGNN.forward(..., query_from=0)` scores only non-context edges; `infer_amlgnn(..., context=None)`. v1/v2 bundles still work unchanged. |
| `files/ML/train_amlgnn.py` | `ML/train_amlgnn.py` | Command-line options `--name`, `--context-batches`, `--layers`, `--train-batches`, `--max-epochs`, `--quick`; prepares context batches; saves `model/amlgnn_<name>.pt`. With no options it trains exactly like v2. |
| `files/ML/service.py` | `ML/service.py` | Optional `context` list in `/models/{name}/predict` requests; `contextRows` in `/models/{name}/info` (0 for models without context). |
| `files/Backend/services/transaction_scoring.py` | same path | `context_rows()` asks the service; `score_transactions(df, context=None)` sends context. |
| `files/Backend/jobs/transaction_poller.py` | same path | Fetches the `contextRows` staging rows before each batch when the model wants them. |

**To start again,** copy the files back from the repository root:

```powershell
Copy-Item ML\experiments\context_v3\files\ML\*.py ML\
Copy-Item ML\experiments\context_v3\files\Backend\services\transaction_scoring.py Backend\services\
Copy-Item ML\experiments\context_v3\files\Backend\jobs\transaction_poller.py Backend\jobs\
```

If the live files have changed since 2026-10-02, merge rather than overwrite: compare each experiment
file with its live file first (`git diff --no-index <live> <experiment>`).

Then, from `ML/`:

```powershell
uv run python train_amlgnn.py --name exp-ctx1 --context-batches 1 --train-batches 60 --max-epochs 8 --quick
uv run python train_amlgnn.py --name exp-ctx1-l3 --context-batches 1 --layers 3 --train-batches 60 --max-epochs 8 --quick
```

## Cached data (git-ignored, in `ML/data/`)

- `hi_medium_context_1.parquet` is complete: the 130 previous batches (6.5M rows) that weren't
  already chosen.
- `graphs_ctx1/` has 75 of 240 context graphs built. The rest are built on the next run, about 1-2 s
  each. The file that was being written when the run stopped was deleted, in case it was incomplete.
- Delete both to rebuild from scratch. That's needed only if `build_graph` changes again.
