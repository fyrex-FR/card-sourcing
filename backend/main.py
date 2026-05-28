import asyncio
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import sourcing
from services.notify_scheduler import run_scheduler

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


_scheduler_task: asyncio.Task | None = None


@app.on_event("startup")
async def _start_notify_scheduler() -> None:
    global _scheduler_task
    if os.getenv("NOTIFY_SCHEDULER_DISABLED", "false").lower() == "true":
        print("[notify] scheduler disabled via NOTIFY_SCHEDULER_DISABLED")
        return
    _scheduler_task = asyncio.create_task(run_scheduler())
    print("[notify] scheduler started")


@app.on_event("shutdown")
async def _stop_notify_scheduler() -> None:
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass


@app.get("/api/health")
async def health():
    return {"ok": True}
