/**
 * API client — all backend communication lives here.
 * Uses EventSource-compatible fetch for SSE streams.
 */

const BASE = '/api'

export async function createSession(resumeFile: File, jobDescription: string): Promise<string> {
  const form = new FormData()
  form.append('resume', resumeFile)
  form.append('job_description', jobDescription)

  const res = await fetch(`${BASE}/session`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(err.detail ?? 'Failed to create session')
  }
  const data = await res.json()
  return data.session_id as string
}

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    handlers.onError?.('Network error')
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, count, question_type: questionType }),
    })
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

export async function getCodeProblem(sessionId: string, difficulty = 'easy'): Promise<object | null> {
  try {
    const res = await fetch(`${BASE}/code-practice/problem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, difficulty }),
    })
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
