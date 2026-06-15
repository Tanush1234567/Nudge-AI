import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.jobs import update_job, get_job

async def check():
    job_id = "658fc3f9-7b45-4051-9c2a-9ea41abc05ea"
    print("Before update:")
    job = await get_job(job_id)
    print(f"  frames_captured: {job.get('frames_captured')}")
    
    print("Updating frames_captured to 42...")
    await update_job(job_id, frames_captured=42)
    
    print("After update:")
    job = await get_job(job_id)
    print(f"  frames_captured: {job.get('frames_captured')}")

if __name__ == "__main__":
    asyncio.run(check())
