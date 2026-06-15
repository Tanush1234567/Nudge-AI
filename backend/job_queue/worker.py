"""In-process async job queue.

WHY: One video job uses ~200MB peak; HF Spaces' free tier has limited RAM, so
max_concurrent=1 keeps memory safe without needing Redis. The queue also
recovers jobs left mid-flight by a restart, so a crash never strands a job.

Note: this package is named job_queue (not queue) to avoid shadowing Python's
stdlib `queue` module, which urllib3 and others import.
"""

import asyncio
import logging

from db.jobs import fail_job, get_jobs_by_status
# The enhanced pipeline is now the default — re-exported under the original
# name so the rest of this file is unchanged. The legacy orchestrator is
# still available at pipeline.orchestrator.process_video if you need to fall
# back.
from pipeline.enhanced_orchestrator import process_video_enhanced as process_video

logger = logging.getLogger(__name__)

# Statuses that mean a job was in progress (or waiting) when the server stopped.
_INTERRUPTED_STATUSES = [
    "queued", "downloading", "capturing", "reading", "transcribing", "writing",
]


class JobQueue:
    """Bounded asyncio queue with a fixed pool of worker tasks."""

    def __init__(self, max_concurrent: int = 1):
        self.max_concurrent = max_concurrent
        # Unbounded — recovery from a long-running queue with hundreds of
        # interrupted jobs (e.g. a 200-video course) would otherwise hit
        # QueueFull and silently strand the overflow.
        self._queue: asyncio.Queue = asyncio.Queue()
        self._workers: list[asyncio.Task] = []
        self._active = 0

    @property
    def queue_depth(self) -> int:
        """Number of jobs currently waiting to be processed."""
        return self._queue.qsize()

    @property
    def active_count(self) -> int:
        """Number of jobs currently being processed."""
        return self._active

    async def enqueue(self, job_id: str, url: str) -> None:
        """Add a job to the queue."""
        await self._queue.put((job_id, url))

    async def start_workers(self) -> None:
        """Start the worker pool and re-enqueue any interrupted jobs."""
        if self._workers:
            return
        for i in range(self.max_concurrent):
            self._workers.append(asyncio.create_task(self._worker(i)))
        await self._recover_interrupted_jobs()
        logger.info("Job queue started with %d worker(s).", self.max_concurrent)

    async def shutdown(self) -> None:
        """Cancel all worker tasks."""
        for task in self._workers:
            task.cancel()
        for task in self._workers:
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._workers.clear()

    async def _recover_interrupted_jobs(self) -> None:
        """Re-enqueue jobs that were in progress when the server last stopped.

        Older jobs (lowest created_at) are enqueued first so they get a chance
        to clear before fresh work piles on.
        """
        try:
            interrupted = await get_jobs_by_status(_INTERRUPTED_STATUSES)
        except Exception as exc:  # noqa: BLE001
            logger.error("Could not recover interrupted jobs: %s", exc)
            return
        interrupted.sort(key=lambda j: j.get("created_at") or "")
        recovered = 0
        for job in interrupted:
            job_id, url = job.get("id"), job.get("url")
            if job_id and url:
                self._queue.put_nowait((job_id, url))
                recovered += 1
        if recovered:
            logger.info("Recovered %d interrupted jobs from previous run.", recovered)

    async def _worker(self, worker_id: int) -> None:
        """Pull and process jobs forever; an exception never kills the worker."""
        while True:
            job_id, url = await self._queue.get()
            self._active += 1
            try:
                await process_video(job_id, url)
            except Exception as exc:  # noqa: BLE001 — protect the worker loop
                logger.exception("Worker %d: job %s crashed", worker_id, job_id)
                try:
                    await fail_job(job_id, "queue", f"Worker error: {exc}")
                except Exception:  # noqa: BLE001
                    pass
            finally:
                self._active -= 1
                self._queue.task_done()


# Module-level singleton — one video at a time (see module docstring).
job_queue = JobQueue(max_concurrent=1)
