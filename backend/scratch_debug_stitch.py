import asyncio
import os
import sys
import re

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase
from pipeline.enhanced_orchestrator import _split_markdown_to_sections, _parse_section_number

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("notes_json").eq("id", "658fc3f9-7b45-4051-9c2a-9ea41abc05ea").execute()
    if res.data:
        notes = res.data[0].get("notes_json") or {}
        markdown = notes.get("markdown", "")
        md_sections = _split_markdown_to_sections(markdown)
        print(f"MD sections count: {len(md_sections)}")
        for idx, md in enumerate(md_sections):
            title = md["title"]
            sec_num = _parse_section_number(title)
            print(f"  MD Sec {idx+1}: Title='{title}' -> parsed sec_num={sec_num}")
            
    else:
        print("Job not found")

if __name__ == "__main__":
    asyncio.run(check())
