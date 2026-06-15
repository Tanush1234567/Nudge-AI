# QA Testing Strategy - Nudge Video Platform

## Test Coverage Roadmap

### Current State
- **Test Coverage:** 0% (no tests exist)
- **Test Infrastructure:** Not setup
- **CI/CD:** Not configured

### Target State
- **Phase 1:** 50% coverage (critical paths)
- **Phase 2:** 75% coverage (all API, pipeline stages)
- **Phase 3:** 85%+ coverage (comprehensive)

---

## Phase 1: Critical Path Testing (Week 1-2)

### Backend Unit Tests
```
tests/backend/unit/
├── test_validation.py         (30 min)
├── test_config.py             (30 min)
├── test_exceptions.py         (15 min)
└── test_middleware.py         (45 min)
```

**Coverage Goal:** API input validation, config parsing, error types

### Backend Integration Tests
```
tests/backend/integration/
├── test_job_queue_basic.py    (2 hours)
├── test_pipeline_mocked.py    (3 hours)
└── test_supabase_ops.py       (2 hours)
```

**Coverage Goal:** Job lifecycle, pipeline orchestration, database operations

**Tools:**
- `pytest` (testing framework)
- `pytest-asyncio` (async support)
- `pytest-cov` (coverage reporting)
- `unittest.mock` (mocking external APIs)

**Setup:**
```bash
pip install pytest pytest-asyncio pytest-cov pytest-env
```

### Frontend Component Tests
```
tests/frontend/
├── test_page.test.tsx         (1 hour)
└── test_components.test.tsx   (1 hour)
```

**Tools:**
- Jest or Vitest
- React Testing Library

**Setup:**
```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom
```

**Estimated Time:** 8-10 hours

---

## Phase 2: Comprehensive Testing (Week 3)

### E2E Tests (Real API, Mocked Video)
```
tests/e2e/
├── test_submit_and_poll.spec.ts     (2 hours)
├── test_duplicate_detection.spec.ts (1 hour)
└── test_error_flows.spec.ts         (1 hour)
```

**Tools:**
- Playwright or Cypress

### Performance Tests
```
tests/performance/
├── test_frame_extraction_perf.py  (1 hour)
├── test_vision_api_batching.py    (1 hour)
└── test_job_queue_throughput.py   (1 hour)
```

**Acceptance Criteria:**
- Frame extraction: <5s per frame (50 frame job = <4 min)
- Vision analysis: <200ms per frame batch
- Job queue: No memory leaks over 10 jobs

### Stress Tests
```
tests/stress/
└── test_concurrent_jobs.py  (Memory limits)
```

**Estimated Time:** 8 hours

---

## Phase 3: Full Coverage (Week 4)

### Database Tests
```
tests/backend/database/
├── test_job_crud.py           (1 hour)
├── test_concurrent_updates.py (1 hour)
└── test_recovery_scenarios.py (1 hour)
```

### Security Tests
```
tests/backend/security/
├── test_csrf_protection.py    (1 hour)
├── test_rate_limiting.py      (1 hour)
└── test_auth_isolation.py     (1 hour)
```

### Pipeline Stage Tests
```
tests/backend/pipeline/
├── test_download.py           (1 hour)
├── test_frames.py             (1 hour)
├── test_vision.py             (2 hours)
├── test_transcript.py         (1 hour)
├── test_synthesize.py         (2 hours)
└── test_stitch.py             (1 hour)
```

**Estimated Time:** 12 hours

---

## Test Fixtures & Mocks

### Shared Fixtures (conftest.py)
```python
# tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock

@pytest.fixture
def mock_supabase():
    """Mock Supabase client."""
    client = AsyncMock()
    client.table.return_value.insert.return_value = {"data": [{"id": "job_123"}]}
    return client

@pytest.fixture
def mock_gemini():
    """Mock Google Gemini API."""
    api = AsyncMock()
    api.vision_call.return_value = {
        "type": "chart",
        "confidence": 0.95,
        "description": "Bar chart showing growth"
    }
    return api

@pytest.fixture
def sample_video_frame():
    """Small test image."""
    import numpy as np
    return np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)

@pytest.fixture
async def test_job_record():
    """Sample job from database."""
    return {
        "id": "job_test_123",
        "video_id": "abc123",
        "url": "https://youtube.com/watch?v=abc123",
        "status": "queued",
        "created_at": "2025-01-01T00:00:00Z"
    }

@pytest.fixture
def mock_redis():
    """Mock Redis for rate limiting."""
    redis = MagicMock()
    redis.incr.return_value = 1
    redis.expire.return_value = True
    return redis
```

### Mock Video Files
```python
@pytest.fixture
def sample_mp4_path(tmp_path):
    """Create a minimal valid MP4 file for testing."""
    # Use ffmpeg to create 1-second test video
    import subprocess
    test_file = tmp_path / "test.mp4"
    subprocess.run([
        "ffmpeg", "-f", "lavfi", "-i", "testsrc=size=640x480:duration=1",
        "-q:v", "5", str(test_file)
    ], capture_output=True)
    return str(test_file)
```

---

## Example Tests

### Unit Test: Input Validation
```python
# tests/backend/unit/test_validation.py
import pytest
from api.middleware import validate_youtube_url
from pydantic import ValidationError
from api.videos import JobIDValidator

class TestYoutubeURLValidation:
    """Test YouTube URL validation."""
    
    @pytest.mark.parametrize("url", [
        "https://youtube.com/watch?v=abc",
        "https://www.youtube.com/watch?v=abc",
        "https://youtu.be/abc",
        "http://youtube.com/watch?v=abc",
    ])
    def test_valid_youtube_urls(self, url):
        assert validate_youtube_url(url) is True
    
    @pytest.mark.parametrize("url", [
        "https://fake-youtube.com",
        "https://youtu.be.scam",
        "",
        None,
        "not a url",
    ])
    def test_invalid_urls(self, url):
        assert validate_youtube_url(url) is False

class TestJobIDValidation:
    """Test job ID format validation."""
    
    def test_valid_job_ids(self):
        JobIDValidator(job_id="job_123")
        JobIDValidator(job_id="a" * 36)
        JobIDValidator(job_id="abc-def_123")
    
    def test_max_length_enforced(self):
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="a" * 37)
    
    def test_invalid_characters_rejected(self):
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="job@123")
        with pytest.raises(ValidationError):
            JobIDValidator(job_id="job#456")
```

### Integration Test: Job Queue
```python
# tests/backend/integration/test_job_queue.py
import pytest
from job_queue.worker import JobQueue

@pytest.mark.asyncio
async def test_job_queue_basic_enqueue_dequeue():
    """Test job queue adds and processes jobs."""
    queue = JobQueue(max_concurrent=1)
    
    await queue.enqueue("job_1", "https://youtube.com/watch?v=abc")
    assert queue.queue_depth == 1
    
    # Start workers would process this
    await queue.start_workers()
    
    # Give it time to process
    import asyncio
    await asyncio.sleep(0.1)

@pytest.mark.asyncio
async def test_queue_bounded_at_50():
    """Test queue max size limit."""
    queue = JobQueue(max_concurrent=1)
    
    # Fill queue to limit
    for i in range(50):
        await queue.enqueue(f"job_{i}", "https://youtube.com/watch?v=test")
    
    assert queue.queue_depth == 50
    
    # Adding more should raise
    with pytest.raises(asyncio.QueueFull):
        await asyncio.wait_for(
            queue.enqueue("job_51", "https://youtube.com/watch?v=test"),
            timeout=1.0
        )
```

### API Test: Rate Limiting
```python
# tests/backend/integration/test_rate_limiting.py
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_rate_limit_enforcement(mock_redis):
    """Test rate limit blocks after 5 requests per IP per hour."""
    
    # First 5 requests should succeed
    for i in range(5):
        response = client.post(
            "/api/analyze",
            json={"url": "https://youtube.com/watch?v=test"},
            headers={"X-Forwarded-For": "192.168.1.1"}
        )
        assert response.status_code in [200, 400]  # 400 = invalid URL, but not rate limited
    
    # 6th request should be rate limited
    response = client.post(
        "/api/analyze",
        json={"url": "https://youtube.com/watch?v=test"},
        headers={"X-Forwarded-For": "192.168.1.1"}
    )
    assert response.status_code == 429
    assert "Rate limit" in response.json()["detail"]
```

---

## Continuous Integration (GitHub Actions)

### .github/workflows/test.yml
```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-lock.txt
          pip install pytest pytest-asyncio pytest-cov
      
      - name: Run backend tests
        run: pytest tests/backend --cov=backend --cov-report=xml
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml

  lint:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install linters
        run: |
          pip install black pylint mypy
      
      - name: Format check
        run: black --check backend/
      
      - name: Lint
        run: pylint backend/ --disable=all --enable=E,F
      
      - name: Type check
        run: mypy backend/

  frontend-test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm run test
      
      - name: Lint
        run: npm run lint
```

---

## Testing Metrics & Goals

### Coverage Targets
| Component | Phase 1 | Phase 2 | Phase 3 |
|-----------|---------|---------|---------|
| API Endpoints | 60% | 90% | 95% |
| Pipeline Stages | 40% | 80% | 90% |
| Utilities | 50% | 75% | 85% |
| **Overall** | **50%** | **75%** | **85%+** |

### Quality Metrics
- **Test Pass Rate:** Target 100% (no flaky tests)
- **Build Time:** <5 minutes
- **Coverage Trend:** Always increasing
- **Bug Escape Rate:** <1 bug per 100 test cases

---

## Test Execution Guide

### Run All Tests
```bash
pytest tests/ -v --cov=backend --cov-report=html
```

### Run Specific Test Suite
```bash
pytest tests/backend/unit/ -v
pytest tests/backend/integration/ -v
pytest tests/backend/pipeline/ -v
```

### Run with Markers
```bash
pytest tests/ -m "unit" -v                # Only unit tests
pytest tests/ -m "integration" -v         # Only integration
pytest tests/ -m "slow" -v                # Only slow tests
```

### Watch Mode (Development)
```bash
pytest-watch tests/
```

### Generate Coverage Report
```bash
pytest tests/ --cov=backend --cov-report=html
open htmlcov/index.html
```

---

## Testing Best Practices

### ✅ DO
- Test behavior, not implementation
- Use descriptive test names (`test_job_queue_recovers_on_restart`)
- Mock external services (Gemini API, Supabase)
- Use fixtures for common setup
- Test error cases and edge cases
- Keep tests fast (<1s per test)
- Use parametrize for similar test cases

### ❌ DON'T
- Test internal implementation details
- Use sleep() in tests (use proper async/await)
- Make real API calls (mock everything external)
- Skip flaky tests without fixing them
- Write tests that depend on test order
- Hardcode values; use fixtures

---

## Rollout Plan

### Week 1
- [ ] Setup pytest infrastructure
- [ ] Write unit tests for validation (20 tests)
- [ ] Write integration tests for job queue (10 tests)
- [ ] Achieve 50% coverage on API

### Week 2
- [ ] Write pipeline stage tests (30 tests)
- [ ] Write error handling tests (15 tests)
- [ ] Setup GitHub Actions CI
- [ ] Achieve 75% coverage

### Week 3
- [ ] Write E2E tests (10 tests)
- [ ] Write performance tests (5 tests)
- [ ] Write security tests (8 tests)
- [ ] Achieve 85%+ coverage

### Ongoing
- [ ] Maintain >85% coverage
- [ ] Add tests for all new features
- [ ] Review and refactor tests quarterly

---

**Total Estimated Effort:** 40-50 hours  
**Recommended Team:** 2 engineers (split frontend/backend)  
**Expected Duration:** 3-4 weeks part-time OR 1-2 weeks full-time
