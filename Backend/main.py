from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

""" from routers.transactions import router as transactions_router """
from jobs import transaction_poller
from routers.cluster_router import router as cluster_router
from routers.util_router import router as util_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs as a single in-process loop -- start the app with one worker,
    # or every worker process will pull the same batches.
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