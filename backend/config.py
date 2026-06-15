"""Central configuration: environment variables and pipeline constants.

WHY: A single import surface keeps env parsing and tunable constants in one
place, so the rest of the codebase never touches os.environ directly and
prompt/pipeline tuning happens here without hunting through modules.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# --- Secrets / external services -------------------------------------------
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")

# --- Fallback LLM provider --------------------------------------------------
# Gemini's free tier has hard per-minute and per-day caps. When a Gemini call
# is rate-limited or errors out, the pipeline fails over to a secondary
# provider so the job still completes.
#
# Provider precedence: if OPENAI_API_KEY is set, OpenAI is used directly;
# otherwise OpenRouter. Leave both empty to disable the fallback.
#
# gpt-4.1-nano is the cheapest vision-capable OpenAI model — a worst-case
# full-fallback run of a 90-min video costs only a few US cents.
OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4.1-nano")

OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL: str = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

# --- CORS -------------------------------------------------------------------
# Comma-separated origins in env -> list of stripped, non-empty strings.
ALLOWED_ORIGINS: list[str] = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]

# --- Prompt versions (A/B testing) -----------------------------------------
VISION_PROMPT_VERSION: str = os.getenv("VISION_PROMPT_VERSION", "v1")
SYNTHESIS_PROMPT_VERSION: str = os.getenv("SYNTHESIS_PROMPT_VERSION", "v1")

# --- Video / job limits -----------------------------------------------------
MAX_VIDEO_DURATION: int = 7200  # seconds (2 hours)
# Hard cap on captured frames. Also bounds worst-case fallback cost: at most
# ceil(MAX_FRAMES/FRAME_BATCH_SIZE) vision calls. 60 keeps a full-fallback
# 90-min run on gpt-4.1-nano under ~$0.05.
MAX_FRAMES: int = 60

# --- Gemini model / batching / rate limiting -------------------------------
# Free-tier quota is per-model; the "flash-lite" variants have their own pool.
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
FRAME_BATCH_SIZE: int = 5            # frames per Gemini vision call
GEMINI_RATE_LIMIT_DELAY: float = 4.5  # seconds between batches (<15 RPM)

# --- Frame extraction tuning ------------------------------------------------
FRAME_SAMPLE_INTERVAL: float = 3.0    # seconds between sampled candidate frames
FRAME_CHANGE_THRESHOLD: float = 0.12  # scene-change sensitivity (0-1)
FRAME_MIN_INTERVAL: float = 5.0       # min seconds between two kept frames
FRAME_FORCE_INTERVAL: float = 30.0    # force a frame at least this often
FRAME_TARGET_WIDTH: int = 640         # downscale width for vision input

# --- Semantic frame comparison (DINOv2) ------------------------------------
SEMANTIC_MODEL: str = "facebook/dinov2-small"  # 21M params, 384-dim embeddings
SEMANTIC_SIMILARITY_THRESHOLD: float = 0.90    # skip if cosine sim > this
PHASH_DEFINITE_SAME: int = 4                   # Hamming distance — definitely same
PHASH_DEFINITE_DIFF: int = 20                  # Hamming distance — definitely different
# Coarse pre-vision filter: drop only frames that are near-identical at the
# pixel level (embeddings more similar than this). Kept deliberately HIGH — a
# whole-image embedding cannot tell distinct slides apart when a presenter or
# a static room dominates the frame, so the REAL dedup happens after vision on
# the extracted text content (see CONTENT_DEDUP_THRESHOLD).
SEMANTIC_DISTINCT_STATE_THRESHOLD: float = 0.94

# Post-vision dedup: two analyzed frames whose extracted on-screen content
# (board text / description) share more than this fraction of words are
# treated as the same content state — one representative is kept. This
# compares what the vision model READ, so it is immune to presenter pose and
# camera framing. This is the main "how many frames end up in the notes" knob.
CONTENT_DEDUP_THRESHOLD: float = 0.80

# --- Transcript alignment window -------------------------------------------
# Asymmetric: a presenter usually explains a concept before showing it.
TRANSCRIPT_WINDOW_BEFORE: float = 20.0
TRANSCRIPT_WINDOW_AFTER: float = 15.0
