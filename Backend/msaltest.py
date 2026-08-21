import uvicorn

from fastapi import FastAPI, Depends
from starlette.middleware.sessions import SessionMiddleware
from fastapi_msal import MSALAuthorization, UserInfo, MSALClientConfig

client_config: MSALClientConfig = MSALClientConfig()
client_config.client_id = "The client_id retrieved at step #1"
client_config.client_credential = "The client_credential retrieved at step #1"
client_config.tenant = "Your tenant_id retrieved at step #1"

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key="suoersecretkey")  # replace with your own!!!
msal_auth = MSALAuthorization(client_config=client_config)
app.include_router(msal_auth.router)


@app.get("/users/me", response_model=UserInfo, response_model_exclude_none=True, response_model_by_alias=False)
async def read_users_me(current_user: UserInfo = Depends(msal_auth.scheme)) -> UserInfo:
    return current_user


if __name__ == "__main__":
    uvicorn.run("main:app", host="localhost", port=5000, reload=True)