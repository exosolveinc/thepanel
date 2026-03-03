/**
 * API client — all backend communication lives here.
 * Uses EventSource-compatible fetch for SSE streams.
 */
import { useAuthStore } from '../store/authStore'

const BASE = import.meta.env.VITE_API_URL || '/api'

function getAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

function handle401(res: Response) {
  if (res.status === 401) {
    useAuthStore.getState().logout()
    throw new Error('Session expired. Please log in again.')
  }
}

// ── Auth ─────────────────────────────────────────────────────────────

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; name: string } }> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Login failed' }))
    throw new Error(err.detail ?? 'Login failed')
  }
  return res.json()
}

// ── Session ──────────────────────────────────────────────────────────

export async function createSession(
  resumeFile: File | null,
  jobDescription: string,
  resumeId?: string,
  jdId?: string,
  folderId?: string,
  instructions?: string,
): Promise<string> {
  const form = new FormData()
  if (resumeFile) form.append('resume', resumeFile)
  if (resumeId) form.append('resume_id', resumeId)
  if (jdId) form.append('jd_id', jdId)
  if (folderId) form.append('folder_id', folderId)
  if (instructions) form.append('instructions', instructions)
  form.append('job_description', jobDescription)

  const res = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: form,
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(err.detail ?? 'Failed to create session')
  }
  const data = await res.json()
  return data.session_id as string
}

export interface SessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  message_type?: string | null
  mode?: string | null
  design_data?: Record<string, unknown> | null
  created_at: string
}

export interface SessionDetailResponse {
  session_id: string
  resume_id: string | null
  resume_tag: string | null
  jd_id: string | null
  jd_label: string | null
  folder_id: string | null
  messages: SessionMessage[]
}

export async function loadSession(sessionId: string): Promise<SessionDetailResponse> {
  const res = await fetch(`${BASE}/session/${sessionId}`, {
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to load session' }))
    throw new Error(err.detail ?? 'Failed to load session')
  }
  return res.json()
}

// ── Library types ────────────────────────────────────────────────────

export interface SavedResume {
  id: string
  tag: string
  file_name: string
  created_at: string
}

export interface SavedJD {
  id: string
  label: string
  text: string
  created_at: string
}

export interface SavedSession {
  id: string
  resume_id: string | null
  resume_tag: string | null
  jd_id: string | null
  jd_label: string | null
  question_count: number
  last_question: string | null
  created_at: string
  updated_at: string
}

export interface LibFolder {
  id: string
  name: string
  created_at: string
  updated_at: string
  resumes: SavedResume[]
  jds: SavedJD[]
  sessions: SavedSession[]
}

// ── Folders ─────────────────────────────────────────────────────────

export async function listFolders(): Promise<LibFolder[]> {
  const res = await fetch(`${BASE}/library/folders`, { headers: { ...getAuthHeaders() } })
  handle401(res)
  if (!res.ok) return []
  return res.json()
}

export async function createFolder(name: string): Promise<LibFolder> {
  const res = await fetch(`${BASE}/library/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name }),
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to create folder' }))
    throw new Error(err.detail ?? 'Failed to create folder')
  }
  return res.json()
}

export async function updateFolder(id: string, updates: { name?: string }): Promise<LibFolder> {
  const res = await fetch(`${BASE}/library/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(updates),
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to update folder' }))
    throw new Error(err.detail ?? 'Failed to update folder')
  }
  return res.json()
}

export async function deleteFolder(id: string): Promise<void> {
  const res = await fetch(`${BASE}/library/folders/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
}

// ── Sessions ────────────────────────────────────────────────────────

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${BASE}/library/sessions/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
}

export async function clearFolderSessions(folderId: string): Promise<void> {
  const res = await fetch(`${BASE}/library/folders/${folderId}/sessions`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
}

// ── Resumes ─────────────────────────────────────────────────────────

export async function uploadResume(file: File, tag: string, folderId: string): Promise<SavedResume> {
  const form = new FormData()
  form.append('file', file)
  form.append('tag', tag)
  form.append('folder_id', folderId)
  const res = await fetch(`${BASE}/library/resumes`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
    body: form,
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail ?? 'Upload failed')
  }
  return res.json()
}

export async function deleteResume(id: string): Promise<void> {
  const res = await fetch(`${BASE}/library/resumes/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
}

// ── Job Descriptions ────────────────────────────────────────────────

export async function saveJD(label: string, text: string, folderId: string): Promise<SavedJD> {
  const res = await fetch(`${BASE}/library/jds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ label, text, folder_id: folderId }),
  })
  handle401(res)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Save failed' }))
    throw new Error(err.detail ?? 'Save failed')
  }
  return res.json()
}

export async function deleteJD(id: string): Promise<void> {
  const res = await fetch(`${BASE}/library/jds/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  })
  handle401(res)
}

// ── SSE streaming ────────────────────────────────────────────────────

type SSEHandler = {
  onQuestionType?: (type: string) => void
  onDesign?: (design: unknown) => void
  onToken?: (text: string) => void
  onDone?: () => void
  onError?: (msg: string) => void
}

async function consumeSSE(
  url: string,
  body: object,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    handlers.onError?.('Network error')
    return
  }

  if (res.status === 401) {
    useAuthStore.getState().logout()
    handlers.onError?.('Session expired. Please log in again.')
    return
  }

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ detail: 'Stream failed' }))
    handlers.onError?.(err.detail ?? 'Stream failed')
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        if (!part.trim()) continue
        const lines = part.split('\n')
        let event = 'message'
        let data = ''

        for (const line of lines) {
          if (line.startsWith('event: ')) event = line.slice(7).trim()
          else if (line.startsWith('data: ')) data = line.slice(6)
        }

        try {
          if (event === 'question_type') {
            const parsed = JSON.parse(data)
            handlers.onQuestionType?.(parsed.type)
          } else if (event === 'design') {
            handlers.onDesign?.(JSON.parse(data))
          } else if (event === 'token') {
            const parsed = JSON.parse(data)
            handlers.onToken?.(parsed.text ?? '')
          } else if (event === 'done') {
            handlers.onDone?.()
          } else if (event === 'error') {
            const parsed = JSON.parse(data)
            handlers.onError?.(parsed.message ?? 'Unknown error')
          }
        } catch {
          // Partial JSON in buffer — handled by next iteration
        }
      }
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') throw e
    // Aborted — silently exit
  }
}

export async function askQuestion(
  sessionId: string,
  question: string,
  mode: 'quick' | 'long' | 'design',
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(`${BASE}/ask`, { session_id: sessionId, question, mode }, handlers, signal)
}

export async function requestDeepDive(
  sessionId: string,
  topic: string,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(`${BASE}/deep-dive`, { session_id: sessionId, topic }, handlers, signal)
}

export async function requestArchFlow(
  sessionId: string,
  question: string,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(`${BASE}/arch-flow`, { session_id: sessionId, question }, handlers, signal)
}

// ── Practice Interview ──────────────────────────────────────────────

export async function getPracticeQuestions(
  sessionId: string,
  count = 10,
  questionType: 'behavioral' | 'technical' | 'mixed' = 'mixed',
): Promise<{ id: string; question: string; difficulty: string; category: string }[]> {
  try {
    const res = await fetch(`${BASE}/practice/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ session_id: sessionId, count, question_type: questionType }),
    })
    handle401(res)
    const data = await res.json()
    return data.questions ?? []
  } catch {
    return []
  }
}

export async function evaluatePracticeAnswer(
  sessionId: string,
  question: string,
  answer: string,
  difficulty: string,
  handlers: SSEHandler,
) {
  await consumeSSE(`${BASE}/practice/evaluate`, { session_id: sessionId, question, answer, difficulty }, handlers)
}

export async function getPracticeSummary(
  sessionId: string,
  qaPairs: object[],
  handlers: SSEHandler,
) {
  await consumeSSE(`${BASE}/practice/summary`, { session_id: sessionId, qa_pairs: qaPairs }, handlers)
}

// ── Coding Practice ─────────────────────────────────────────────────

export interface CodeProblem {
  id: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  description: string
  examples: string[]
  constraints: string[]
  hint?: string
  expected_time?: string
  expected_space?: string
}

export async function getCodeProblem(sessionId: string, difficulty = 'easy'): Promise<CodeProblem | null> {
  try {
    const res = await fetch(`${BASE}/code-practice/problem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ session_id: sessionId, difficulty }),
    })
    handle401(res)
    const data = await res.json()
    return data.problem ?? null
  } catch {
    return null
  }
}

export async function evaluateCode(
  sessionId: string,
  problemTitle: string,
  problemDescription: string,
  code: string,
  language: string,
  handlers: SSEHandler,
) {
  await consumeSSE(`${BASE}/code-practice/evaluate`, {
    session_id: sessionId,
    problem_title: problemTitle,
    problem_description: problemDescription,
    code,
    language,
  }, handlers)
}

export async function drillComponent(
  sessionId: string,
  componentId: string,
  componentName: string,
  context: string,
  depth: number,
  handlers: SSEHandler,
) {
  await consumeSSE(`${BASE}/drill`, {
    session_id: sessionId,
    component_id: componentId,
    component_name: componentName,
    context,
    depth,
  }, handlers)
}
