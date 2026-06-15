"""FastAPI application entrypoint for the Pupil backend.

WHY: Wires CORS, the job-queue worker lifecycle, and the API router into a
single ASGI app. The lifespan hook owns the background worker so it starts
with the server and shuts down cleanly.
"""

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ALLOWED_ORIGINS
from api.router import router
from job_queue.worker import job_queue


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the job-queue workers on startup, stop them on shutdown."""
    await job_queue.start_workers()
    yield
    await job_queue.shutdown()


app = FastAPI(title="Pupil API", version="0.1.0", lifespan=lifespan)

# Local frontend dev: Next.js hops to 3001+ when 3000 is taken, so allow a range.
_dev_origins = {f"http://localhost:{p}" for p in range(3000, 3011)}
_cors_origins = list({*ALLOWED_ORIGINS, *_dev_origins})

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="")


@app.get("/")
async def root() -> dict:
    """Health check used by HF Spaces and uptime monitors."""
    return {"status": "ok", "service": "pupil", "version": "0.1.0"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=7860, reload=True)
