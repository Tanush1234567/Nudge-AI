import asyncio
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("notes_json").eq("id", "658fc3f9-7b45-4051-9c2a-9ea41abc05ea").execute()
    if res.data:
        notes = res.data[0].get("notes_json") or {}
        sections = notes.get("sections", [])
        print(f"Total sections: {len(sections)}")
        for idx, s in enumerate(sections):
            print(f"Section {idx+1}: Number={s.get('number')}, Title='{s.get('title')}', Visuals={s.get('visuals')}")
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
