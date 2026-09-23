from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

""" from routers.transactions import router as transactions_router """
from routers.cluster_router import router as cluster_router
from routers import backup_model

app = FastAPI()

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
app.include_router(backup_model.router, prefix="/api", tags=["predictions"])

@app.get("/")
async def home():
    return {"message": "Hello World!"}