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
        print("Notes Keys:", list(notes.keys()))
        markdown = notes.get("markdown", "")
        print(f"Markdown length: {len(markdown)}")
        print("\n--- Markdown Snippet (First 500 chars) ---")
        print(markdown[:500])
        print("-------------------------------------------\n")
        
        extractions = notes.get("extractions", [])
        print(f"Total Extractions: {len(extractions)}")
        for idx, ext in enumerate(extractions[:5]):
            print(f"  Extraction {idx}: topic='{ext.get('topic')}', content_type='{ext.get('content_type')}', is_important={ext.get('is_important')}")
            
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
