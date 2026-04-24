/**
 * API client — all backend communication lives here.
 * Uses fetch + ReadableStream for SSE consumption.
 */

const BASE = '/api'

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  detail?: string
  message?: string
  code?: string
}

function statusToMessage(status: number, fallback: string): string {
  switch (status) {
    case 400: return fallback || 'Bad request.'
    case 401: return 'Authentication required.'
    case 403: return 'Forbidden.'
    case 404: return fallback || 'Not found — your session may have expired. Please restart.'
    case 408: return 'Request timed out.'
    case 413: return 'Payload too large.'
    case 422: return fallback || 'Invalid input.'
    case 429: return 'Rate limited — please slow down.'
    case 502:
    case 503:
    case 504: return 'Backend unavailable — try again in a moment.'
  }
  if (status >= 500) return 'Server error — try again.'
  return fallback || `Request failed (HTTP ${status}).`
}

export async function createSession(resumeFile: File, jobDescription: string): Promise<string> {
  const form = new FormData()
  form.append('resume', resumeFile)
  form.append('job_description', jobDescription)

  const res = await fetch(`${BASE}/session`, { method: 'POST', body: form })
  if (!res.ok) {
    const err: ErrorBody = await res.json().catch(() => ({}))
    throw new ApiError(statusToMessage(res.status, err.detail ?? ''), res.status, err.code)
  }
  const data = await res.json() as { session_id?: string }
  if (!data.session_id) throw new ApiError('Backend did not return a session_id.', 500)
  return data.session_id
}

type SSEHandler = {
  onQuestionType?: (type: string) => void
  onDesign?: (design: unknown) => void
  onSection?: (name: string) => void
  onToken?: (text: string, section?: string) => void
  onDone?: () => void
  onError?: (msg: string) => void
}

async function consumeSSE(
  url: string,
  body: object,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  let terminated = false
  const fireError = (msg: string) => {
    if (terminated) return
    terminated = true
    handlers.onError?.(msg)
  }
  const fireDone = () => {
    if (terminated) return
    terminated = true
    handlers.onDone?.()
  }

  let res: Response
  const timeout = AbortSignal.timeout(30_000)
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: combinedSignal,
    })
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      // Caller-initiated abort: stay silent. Otherwise it's the 30s timeout.
      if (signal?.aborted) {
        terminated = true
        return
      }
      fireError('Request timed out — backend may be down.')
      return
    }
    fireError('Network error — check your connection.')
    return
  }

  if (!res.ok || !res.body) {
    const err: ErrorBody = await res.json().catch(() => ({}))
    fireError(statusToMessage(res.status, err.detail ?? err.message ?? ''))
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
            const parsed = JSON.parse(data) as { type?: string }
            if (parsed.type) handlers.onQuestionType?.(parsed.type)
          } else if (event === 'design') {
            handlers.onDesign?.(JSON.parse(data))
          } else if (event === 'section') {
            const parsed = JSON.parse(data) as { name?: string }
            if (parsed.name) handlers.onSection?.(parsed.name)
          } else if (event === 'token') {
            const parsed = JSON.parse(data) as { text?: string; section?: string }
            handlers.onToken?.(parsed.text ?? '', parsed.section)
          } else if (event === 'done') {
            fireDone()
          } else if (event === 'error') {
            const parsed = JSON.parse(data) as ErrorBody
            fireError(parsed.message ?? parsed.detail ?? 'Unknown error.')
          }
        } catch (parseErr) {
          // Log but don't surface — partial frames are expected mid-stream.
          console.warn('[SSE] event parse skipped', { event, data, parseErr })
        }
      }
    }
    fireDone()
  } catch (e) {
    const err = e as Error
    if (err.name === 'AbortError') {
      terminated = true
      return
    }
    fireError(`Stream interrupted: ${err.message}`)
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

// ── Hiring Manager Mode ──────────────────────────────────────────────

export async function getHMShortcuts(
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ key: string; label: string; question: string }[]> {
  try {
    const res = await fetch(`${BASE}/hm/shortcuts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
      signal,
    })
    if (!res.ok) return []
    const data = await res.json() as { shortcuts?: unknown }
    return Array.isArray(data.shortcuts) ? data.shortcuts as { key: string; label: string; question: string }[] : []
  } catch {
    return []
  }
}

export async function hmAsk(
  sessionId: string,
  question: string,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(`${BASE}/hm/ask`, { session_id: sessionId, question, mode: 'quick' }, handlers, signal)
}

// ── Global Project Doc Store ─────────────────────────────────────────

export async function uploadProjectDoc(
  file: File,
  signal?: AbortSignal,
): Promise<{ doc_id: string; filename: string; char_count: number; chunks: number; existed: boolean }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/hm/docs/upload`, { method: 'POST', body: form, signal })
  if (!res.ok) {
    const err: ErrorBody = await res.json().catch(() => ({}))
    throw new ApiError(statusToMessage(res.status, err.detail ?? 'Upload failed'), res.status, err.code)
  }
  return res.json()
}

export async function listProjectDocs(
  signal?: AbortSignal,
): Promise<{ doc_id: string; filename: string; created_at: string }[]> {
  try {
    const res = await fetch(`${BASE}/hm/docs/list`, { signal })
    if (!res.ok) return []
    const data = await res.json() as { docs?: unknown }
    return Array.isArray(data.docs) ? data.docs as { doc_id: string; filename: string; created_at: string }[] : []
  } catch {
    return []
  }
}

export async function deleteProjectDoc(docId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/hm/docs/${docId}`, { method: 'DELETE', signal })
  if (!res.ok) {
    const err: ErrorBody = await res.json().catch(() => ({}))
    throw new ApiError(statusToMessage(res.status, err.detail ?? 'Delete failed'), res.status, err.code)
  }
}

/** Live voice panel — bypasses question classifier for immediate first token. */
export async function liveAsk(
  sessionId: string,
  question: string,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(`${BASE}/live-ask`, { session_id: sessionId, question, mode: 'quick' }, handlers, signal)
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
  signal?: AbortSignal,
): Promise<{ id: string; question: string; difficulty: string; category: string }[]> {
  try {
    const res = await fetch(`${BASE}/practice/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, count, question_type: questionType }),
      signal,
    })
    if (!res.ok) return []
    const data = await res.json() as { questions?: unknown }
    return Array.isArray(data.questions)
      ? data.questions as { id: string; question: string; difficulty: string; category: string }[]
      : []
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
  signal?: AbortSignal,
) {
  await consumeSSE(
    `${BASE}/practice/evaluate`,
    { session_id: sessionId, question, answer, difficulty },
    handlers,
    signal,
  )
}

export async function getPracticeSummary(
  sessionId: string,
  qaPairs: object[],
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(
    `${BASE}/practice/summary`,
    { session_id: sessionId, qa_pairs: qaPairs },
    handlers,
    signal,
  )
}

// ── Coding Practice ─────────────────────────────────────────────────

export async function getCodeProblem(
  sessionId: string,
  difficulty = 'easy',
  signal?: AbortSignal,
): Promise<object | null> {
  try {
    const res = await fetch(`${BASE}/code-practice/problem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, difficulty }),
      signal,
    })
    if (!res.ok) return null
    const data = await res.json() as { problem?: unknown }
    return (data.problem && typeof data.problem === 'object') ? data.problem as object : null
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
  signal?: AbortSignal,
) {
  await consumeSSE(
    `${BASE}/code-practice/evaluate`,
    {
      session_id: sessionId,
      problem_title: problemTitle,
      problem_description: problemDescription,
      code,
      language,
    },
    handlers,
    signal,
  )
}

export async function getFollowUps(
  sessionId: string,
  question: string,
  answer: string,
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, question, answer }),
      signal,
    })
    if (!res.ok) return []
    const data = await res.json() as { questions?: unknown }
    return Array.isArray(data.questions) ? data.questions.filter((q): q is string => typeof q === 'string') : []
  } catch {
    return []
  }
}

export async function drillComponent(
  sessionId: string,
  componentId: string,
  componentName: string,
  context: string,
  depth: number,
  handlers: SSEHandler,
  signal?: AbortSignal,
) {
  await consumeSSE(
    `${BASE}/drill`,
    {
      session_id: sessionId,
      component_id: componentId,
      component_name: componentName,
      context,
      depth,
    },
    handlers,
    signal,
  )
}
