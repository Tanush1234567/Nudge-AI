import {
  JobStatus,
  VideoNotes,
  Course,
  CourseWithLectures,
  PlaylistPreview,
  Syllabus,
  UrlClassification,
  ConceptGraph,
  LectureDiff,
  ExamGuide,
} from './types';
import { getSupabaseClient } from './supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:7860';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function getSession() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token ?? null;
}

// Single-attempt fetch — wrapped by `request()` which adds an automatic
// retry on transient failures.
async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const response = await fetch(url, { ...init, headers });

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.detail || errorMessage;
      } catch {
        // Fallback to statusText if JSON parsing fails
      }
      throw new ApiError(response.status, errorMessage);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, error instanceof Error ? error.message : 'Unknown network error');
  }
}

// True for transient failures worth retrying once.
function _isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0 || err.status === 500) return true; // network / generic server
  if (err.status === 502 || err.status === 503 || err.status === 504) return true;
  return false;
}

// Exponential backoff delays between retry attempts. Three attempts gives
// ~5 seconds total runway, which covers most transient network blips
// (WiFi reconnect, VPN flip, ERR_NETWORK_CHANGED).
const _RETRY_DELAYS_MS = [400, 1200, 2800];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  // Only auto-retry idempotent reads. POST/PATCH/DELETE could double-fire.
  const canRetry = method === 'GET';

  let lastErr: unknown;
  const maxAttempts = canRetry ? _RETRY_DELAYS_MS.length + 1 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await rawRequest<T>(path, init);
    } catch (err) {
      lastErr = err;
      if (!canRetry || !_isTransient(err) || attempt === maxAttempts - 1) break;
      // If the browser thinks we're offline, wait for it to come back before
      // burning a retry attempt on a guaranteed-to-fail fetch.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await _waitForOnline(8000);
      } else {
        await new Promise((r) => setTimeout(r, _RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  console.warn('[api] all attempts failed for', method, path, lastErr);
  throw lastErr;
}

// Resolves the moment the browser reports it's back online, or after `cap`ms.
function _waitForOnline(cap: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || navigator.onLine) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('online', finish);
      resolve();
    };
    window.addEventListener('online', finish);
    setTimeout(finish, cap);
  });
}

export const startAnalysis = (url: string) =>
  request<{ job_id: string }>('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

export const getJobStatus = (jobId: string) =>
  request<JobStatus>(`/api/status/${jobId}`);

export const getNotes = (jobId: string) =>
  request<VideoNotes>(`/api/notes/${jobId}`);

export const listJobs = () =>
  request<any[]>('/api/jobs');

export interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  video_count: number;
}

export const getCurrentUser = () => request<CurrentUser>('/api/user');

// --- workspace: folders + search -----------------------------------------

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string | null;
  video_count: number;
}

export const listFolders = () => request<FolderItem[]>('/api/folders');

export const createFolder = (name: string, parent_id: string | null = null) =>
  request<FolderItem>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name, parent_id }),
  });

export const deleteFolder = (id: string) =>
  request<{ deleted: boolean }>(`/api/folders/${id}`, { method: 'DELETE' });

export const moveJobToFolder = (jobId: string, folder_id: string | null) =>
  request<{ id: string; folder_id: string | null }>(
    `/api/jobs/${jobId}/folder`,
    { method: 'PATCH', body: JSON.stringify({ folder_id }) },
  );

export interface SearchResult {
  id: string;
  title: string;
  channel: string | null;
  thumbnail_url: string | null;
  similarity: number;
  snippet: string;
  course_id: string | null;
  course_title: string | null;
  lecture_number: number | null;
}

export interface SearchResponse {
  query: string;
  scope: 'all' | 'course';
  course_id: string | null;
  results: SearchResult[];
}

export const searchVideos = (
  q: string,
  opts?: { scope?: 'all' | 'course'; courseId?: string },
) => {
  const params = new URLSearchParams({ q });
  if (opts?.scope) params.set('scope', opts.scope);
  if (opts?.courseId) params.set('courseId', opts.courseId);
  return request<SearchResponse>(`/api/search?${params.toString()}`);
};

// --- courses --------------------------------------------------------------

export const classifyUrl = (url: string) =>
  request<UrlClassification>('/api/classify-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

export const listCourses = () => request<Course[]>('/api/courses');

export const getCourse = (courseId: string) =>
  request<CourseWithLectures>(`/api/courses/${courseId}`);

export const createCourse = (url: string) =>
  request<PlaylistPreview>('/api/courses', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

export const processCourse = (courseId: string) =>
  request<{ course_id: string; started: boolean }>(
    `/api/courses/${courseId}/process`,
    { method: 'POST' },
  );

export const deleteCourse = (courseId: string) =>
  request<{ deleted: boolean }>(`/api/courses/${courseId}`, { method: 'DELETE' });

export const getCourseSyllabus = (courseId: string) =>
  request<{ course_id: string; syllabus: Syllabus; master_equations: any[] }>(
    `/api/courses/${courseId}/syllabus`,
  );

export const generateSyllabus = (courseId: string) =>
  request<{ course_id: string; syllabus: Syllabus }>(
    `/api/courses/${courseId}/generate-syllabus`,
    { method: 'POST' },
  );

export const generateExamGuide = (courseId: string) =>
  request<{ course_id: string; exam_guide: ExamGuide }>(
    `/api/courses/${courseId}/generate-exam-guide`,
    { method: 'POST' },
  );

export const getExamGuide = (courseId: string) =>
  request<{ course_id: string; exam_guide: ExamGuide }>(
    `/api/courses/${courseId}/exam-guide`,
  );

export const getCourseConcepts = (courseId: string) =>
  request<ConceptGraph>(`/api/courses/${courseId}/concepts`);

export const generateCourseConcepts = (courseId: string) =>
  request<ConceptGraph>(`/api/courses/${courseId}/generate-concepts`, { method: 'POST' });

export const getLectureDiff = (courseId: string, lectureNumber: number) =>
  request<LectureDiff>(`/api/courses/${courseId}/lectures/${lectureNumber}/diff`);

