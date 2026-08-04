from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(lifespan=lifespan)

class Transactions(BaseModel):
    transactions: List[Transaction]
    
class Transaction():
    transaction_id: str
    transaction_amount: float
    transaction_currency: str
    transaction_date: datetime
    transaction_type: str
    transaction_status: str
    transaction_id: str
    transaction_status: str
    
    
@app.get("/")
async def home():
    return {"message":"Hello World!"}

@app.post("/predict")
async def predict(transactions: Transactions):
    return {"message":"Predictions made!"}