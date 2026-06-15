import asyncio
import os
import sys
import json

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("notes_json").eq("id", "658fc3f9-7b45-4051-9c2a-9ea41abc05ea").execute()
    if res.data:
        notes = res.data[0].get("notes_json") or {}
        with open("scratch_raw_notes.json", "w", encoding="utf-8") as f:
            json.dump(notes, f, indent=2)
        print("Wrote scratch_raw_notes.json successfully")
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
