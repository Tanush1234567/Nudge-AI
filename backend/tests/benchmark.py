"""Benchmark script: time taken and Gemini credits spent per video.

WHY: The pipeline's cost is dominated by wall-clock time and Gemini API calls.
This script drives the live backend over HTTP exactly as the frontend would —
submit a URL, poll /status, and time how long the job spends in each stage —
so the numbers reflect the real deployed pipeline, not a mock.

"Credits" here means Gemini API requests, since the free tier is rate-limited
per request (RPM): one request per frame batch in the vision stage, plus one
synthesis request. A rough USD estimate is also derived from token pricing.

Usage:
    python -m tests.benchmark https://youtu.be/VIDEO_ID [more URLs...]
    python -m tests.benchmark --file urls.txt
    python -m tests.benchmark --api http://localhost:8080 https://youtu.be/...

Results are printed as a table and appended to tests/benchmark_results.csv.
"""

import argparse
import csv
import math
import os
import sys
import time
from dataclasses import dataclass, field

import httpx

# Vision frames per Gemini call — must match config.FRAME_BATCH_SIZE.
_FRAME_BATCH_SIZE = 5
# Gemini 2.5 Flash-Lite pricing (USD per 1M tokens), used only for a rough
# cost estimate; update if Google changes pricing.
_PRICE_INPUT_PER_M = 0.10
_PRICE_OUTPUT_PER_M = 0.40
# Crude per-request token guesses (vision = prompt + 5 images, synthesis = big).
_EST_VISION_INPUT_TOKENS = 4_500
_EST_VISION_OUTPUT_TOKENS = 1_800
_EST_SYNTH_INPUT_TOKENS = 9_000
_EST_SYNTH_OUTPUT_TOKENS = 6_000

# Job statuses that mean the pipeline is still running, in pipeline order.
_ACTIVE_STATUSES = (
    "queued", "downloading", "transcribing", "capturing", "reading", "writing",
)
_POLL_INTERVAL = 2.0       # seconds between /status polls
_JOB_TIMEOUT = 1_200.0     # give up on a single job after 20 minutes

_RESULTS_CSV = os.path.join(os.path.dirname(__file__), "benchmark_results.csv")


@dataclass
class VideoResult:
    """Timing and credit accounting for one processed video."""

    url: str
    job_id: str = ""
    title: str = ""
    channel: str = ""
    duration_seconds: int = 0
    status: str = "pending"
    error: str = ""
    frames_captured: int = 0
    total_seconds: float = 0.0
    # Wall-clock seconds spent in each pipeline status.
    stage_seconds: dict[str, float] = field(default_factory=dict)
    was_cached: bool = False

    @property
    def gemini_requests(self) -> int:
        """Estimated Gemini API calls: one per frame batch + one synthesis call."""
        if self.frames_captured <= 0:
            return 0
        vision = math.ceil(self.frames_captured / _FRAME_BATCH_SIZE)
        return vision + 1  # + synthesis

    @property
    def est_cost_usd(self) -> float:
        """Rough USD estimate from per-request token guesses."""
        if self.frames_captured <= 0:
            return 0.0
        vision_calls = math.ceil(self.frames_captured / _FRAME_BATCH_SIZE)
        in_tokens = vision_calls * _EST_VISION_INPUT_TOKENS + _EST_SYNTH_INPUT_TOKENS
        out_tokens = vision_calls * _EST_VISION_OUTPUT_TOKENS + _EST_SYNTH_OUTPUT_TOKENS
        return (
            in_tokens / 1_000_000 * _PRICE_INPUT_PER_M
            + out_tokens / 1_000_000 * _PRICE_OUTPUT_PER_M
        )


def _submit(api: str, url: str) -> tuple[str, bool]:
    """POST /api/analyze; return (job_id, was_already_cached)."""
    resp = httpx.post(f"{api}/api/analyze", json={"url": url}, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["job_id"], data.get("status") == "complete"


def _poll_until_done(api: str, result: VideoResult) -> None:
    """Poll /api/status, recording wall-clock time spent in each stage."""
    start = time.monotonic()
    stage_start = start
    last_status = ""

    while True:
        resp = httpx.get(f"{api}/api/status/{result.job_id}", timeout=30)
        resp.raise_for_status()
        job = resp.json()
        now = time.monotonic()

        status = job.get("status") or "unknown"
        if status != last_status:
            # Charge the elapsed time to the stage we are leaving.
            if last_status:
                result.stage_seconds[last_status] = (
                    result.stage_seconds.get(last_status, 0.0) + now - stage_start
                )
            stage_start = now
            last_status = status

        # Capture metadata as soon as the backend learns it.
        result.title = job.get("video_title") or result.title
        result.channel = job.get("video_channel") or result.channel
        result.duration_seconds = job.get("video_duration") or result.duration_seconds
        if job.get("frames_found"):
            result.frames_captured = job["frames_found"]

        if status == "complete":
            result.stage_seconds[last_status] = (
                result.stage_seconds.get(last_status, 0.0) + now - stage_start
            )
            result.status = "complete"
            break
        if status == "error":
            result.status = "error"
            result.error = job.get("error_message") or "unknown error"
            break
        if now - start > _JOB_TIMEOUT:
            result.status = "timeout"
            result.error = f"exceeded {_JOB_TIMEOUT:.0f}s"
            break
        if status not in _ACTIVE_STATUSES and status not in ("complete", "error"):
            # Unknown status — keep polling, but don't spin tightly.
            pass

        time.sleep(_POLL_INTERVAL)

    result.total_seconds = time.monotonic() - start


def run_video(api: str, url: str) -> VideoResult:
    """Submit one video and benchmark it end to end."""
    result = VideoResult(url=url)
    print(f"\n[submit] {url}")
    try:
        job_id, cached = _submit(api, url)
    except httpx.HTTPError as exc:
        result.status = "error"
        result.error = f"submit failed: {exc}"
        print(f"  ! {result.error}")
        return result

    result.job_id = job_id
    result.was_cached = cached
    if cached:
        # Duplicate — backend returned an already-finished job, nothing to time.
        result.status = "complete"
        print(f"  = cached job {job_id} (skipped processing)")
        return result

    print(f"  job {job_id} queued; polling...")
    try:
        _poll_until_done(api, result)
    except httpx.HTTPError as exc:
        result.status = "error"
        result.error = f"poll failed: {exc}"

    flag = "OK" if result.status == "complete" else result.status.upper()
    print(
        f"  [{flag}] {result.total_seconds:.1f}s | "
        f"{result.frames_captured} frames | "
        f"~{result.gemini_requests} Gemini calls | ~${result.est_cost_usd:.4f}"
    )
    if result.error:
        print(f"  ! {result.error}")
    return result


def _print_summary(results: list[VideoResult]) -> None:
    """Print a per-video table plus run totals."""
    print("\n" + "=" * 78)
    print("BENCHMARK SUMMARY")
    print("=" * 78)
    header = f"{'Video':<32} {'Time':>8} {'Frames':>7} {'Calls':>6} {'Est.$':>9}"
    print(header)
    print("-" * 78)

    total_time = total_calls = 0.0
    total_cost = 0.0
    for r in results:
        name = (r.title or r.url)[:31]
        if r.was_cached:
            print(f"{name:<32} {'cached':>8} {'-':>7} {'-':>6} {'-':>9}")
            continue
        if r.status != "complete":
            print(f"{name:<32} {r.status:>8} {'-':>7} {'-':>6} {'-':>9}")
            continue
        print(
            f"{name:<32} {r.total_seconds:>7.1f}s {r.frames_captured:>7} "
            f"{r.gemini_requests:>6} {r.est_cost_usd:>8.4f}"
        )
        total_time += r.total_seconds
        total_calls += r.gemini_requests
        total_cost += r.est_cost_usd

    print("-" * 78)
    print(
        f"{'TOTAL (processed)':<32} {total_time:>7.1f}s {'':>7} "
        f"{int(total_calls):>6} {total_cost:>8.4f}"
    )

    # Per-stage breakdown across all processed videos.
    stage_totals: dict[str, float] = {}
    for r in results:
        for stage, secs in r.stage_seconds.items():
            stage_totals[stage] = stage_totals.get(stage, 0.0) + secs
    if stage_totals:
        print("\nTime per stage (all videos):")
        for stage in _ACTIVE_STATUSES + ("complete",):
            if stage in stage_totals:
                print(f"  {stage:<14} {stage_totals[stage]:>7.1f}s")


def _write_csv(results: list[VideoResult]) -> None:
    """Append each result as a row to benchmark_results.csv."""
    new_file = not os.path.exists(_RESULTS_CSV)
    with open(_RESULTS_CSV, "a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        if new_file:
            writer.writerow([
                "timestamp", "url", "job_id", "title", "channel",
                "video_duration_s", "status", "total_seconds",
                "frames_captured", "gemini_requests", "est_cost_usd",
                "was_cached", "error",
            ])
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        for r in results:
            writer.writerow([
                stamp, r.url, r.job_id, r.title, r.channel,
                r.duration_seconds, r.status, round(r.total_seconds, 1),
                r.frames_captured, r.gemini_requests,
                round(r.est_cost_usd, 4), r.was_cached, r.error,
            ])
    print(f"\nResults appended to {_RESULTS_CSV}")


def _load_urls(args: argparse.Namespace) -> list[str]:
    """Collect URLs from positional args and/or a --file."""
    urls = list(args.urls)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            urls += [line.strip() for line in fh if line.strip()
                     and not line.startswith("#")]
    return urls


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="*", help="YouTube URLs to benchmark")
    parser.add_argument("--file", help="text file of URLs, one per line")
    parser.add_argument(
        "--api", default=os.getenv("PUPIL_API", "http://localhost:8080"),
        help="backend base URL (default: http://localhost:8080)",
    )
    args = parser.parse_args()

    urls = _load_urls(args)
    if not urls:
        parser.error("provide at least one URL, or use --file")

    print(f"Benchmarking {len(urls)} video(s) against {args.api}")
    results = [run_video(args.api, url) for url in urls]

    _print_summary(results)
    _write_csv(results)

    # Non-zero exit if any video failed — useful in CI.
    return 0 if all(r.status == "complete" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
