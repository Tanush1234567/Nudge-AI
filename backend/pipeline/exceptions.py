"""Pipeline exception hierarchy.

WHY: Each pipeline stage raises a typed error so the orchestrator can update
the job record with a meaningful failure reason instead of a generic 500.
"""


class PipelineError(Exception):
    """Base class for any recoverable failure inside the analysis pipeline."""


class VideoNotFoundError(PipelineError):
    """The YouTube URL is invalid, private, or no longer available."""


class VideoTooLongError(PipelineError):
    """The video exceeds MAX_VIDEO_DURATION."""

    def __init__(self, minutes: float, message: str | None = None):
        self.minutes = minutes
        super().__init__(
            message or f"Video is {minutes:.0f} min long, which exceeds the limit."
        )


class DownloadError(PipelineError):
    """yt-dlp failed to download the video."""


class FrameExtractionError(PipelineError):
    """OpenCV failed to extract frames from the downloaded video."""


class TranscriptError(PipelineError):
    """The transcript could not be fetched (disabled, missing, or rate-limited)."""


class VisionAnalysisError(PipelineError):
    """A Gemini vision call failed or returned unusable output."""


class SynthesisError(PipelineError):
    """The final synthesis step failed to produce structured notes."""
