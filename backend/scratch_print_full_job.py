import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("*").eq("id", "658fc3f9-7b45-4051-9c2a-9ea41abc05ea").execute()
    if res.data:
        job = res.data[0]
        for k, v in job.items():
            if k == "notes_json":
                print(f"{k}: (keys) {list(v.keys())}")
            else:
                print(f"{k}: {v}")
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
