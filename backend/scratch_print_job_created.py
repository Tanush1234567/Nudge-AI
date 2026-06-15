import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("id", "created_at", "status", "notes_json").eq("id", "258d997a-3547-4c76-8063-384e2348e265").execute()
    if res.data:
        job = res.data[0]
        print(f"Job ID: {job['id']}")
        print(f"  Created At: {job.get('created_at')}")
        print(f"  Notes keys: {list((job.get('notes_json') or {}).keys())}")
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
