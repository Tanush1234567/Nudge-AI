"""Main API router — aggregates per-resource routers behind one object.

WHY: main.py imports a single `router`; resource modules (videos, etc.) are
mounted here so endpoint wiring lives in one place.
"""

from fastapi import APIRouter

from api.courses import router as courses_router
from api.resurfacing import router as resurfacing_router
from api.videos import router as videos_router
from api.workspace import router as workspace_router

router = APIRouter()

router.include_router(videos_router, prefix="/api")
router.include_router(workspace_router, prefix="/api")
router.include_router(courses_router, prefix="/api")
router.include_router(resurfacing_router, prefix="/api")


@router.get("/api/health")
async def health() -> dict:
    """Lightweight readiness probe."""
    return {"status": "ok"}
