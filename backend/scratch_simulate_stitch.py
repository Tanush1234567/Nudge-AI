import asyncio
import os
import sys
import re

# Force UTF-8 output
if sys.platform.startswith('win'):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db.client import get_supabase
from pipeline.vision import AlignedAnalysis
from pipeline.stitch import stitch_analyses
from pipeline.enhanced_orchestrator import merge_stitched_sections, _build_notes_json, _split_markdown_to_sections

async def check():
    sb = get_supabase()
    res = sb.table("jobs").select("notes_json").eq("id", "658fc3f9-7b45-4051-9c2a-9ea41abc05ea").execute()
    if not res.data:
        print("Job not found")
        return
    notes = res.data[0].get("notes_json") or {}
    extractions = notes.get("extractions", [])
    markdown = notes.get("markdown", "")
    
    print(f"Loaded {len(extractions)} extractions")
    
    # Reconstruct aligned analysis
    aligned = []
    for idx, ext in enumerate(extractions):
        aligned.append(
            AlignedAnalysis(
                frame_index=idx,
                timestamp=idx * 20.0,  # dummy timestamp
                timestamp_str=f"{idx}:00",
                transcript_context="context",
                content_type=ext.get("content_type", "other"),
                visual_description=ext.get("visual_description", ""),
                extracted_text=ext.get("extracted_text", ""),
                alignment_note=ext.get("alignment_note", ""),
                is_important=bool(ext.get("is_important", True)),
                importance_reason="",
                topic=ext.get("topic", ""),
            )
        )
        
    # Run stitching
    stitched_sections = stitch_analyses(aligned, [], 1000.0)
    print(f"Stitched sections count before merge: {len(stitched_sections)}")
    for s in stitched_sections:
        print(f"  Sec {s.section_number} ({s.title}): important_frames count={len(s.important_frames)}")
        if s.important_frames:
            print(f"    frame_index={s.important_frames[0].get('frame_index')}")
        
    merged_sections = merge_stitched_sections(stitched_sections, max_cap=15)
    print(f"Stitched sections count after merge: {len(merged_sections)}")
    for s in merged_sections:
        print(f"  Merged Sec {s.section_number} ({s.title}): important_frames count={len(s.important_frames)}")
        if s.important_frames:
            print(f"    frame_indices={[f.get('frame_index') for f in s.important_frames]}")
        
    # Re-run _build_notes_json with mock image_b64_by_idx
    mock_b64 = {i: "MOCK_BASE64_DATA" for i in range(len(extractions))}
    notes_json = _build_notes_json(
        markdown=markdown,
        stitched_sections=merged_sections,
        extractions=extractions,
        video_meta={"topics": []},
        embedding=None,
        image_b64_by_idx=mock_b64
    )
    
    print("\n--- Reconstructed Notes JSON Sections ---")
    for sec in notes_json.get("sections", []):
        print(f"Sec {sec.get('number')} ({sec.get('title')}): visuals count={len(sec.get('visuals'))}, visuals={sec.get('visuals')}")

if __name__ == "__main__":
    asyncio.run(check())
