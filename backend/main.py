from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import leads, ingest
from app.routes.users import users_router, search_router
from app.routes.chat import router as chat_router
from app.scorer import get_token_usage

app = FastAPI(title="Intent Intelligence API", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(ingest.router)
app.include_router(users_router)
app.include_router(search_router)
app.include_router(chat_router)

@app.get("/")
def root():
    return {"status": "Intent Intelligence API running"}

@app.get("/usage/")
def token_usage():
    return get_token_usage()
