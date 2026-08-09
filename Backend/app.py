from fastapi import FastAPI
import database_builder

app = FastAPI()

@app.get("/")
async def home():
    return {"message":"Hello World!"}


print("Hello World!")
try:
    print("Creating database engine...")    
    database_builder.createEngine()
    print("Database engine created successfully.")
except Exception as e:
    print(f"Error creating database engine: {e}")