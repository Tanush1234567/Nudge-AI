export interface JobStatus {
  job_id: string;
  status: 'queued' | 'downloading' | 'capturing' | 'reading' | 'transcribing' | 'writing' | 'complete' | 'error';
  progress: number;
  stage_detail: string | null;
  frames_found: number;
  video_title: string | null;
  video_channel: string | null;
  video_duration: number | null;
  error_message: string | null;
}

export interface JobListItem {
  id: string;
  url: string;
  youtube_id: string;
  title: string;
  channel: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  status: 'queued' | 'downloading' | 'capturing' | 'reading' | 'transcribing' | 'writing' | 'complete' | 'error';
  progress: number;
  stage_detail?: string | null;
  created_at: string;
  completed_at?: string | null;
  folder?: string | null;
  folder_id?: string | null;
  error_message?: string | null;
}

export interface ContentClassification {
  format?: string;
  domain?: string;
  formality?: string;
  has_equations?: boolean;
  has_code?: boolean;
  has_worked_examples?: boolean;
  speaker_style?: string;
  key_terminology?: string[];
  reasoning?: string;
}

export interface VideoNotes {
  job_id: string;
  video: {
    title: string;
    channel: string;
    duration_seconds: number;
    thumbnail_url: string;
    youtube_id: string;
  };
  stats: {
    frames_captured: number;
    diagrams_generated: number;
    code_blocks_extracted: number;
    equations_extracted: number;
  };
  summary: string;
  topics: string[];
  sections: NoteSection[];
  content_classification?: ContentClassification;
}

export interface NoteSection {
  number: number;
  title: string;
  timestamp_seconds: number;
  content_html: string;
  key_takeaway: string;
  visuals: Visual[];
}

export type Visual =
  | { type: 'captured_frame'; frame_index: number; timestamp_seconds?: number; timestamp_str?: string; image_url: string; caption?: string; }
  | { type: 'ai_diagram'; mermaid?: string; description?: string; diagram_type?: string; caption?: string; }
  | { type: 'code_block'; language: string; code: string; caption?: string; explanation?: string; }
  | { type: 'equation'; latex: string; caption?: string; explanation?: string; };

// ─── Courses ────────────────────────────────────────────────────────────────

export type CourseStatus = 'processing' | 'partial' | 'complete' | 'failed';

export interface Course {
  id: string;
  title: string;
  description: string | null;
  source_url: string;
  platform?: string | null;
  thumbnail_url: string | null;
  total_videos: number;
  processed_videos: number;
  status: CourseStatus;
  created_at: string;
  updated_at?: string;
}

export interface CourseLecture {
  job_id: string;
  lecture_number: number;
  title: string;
  channel?: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  status: string;
  progress?: number;
  key_takeaway: string | null;
  first_equation: string | null;
}

export interface CourseWithLectures extends Course {
  has_syllabus?: boolean;
  has_exam_guide?: boolean;
  lectures: CourseLecture[];
}

export interface MasterEquation {
  latex: string;
  name: string;
  lecture: number;
  timestamp?: string;
  topic: string;
}

export interface SyllabusTopic {
  title: string;
  lectures: number[];
  equations: string[];
  concepts: string[];
  prerequisites: string[];
}

export interface Syllabus {
  overview: string;
  topics: SyllabusTopic[];
  master_equations: MasterEquation[];
}

// Playlist preview returned by POST /api/courses (and used by the modal
// before the user confirms — `videos` carries the entries the user will
// optionally deselect).
export interface PlaylistPreviewVideo {
  lecture_number?: number;
  job_id?: string;
  title: string;
  duration?: number | null;
  thumbnail?: string | null;
  url: string;
}

export interface PlaylistPreview {
  course_id?: string;
  title: string;
  description: string | null;
  thumbnail: string | null;
  total_videos: number;
  total_duration_seconds: number;
  videos: PlaylistPreviewVideo[];
}

export interface UrlClassification {
  type: 'playlist' | 'video_in_playlist' | 'single_video' | 'unknown';
  url?: string;
  video_url?: string;
  playlist_url?: string | null;
}

// ─── Concept tracking ──────────────────────────────────────────────────────

export interface ConceptAppearance {
  lecture: number;
  timestamp: string;
  context: 'definition' | 'application' | 'review';
  section_title: string;
  equation?: string | null;
}

export interface ConceptData {
  id: string;
  name: string;
  first_appearance: { lecture: number; timestamp: string };
  appearances: ConceptAppearance[];
  leads_to: string[];
  depends_on: string[];
  total_appearances: number;
}

export interface ConceptPrerequisite {
  from: string;
  from_name?: string;
  to: string;
  to_name?: string;
  lectures: number[];
}

export interface ConceptGraph {
  course_id?: string;
  concepts: ConceptData[];
  prerequisites: ConceptPrerequisite[];
}

export interface LectureDiff {
  lecture_number: number;
  new_concepts: { name: string; section: string; equation?: string | null }[];
  review_concepts: { name: string; first_seen: string; section: string }[];
  applied_concepts: { name: string; first_seen: string; new_context: string }[];
  key_connection: string;
}

// ─── Exam study guide ──────────────────────────────────────────────────────

export type ExamImportance = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ExamTopicEquation {
  latex: string;
  description: string;
}

export interface ExamTopic {
  title: string;
  importance: ExamImportance;
  equations: ExamTopicEquation[];
  explanation: string;
  best_source: { lecture: number; timestamp: string };
  exam_patterns: string[];
  connections: string[];
}

export interface MasterEquationDetail {
  latex: string;
  variables: string;
  when_to_use: string;
  lecture: number;
  timestamp: string;
  topic: string;
}

export interface QuickReference {
  definitions: { term: string; definition: string }[];
  theorems: { name: string; statement: string; proof_ref: string }[];
  common_mistakes: string[];
  patterns: { if_you_see: string; use: string }[];
}

export interface ExamGuide {
  overview: string;
  topics: ExamTopic[];
  master_equations: MasterEquationDetail[];
  quick_reference: QuickReference;
}
