/**
 * localStorage utilities for persisting resumes, job descriptions, and session history.
 */

export interface SavedResume {
  id: string
  tag: string        // user label e.g. "IBM SWE resume"
  fileName: string
  sizeKB: number
  data: string       // base64-encoded PDF (data URL)
  createdAt: string
}

export interface SavedJD {
  id: string
  label: string      // user label e.g. "Google Staff SWE"
  text: string
  createdAt: string
}

export interface SessionRecord {
  id: string         // backend session_id
  date: string
  resumeId: string
  resumeTag: string
  jdId: string
  jdLabel: string
  questionCount: number
  lastQuestion: string
}

const KEYS = {
  RESUMES:  'panel:resumes',
  JDS:      'panel:jds',
  SESSIONS: 'panel:sessions',
} as const

const uid = () => Math.random().toString(36).slice(2)

/* ── Resumes ─────────────────────────────────────────────── */

export function getResumes(): SavedResume[] {
  try { return JSON.parse(localStorage.getItem(KEYS.RESUMES) ?? '[]') } catch { return [] }
}

export function saveResume(file: File, tag: string): Promise<SavedResume> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const resume: SavedResume = {
        id: uid(), tag, fileName: file.name,
        sizeKB: Math.round(file.size / 1024),
        data: reader.result as string,
        createdAt: new Date().toISOString(),
      }
      const all = getResumes().filter(r => r.id !== resume.id)
      all.unshift(resume)
      try {
        localStorage.setItem(KEYS.RESUMES, JSON.stringify(all.slice(0, 5)))
      } catch {
        // Storage full — replace oldest
        localStorage.setItem(KEYS.RESUMES, JSON.stringify([resume]))
      }
      resolve(resume)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function deleteResume(id: string) {
  localStorage.setItem(KEYS.RESUMES, JSON.stringify(getResumes().filter(r => r.id !== id)))
}

export function resumeToFile(saved: SavedResume): File {
  const [meta, b64] = saved.data.split(',')
  const mime = meta.match(/:(.*?);/)?.[1] ?? 'application/pdf'
  const bstr = atob(b64)
  const u8 = new Uint8Array(bstr.length)
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i)
  return new File([u8], saved.fileName, { type: mime })
}

/* ── Job descriptions ─────────────────────────────────────── */

export function getJDs(): SavedJD[] {
  try { return JSON.parse(localStorage.getItem(KEYS.JDS) ?? '[]') } catch { return [] }
}

export function saveJD(text: string, label: string): SavedJD {
  const jd: SavedJD = { id: uid(), label, text, createdAt: new Date().toISOString() }
  const all = getJDs()
  all.unshift(jd)
  try { localStorage.setItem(KEYS.JDS, JSON.stringify(all.slice(0, 20))) } catch { /* ignore */ }
  return jd
}

export function deleteJD(id: string) {
  localStorage.setItem(KEYS.JDS, JSON.stringify(getJDs().filter(j => j.id !== id)))
}

/* ── Sessions ─────────────────────────────────────────────── */

export function getSessions(): SessionRecord[] {
  try { return JSON.parse(localStorage.getItem(KEYS.SESSIONS) ?? '[]') } catch { return [] }
}

export function recordSession(record: Omit<SessionRecord, 'date'>) {
  const entry: SessionRecord = { ...record, date: new Date().toISOString() }
  const all = getSessions().filter(s => s.id !== record.id)
  all.unshift(entry)
  try { localStorage.setItem(KEYS.SESSIONS, JSON.stringify(all.slice(0, 30))) } catch { /* ignore */ }
}

export function deleteSessionRecord(id: string) {
  localStorage.setItem(KEYS.SESSIONS, JSON.stringify(getSessions().filter(s => s.id !== id)))
}

export function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
