import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def clear_jobs():
    sb = get_supabase()
    # Let's find jobs with the URL
    url = "https://youtu.be/P3fc6v191mA?si=hhwMoRxNDhXW_laM"
    res = sb.table("jobs").select("id", "status").eq("url", url).execute()
    jobs = res.data or []
    print(f"Found {len(jobs)} jobs for {url}:")
    for job in jobs:
        print(f"Updating job {job['id']} (status: {job['status']}) to 'error'...")
        sb.table("jobs").update({
            "status": "error",
            "progress": 0,
            "error_message": "Manually cleared for retry."
        }).eq("id", job["id"]).execute()
    print("Done!")

if __name__ == "__main__":
    asyncio.run(clear_jobs())
