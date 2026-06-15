import time
import requests

def run():
    url = "http://localhost:7860/api/analyze"
    payload = {
        "url": "https://www.youtube.com/watch?v=8SwKD5_VL5o",
        "force": True
    }
    
    print("Triggering new analysis...")
    res = requests.post(url, json=payload)
    if res.status_code != 200:
        print("Failed to trigger analysis:", res.text)
        return
        
    job_id = res.json()["job_id"]
    print(f"Triggered job: {job_id}")
    
    # Poll status in loop
    time.sleep(2)
    start_time = time.time()
    while True:
        status_res = requests.get(f"http://localhost:7860/api/status/{job_id}")
        if status_res.status_code != 200:
            print("Failed to get status:", status_res.text)
            break
            
        status_data = status_res.json()
        status = status_data.get("status")
        progress = status_data.get("progress")
        stage_detail = status_data.get("stage_detail")
        frames_found = status_data.get("frames_found")
        
        print(f"[{time.time()-start_time:.1f}s] Status: {status} | Progress: {progress}% | Detail: {stage_detail} | Frames Found: {frames_found}")
        
        if status in ("complete", "error"):
            break
            
        time.sleep(3)
        
    if status == "complete":
        print("\nJob complete! Fetching notes...")
        notes_res = requests.get(f"http://localhost:7860/api/notes/{job_id}")
        if notes_res.status_code == 200:
            notes_data = notes_res.json()
            sections = notes_data.get("sections", [])
            print(f"Total sections generated: {len(sections)}")
            for sec in sections:
                visuals = sec.get("visuals", [])
                print(f"  Section {sec.get('number')} ({sec.get('title')}): body length={len(sec.get('content_html', ''))}, visuals count={len(visuals)}")
                for vis in visuals:
                    print(f"    Visual type: {vis.get('type')}, frame_index={vis.get('frame_index')}, image_url prefix={vis.get('image_url')[:40]}...")
        else:
            print("Failed to get notes:", notes_res.text)

if __name__ == "__main__":
    run()
