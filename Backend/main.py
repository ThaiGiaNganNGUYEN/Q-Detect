import asyncio
import os
import traceback
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

""" from routers.transactions import router as transactions_router """
from jobs import transaction_poller
from routers.cluster_router import router as cluster_router
from routers.util_router import router as util_router

load_dotenv()

# Off by default: scoring only starts via POST /api/util/jobs/start.
AUTO_START_POLLER = os.getenv("AUTO_START_POLLER", "false").lower() in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creates the graph tables and backfills anything not assigned yet. A
    # failure is logged rather than stopping the API from starting.
    try:
        await asyncio.to_thread(transaction_poller.sync_graphs)
    except Exception:
        traceback.print_exc()

    # Runs as a single in-process loop -- start the app with one worker,
    # or every worker process will pull the same batches.
    if AUTO_START_POLLER:
        transaction_poller.start()
    yield
    await transaction_poller.stop()


app = FastAPI(lifespan=lifespan)

# Vite dev server runs on a different origin (port) than this API, so the
# browser blocks the frontend's fetch() calls without explicit CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

""" app.include_router(transactions_router) """
app.include_router(cluster_router)
app.include_router(util_router)

@app.get("/")
async def home():
    return {"message": "Hello World!"}


if __name__ == "__main__":
    import uvicorn

    # `uv run main.py` -- single worker, see lifespan above.
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))