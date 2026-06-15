"""Stage 3: semantic-aware frame extraction using DINOv2.

WHY: Raw pixel-diff fails on whiteboard lectures — the speaker moving triggers
false scene changes even when the educational content hasn't changed. DINOv2
(facebook/dinov2-small, 21M parameters) computes semantic embeddings that
represent what the frame MEANS, not what pixels look like. Two frames showing
the same whiteboard with different speaker poses get cosine similarity ~0.95
(same meaning). Genuinely different content gets ~0.70 (different meaning).

PERFORMANCE: DINOv2-small processes one 224x224 image in ~50ms on CPU. For a
7-min video sampled every 3 seconds, that's ~140 frames. The tiered approach
(pHash fast-filter → DINOv2 only for ambiguous cases) means DINOv2 runs on
~30-40% of frames. Total time: ~3-5 seconds. Negligible vs Gemini API calls.

FALLBACK: If DINOv2 fails to load (download error, OOM), the system falls
back to the original pixel-diff approach. Degraded quality beats a crash.
"""

import base64
import hashlib
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from config import (
    PHASH_DEFINITE_DIFF,
    PHASH_DEFINITE_SAME,
    SEMANTIC_DISTINCT_STATE_THRESHOLD,
    SEMANTIC_MODEL,
    SEMANTIC_SIMILARITY_THRESHOLD,
)
from pipeline.exceptions import FrameExtractionError

logger = logging.getLogger(__name__)

_PIXEL_DIFF_THRESHOLD = 30
_COMPARE_SIZE = (160, 90)
_JPEG_QUALITY = 85

# --- Lazy-loaded DINOv2 model (loaded on first use, not at import) ----------

_dinov2_model = None
_dinov2_processor = None
_dinov2_available = None  # None = not tried yet, True/False after first attempt


def _load_dinov2():
    """Load DINOv2-small on first call. Returns True if successful."""
    global _dinov2_model, _dinov2_processor, _dinov2_available

    if _dinov2_available is not None:
        return _dinov2_available

    try:
        import torch
        from transformers import AutoImageProcessor, AutoModel

        logger.info("[DIAG] Loading DINOv2 model (%s)...", SEMANTIC_MODEL)
        _dinov2_processor = AutoImageProcessor.from_pretrained(SEMANTIC_MODEL)
        _dinov2_model = AutoModel.from_pretrained(SEMANTIC_MODEL)
        _dinov2_model.eval()
        _dinov2_available = True
        logger.info("[DIAG] DINOv2 loaded successfully (384-dim embeddings, CPU).")
    except Exception as exc:
        logger.warning(
            "[DIAG] DINOv2 unavailable — falling back to pixel-diff. Reason: %s", exc
        )
        _dinov2_available = False

    return _dinov2_available


def _get_embedding(frame_bgr: np.ndarray) -> Optional[np.ndarray]:
    """Compute a 384-dim L2-normalized semantic embedding for a BGR frame.

    Returns None if DINOv2 is not available.
    """
    if not _dinov2_available:
        return None

    import torch
    from PIL import Image

    try:
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        inputs = _dinov2_processor(pil_img, return_tensors="pt")

        with torch.no_grad():
            outputs = _dinov2_model(**inputs)

        # CLS token = first token of last hidden state = whole-image meaning
        embedding = outputs.last_hidden_state[:, 0, :].squeeze().numpy()
        # L2-normalize so dot product = cosine similarity
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
        return embedding
    except Exception as exc:
        logger.warning("DINOv2 embedding failed: %s", exc)
        return None


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two L2-normalized vectors (= dot product)."""
    return float(np.dot(a, b))


def _compute_phash(frame_bgr: np.ndarray) -> Optional[object]:
    """Compute perceptual hash for fast pre-filtering. Returns None on failure."""
    try:
        import imagehash
        from PIL import Image

        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        return imagehash.phash(pil_img, hash_size=16)
    except Exception:
        return None


def _phash_distance(h1, h2) -> int:
    """Hamming distance between two perceptual hashes."""
    if h1 is None or h2 is None:
        return 999  # force semantic check if pHash failed
    return h1 - h2


# --- CapturedFrame dataclass ------------------------------------------------

@dataclass
class CapturedFrame:
    """A frame selected for vision analysis."""

    timestamp: float
    frame_index: int
    image_path: str
    image_base64: str
    change_score: float
    content_hash: str
    # NEW — why this frame was captured (does not break existing consumers)
    capture_reason: str = "semantic_change"


# --- Main extraction function -----------------------------------------------

def extract_smart_frames(
    video_path: str,
    output_dir: str,
    sample_interval: float = 3.0,
    change_threshold: float = 0.12,
    min_interval: float = 5.0,
    force_interval: float = 30.0,
    max_frames: int = 60,
    target_width: int = 640,
    delete_video: bool = False,
) -> list[CapturedFrame]:
    """Extract semantically distinct frames from a video.

    Uses a three-tier comparison:
    1. pHash fast-filter: Hamming distance < PHASH_DEFINITE_SAME → skip (< 1ms)
    2. pHash fast-filter: Hamming distance > PHASH_DEFINITE_DIFF → capture (< 1ms)
    3. DINOv2 semantic check: cosine similarity → capture or skip (~50ms)

    Falls back to pixel-diff if DINOv2 is unavailable.

    NOTE: The video file is NOT deleted by default. Pass delete_video=True only
    when the caller is certain no downstream stage (e.g. regrab) needs the file.
    The enhanced orchestrator leaves deletion to its temp_dir cleanup.
    """
    if not os.path.exists(video_path):
        raise FrameExtractionError(f"Video file not found: {video_path}")

    os.makedirs(output_dir, exist_ok=True)

    # Remap old-style pixel threshold to semantic threshold
    # Old default was 0.12 (12% pixel change). If caller passes a value < 0.5,
    # it's the old pixel-diff threshold — remap to semantic similarity.
    if change_threshold < 0.5:
        semantic_threshold = SEMANTIC_SIMILARITY_THRESHOLD
        pixel_threshold = change_threshold
    else:
        semantic_threshold = change_threshold
        pixel_threshold = 0.12

    # Try to load DINOv2 (lazy, first-call only)
    use_semantic = _load_dinov2()
    logger.info(
        "[DIAG] extract_smart_frames: method=%s  max_frames=%d  sample_interval=%.1fs  "
        "min_interval=%.1fs  force_interval=%.1fs  semantic_threshold=%.3f",
        "dinov2" if use_semantic else "pixel-diff",
        max_frames, sample_interval, min_interval, force_interval,
        SEMANTIC_SIMILARITY_THRESHOLD if use_semantic else change_threshold,
    )

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        cap.release()
        raise FrameExtractionError(f"OpenCV could not open video: {video_path}")

    captured: list[CapturedFrame] = []
    embeddings: list[Optional[np.ndarray]] = []  # parallel to captured

    # Counters for per-run diagnostics
    _n_sampled = 0
    _n_skip_min_interval = 0
    _n_skip_phash_same = 0
    _n_capture_phash_diff = 0
    _n_capture_semantic = 0
    _n_skip_semantic = 0
    _n_force = 0
    _n_pixel_change = 0
    _n_pixel_skip = 0

    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            raise FrameExtractionError("Could not determine video frame rate.")

        # Spread the frame budget across the WHOLE video. Without this, a burst
        # of scene-changes early on exhausts max_frames in the first few
        # minutes and the rest of the video is never sampled. Stretch the
        # capture spacing so ~max_frames frames span the full duration.
        total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = total_frames / fps if total_frames > 0 else 0.0
        if duration > 0:
            target_spacing = duration / max_frames
            min_interval = max(min_interval, target_spacing)
            force_interval = max(force_interval, target_spacing)
            logger.info(
                "[DIAG] Video duration=%.0fs fps=%.1f total_frames=%.0f "
                "budget=%d → effective min_interval=%.1fs force_interval=%.1fs",
                duration, fps, total_frames, max_frames, min_interval, force_interval,
            )

        sample_every_n = max(1, int(round(fps * sample_interval)))

        prev_small = None       # for pixel-diff fallback
        prev_embedding = None   # for DINOv2 comparison
        prev_phash = None       # for fast pre-filter
        last_capture_time = -1e9
        frame_pos = 0

        while len(captured) < max_frames:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_pos % sample_every_n != 0:
                frame_pos += 1
                continue

            _n_sampled += 1
            timestamp = frame_pos / fps
            elapsed = timestamp - last_capture_time

            # --- Decision logic ---
            if prev_embedding is None and prev_small is None:
                # First frame — always capture
                should_capture = True
                change_score = 1.0
                capture_reason = "first_frame"
                cached_emb = None

            elif use_semantic:
                # === SEMANTIC COMPARISON (DINOv2 + pHash tiered) ===
                should_capture, change_score, capture_reason, cached_emb = (
                    _semantic_comparison(
                        frame, prev_phash, prev_embedding,
                        semantic_threshold, elapsed, min_interval,
                        force_interval,
                    )
                )
                # Tally reason for diagnostics
                if not should_capture:
                    if capture_reason == "":
                        if elapsed < min_interval:
                            _n_skip_min_interval += 1
                        else:
                            _n_skip_phash_same += 1
                    else:
                        _n_skip_semantic += 1
                else:
                    if capture_reason == "forced_interval":
                        _n_force += 1
                    elif capture_reason == "semantic_change" and change_score == 1.0:
                        _n_capture_phash_diff += 1
                    else:
                        _n_capture_semantic += 1
            else:
                # === FALLBACK: pixel-diff (original behavior) ===
                small = cv2.cvtColor(
                    cv2.resize(frame, _COMPARE_SIZE), cv2.COLOR_BGR2GRAY
                )
                diff = cv2.absdiff(small, prev_small)
                changed = int((diff > _PIXEL_DIFF_THRESHOLD).sum())
                change_score = changed / diff.size
                scene_changed = (
                    change_score > pixel_threshold and elapsed >= min_interval
                )
                forced = elapsed >= force_interval
                should_capture = scene_changed or forced
                capture_reason = (
                    "pixel_change_fallback" if scene_changed
                    else "forced_interval" if forced
                    else ""
                )
                cached_emb = None
                if should_capture:
                    if scene_changed:
                        _n_pixel_change += 1
                    else:
                        _n_force += 1
                else:
                    _n_pixel_skip += 1

            if should_capture:
                frame_obj = _save_frame(
                    frame, timestamp, len(captured), output_dir,
                    change_score, target_width, capture_reason,
                )
                if frame_obj is not None:
                    captured.append(frame_obj)

                    # Update previous references for next comparison
                    if use_semantic:
                        # Reuse embedding from _semantic_comparison if available,
                        # otherwise compute fresh (for first_frame / forced_interval)
                        prev_embedding = cached_emb if cached_emb is not None else _get_embedding(frame)
                        prev_phash = _compute_phash(frame)
                        embeddings.append(prev_embedding)
                    else:
                        prev_small = cv2.cvtColor(
                            cv2.resize(frame, _COMPARE_SIZE),
                            cv2.COLOR_BGR2GRAY,
                        )
                        embeddings.append(None)

                    last_capture_time = timestamp

            frame_pos += 1
    finally:
        cap.release()

    logger.info(
        "[DIAG] Frame sampling complete: sampled=%d captured=%d "
        "| skip_min_interval=%d skip_phash_same=%d skip_semantic=%d "
        "| capture_phash_diff=%d capture_semantic=%d force=%d "
        "| pixel_change=%d pixel_skip=%d",
        _n_sampled, len(captured),
        _n_skip_min_interval, _n_skip_phash_same, _n_skip_semantic,
        _n_capture_phash_diff, _n_capture_semantic, _n_force,
        _n_pixel_change, _n_pixel_skip,
    )

    # --- Post-extraction dedup ---
    # Collapse to one frame per visually distinct board/slide state. A
    # whiteboard lecture (one board, the speaker moving) collapses to a
    # handful; a slide deck keeps one frame per slide.
    if use_semantic and len(captured) > 1:
        deduped = _collapse_to_distinct_states(
            captured, embeddings, SEMANTIC_DISTINCT_STATE_THRESHOLD
        )
    else:
        deduped = _deduplicate(captured)

    # Video deletion is intentionally NOT done here.
    # The enhanced orchestrator owns the temp_dir lifetime — shutil.rmtree
    # in its finally block cleans everything up. Deleting early would break
    # the RE_GRAB stage which needs to re-open the video file.
    # If delete_video=True is passed explicitly (e.g. the legacy orchestrator),
    # we honour it.
    if delete_video:
        try:
            os.remove(video_path)
        except OSError as exc:
            logger.warning("Could not delete source video %s: %s", video_path, exc)

    logger.info(
        "[DIAG] extract_smart_frames done: captured=%d  deduped=%d  method=%s  delete_video=%s",
        len(captured), len(deduped),
        "dinov2" if use_semantic else "pixel-diff",
        delete_video,
    )
    return deduped


def _semantic_comparison(
    frame: np.ndarray,
    prev_phash,
    prev_embedding: Optional[np.ndarray],
    threshold: float,
    elapsed: float,
    min_interval: float,
    force_interval: float,
) -> tuple[bool, float, str, Optional[np.ndarray]]:
    """Three-tier semantic comparison.

    Returns (should_capture, change_score, reason, curr_embedding).
    curr_embedding is returned so the caller can reuse it without recomputing.
    It may be None if DINOv2 wasn't needed (pHash was decisive) or failed.
    """

    # Tier 0: Force capture if too long since last frame
    if elapsed >= force_interval:
        logger.debug(
            "[DIAG] t=%.1fs → FORCE CAPTURE (elapsed=%.1fs >= force_interval=%.1fs)",
            elapsed + 0, elapsed, force_interval,  # timestamp not in scope; elapsed is proxy
        )
        return True, 0.5, "forced_interval", None

    # Tier 0b: Respect minimum interval
    if elapsed < min_interval:
        logger.debug(
            "[DIAG] → SKIP: min_interval not met (elapsed=%.1fs < %.1fs)",
            elapsed, min_interval,
        )
        return False, 0.0, "", None

    # Tier 1: pHash fast-filter (< 1ms)
    curr_phash = _compute_phash(frame)
    distance = _phash_distance(prev_phash, curr_phash)

    if distance < PHASH_DEFINITE_SAME:
        # Definitely the same content — skip without running DINOv2
        logger.debug(
            "[DIAG] → SKIP: pHash same (distance=%d < PHASH_DEFINITE_SAME=%d)",
            distance, PHASH_DEFINITE_SAME,
        )
        return False, 0.0, "", None

    if distance > PHASH_DEFINITE_DIFF:
        # Definitely different content — capture without running DINOv2
        logger.debug(
            "[DIAG] → CAPTURE: pHash diff (distance=%d > PHASH_DEFINITE_DIFF=%d)",
            distance, PHASH_DEFINITE_DIFF,
        )
        return True, 1.0, "semantic_change", None

    # Tier 2: Ambiguous pHash range — use DINOv2 semantic embedding (~50ms)
    curr_embedding = _get_embedding(frame)
    if curr_embedding is None or prev_embedding is None:
        # DINOv2 failed for this frame — capture conservatively
        logger.debug(
            "[DIAG] → CAPTURE: DINOv2 embedding unavailable (pHash distance=%d — ambiguous)",
            distance,
        )
        return True, 0.5, "pixel_change_fallback", None

    similarity = _cosine_similarity(prev_embedding, curr_embedding)
    change_score = 1.0 - similarity  # higher = more different

    if similarity < threshold:
        # Content meaningfully changed — return embedding for reuse
        logger.debug(
            "[DIAG] → CAPTURE: semantic change (similarity=%.4f < threshold=%.4f, pHash=%d)",
            similarity, threshold, distance,
        )
        return True, change_score, "semantic_change", curr_embedding
    else:
        # Same meaning — speaker just moved
        logger.debug(
            "[DIAG] → SKIP: semantically same (similarity=%.4f >= threshold=%.4f, pHash=%d)",
            similarity, threshold, distance,
        )
        return False, change_score, "", curr_embedding


# --- Frame saving (unchanged interface) -------------------------------------

def _save_frame(
    frame,
    timestamp: float,
    index: int,
    output_dir: str,
    change_score: float,
    target_width: int,
    capture_reason: str = "semantic_change",
) -> CapturedFrame | None:
    """Resize, write as JPEG, base64-encode, and hash a single frame."""
    height, width = frame.shape[:2]
    if width > target_width:
        scale = target_width / width
        frame = cv2.resize(
            frame, (target_width, int(round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )

    ok, buffer = cv2.imencode(
        ".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), _JPEG_QUALITY]
    )
    if not ok:
        logger.warning("Failed to JPEG-encode frame at t=%.1fs", timestamp)
        return None

    image_path = os.path.join(output_dir, f"frame_{index:04d}.jpg")
    with open(image_path, "wb") as fh:
        fh.write(buffer)

    data = buffer.tobytes()
    return CapturedFrame(
        timestamp=timestamp,
        frame_index=index,
        image_path=image_path,
        image_base64=base64.b64encode(data).decode("ascii"),
        change_score=change_score,
        content_hash=hashlib.md5(data[:1000]).hexdigest(),
        capture_reason=capture_reason,
    )


# --- Deduplication ----------------------------------------------------------

def _deduplicate(frames: list[CapturedFrame]) -> list[CapturedFrame]:
    """Original hash-based dedup — used when DINOv2 is unavailable."""
    seen: set[str] = set()
    unique: list[CapturedFrame] = []
    for frame in frames:
        if frame.content_hash in seen:
            try:
                os.remove(frame.image_path)
            except OSError:
                pass
            continue
        seen.add(frame.content_hash)
        unique.append(frame)
    return unique


def _collapse_to_distinct_states(
    frames: list[CapturedFrame],
    embeddings: list[Optional[np.ndarray]],
    threshold: float,
) -> list[CapturedFrame]:
    """Collapse frames to one representative per visually distinct state.

    WHY: Adjacent-only dedup is not enough — a whiteboard lecture produces
    dozens of frames that are all the *same board* with the speaker in
    different poses. DINOv2 embeds the whole image, so pose changes still
    register as small differences and slip past a frame-to-frame check.

    This does a global pass: each kept frame becomes a "state representative";
    a later frame whose embedding is more similar than `threshold` to ANY
    existing representative is treated as the same state and dropped. The
    chronologically first frame of each state is kept (earliest appearance).

    A static whiteboard collapses to 1-3 frames; genuinely different slides
    stay separate because their embeddings differ well below `threshold`.
    """
    if len(frames) <= 1:
        return frames

    kept: list[CapturedFrame] = []
    kept_embeddings: list[Optional[np.ndarray]] = []

    for frame, emb in zip(frames, embeddings):
        if emb is None:
            # No embedding to compare — keep it rather than risk dropping
            # a genuinely distinct frame.
            kept.append(frame)
            kept_embeddings.append(None)
            continue

        is_duplicate_state = False
        for rep_emb in kept_embeddings:
            if rep_emb is not None and _cosine_similarity(emb, rep_emb) > threshold:
                is_duplicate_state = True
                break

        if is_duplicate_state:
            try:
                os.remove(frame.image_path)
            except OSError:
                pass
            continue

        kept.append(frame)
        kept_embeddings.append(emb)

    logger.info(
        "[DIAG] _collapse_to_distinct_states: %d frames → %d distinct states (threshold=%.3f).",
        len(frames), len(kept), threshold,
    )
    return kept
