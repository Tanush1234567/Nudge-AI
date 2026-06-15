import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("id", "url", "status", "created_at", "notes_json").order("created_at", desc=True).limit(5).execute()
    jobs = res.data or []
    
    for job in jobs:
        notes = job.get("notes_json") or {}
        print(f"Job ID: {job['id']}")
        print(f"  Created At: {job.get('created_at')}")
        print(f"  URL: {job.get('url')}")
        print(f"  Notes Keys: {list(notes.keys())}")
        sections = notes.get("sections", [])
        print(f"  Number of sections: {len(sections)}")
        
        # Check first section's visuals
        if sections:
            first_sec = sections[0]
            print(f"  First section: Title='{first_sec.get('title')}'")
            visuals = first_sec.get("visuals", [])
            print(f"    Visuals: {visuals}")
        print("-" * 60)

if __name__ == "__main__":
    asyncio.run(check())
