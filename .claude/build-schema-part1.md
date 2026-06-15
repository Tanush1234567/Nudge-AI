# Nudge — Complete Build Package (Start From Scratch)
## Schema Design + ML Optimization + Full Prompt Sequence

---

## PART 1: SCHEMA DESIGN — SYSTEM + ML PERSPECTIVE

### What the Original Schema Was Missing

The original schema stored the minimum: a job record with input URL and output notes_json.
That's enough to display notes. It's NOT enough to:

1. **Improve note quality over time** — no feedback loop, no quality metrics
2. **Debug pipeline failures** — no stage timing, no intermediate data
3. **Optimize per video type** — coding tutorials need different frame thresholds than whiteboard lectures
4. **A/B test prompts** — no prompt versioning, can't compare output quality across prompt iterations
5. **Recover from partial failures** — intermediate analyses are thrown away
6. **Learn from users** — no corrections, no ratings, no engagement data

The redesigned schema adds 4 categories of ML-critical columns:

```
CATEGORY 1: PIPELINE INSTRUMENTATION
  Why: Know what happened at each stage. Debug failures. Optimize bottlenecks.
  Columns: stage_timings, gemini_calls_count, gemini_tokens_used,
           processing_seconds, retry_counts

CATEGORY 2: CONTENT CLASSIFICATION
  Why: Different video types need different processing strategies.
       A coding tutorial needs tighter frame extraction (code changes fast).
       A whiteboard lecture needs OCR-optimized vision prompts.
       A slide deck needs slide-transition detection.
  Columns: video_type, dominant_content_type, code_languages_detected,
           transcript_source, transcript_coverage

CATEGORY 3: INTERMEDIATE DATA PERSISTENCE
  Why: If you improve your prompts next week, you can re-run synthesis
       on stored frame analyses WITHOUT re-downloading and re-processing
       the video. This saves hours of pipeline compute.
  Table: frame_analyses (one row per analyzed frame)
  Columns: raw_sections_json (pre-synthesis stitched data)

CATEGORY 4: QUALITY FEEDBACK LOOP
  Why: User ratings and corrections are GOLD DATA. They tell you which
       notes are good, which are bad, and exactly what's wrong.
       After 500 rated videos, you can fine-tune prompts by studying
       what differentiates 5-star notes from 2-star notes.
  Columns: user_rating, user_feedback, corrections_json,
           notes_shared_count, notes_view_count, time_spent_viewing_seconds
```

### The Redesigned Schema

```sql
-- ════════════════════════════════════════════════════════════════
-- Run this ENTIRE script in Supabase SQL Editor
-- ════════════════════════════════════════════════════════════════


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 1: JOBS — Each video processing request               │
-- │ This is the central table. Everything links back here.      │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- ── WHO ──
    user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    anonymous_ip        TEXT,
    
    -- ── INPUT ──
    url                 TEXT NOT NULL,
    video_id            TEXT NOT NULL,
    
    -- ── VIDEO METADATA (populated after download) ──
    video_title         TEXT,
    video_channel       TEXT,
    video_duration      INTEGER,                -- seconds
    video_thumbnail     TEXT,                   -- URL
    
    -- ── CONTENT CLASSIFICATION (ML-critical) ──
    -- These columns let you optimize the pipeline per video type.
    -- After 100+ processed videos, you can analyze which types
    -- produce the best notes and tune parameters accordingly.
    video_type          TEXT DEFAULT 'unknown'
                        CHECK (video_type IN (
                            'coding_tutorial',  -- code editor on screen
                            'slide_lecture',     -- PowerPoint/Keynote slides
                            'whiteboard',        -- handwritten on board/tablet
                            'talking_head',      -- mostly face, minimal visuals
                            'screencast',        -- screen recording (UI demo, terminal)
                            'mixed',             -- combination of types
                            'unknown'            -- not yet classified
                        )),
    dominant_content_type TEXT,                  -- most common frame content_type
    code_languages      TEXT[],                 -- detected programming languages
    has_equations        BOOLEAN DEFAULT FALSE,  -- contains math/equations
    
    -- ── TRANSCRIPT METADATA (ML-critical) ──
    -- transcript_source affects accuracy. Manual captions >> auto-generated.
    -- transcript_coverage tells you how much of the video has captions.
    -- Low coverage = need to rely more on visual analysis.
    transcript_source   TEXT CHECK (transcript_source IN (
                            'manual',           -- human-written captions
                            'auto_generated',   -- YouTube auto-captions
                            'translated',       -- auto-translated from another language
                            'none'              -- no captions available
                        )),
    transcript_coverage FLOAT,                  -- 0.0 to 1.0: fraction of video covered
    transcript_language TEXT,                    -- detected language code (en, es, etc.)
    transcript_segments_count INTEGER DEFAULT 0,
    
    -- ── PROCESSING STATE ──
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                            'queued', 'downloading', 'transcribing',
                            'capturing', 'reading', 'stitching',
                            'writing', 'complete', 'error', 'cancelled'
                        )),
    progress            INTEGER NOT NULL DEFAULT 0
                        CHECK (progress >= 0 AND progress <= 100),
    stage_detail        TEXT,
    frames_captured     INTEGER NOT NULL DEFAULT 0,
    frames_important    INTEGER NOT NULL DEFAULT 0,
    
    -- ── PIPELINE INSTRUMENTATION (ML-critical) ──
    -- stage_timings lets you identify bottlenecks.
    -- Example: {"download": 8.2, "transcript": 1.1, "frames": 4.5, 
    --           "vision": 45.3, "stitch": 0.8, "synthesis": 12.1}
    -- After 100 videos, you discover vision takes 60% of processing time.
    -- That tells you: optimize batching, reduce frame count, or cache.
    stage_timings       JSONB,                  -- {stage_name: seconds}
    total_processing_seconds FLOAT,
    gemini_calls_count  INTEGER DEFAULT 0,
    gemini_tokens_used  INTEGER DEFAULT 0,      -- approximate input+output tokens
    
    -- ── PROMPT VERSIONING (ML-critical) ──
    -- When you iterate on prompts (and you will, constantly), this lets you
    -- compare output quality between prompt versions.
    -- "Did prompt v3 produce better ratings than v2?"
    vision_prompt_version   TEXT DEFAULT 'v1',
    synthesis_prompt_version TEXT DEFAULT 'v1',
    
    -- ── OUTPUT ──
    notes_json          JSONB,                  -- the final structured notes
    raw_sections_json   JSONB,                  -- pre-synthesis stitched sections
                                                -- (intermediate data — enables re-synthesis
                                                --  without re-processing the video)
    stats               JSONB,                  -- {frames_captured, diagrams_generated, etc.}
    notes_word_count    INTEGER,                -- total words in generated notes
    notes_sections_count INTEGER,               -- number of sections generated
    
    -- ── QUALITY & FEEDBACK (ML-critical) ──
    -- This is your training data. After 500+ rated videos, you can:
    -- 1. Analyze what makes a 5-star note vs a 2-star note
    -- 2. Correlate quality with video_type, transcript_source, frame_count
    -- 3. Fine-tune prompts based on high-rated examples
    -- 4. Identify failure patterns (certain video types always score low)
    user_rating         INTEGER CHECK (user_rating BETWEEN 1 AND 5),
    user_feedback       TEXT,                   -- freeform feedback
    corrections_json    JSONB,                  -- user corrections: [{section, field, old, new}]
    notes_view_count    INTEGER DEFAULT 0,
    notes_share_count   INTEGER DEFAULT 0,
    time_spent_viewing_seconds INTEGER DEFAULT 0, -- total time users spent reading this note
    
    -- ── ERROR TRACKING ──
    error_message       TEXT,
    error_stage         TEXT,
    retry_count         INTEGER NOT NULL DEFAULT 0,
    retry_stages        JSONB,                  -- {stage: retry_count} for per-stage retries
    
    -- ── TIMESTAMPS ──
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    rated_at            TIMESTAMPTZ,
    
    -- ── DEDUP ──
    UNIQUE(user_id, video_id)
);

-- Performance indices
CREATE INDEX idx_jobs_user ON jobs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_jobs_status ON jobs(status) WHERE status NOT IN ('complete', 'error');
CREATE INDEX idx_jobs_ip ON jobs(anonymous_ip) WHERE anonymous_ip IS NOT NULL;
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);
CREATE INDEX idx_jobs_video_id ON jobs(video_id);
CREATE INDEX idx_jobs_video_type ON jobs(video_type) WHERE video_type != 'unknown';
CREATE INDEX idx_jobs_rating ON jobs(user_rating) WHERE user_rating IS NOT NULL;

-- Full-text search on notes (for future ASK mode / search across videos)
CREATE INDEX idx_jobs_notes_search ON jobs 
    USING GIN (to_tsvector('english', COALESCE(video_title, '') || ' ' || 
    COALESCE(notes_json->>'summary', '')));


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 2: FRAME_ANALYSES — Per-frame multimodal analysis     │
-- │                                                             │
-- │ WHY PERSIST THIS:                                           │
-- │ 1. Re-run synthesis with new prompts without re-processing  │
-- │ 2. Build a training dataset for content classification      │
-- │ 3. Debug why specific frames were misclassified             │
-- │ 4. Enable frame-level search ("find all frames with code")  │
-- │ 5. Power the "captured frames" display in notes             │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE frame_analyses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    
    -- ── FRAME DATA ──
    frame_index         INTEGER NOT NULL,       -- 0-based position
    timestamp_seconds   FLOAT NOT NULL,
    timestamp_str       TEXT NOT NULL,           -- "04:32" for display
    
    -- ── SCENE DETECTION METADATA ──
    change_score        FLOAT,                  -- how much changed visually (0-1)
    capture_reason      TEXT CHECK (capture_reason IN (
                            'scene_change',     -- visual threshold exceeded
                            'forced_interval',  -- 30s forced capture
                            'first_frame'       -- first frame of video
                        )),
    
    -- ── TRANSCRIPT CONTEXT ──
    transcript_context  TEXT,                    -- the ±20/15s transcript window
    transcript_window   JSONB,                  -- {before_seconds: 20, after_seconds: 15}
    
    -- ── VISION ANALYSIS OUTPUT ──
    content_type        TEXT,                    -- code, slides, whiteboard, diagram, etc.
    visual_description  TEXT,
    extracted_text      TEXT,                    -- verbatim code/equations/slide text
    alignment_note      TEXT,                    -- how visual relates to speech
    is_important        BOOLEAN DEFAULT FALSE,
    importance_reason   TEXT,
    topic               TEXT,                    -- short topic label
    
    -- ── ML METADATA ──
    confidence_score    FLOAT,                  -- model's self-assessed confidence (0-1)
                                                -- extracted from Gemini response if available
    extraction_quality  TEXT CHECK (extraction_quality IN (
                            'high',             -- clear, readable screen content
                            'medium',           -- partially readable
                            'low',              -- blurry, small text, hard to read
                            'none'              -- no text to extract (talking head)
                        )),
    
    -- ── FRAME STORAGE ──
    storage_url         TEXT,                   -- Supabase Storage URL (null if not uploaded)
    
    -- ── TIMESTAMPS ──
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(job_id, frame_index)
);

CREATE INDEX idx_frames_job ON frame_analyses(job_id, frame_index);
CREATE INDEX idx_frames_important ON frame_analyses(job_id) WHERE is_important = TRUE;
CREATE INDEX idx_frames_content_type ON frame_analyses(content_type);
CREATE INDEX idx_frames_topic ON frame_analyses USING GIN (to_tsvector('english', COALESCE(topic, '')));


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 3: COURSES — Playlist-based groupings                 │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE courses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    playlist_url        TEXT NOT NULL,
    playlist_id         TEXT,
    title               TEXT,
    total_videos        INTEGER NOT NULL DEFAULT 0,
    total_duration      INTEGER,                -- total seconds
    videos_completed    INTEGER DEFAULT 0,
    master_summary      JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_courses_user ON courses(user_id);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 4: COURSE_VIDEOS — Links courses to jobs in order     │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE course_videos (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id           UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    job_id              UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    video_order         INTEGER NOT NULL,
    UNIQUE(course_id, job_id),
    UNIQUE(course_id, video_order)
);

CREATE INDEX idx_cv_course ON course_videos(course_id, video_order);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 5: FREE_TIER_USAGE — IP-based rate limiting           │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE free_tier_usage (
    ip_address          TEXT PRIMARY KEY,
    videos_used         INTEGER NOT NULL DEFAULT 0,
    first_used_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 6: PROMPT_VERSIONS — Track prompt template changes    │
-- │                                                             │
-- │ WHY: When you change a prompt, you need to know:            │
-- │ 1. Which version produced which outputs                     │
-- │ 2. Whether the new version is better (by comparing ratings) │
-- │ 3. What exactly changed (diff between versions)             │
-- │ This is your ML experiment tracking system.                 │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE prompt_versions (
    id                  TEXT PRIMARY KEY,        -- e.g., "vision_v1", "synthesis_v3"
    prompt_type         TEXT NOT NULL CHECK (prompt_type IN ('vision', 'synthesis')),
    version             TEXT NOT NULL,            -- "v1", "v2", etc.
    prompt_text         TEXT NOT NULL,            -- the full prompt template
    description         TEXT,                    -- what changed from previous version
    is_active           BOOLEAN DEFAULT FALSE,   -- currently in use?
    
    -- ── PERFORMANCE METRICS (updated periodically) ──
    jobs_count          INTEGER DEFAULT 0,       -- how many jobs used this prompt
    avg_rating          FLOAT,                   -- average user rating for this prompt
    avg_processing_seconds FLOAT,                -- how fast this prompt processes
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(prompt_type, version)
);


-- ┌─────────────────────────────────────────────────────────────┐
-- │ TABLE 7: ANALYTICS_EVENTS — Lightweight event tracking      │
-- │                                                             │
-- │ Track: note views, shares, time on page, quiz starts        │
-- │ This data feeds into quality scoring over time.             │
-- └─────────────────────────────────────────────────────────────┘

CREATE TABLE analytics_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id              UUID REFERENCES jobs(id) ON DELETE CASCADE,
    event_type          TEXT NOT NULL CHECK (event_type IN (
                            'note_view',        -- user opened the notes page
                            'note_share',       -- user clicked share
                            'note_export',      -- user exported as PDF/markdown
                            'note_rate',        -- user rated the notes
                            'quiz_start',       -- user started a quiz
                            'frame_click',      -- user clicked a captured frame
                            'timestamp_click',  -- user clicked a timestamp (went to YouTube)
                            'copy_code'         -- user copied a code block
                        )),
    event_data          JSONB,                  -- flexible payload per event type
    session_duration_seconds INTEGER,           -- how long they spent (for view events)
    ip_address          TEXT,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_job ON analytics_events(job_id);
CREATE INDEX idx_events_type ON analytics_events(event_type, created_at DESC);


-- ════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE frame_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Jobs: users see their own + anonymous jobs are public (for sharing)
CREATE POLICY "Users read own jobs" ON jobs
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "Anyone can create jobs" ON jobs
    FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Users update own jobs" ON jobs
    FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

-- Frame analyses: readable by anyone who can read the parent job
CREATE POLICY "Read frames via job" ON frame_analyses
    FOR SELECT USING (
        job_id IN (SELECT id FROM jobs WHERE auth.uid() = user_id OR user_id IS NULL)
    );
CREATE POLICY "Insert frames" ON frame_analyses
    FOR INSERT WITH CHECK (TRUE);

-- Courses: users see their own
CREATE POLICY "Users read own courses" ON courses
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create courses" ON courses
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Course videos: via course ownership
CREATE POLICY "Read course videos" ON course_videos
    FOR SELECT USING (
        course_id IN (SELECT id FROM courses WHERE auth.uid() = user_id)
    );

-- Prompt versions: readable by all (no sensitive data)
CREATE POLICY "Read prompts" ON prompt_versions FOR SELECT USING (TRUE);

-- Analytics: insertable by anyone, readable by job owner
CREATE POLICY "Insert events" ON analytics_events FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Read own events" ON analytics_events
    FOR SELECT USING (
        job_id IN (SELECT id FROM jobs WHERE auth.uid() = user_id OR user_id IS NULL)
    );


-- ════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ════════════════════════════════════════════════════════════════

-- Increment free tier usage (upsert)
CREATE OR REPLACE FUNCTION increment_free_usage(target_ip TEXT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO free_tier_usage (ip_address, videos_used, last_used_at)
    VALUES (target_ip, 1, NOW())
    ON CONFLICT (ip_address)
    DO UPDATE SET 
        videos_used = free_tier_usage.videos_used + 1,
        last_used_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Increment note view count (called from frontend)
CREATE OR REPLACE FUNCTION increment_view_count(target_job_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE jobs SET notes_view_count = COALESCE(notes_view_count, 0) + 1
    WHERE id = target_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get pipeline performance stats (for ML analysis)
CREATE OR REPLACE FUNCTION get_pipeline_stats()
RETURNS TABLE (
    video_type TEXT,
    total_jobs BIGINT,
    avg_processing_seconds FLOAT,
    avg_frames_captured FLOAT,
    avg_rating FLOAT,
    avg_notes_word_count FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        j.video_type,
        COUNT(*)::BIGINT as total_jobs,
        AVG(j.total_processing_seconds) as avg_processing_seconds,
        AVG(j.frames_captured::FLOAT) as avg_frames_captured,
        AVG(j.user_rating::FLOAT) as avg_rating,
        AVG(j.notes_word_count::FLOAT) as avg_notes_word_count
    FROM jobs j
    WHERE j.status = 'complete'
    GROUP BY j.video_type
    ORDER BY total_jobs DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ════════════════════════════════════════════════════════════════
-- STORAGE BUCKET
-- ════════════════════════════════════════════════════════════════
-- Create via Supabase Dashboard → Storage → New Bucket:
--   Name: "frames"
--   Public: YES
--   File size limit: 5MB
--   Allowed MIME types: image/jpeg, image/png


-- ════════════════════════════════════════════════════════════════
-- SEED: Initial Prompt Versions
-- ════════════════════════════════════════════════════════════════

INSERT INTO prompt_versions (id, prompt_type, version, prompt_text, description, is_active)
VALUES 
('vision_v1', 'vision', 'v1', 'See prompts.py for full text', 'Initial vision prompt with aligned frame-transcript analysis', TRUE),
('synthesis_v1', 'synthesis', 'v1', 'See prompts.py for full text', 'Initial synthesis prompt with section-based note generation', TRUE);
```

---

## PART 2: HOW EACH ML COLUMN IMPROVES OUTPUT

```
COLUMN                          │ HOW IT IMPROVES OUTPUT
────────────────────────────────┼───────────────────────────────────────────
video_type                      │ After 50 videos: you discover coding tutorials 
                                │ need 8% change threshold (not 12%) because code
                                │ changes are subtle. Whiteboard needs 15% because
                                │ drawing is incremental. You add per-type config.
                                │
transcript_source               │ Auto-generated captions have ~85% accuracy.
                                │ Manual captions are ~99%. When transcript_source
                                │ is 'auto_generated', you can add a note to the
                                │ synthesis prompt: "Transcript may contain errors.
                                │ Cross-check with visual content."
                                │
transcript_coverage             │ If coverage is <0.5 (half the video has no captions),
                                │ switch to visual-heavy mode: extract MORE frames,
                                │ rely MORE on vision analysis, generate MORE diagrams.
                                │
stage_timings                   │ After 100 videos: "vision stage takes 62% of total
                                │ time." Now you know to optimize batching, reduce
                                │ frame count for talking-head sections, or implement
                                │ a fast pre-classifier that skips non-important frames
                                │ before sending to Gemini.
                                │
vision_prompt_version           │ You change the vision prompt. Process 20 videos with
                                │ v2. Compare avg_rating for v1 vs v2 jobs. If v2 is
                                │ better, make it the default. If worse, revert.
                                │ This is your A/B testing infrastructure.
                                │
raw_sections_json               │ You improve your synthesis prompt. Instead of
                                │ re-processing 200 old videos from scratch (re-download,
                                │ re-extract frames, re-run vision), you just re-run
                                │ synthesis on the stored raw_sections. Saves 95% of
                                │ compute. This is the single most valuable ML column.
                                │
frame_analyses (table)          │ Same as above but at frame level. Also enables:
                                │ "Show me all frames classified as 'code' with low
                                │ confidence" → review → improve the vision prompt for
                                │ code detection. This is your annotation/debugging tool.
                                │
user_rating + corrections_json  │ After 500 rated videos, you have a labeled dataset.
                                │ You can analyze: "5-star notes average 8 sections,
                                │ 2-star notes average 3. 5-star notes have 2.5 code
                                │ blocks per section, 2-star have 0.3." This tells you
                                │ exactly what to optimize in the synthesis prompt.
                                │
                                │ corrections_json is even more valuable: it tells you
                                │ EXACTLY what the model got wrong. "User corrected the
                                │ code in section 3 — model extracted 'setstate' but
                                │ correct is 'setState'." That's a training signal.
                                │
notes_view_count + share_count  │ Proxy for quality. Notes that get shared are good.
                                │ Notes that get viewed once and never again are bad.
                                │ Use as a secondary quality signal alongside ratings.
                                │
confidence_score (frame level)  │ Gemini can self-assess: "How confident are you in
                                │ this text extraction?" Low confidence frames should
                                │ be processed differently — maybe with a larger image
                                │ (higher resolution), or with a specialized OCR prompt.
                                │
analytics_events                │ "Users click timestamps 3x more than code blocks."
                                │ That tells you timestamps are high-value → make them
                                │ more prominent. "Users copy code blocks 70% of the
                                │ time" → code extraction accuracy is CRITICAL.
```

---

## PART 3: .CLAUDE/CLAUDE.md

```
Copy this file to: nudge/.claude/CLAUDE.md
```