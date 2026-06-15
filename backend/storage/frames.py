"""Upload captured frame images to Supabase Storage.

WHY: A job captures 60+ frames but only a handful are actually referenced in
the final notes. We upload only those — storing every frame would burn through
the 1GB free-tier quota fast. Failed uploads are skipped: a note missing one
image is fine; a crashed job is not.
"""

import logging

from config import SUPABASE_URL
from db.client import get_supabase

logger = logging.getLogger(__name__)

_BUCKET = "frames"


def _public_url(job_id: str, index: int) -> str:
    """Build the public URL for an uploaded frame."""
    return (
        f"{SUPABASE_URL}/storage/v1/object/public/"
        f"{_BUCKET}/{job_id}/frame_{index:03d}.jpg"
    )


async def upload_key_frames(
    job_id: str,
    frames: list,
    sections: list,
) -> dict[int, str]:
    """Upload only the frames referenced in the notes; return index -> URL.

    `frames` are CapturedFrame objects; `sections` are StitchedSections whose
    important_frames carry the indices that actually appear in the notes.
    """
    # (a) Which frame indices are actually referenced.
    referenced: set[int] = set()
    for section in sections:
        for frame in getattr(section, "important_frames", []):
            idx = frame.get("frame_index")
            if idx is not None:
                referenced.add(idx)

    if not referenced:
        return {}

    frames_by_index = {f.frame_index: f for f in frames}
    sb = get_supabase()
    urls: dict[int, str] = {}

    for index in sorted(referenced):
        frame = frames_by_index.get(index)
        if frame is None:
            logger.warning("Referenced frame %d not found in captured frames.", index)
            continue
        try:
            with open(frame.image_path, "rb") as fh:
                data = fh.read()
            path = f"{job_id}/frame_{index:03d}.jpg"
            sb.storage.from_(_BUCKET).upload(
                path,
                data,
                {"content-type": "image/jpeg", "upsert": "true"},
            )
            urls[index] = _public_url(job_id, index)
        except Exception as exc:  # noqa: BLE001 — a failed upload is non-fatal
            logger.error("Failed to upload frame %d for job %s: %s", index, job_id, exc)
            continue

    logger.info("Uploaded %d/%d referenced frames for job %s",
                len(urls), len(referenced), job_id)
    return urls
