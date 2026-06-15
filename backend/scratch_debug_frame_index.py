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
        extractions = notes.get("extractions", [])
        print(f"Num extractions: {len(extractions)}")
        for idx, ext in enumerate(extractions[:5]):
            print(f"  Ext {idx}: frame_index={ext.get('frame_index')}")
        
        # Let's print out if any base64 images exist in the JSON or if it's completely missing
        # We can scan the JSON keys or check sections
        sections = notes.get("sections", [])
        for idx, s in enumerate(sections[:3]):
            print(f"  Section {idx+1} ({s.get('title')}): visuals={s.get('visuals')}")
            
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
