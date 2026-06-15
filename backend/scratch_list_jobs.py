import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("id", "url", "status", "progress", "frames_captured", "notes_json").order("created_at", desc=True).limit(10).execute()
    jobs = res.data or []
    print(f"Found {len(jobs)} jobs in the database:\n")
    for job in jobs:
        notes = job.get("notes_json") or {}
        sections = notes.get("sections", [])
        visuals_count = 0
        visuals_with_images = 0
        for s in sections:
            visuals = s.get("visuals", [])
            for v in visuals:
                if v.get("type") == "captured_frame":
                    visuals_count += 1
                    if v.get("image_url"):
                        visuals_with_images += 1
        
        print(f"Job ID: {job['id']}")
        print(f"  URL: {job.get('url')}")
        print(f"  Status: {job.get('status')} (Progress: {job.get('progress')}%)")
        print(f"  Frames captured count in DB column: {job.get('frames_captured')}")
        print(f"  Sections in notes: {len(sections)}")
        print(f"  Captured frames in notes visuals: {visuals_count}")
        print(f"  Captured frames with non-empty image_url: {visuals_with_images}")
        if sections and visuals_count > 0:
            # print first visual's image_url prefix
            found = False
            for s in sections:
                for v in s.get("visuals", []):
                    if v.get("type") == "captured_frame":
                        url_val = v.get("image_url", "")
                        print(f"  Sample Image URL: {url_val[:100]}...")
                        found = True
                        break
                if found:
                    break
        print("-" * 60)

if __name__ == "__main__":
    asyncio.run(check())
