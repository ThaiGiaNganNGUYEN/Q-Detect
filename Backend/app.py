from fastapi import FastAPI
import database_builder
## App structure : User page (login credentials) -> 
# /login ( 1. Checks authentication, then authorizes JWT) ->
# Send JWT to user -> /dashboard ( 2. Checks JWT, then displays dashboard content)


app = FastAPI()

@app.get("/")
async def home():
    ## Opens login page
    return {"message":"Hello World!"}

@app.get("/login")
async def login():
    ## Checks Credentials, if login credentials are correct, redirect to dashboard page
    return {"message":"Login page"}

@app.get("/dashboard")
async def dashboard():
    ## Display dashboard content
    return {"message":"Dashboard page"}


print("Hello World!")
try:
    print("Creating database engine...")    
    database_builder.createEngine()
    print("Database engine created successfully.")
except Exception as e:
    print(f"Error creating database engine: {e}")