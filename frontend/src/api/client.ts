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
