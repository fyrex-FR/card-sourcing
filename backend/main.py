import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import sourcing

load_dotenv()

debug = os.getenv("DEBUG", "false").lower() == "true"

app = FastAPI(title="Card Sourcing API", docs_url="/docs" if debug else None, redoc_url=None)

origins = [
    "http://localhost:5173",
    "http://localhost:5174",
]
extra_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "").split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins + extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sourcing.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"ok": True}
