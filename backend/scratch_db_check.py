import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.jobs import get_job

async def check():
    job_id = "f96f0016-726a-4a1f-a650-a069f704df2f"
    job = await get_job(job_id)
    if job:
        print("URL:", job.get("url"))

if __name__ == "__main__":
    asyncio.run(check())
