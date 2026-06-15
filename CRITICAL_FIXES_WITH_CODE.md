# QA Quick Fix Guide - Critical Issues
## Code Examples for Immediate Remediation

---

## 🔴 Issue 1: Job ID Validation

### ❌ Current Code (api/videos.py)
```python
@router.get("/status/{job_id}")
async def status(job_id: str) -> dict:  # No validation!
    job = await get_job(job_id)
```

### ✅ Fixed Code
```python
from pydantic import BaseModel, Field, validator
import re

class JobIDValidator(BaseModel):
    job_id: str = Field(..., min_length=1, max_length=36)
    
    @validator('job_id')
    def validate_format(cls, v):
        # Allow UUID or alphanumeric + underscore/dash
        if not re.match(r'^[a-zA-Z0-9_-]{1,36}$', v):
            raise ValueError('Invalid job ID format')
        return v

@router.get("/status/{job_id}")
async def status(job_id: str) -> dict:
    try:
        validator = JobIDValidator(job_id=job_id)
        job = await get_job(validator.job_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

**Time:** 30 minutes  
**Risk:** Low (backward compatible)

---

## 🔴 Issue 2: YouTube URL Validation

### ❌ Current Code (api/middleware.py)
```python
def validate_youtube_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    lowered = url.lower()
    return "youtube.com" in lowered or "youtu.be" in lowered
    # ❌ This matches "fake-youtube.com" or "youtu.be.scam"
```

### ✅ Fixed Code
```python
from urllib.parse import urlparse

def validate_youtube_url(url: str) -> bool:
    """Validate that URL is from youtube.com or youtu.be domain."""
    if not url or not isinstance(url, str):
        return False
    
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        # Allow www.youtube.com, youtube.com, youtu.be
        return domain in ('youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be')
    except Exception:
        return False
```

**Time:** 15 minutes  
**Risk:** Low (stricter, but correct)

---

## 🔴 Issue 3: CSRF Token Protection

### ❌ Current Code (api/videos.py)
```python
@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request) -> dict:
    # ❌ No CSRF protection
    if not validate_youtube_url(body.url):
        raise HTTPException(status_code=400, detail="Not a valid YouTube URL")
```

### ✅ Fixed Code - Option A: Middleware
```python
# middleware.py
from secrets import token_urlsafe
from fastapi import HTTPException

CSRF_TOKEN_STORE = {}  # In production, use Redis

def generate_csrf_token() -> str:
    return token_urlsafe(32)

def validate_csrf_token(token: str, session_id: str) -> bool:
    stored = CSRF_TOKEN_STORE.get(session_id)
    return stored and token == stored and len(token) > 20

@app.post("/csrf-token")
async def get_csrf_token(request: Request) -> dict:
    """Return a CSRF token for the client."""
    session_id = request.client.host  # Use IP or session cookie
    token = generate_csrf_token()
    CSRF_TOKEN_STORE[session_id] = token
    return {"csrf_token": token}

# In main.py
@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    if request.method in ["POST", "PUT", "DELETE"]:
        # Skip CSRF for health endpoints
        if request.url.path not in ["/", "/health"]:
            csrf_token = request.headers.get("X-CSRF-Token")
            session_id = request.client.host
            if not csrf_token or not validate_csrf_token(csrf_token, session_id):
                raise HTTPException(status_code=403, detail="CSRF token invalid")
    
    response = await call_next(request)
    return response

# videos.py
@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request) -> dict:
    # CSRF validation now automatic via middleware
    ...
```

### ✅ Fixed Code - Option B: Simple Header Check
```python
# For frontend + same-origin: just check Origin header
from fastapi import HTTPException

@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request) -> dict:
    origin = request.headers.get("origin") or request.headers.get("referer")
    allowed_origins = ALLOWED_ORIGINS  # from config
    
    if origin:
        # Extract domain from origin
        from urllib.parse import urlparse
        origin_domain = urlparse(origin).netloc
        allowed_domains = [urlparse(o).netloc for o in allowed_origins]
        
        if origin_domain not in allowed_domains:
            raise HTTPException(status_code=403, detail="CSRF validation failed")
    
    # Rest of endpoint...
```

**Time:** 1-2 hours (including frontend changes to send token)  
**Risk:** Medium (requires client changes)

---

## 🔴 Issue 4: Validate Environment Variables

### ❌ Current Code (config.py)
```python
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
# ❌ Silent failures: all can be empty strings
```

### ✅ Fixed Code
```python
import os
import sys
from dotenv import load_dotenv

load_dotenv()

def _require_env(key: str) -> str:
    """Get required env var; raise error if missing."""
    value = os.getenv(key)
    if not value or not value.strip():
        print(f"❌ FATAL: Required environment variable '{key}' is not set.", file=sys.stderr)
        sys.exit(1)
    return value.strip()

def _optional_env(key: str, default: str = "") -> str:
    """Get optional env var with default."""
    return (os.getenv(key) or default).strip()

# Validate at import time (fails fast on startup)
SUPABASE_URL: str = _require_env("SUPABASE_URL")
SUPABASE_SERVICE_KEY: str = _require_env("SUPABASE_SERVICE_KEY")
GEMINI_API_KEY: str = _require_env("GEMINI_API_KEY")

# Optional with sensible defaults
ALLOWED_ORIGINS: list[str] = [
    origin.strip()
    for origin in _optional_env("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
```

**Time:** 30 minutes  
**Risk:** Low (fails on startup, helps catch config issues early)

---

## 🔴 Issue 5: Lock Dependencies

### ❌ Current File (requirements.txt)
```
fastapi==0.115.0
yt-dlp>=2024.12.0          # ❌ Loose version
opencv-python-headless>=4.10.0  # ❌ Loose version
google-generativeai>=0.8.0  # ❌ Loose version
```

### ✅ Fixed Process
1. **Install pip-tools:**
   ```bash
   pip install pip-tools
   ```

2. **Create requirements.in:**
   ```
   fastapi==0.115.0
   uvicorn[standard]==0.32.0
   yt-dlp==2024.12.30
   opencv-python-headless==4.10.0.84
   Pillow==10.4.0
   google-generativeai==0.8.0
   youtube-transcript-api==0.6.1
   supabase==2.0.0
   python-dotenv==1.0.0
   httpx==0.27.0
   ```

3. **Generate lock file:**
   ```bash
   pip-compile requirements.in -o requirements-lock.txt
   ```

4. **Use lock file in production:**
   ```bash
   pip install -r requirements-lock.txt
   ```

5. **Update Dockerfile:**
   ```dockerfile
   COPY --chown=user requirements-lock.txt requirements.txt .
   RUN pip install --no-cache-dir -r requirements-lock.txt
   ```

**Time:** 1 hour  
**Risk:** Low (more reproducible, safer)

---

## 🔴 Issue 6: Implement Rate Limiting

### ❌ Current Code (api/videos.py)
```python
# No rate limiting enforced
```

### ✅ Fixed Code - In-Memory (Simple, Single Server)
```python
# middleware.py
from collections import defaultdict
from datetime import datetime, timedelta
from fastapi import HTTPException

class RateLimiter:
    def __init__(self, max_requests: int = 5, window_minutes: int = 60):
        self.max_requests = max_requests
        self.window = timedelta(minutes=window_minutes)
        self.requests = defaultdict(list)  # IP -> list of timestamps
    
    def is_allowed(self, client_ip: str) -> bool:
        """Check if request from IP is within rate limit."""
        now = datetime.now()
        cutoff = now - self.window
        
        # Remove old requests
        self.requests[client_ip] = [
            req_time for req_time in self.requests[client_ip]
            if req_time > cutoff
        ]
        
        # Check if under limit
        if len(self.requests[client_ip]) >= self.max_requests:
            return False
        
        # Record this request
        self.requests[client_ip].append(now)
        return True

# Create limiter: max 5 analyses per IP per hour
rate_limiter = RateLimiter(max_requests=5, window_minutes=60)

# In videos.py
@router.post("/analyze")
async def analyze(body: AnalyzeRequest, request: Request) -> dict:
    ip = get_client_ip(request)
    
    if not rate_limiter.is_allowed(ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded: 5 analyses per hour per IP"
        )
    
    # Rest of endpoint...
```

### ✅ Fixed Code - Redis (Scalable)
```python
# middleware.py
import redis
from datetime import timedelta

class RedisRateLimiter:
    def __init__(self, redis_client, max_requests: int = 5, window_minutes: int = 60):
        self.redis = redis_client
        self.max_requests = max_requests
        self.window_seconds = window_minutes * 60
    
    def is_allowed(self, client_ip: str) -> bool:
        key = f"rate_limit:{client_ip}"
        current = self.redis.incr(key)
        
        if current == 1:
            # Set expiry on first request in window
            self.redis.expire(key, self.window_seconds)
        
        return current <= self.max_requests

# In main.py
from redis import Redis
redis_client = Redis(host='localhost', port=6379, db=0)
rate_limiter = RedisRateLimiter(redis_client, max_requests=5, window_minutes=60)
```

**Time:** 2-3 hours  
**Risk:** Medium (requires Redis for production)

---

## Testing These Fixes

### Unit Tests (tests/test_validation.py)
```python
import pytest
from api.middleware import validate_youtube_url, JobIDValidator
from pydantic import ValidationError

class TestYoutubeURLValidation:
    def test_valid_urls(self):
        assert validate_youtube_url("https://youtube.com/watch?v=abc123")
        assert validate_youtube_url("https://www.youtube.com/watch?v=abc123")
        assert validate_youtube_url("https://youtu.be/abc123")
    
    def test_invalid_urls(self):
        assert not validate_youtube_url("https://fake-youtube.com")
        assert not validate_youtube_url("https://youtu.be.scam")
        assert not validate_youtube_url("not a url")
        assert not validate_youtube_url("")

class TestJobIDValidation:
    def test_valid_ids(self):
        JobIDValidator(job_id="job_123")
        JobIDValidator(job_id="a" * 36)  # Max length
    
    def test_invalid_ids(self):
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="")  # Too short
        
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="a" * 37)  # Too long
        
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="job@123")  # Invalid char
```

---

## Summary: Critical Fixes

| Issue | Time | Risk | File | Lines |
|-------|------|------|------|-------|
| Job ID validation | 30m | Low | api/videos.py | +15 |
| URL validation | 15m | Low | api/middleware.py | +10 |
| CSRF token | 2h | Med | api/*, main.py | +50 |
| Env var validation | 30m | Low | config.py | +20 |
| Lock deps | 1h | Low | requirements.txt | +10 |
| Rate limiting | 2h | Med | api/*, middleware.py | +40 |
| **Total** | **8-10h** | **Low-Med** | **~145 LOC** | |

---

## Implementation Checklist

- [ ] Fix job ID validation
- [ ] Fix URL validation
- [ ] Add CSRF token middleware
- [ ] Validate required env vars
- [ ] Lock dependencies with pip-tools
- [ ] Implement rate limiting (in-memory for MVP)
- [ ] Write tests for all 6 fixes
- [ ] Update Dockerfile if needed
- [ ] Manual testing: submit a job, check status
- [ ] Code review before deployment

**Estimated Sprint:** 2-3 days for a focused team  
**Blocking Production:** YES — All 6 must be fixed
