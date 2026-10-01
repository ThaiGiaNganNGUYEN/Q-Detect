# Production-Style Data Pipeline Demo

`pipeline.md` documents the pipeline as it exists today: a **batch** job that
loads the whole CSV, then a **batch** job that rebuilds the whole graph. This
document is the design for a variant that *demonstrates* how the same data
would flow in production: a one-time load into Postgres, then a **scheduled,
chunked** process that periodically pulls a slice of DB-stored transactions,
updates the graph, and feeds that slice to the ML model -- instead of
rebuilding everything from scratch every time.

Since the source dataset is a static, historical CSV (not a live feed), the
"production" part being demonstrated is the *ingestion cadence and chunking
mechanics* -- the scheduler replays the historical data in slices, standing
in for transactions arriving over time.

## Overview

In one paragraph: the raw CSV is loaded into Postgres exactly once (`staging_transactions`), and from then on nothing ever touches that raw table in bulk again -- instead, a scheduler (APScheduler) wakes up on a fixed real-world interval (e.g. every 5 minutes), and each time it fires it enqueues a job that asks "what's the next unprocessed slice of transactions?", using a `pipeline_watermark` row to know exactly where the last run left off and pulling either a fixed number of rows or the next time-window's worth of data; a worker (via Redis Queue) then picks that chunk up, figures out which accounts it touches, upserts just those accounts' aggregate features into a live `graph_nodes` table and appends the chunk's transactions as new rows in a live `graph_edges` table (so the graph grows incrementally rather than being rebuilt from scratch each time), hands that chunk's edges -- each paired with its two endpoint accounts' *cached* GNN embeddings, refreshed on a separate, much slower cadence rather than recomputed per chunk -- to the trained ML model's classifier head for scoring, persists the predictions, and finally advances the watermark -- all inside one database transaction, so a crash mid-chunk simply gets retried rather than silently skipping or duplicating data.

```
HI-Small_Trans.csv --[COPY, one-time]--> staging_transactions (Postgres)
                                                |
                                    [scheduler, every N minutes]
                                                |
                                                v
                                   pull next chunk (time window OR row count)
                                                |
                              +-----------------+------------------+
                              |                                    |
                    upsert touched accounts'                 compute this
                    node features (graph_nodes)          chunk's edge features
                              |                                    |
                              +-----------------+------------------+
                                                |
                                                v
                                   feed chunk to ML model (score / predict)
                                                |
                                                v
                                  advance watermark, log results
```

## Components

| Component | Role |
|---|---|
| **Postgres** | `staging_transactions` (raw, loaded once), `pipeline_watermark` (cursor -- where the last chunk left off), `graph_nodes` (live, incrementally-updated node feature store, including cached embeddings) |
| **Scheduler** | Fires on a fixed interval (e.g. every 5 minutes), decides *what* chunk is due next |
| **Queue + worker(s)** | Actually does the chunk processing (DB reads, feature upserts, model call), off the scheduler's own thread |
| **Re-embedding job** | Runs far less often (e.g. nightly) -- the *only* place a full-graph GNN forward pass happens, refreshing every account's cached embedding in `graph_nodes` |
| **ML model** | Two halves used differently: the GNN's message-passing layers (run only by the re-embedding job) and the classifier head (run per chunk, cheap) -- see [Step 5](#step-5----feeding-the-ml-model) |

## Part 1 -- Scheduled pipeline (APScheduler + Redis Queue)

The recommended design: a scheduler decides *when*, a queue + worker(s) do
the actual work. See [Part 2](#part-2----pipeline-without-a-scheduler) below
for the simpler alternative that drops the scheduler/queue layer entirely.

## Step 0 -- One-time load (already built)

Unchanged from `pipeline.md`: `scripts/load_transactions.py` loads the CSV
into `staging_transactions` once via `COPY`. Nothing here runs on a
schedule -- it's a prerequisite, run manually or as a one-off deploy step.

## Step 1 -- Track progress with a watermark table

A scheduled job that reprocesses everything from row 1 every time isn't
sound -- every run must pick up **only what the previous run hadn't
processed yet**. That requires a small table recording where the last run
stopped:

```sql
CREATE TABLE pipeline_watermark (
    id                  SMALLINT PRIMARY KEY DEFAULT 1,
    last_processed_id   BIGINT,          -- for row-count chunking
    last_processed_ts   TIMESTAMPTZ,     -- for time-window chunking
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (id = 1)                       -- single row, single pipeline
);

INSERT INTO pipeline_watermark (id, last_processed_id, last_processed_ts)
VALUES (1, 0, '1970-01-01') ON CONFLICT DO NOTHING;
```

Each run reads the current watermark, pulls the next chunk *after* it,
processes it, then advances the watermark -- in the same transaction as the
chunk processing, so a crash mid-run doesn't lose or double-process a chunk.

## Step 2 -- Two chunking strategies

Both were mentioned as options; pick one (row-count is simpler to reason
about, time-window is more realistic to how transactions would actually
arrive).

### A. Fixed row count per tick (e.g. N rows every 5 real minutes)

```sql
SELECT *
FROM staging_transactions
WHERE id > :last_processed_id
ORDER BY id
LIMIT :chunk_size;                       -- e.g. 50,000
```

Simple, predictable job duration (chunk size is fixed), easy to reason about
backlog (`SELECT COUNT(*) WHERE id > :last_processed_id`).

### B. Time window per tick ("10 minutes' worth of data")

```sql
SELECT *
FROM staging_transactions
WHERE timestamp > :last_processed_ts
  AND timestamp <= :last_processed_ts + INTERVAL '10 minutes'
ORDER BY timestamp;
```

Closer to how a real feed behaves (a burst of activity produces a bigger
chunk, a quiet period a smaller one), but chunk *size* is unpredictable --
worth capping with an additional `LIMIT` as a safety valve so one very busy
10-minute window doesn't blow up a single job run.

Either way, the scheduler tick interval (wall-clock, e.g. every 5 minutes)
is independent from the chunk-selection window (dataset time, e.g. 10
minutes of transaction history) -- that's what makes this a "replay":
each real 5-minute tick advances further through the dataset's own
timeline.

## Step 3 -- Scheduler + queue

Two building blocks, kept separate on purpose:

- **Scheduler** -- fires on a timer, decides a chunk is due, and enqueues a
  job. It does *no* DB/model work itself.
- **Worker** -- picks jobs off the queue and does the actual chunk
  processing (DB reads, feature upserts, model call).

Keeping these separate means a slow or failing chunk (model timeout, DB
contention) doesn't block the scheduler from firing its next tick, and
processing can be scaled by adding more workers without touching the
scheduler.

### Option comparison

| | **APScheduler only** | **APScheduler + Redis Queue (RQ)** | **Celery + Redis (beat + workers)** |
|---|---|---|---|
| Extra infra | None -- runs in-process | Redis | Redis (or RabbitMQ) |
| Scheduling | In-process timer/cron | In-process timer enqueues to Redis | `celery beat` schedules, brokered via Redis |
| Execution | Same process/thread as scheduler | Separate worker process(es) | Separate worker process(es) |
| Retry on failure | Manual (write it yourself) | Built into RQ (`retry=Retry(max=3)`) | Built into Celery, more configurable |
| Horizontal scaling | No (single process) | Yes -- run more `rq worker` processes | Yes -- run more Celery workers |
| Visibility/monitoring | Logs only | `rq-dashboard` (simple web UI) | Flower (richer web UI) |
| Operational complexity | Lowest | Low-medium | Medium-high |
| Good fit here | A single-instance dev/demo setup | **Recommended** -- decouples timing from execution without much extra ops burden | Overkill unless you already run Celery elsewhere |

**Recommendation: APScheduler for the trigger, RQ for execution.**
APScheduler's `IntervalTrigger` is enough to decide "a chunk is due" -- it
doesn't need Celery's full scheduling feature set. RQ (backed by the same
Redis that could later carry other async work, e.g. FastAPI background
tasks) gives retries, a real worker pool, and a dashboard, for very little
added operational surface versus APScheduler alone. If this project already
uses Celery elsewhere, use Celery instead and skip running two systems.

### Sketch: scheduler (`Backend/scheduler.py`)

```python
from apscheduler.schedulers.blocking import BlockingScheduler
from redis import Redis
from rq import Queue

from jobs import process_next_chunk  # the actual work, defined in jobs.py

queue = Queue("graph-pipeline", connection=Redis.from_url("redis://localhost:6379/0"))
scheduler = BlockingScheduler()


@scheduler.scheduled_job("interval", minutes=5)
def enqueue_chunk():
    queue.enqueue(process_next_chunk, retry=Retry(max=3, interval=[10, 30, 60]))


if __name__ == "__main__":
    scheduler.start()
```

### Sketch: worker job (`Backend/jobs.py`)

```python
from sqlmodel import Session, text

from db import get_engine
from ml_client import score_transactions  # classifier head only -- see Step 5

CHUNK_SIZE = 50_000


def process_next_chunk() -> None:
    engine = get_engine()
    with Session(engine) as session:
        watermark = session.exec(text(
            "SELECT last_processed_id FROM pipeline_watermark WHERE id = 1"
        )).one()

        chunk = session.exec(text(
            "SELECT * FROM staging_transactions WHERE id > :last "
            "ORDER BY id LIMIT :n"
        ), {"last": watermark, "n": CHUNK_SIZE}).all()

        if not chunk:
            return  # nothing new since last tick

        touched_accounts = {r.from_bank + "_" + r.from_account for r in chunk} | \
                            {r.to_bank + "_" + r.to_account for r in chunk}

        # --- this is the graph-build step, see "Step 4" below ---
        upsert_node_features(session, touched_accounts)    # scoped, not full-table
        edge_batch = build_edge_features(chunk)             # same feature logic as build_graph.py
        insert_graph_edges(session, edge_batch)              # persist into graph_edges
        # ------------------------------------------------------

        # score_transactions looks up each edge's src/dst graph_nodes.embedding
        # (falling back to a cold-start vector if NULL) and runs only the
        # classifier head -- it never recomputes embeddings itself
        predictions = score_transactions(session, edge_batch)
        persist_predictions(session, predictions)

        session.exec(text(
            "UPDATE pipeline_watermark SET last_processed_id = :last, updated_at = now() WHERE id = 1"
        ), {"last": chunk[-1].id})
        session.commit()   # chunk processing + watermark advance, one transaction
```

## Step 4 -- Build/update the graph, incrementally

This is the part that was easy to miss above: it isn't a separate scheduled
step, it's what the worker job's middle section (`upsert_node_features` +
`insert_graph_edges`) *is* -- the graph, at any point in time, is just the
current contents of `graph_nodes` + `graph_edges`. There is deliberately no
standalone "rebuild the graph" job here, because rebuilding from scratch is
exactly the full-table-rescan problem `pipeline.md`'s Production
Considerations section calls out. Instead, every chunk *extends* the graph
that already exists:

```sql
CREATE TABLE graph_nodes (
    account_id      TEXT PRIMARY KEY,          -- "{bank}_{account}"
    total_sent      DOUBLE PRECISION NOT NULL,
    total_received  DOUBLE PRECISION NOT NULL,
    tx_count_out    BIGINT NOT NULL,
    tx_count_in     BIGINT NOT NULL,
    unique_cp_out   BIGINT NOT NULL,
    unique_cp_in    BIGINT NOT NULL,
    avg_sent        DOUBLE PRECISION NOT NULL,
    avg_received    DOUBLE PRECISION NOT NULL,
    embedding       DOUBLE PRECISION[],        -- cached GNN node embedding, NULL until first re-embed
    embedding_at    TIMESTAMPTZ,                -- when `embedding` was last refreshed
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE graph_edges (
    id                  BIGINT PRIMARY KEY,        -- staging_transactions.id
    src_account_id      TEXT NOT NULL REFERENCES graph_nodes (account_id),
    dst_account_id      TEXT NOT NULL REFERENCES graph_nodes (account_id),
    is_laundering       BOOLEAN,
    log_amount_paid     DOUBLE PRECISION,
    log_amount_received DOUBLE PRECISION,
    amount_ratio        DOUBLE PRECISION,
    is_cross_currency   DOUBLE PRECISION,
    hour_sin            DOUBLE PRECISION,
    hour_cos            DOUBLE PRECISION,
    is_weekend          DOUBLE PRECISION,
    is_night            DOUBLE PRECISION,
    payment_format_enc  DOUBLE PRECISION,
    inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_graph_edges_src ON graph_edges (src_account_id);
CREATE INDEX ix_graph_edges_dst ON graph_edges (dst_account_id);
```

- **`upsert_node_features`** re-runs the same aggregation logic as
  `build_graph.py`'s node query, but **filtered to only the accounts touched
  by this chunk** (`WHERE account_id = ANY(:touched_accounts)`), and writes
  with `INSERT ... ON CONFLICT (account_id) DO UPDATE` into `graph_nodes` --
  each account's row reflects its running totals as of the last chunk that
  touched it, not a point-in-time snapshot like `nodes.csv`. It only ever
  touches the raw feature columns (`total_sent`, `tx_count_out`, ...) --
  **never `embedding`**. That column is owned entirely by the re-embedding
  job below; the chunk worker only ever reads it.
- **`insert_graph_edges`** appends this chunk's transactions as rows in
  `graph_edges` (`FOREIGN KEY` to `graph_nodes`, since every edge's
  endpoints must already have been upserted by the line above). Unlike the
  batch pipeline's `edges.csv`, which is a full rewrite every run, this is a
  pure append -- prior chunks' edges are never touched again.

Recomputing stats for a few thousand touched accounts (and inserting one
chunk's worth of edges) is cheap; recomputing all 515K accounts and 5M edges
on every 5-minute tick is not -- that's the incremental-aggregation change
called out in `pipeline.md`'s Production Considerations section. At any
moment, `graph_nodes` JOIN `graph_edges` **is** the current graph -- a live,
continuously-growing table pair, replacing the static CSV pair from the
batch pipeline.

### The periodic re-embedding job (the only full-graph step, and it's intentionally rare)

The GNN's message-passing layers (`conv1`/`conv2` in the reference notebook)
compute a node's embedding from its neighbors -- and its neighbors'
neighbors, for a 2-layer GNN. That means getting a correct embedding for one
account genuinely requires looking at a slice of the graph around it, not
just that account's own row. Running that for every account on every
5-minute chunk tick would mean the "expensive" part of the pipeline runs on
the *same* schedule as the cheap part, which defeats the point of chunking
in the first place.

The standard fix: decouple the two. A **separate job, on a much slower
cadence** (nightly, or every few hours -- not the 5-minute chunk interval)
loads the current `graph_nodes` + `graph_edges`, runs the GNN's
message-passing layers once over the whole graph, and bulk-writes the
resulting vectors back into `graph_nodes.embedding`:

```python
# Backend/jobs_reembed.py -- scheduled separately, e.g. nightly
def refresh_embeddings() -> None:
    engine = get_engine()
    graph = load_full_graph(engine)          # graph_nodes + graph_edges -> PyG Data
    embeddings = gnn_model.get_node_embeddings(graph.x, graph.edge_index)  # one forward pass

    with Session(engine) as session:
        for account_id, vec in zip(graph.account_ids, embeddings.tolist()):
            session.exec(text(
                "UPDATE graph_nodes SET embedding = :vec, embedding_at = now() "
                "WHERE account_id = :aid"
            ), {"vec": vec, "aid": account_id})
        session.commit()
```

This is registered as its own APScheduler job (or its own cron line in
[Part 2](#part-2----pipeline-without-a-scheduler)) with a longer interval,
sharing the same Postgres and worker infrastructure but never touching the
5-minute chunk loop.

## Step 5 -- Feeding the ML model

Per chunk, the worker feeds the model **this chunk's edges only, each
paired with its two endpoints' already-cached embeddings** -- not the full
graph, and not a fresh embedding computation:

```python
# for each transaction in the chunk:
model_input = concat(
    graph_nodes.embedding[src_account_id],   # cached, from the last re-embed
    graph_nodes.embedding[dst_account_id],   # cached, from the last re-embed
    edge_features,                            # computed fresh, this chunk
)
prediction = classifier_head(model_input)     # cheap -- an MLP forward pass, no message passing
```

This is only cheap because the model's expensive part (message passing over
the graph) already ran in the re-embedding job -- the chunk worker only ever
runs the lightweight classifier head (`edge_mlp` in the reference notebook)
on vectors that are already sitting in Postgres. The trade-off: an
account's embedding can be up to one re-embedding cycle stale (e.g. up to
24h old) relative to its very latest transactions -- acceptable for most
AML use cases, but worth surfacing as a monitoring metric (`now() -
embedding_at`), since a badly stale embedding degrades prediction quality
quietly rather than failing loudly.

**Cold start:** a brand-new account, first seen in this chunk, has no
`embedding` yet -- `upsert_node_features` just inserted its raw features,
but the next re-embedding job hasn't run yet. Handle this explicitly rather
than letting a `NULL` reach the model: fall back to a zero-vector (or a
small separately-trained "cold-start" head that uses only the raw
aggregate features) until the account is picked up by the next
re-embedding cycle.

**Retraining vs. scoring:** everything above is inference against an
already-trained model. Retraining the GNN itself (updating its weights, not
just refreshing cached embeddings) is a separate, much heavier, much less
frequent process (e.g. monthly, or triggered manually after a model review)
-- not something this chunk loop or even the nightly re-embedding job does.

## Step 6 -- Idempotency & failure handling

- **Watermark advance is transactional** with the chunk processing (see
  sketch) -- if the job crashes before commit, the watermark hasn't moved,
  and the next attempt reprocesses the same chunk rather than skipping it.
- **RQ retries** (`Retry(max=3, interval=[10, 30, 60])`) handle transient
  failures (DB hiccup, model service timeout) without manual intervention.
- **`graph_nodes` upserts are naturally idempotent** (`ON CONFLICT DO
  UPDATE` recomputes from source data, doesn't accumulate deltas), so
  reprocessing the same chunk twice is safe. **`graph_edges` inserts are
  not** by default (a retried chunk would try to insert the same `id`
  twice) -- use `INSERT ... ON CONFLICT (id) DO NOTHING` there too, so a
  retried chunk is a safe no-op rather than a duplicate-key error.
- A job that keeps failing after retries should land in RQ's failed-job
  registry rather than silently disappearing -- worth alerting on that
  queue's size.

## Step 7 -- Monitoring

- `rq-dashboard` (a small separate web process) gives a live view of
  queued/running/failed jobs.
- Log, per chunk: chunk size, accounts touched, processing time, model call
  latency, prediction summary (e.g. how many flagged this run).
- Alert if `pipeline_watermark.updated_at` goes stale (the scheduler stopped
  firing or every recent job has failed).

## Deployment additions vs. the current `docker-compose.yml`

```yaml
services:
  db:        # unchanged -- Postgres
  redis:
    image: redis:7
    ports: ["6379:6379"]
  scheduler:
    build: ./Backend
    command: uv run python scheduler.py
    depends_on: [redis, db]
  worker:
    build: ./Backend
    command: uv run rq worker graph-pipeline --url redis://redis:6379/0
    depends_on: [redis, db]
    deploy:
      replicas: 2          # scale workers independently of the scheduler
```

## How this maps back to what already exists

| Existing (`pipeline.md`) | Production variant (this doc) |
|---|---|
| `load_transactions.py` -- one-time full load | Unchanged -- still the Step 0 prerequisite |
| `build_graph.py` -- recomputes all 515K node aggregates every run, writes `nodes.csv` | `upsert_node_features()` -- recomputes only the accounts touched by the current chunk, upserts into `graph_nodes` (Step 4) |
| `build_graph.py` -- recomputes all 5M edge features every run, writes `edges.csv` | `build_edge_features()` + `insert_graph_edges()` -- same per-row feature logic, applied only to the current chunk, appended into `graph_edges` (Step 4) |
| Output: static `nodes.csv` / `edges.csv`, read once by a training notebook | Output: live `graph_nodes` + `graph_edges` tables (the graph itself) plus per-chunk predictions, continuously updated |
| Run manually, on demand | Run on a schedule (APScheduler trigger -> RQ worker), continuously |

## Part 2 -- Pipeline without a scheduler

Everything in Steps 0, 1, 2, 4, and 6 above is unchanged here -- the
one-time load, the watermark table, the chunking queries, the incremental
`graph_nodes`/`graph_edges` build, and the idempotent upserts all stay
exactly as designed. What's removed is Step 3's scheduler + queue layer
(APScheduler and Redis Queue) -- no Redis dependency, no in-process Python
scheduler, no separate worker pool.

This fits when: a single-instance/low-volume deployment doesn't need
horizontal scaling or job retries, the platform already has its own
scheduling primitive (cron, Windows Task Scheduler, a cloud provider's
scheduled job/cloud function) and doesn't need a second one layered on top
in Python, or you just want the simplest thing that works before adding
queueing infrastructure later.

### What changes

`jobs.py`'s `process_next_chunk()` function -- the actual chunk logic --
is reused as-is. The only new piece is a thin CLI entrypoint that runs it
once and exits, meant to be triggered externally rather than from inside a
long-running scheduler process:

```python
# Backend/scripts/process_chunk.py
"""Process exactly one chunk, then exit.

Meant to be triggered externally (cron, Windows Task Scheduler, a cloud
scheduled job) instead of an in-process Python scheduler.

Usage:
    uv run python -m scripts.process_chunk
"""
from jobs import process_next_chunk

if __name__ == "__main__":
    process_next_chunk()
```

Trigger it on a schedule using whatever the deployment platform already
has:

```bash
# cron (Linux/macOS) -- every 5 minutes
*/5 * * * * cd /path/to/Backend && uv run python -m scripts.process_chunk >> /var/log/qdetect/pipeline.log 2>&1
```

```powershell
# Windows Task Scheduler -- create a Basic Task
# Trigger:  Repeat every 5 minutes, indefinitely
# Action:   Start a program
#   Program: uv
#   Arguments: run python -m scripts.process_chunk
#   Start in: D:\Learning\Q-Detect\Backend
```

### The one thing you have to add back yourself: overlap protection

RQ gave this for free in Part 1 -- a queue naturally processes one job at a
time, so a slow chunk just delays the next one rather than running
alongside it. Plain cron has no such awareness: if a chunk takes longer than
5 minutes, cron fires again anyway, and two processes could race on the
same watermark. Guard against that with a Postgres advisory lock at the top
of `process_next_chunk()`:

```python
def process_next_chunk() -> None:
    engine = get_engine()
    with engine.connect() as conn:
        got_lock = conn.execute(text("SELECT pg_try_advisory_lock(918273)")).scalar()
        if not got_lock:
            print("Previous run still in progress -- skipping this tick.")
            return
        try:
            ...  # same chunk processing as Part 1
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(918273)"))
```

### Trade-offs vs. Part 1

| | **Part 1** (APScheduler + RQ) | **Part 2** (external cron, no queue) |
|---|---|---|
| Extra infra | Redis | None -- just the OS/platform's own scheduler |
| Retry on failure | Automatic (RQ) | None built-in -- watermark doesn't advance on failure, so no data is lost, but nothing retries before the next scheduled tick |
| Parallel workers | Yes -- scale `rq worker` replicas | No -- a single process runs to completion, then exits |
| Overlap protection | Free (queue serializes jobs) | Must add yourself (advisory lock, shown above) |
| Visibility | `rq-dashboard` | Process exit code + logs only |
| Best for | Multi-instance or higher-volume deployments | Single-instance, low-volume, or a stepping stone before introducing a queue |

## What this demo does *not* solve

This is still a **simulation** built on a static historical dataset, not a
real production ingestion path:

- There's no real upstream producing new transactions -- the scheduler
  is replaying rows already sitting in `staging_transactions`.
- A real system would ingest from wherever transactions actually
  originate (a message queue, an upstream service's API/webhook, a
  banking core system feed) instead of `SELECT ... WHERE id > :last`.
- Model retraining cadence, drift monitoring, and A/B rollout of new model
  versions aren't covered here -- this doc only covers the ingestion ->
  graph-update -> scoring loop.
