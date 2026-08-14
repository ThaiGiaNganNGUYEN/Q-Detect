from fastapi import FastAPI

from routers.transactions import router as transactions_router

app = FastAPI()
app.include_router(transactions_router)


@app.get("/")
async def home():
    return {"message": "Hello World!"}
