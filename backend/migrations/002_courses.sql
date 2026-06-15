-- Courses migration: playlist-level grouping with syllabus + concept graph.
--
-- A course bundles many lecture videos (rows in `jobs`) under one parent
-- record. The junction table `course_videos` carries the lecture order.
-- Course-level intelligence (syllabus, master equation sheet, concept graph)
-- is generated once all lectures have processed and lives in the JSON
-- columns on `courses`.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- Reset any partial state from an aborted earlier run. Safe because courses
-- contain no user-authored data — they are derived from playlists.
drop function if exists get_course_with_lectures(uuid);
drop table if exists course_videos cascade;
drop table if exists courses cascade;

-- ---------------------------------------------------------------------------
-- 1. courses
-- ---------------------------------------------------------------------------
create table courses (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            text        not null,
  title              text        not null,
  description        text,
  source_url         text        not null,
  platform           text        default 'youtube',
  thumbnail_url      text,
  total_videos       integer     not null,
  processed_videos   integer     default 0,
  status             text        default 'processing'
                                 check (status in ('processing', 'partial', 'complete', 'failed')),
  syllabus_json      jsonb,
  concept_graph      jsonb,
  master_equations   jsonb,
  course_embedding   vector(1536),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists courses_user_id_idx on courses(user_id);
create index if not exists courses_status_idx  on courses(status);

-- ---------------------------------------------------------------------------
-- 2. course_videos — ordered junction between courses and jobs
-- ---------------------------------------------------------------------------
create table course_videos (
  course_id       uuid    references courses(id) on delete cascade,
  video_id        uuid    references jobs(id)    on delete cascade,
  lecture_number  integer not null,
  primary key (course_id, video_id)
);

create index if not exists idx_course_videos_course on course_videos(course_id);
create index if not exists idx_course_videos_order  on course_videos(course_id, lecture_number);

-- ---------------------------------------------------------------------------
-- 3. RLS policies — each user can only see/manage their own courses.
--    Backend uses the SERVICE ROLE key, which bypasses RLS; these policies
--    protect direct anon-key access from the browser.
-- ---------------------------------------------------------------------------
alter table courses enable row level security;

drop policy if exists "Users can view own courses"   on courses;
drop policy if exists "Users can insert own courses" on courses;
drop policy if exists "Users can update own courses" on courses;
drop policy if exists "Users can delete own courses" on courses;

create policy "Users can view own courses"   on courses for select using (user_id = auth.uid()::text);
create policy "Users can insert own courses" on courses for insert with check (user_id = auth.uid()::text);
create policy "Users can update own courses" on courses for update using (user_id = auth.uid()::text);
create policy "Users can delete own courses" on courses for delete using (user_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4. Convenience RPC — flatten a course with all its lectures in one call.
-- ---------------------------------------------------------------------------
create or replace function get_course_with_lectures(p_course_id uuid)
returns table (
  course_id        uuid,
  course_title     text,
  course_status    text,
  total_videos     integer,
  processed_videos integer,
  syllabus_json    jsonb,
  concept_graph    jsonb,
  master_equations jsonb,
  video_id         uuid,
  lecture_number   integer,
  video_title      text,
  video_status     text,
  notes_json       jsonb
)
language sql stable as $$
  select
    c.id, c.title, c.status, c.total_videos, c.processed_videos,
    c.syllabus_json, c.concept_graph, c.master_equations,
    j.id, cv.lecture_number, j.video_title,
    j.status, j.notes_json
  from courses c
  left join course_videos cv on cv.course_id = c.id
  left join jobs j           on j.id = cv.video_id
  where c.id = p_course_id
  order by cv.lecture_number nulls last;
$$;
