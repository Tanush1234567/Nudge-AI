import asyncio
import os
import sys
import json

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("*").eq("id", "fa7e26b2-7e90-4490-b0aa-e0c448bac690").execute()
    if res.data:
        job = res.data[0]
        notes = job.get("notes_json") or {}
        print("Summary:")
        print(notes.get("summary"))
        print("\nSections:")
        for sec in notes.get("sections", []):
            print(f"--- Section {sec.get('number')}: {sec.get('title')} ---")
            print(sec.get("content_html"))
            print("\n")
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
