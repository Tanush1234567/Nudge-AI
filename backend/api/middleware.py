"""Request helpers: Supabase auth, client IP, and YouTube URL validation.

WHY: Endpoints behind /api are authenticated against Supabase Auth. The
`require_user` FastAPI dependency verifies the incoming Bearer token with
the Supabase Admin client and returns the authenticated user, which
handlers pass through to the DB layer for ownership checks.
"""

import logging

from fastapi import Header, HTTPException, Request, status

from db.client import get_supabase

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """Return the originating client IP, accounting for proxy headers."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    return request.client.host if request.client else "unknown"


def validate_youtube_url(url: str) -> bool:
    """True if the URL plausibly points at a YouTube video."""
    if not url or not isinstance(url, str):
        return False
    lowered = url.lower()
    return "youtube.com" in lowered or "youtu.be" in lowered


async def require_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict:
    """FastAPI dependency: verify the Bearer token and return the user.

    Raises 401 if the header is missing/malformed or the token is invalid.
    On success the user_id + email are stashed on `request.state` so
    downstream handlers can pick them up cheaply.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
        )

    try:
        sb = get_supabase()
        res = sb.auth.get_user(token)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Supabase auth.get_user failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    user = getattr(res, "user", None)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

    user_id = getattr(user, "id", None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user id",
        )

    request.state.user_id = user_id
    request.state.user_email = getattr(user, "email", None)

    meta = getattr(user, "user_metadata", None) or {}
    return {
        "id": user_id,
        "email": getattr(user, "email", None),
        "name": meta.get("full_name") or meta.get("name"),
        "avatar_url": meta.get("avatar_url") or meta.get("picture"),
    }
