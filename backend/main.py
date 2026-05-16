from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import leads, ingest

app = FastAPI(title="Intent Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(ingest.router)

@app.get("/")
def root():
    return {"status": "Intent Intelligence API running"}
