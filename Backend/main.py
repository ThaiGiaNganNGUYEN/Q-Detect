from fastapi import FastAPI

""" from routers.transactions import router as transactions_router """
from routers.cluster_router import router as cluster_router

app = FastAPI()
""" app.include_router(transactions_router) """
app.include_router(cluster_router)

@app.get("/")
async def home():
    return {"message": "Hello World!"}