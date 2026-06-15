-- Workspace migration: folders, vector embedding column, semantic search RPC.
--
-- Prereq: the pgvector extension must be enabled in this Supabase project.
-- Run once in the SQL editor if it isn't already:
--   create extension if not exists vector;

create extension if not exists vector;
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. folders
-- ---------------------------------------------------------------------------
create table if not exists folders (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        not null,
  name        text        not null,
  parent_id   uuid        references folders(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists folders_user_id_idx   on folders(user_id);
create index if not exists folders_parent_id_idx on folders(parent_id);

-- ---------------------------------------------------------------------------
-- 2. jobs: folder_id + vector embedding column
-- ---------------------------------------------------------------------------
alter table jobs add column if not exists folder_id uuid
  references folders(id) on delete set null;

create index if not exists jobs_folder_id_idx on jobs(folder_id);

alter table jobs add column if not exists notes_embedding vector(1536);

-- ANN index (cosine). ivfflat is fine for moderate row counts; switch to
-- hnsw when the user library grows large. Created only if it doesn't exist.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'jobs_notes_embedding_idx'
  ) then
    execute 'create index jobs_notes_embedding_idx on jobs '
            'using ivfflat (notes_embedding vector_cosine_ops) with (lists = 100)';
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Semantic search RPC
-- ---------------------------------------------------------------------------
create or replace function match_videos(
  query_embedding vector(1536),
  match_threshold float default 0.3,
  match_count int default 10,
  p_user_id text default null
)
returns table (id uuid, video_title text, similarity float)
language sql stable as $$
  select
    jobs.id,
    jobs.video_title,
    1 - (jobs.notes_embedding <=> query_embedding) as similarity
  from jobs
  where jobs.user_id::text = p_user_id
    and jobs.status = 'complete'
    and jobs.notes_embedding is not null
    and 1 - (jobs.notes_embedding <=> query_embedding) > match_threshold
  order by jobs.notes_embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS for folders — each user can only see/manage their own folders.
--    The backend uses the SERVICE ROLE key which bypasses RLS; these
--    policies protect against direct client access with the anon key.
-- ---------------------------------------------------------------------------
alter table folders enable row level security;

drop policy if exists folders_select_own on folders;
create policy folders_select_own on folders
  for select using (auth.uid()::text = user_id);

drop policy if exists folders_insert_own on folders;
create policy folders_insert_own on folders
  for insert with check (auth.uid()::text = user_id);

drop policy if exists folders_update_own on folders;
create policy folders_update_own on folders
  for update using (auth.uid()::text = user_id)
              with check (auth.uid()::text = user_id);

drop policy if exists folders_delete_own on folders;
create policy folders_delete_own on folders
  for delete using (auth.uid()::text = user_id);
