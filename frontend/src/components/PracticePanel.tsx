/**
 * PracticePanel — mock interview practice tab.
 * Accepts questionType: 'behavioral' | 'technical' to run typed sessions.
 * Left: voice Q&A + streaming evaluation.
 * Right: live score sidebar with running avg, verdict, per-Q bars, key notes.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Mic, MicOff, ChevronRight, RotateCcw, Loader2,
  CheckCircle, Volume2, VolumeX, BarChart2, AlertCircle,
  Brain, Code2,
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { getPracticeQuestions, evaluatePracticeAnswer, getPracticeSummary } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

interface PracticePanelProps {
  questionType: 'behavioral' | 'technical'
}

interface Question {
  id: string
  question: string
  difficulty: 'easy' | 'medium' | 'hard'
  category: string
}

interface QAPair {
  question: Question
  answer: string
  evaluation: string
  score: number | null
  evaluating: boolean
}

type Phase = 'idle' | 'loading' | 'answering' | 'evaluating' | 'summary'

const DIFF_COLOR = {
  easy:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  hard:   'text-red-400 bg-red-400/10 border-red-400/20',
}

const CAT_LABEL: Record<string, string> = {
  behavioral: 'Behavioral', technical: 'Technical',
  'system-design': 'System Design', 'problem-solving': 'Problem Solving',
}

function extractScore(text: string): number | null {
  const m = text.match(/(\d+)\s*\/\s*10/)
  if (m) {
    const n = parseInt(m[1])
    return n >= 0 && n <= 10 ? n : null
  }
  return null
}

function extractBullets(text: string, header: string): string[] {
  const re = new RegExp(`##\\s*${header}[\\s\\S]*?\\n([\\s\\S]*?)(?=\\n##|$)`, 'i')
  const m = text.match(re)
  if (!m) return []
  return m[1]
    .split('\n')
    .filter(l => /^[•\-\*]/.test(l.trim()))
    .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 2)
}

function getVerdict(avg: number): { label: string; color: string; bg: string } {
  if (avg >= 8)   return { label: 'Strong Hire', color: 'text-emerald-300', bg: 'bg-emerald-500/10 border-emerald-500/25' }
  if (avg >= 6.5) return { label: 'Hire',        color: 'text-cyan-300',    bg: 'bg-cyan-500/10 border-cyan-500/25' }
  if (avg >= 5)   return { label: 'Maybe',       color: 'text-amber-300',   bg: 'bg-amber-500/10 border-amber-500/25' }
  return                  { label: 'Not Yet',    color: 'text-red-300',     bg: 'bg-red-500/10 border-red-500/25' }
}

/* ── Score sidebar ───────────────────────────────────────────────── */

function ScoreSidebar({
  pairs,
  liveScore,
  totalQ,
  questionType,
}: {
  pairs: QAPair[]
  liveScore: number | null
  totalQ: number
  questionType: 'behavioral' | 'technical'
}) {
  const scores = pairs.map(p => p.score).filter((s): s is number => s !== null)
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  const verdict = avg !== null ? getVerdict(avg) : null

  // Extract notes from most recent completed evaluation
  const lastCompleted = [...pairs].reverse().find(p => p.evaluation && p.score !== null)
  const strengths = lastCompleted ? extractBullets(lastCompleted.evaluation, 'What landed well') : []
  const gaps      = lastCompleted ? extractBullets(lastCompleted.evaluation, 'What was missing') : []

  const accentColor = questionType === 'behavioral' ? 'bg-violet-500' : 'bg-indigo-500'
  const accentDim   = questionType === 'behavioral' ? 'bg-violet-500/20' : 'bg-indigo-500/20'

  return (
    <div className="w-[200px] shrink-0 border-l border-zinc-800/60 flex flex-col overflow-y-auto bg-zinc-950/60">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/50">
        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3">
          Interviewer's View
        </p>

        {/* Average score */}
        <div className="text-center mb-3">
          <p className={clsx(
            'text-[28px] font-black leading-none',
            avg === null ? 'text-zinc-700' :
            avg >= 7 ? 'text-emerald-400' :
            avg >= 5 ? 'text-amber-400' : 'text-red-400',
          )}>
            {avg !== null ? avg.toFixed(1) : '—'}
          </p>
          <p className="text-[9px] text-zinc-600 mt-0.5">avg / 10</p>
        </div>

        {/* Verdict badge */}
        {verdict && (
          <div className={clsx(
            'text-center text-[10px] font-bold py-1 px-2 rounded-lg border',
            verdict.color, verdict.bg,
          )}>
            {verdict.label}
          </div>
        )}
        {!verdict && (
          <div className="text-center text-[10px] text-zinc-700 py-1 px-2 rounded-lg border border-zinc-800">
            Pending…
          </div>
        )}

        {/* Lively score if currently evaluating */}
        {liveScore !== null && (
          <div className="mt-2 text-center">
            <p className="text-[9px] text-zinc-600">Current Q (live)</p>
            <p className={clsx(
              'text-[14px] font-bold',
              liveScore >= 7 ? 'text-emerald-400' :
              liveScore >= 5 ? 'text-amber-400' : 'text-red-400',
            )}>
              {liveScore}/10
            </p>
          </div>
        )}
      </div>

      {/* Per-question scores */}
      {totalQ > 0 && (
        <div className="px-4 py-3 border-b border-zinc-800/50 space-y-2">
          <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Questions</p>
          {Array.from({ length: totalQ }).map((_, i) => {
            const pair = pairs[i]
            const score = pair?.score ?? null
            const pct = score !== null ? (score / 10) * 100 : 0
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-zinc-600">Q{i + 1}</span>
                  <span className={clsx(
                    'text-[9px] font-bold',
                    score === null ? 'text-zinc-700' :
                    score >= 7 ? 'text-emerald-400' :
                    score >= 5 ? 'text-amber-400' : 'text-red-400',
                  )}>
                    {score !== null ? `${score}/10` : '—'}
                  </span>
                </div>
                <div className={clsx('h-1 rounded-full', accentDim)}>
                  <div
                    className={clsx('h-full rounded-full transition-all duration-500', accentColor)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Key notes */}
      {(strengths.length > 0 || gaps.length > 0) && (
        <div className="px-4 py-3 space-y-3">
          <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Latest Notes</p>
          {strengths.length > 0 && (
            <div className="space-y-1">
              {strengths.map((s, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-emerald-500 text-[9px] mt-0.5 shrink-0">✓</span>
                  <p className="text-[9px] text-zinc-400 leading-tight">{s}</p>
                </div>
              ))}
            </div>
          )}
          {gaps.length > 0 && (
            <div className="space-y-1">
              {gaps.map((g, i) => (
                <div key={i} className="flex gap-1.5">
                  <span className="text-red-500 text-[9px] mt-0.5 shrink-0">✗</span>
                  <p className="text-[9px] text-zinc-400 leading-tight">{g}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */

export default function PracticePanel({ questionType }: PracticePanelProps) {
  const { sessionId } = useSessionStore()

  const [phase, setPhase]           = useState<Phase>('idle')
  const [questions, setQuestions]   = useState<Question[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [pairs, setPairs]           = useState<QAPair[]>([])
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim]       = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [audioActive, setAudioActive] = useState(false)
  const [evalContent, setEvalContent] = useState('')
  const [summaryContent, setSummaryContent] = useState('')
  const [error, setError]           = useState('')
  const [loadingMsg, setLoadingMsg] = useState('')

  const recogRef     = useRef<SpeechRecognition | null>(null)
  const shouldRunRef = useRef(false)
  const evalRef      = useRef<HTMLDivElement>(null)

  const isBehavioral = questionType === 'behavioral'
  const accentClass  = isBehavioral ? 'text-violet-400' : 'text-indigo-400'
  const btnActive    = isBehavioral
    ? 'bg-violet-600 hover:bg-violet-500'
    : 'bg-indigo-600 hover:bg-indigo-500'
  const progressColor = isBehavioral ? 'bg-violet-500/60' : 'bg-indigo-500/60'
  const spinnerColor  = isBehavioral ? 'text-violet-400' : 'text-indigo-400'
  const cursorColor   = isBehavioral ? 'bg-violet-400' : 'bg-indigo-400'

  useEffect(() => {
    if (evalRef.current) evalRef.current.scrollTop = evalRef.current.scrollHeight
  }, [evalContent, summaryContent])

  useEffect(() => () => {
    shouldRunRef.current = false
    try { recogRef.current?.abort() } catch { /* ignore */ }
  }, [])

  /* ── Speech recognition ───────────────────────────────────── */
  const startRecognition = useCallback(() => {
    if (!shouldRunRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('Speech recognition requires Chrome or Edge.'); return }

    try { recogRef.current?.abort() } catch { /* ignore */ }

    const rec = new SR()
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
    recogRef.current = rec

    rec.onaudiostart = () => setAudioActive(true)
    rec.onaudioend   = () => setAudioActive(false)

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let it = '', ft = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) ft += r[0].transcript
        else           it += r[0].transcript
      }
      setInterim(it)
      if (ft.trim()) {
        setTranscript(prev => (prev ? prev + ' ' : '') + ft.trim())
        setInterim('')
      }
    }

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      if (e.error === 'not-allowed') {
        setError('Microphone access denied.')
        shouldRunRef.current = false; setIsRecording(false)
      }
    }

    rec.onend = () => {
      setAudioActive(false)
      if (shouldRunRef.current) setTimeout(startRecognition, 300)
      else { setIsRecording(false); setInterim('') }
    }

    try { rec.start() } catch { if (shouldRunRef.current) setTimeout(startRecognition, 500) }
  }, [])

  const toggleRecording = () => {
    if (isRecording) {
      shouldRunRef.current = false
      try { recogRef.current?.abort() } catch { /* ignore */ }
      setIsRecording(false); setInterim(''); setAudioActive(false)
    } else {
      setError('')
      shouldRunRef.current = true; setIsRecording(true)
      startRecognition()
    }
  }

  const stopRecording = () => {
    shouldRunRef.current = false
    try { recogRef.current?.abort() } catch { /* ignore */ }
    setIsRecording(false); setInterim(''); setAudioActive(false)
  }

  /* ── Session flow ─────────────────────────────────────────── */
  const startSession = async () => {
    if (!sessionId) { setError('No session. Upload resume + JD first.'); return }
    setError('')
    setPhase('loading')
    setLoadingMsg('Generating personalized questions…')
    setPairs([]); setCurrentIdx(0); setSummaryContent(''); setTranscript(''); setEvalContent('')

    const qs = await getPracticeQuestions(sessionId, 10, questionType)
    if (!qs.length) { setError('Failed to generate questions. Try again.'); setPhase('idle'); return }

    setQuestions(qs)
    setPhase('answering')
  }

  const submitAnswer = async () => {
    if (!sessionId) return
    const combined = transcript + (interim ? ' ' + interim : '')
    if (!combined.trim()) { setError('Please record or type your answer first.'); return }

    stopRecording()
    setError('')
    setPhase('evaluating')
    setEvalContent('')

    const q = questions[currentIdx]
    const finalAnswer = combined.trim()

    await evaluatePracticeAnswer(sessionId, q.question, finalAnswer, q.difficulty, {
      onToken: t => setEvalContent(prev => prev + t),
      onDone: () => {
        setEvalContent(prev => {
          const score = extractScore(prev)
          setPairs(p => [...p, {
            question: q,
            answer: finalAnswer,
            evaluation: prev,
            score,
            evaluating: false,
          }])
          return prev
        })
      },
      onError: msg => {
        setPairs(p => [...p, {
          question: q, answer: finalAnswer,
          evaluation: `⚠ ${msg}`, score: null, evaluating: false,
        }])
        nextQuestion()
      },
    })
  }

  const nextQuestion = () => {
    const next = currentIdx + 1
    if (next >= questions.length) {
      finishSession()
    } else {
      setCurrentIdx(next)
      setTranscript(''); setInterim(''); setEvalContent('')
      setPhase('answering')
    }
  }

  const finishSession = async () => {
    if (!sessionId) return
    setPhase('loading')
    setLoadingMsg('Generating your performance report…')
    setSummaryContent('')

    const qaPairs = pairs.map(p => ({
      question: p.question.question,
      difficulty: p.question.difficulty,
      answer: p.answer,
      score: p.score,
    }))

    await getPracticeSummary(sessionId, qaPairs, {
      onToken: t => setSummaryContent(prev => prev + t),
      onDone: () => setPhase('summary'),
      onError: msg => { setSummaryContent(`⚠ ${msg}`); setPhase('summary') },
    })
  }

  const reset = () => {
    stopRecording()
    setPhase('idle'); setQuestions([]); setCurrentIdx(0); setPairs([])
    setTranscript(''); setInterim(''); setEvalContent(''); setSummaryContent(''); setError('')
  }

  /* ── Derived ──────────────────────────────────────────────── */
  const currentQ  = questions[currentIdx]
  const progress  = questions.length ? (currentIdx / questions.length) * 100 : 0
  const liveScore = phase === 'evaluating' ? extractScore(evalContent) : null
  const showSidebar = phase !== 'idle'

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">

      {/* Header */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-3">
          {isBehavioral
            ? <Brain size={13} className={accentClass} />
            : <Code2 size={13} className={accentClass} />
          }
          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">
            {isBehavioral ? 'Behavioral Practice' : 'Technical Practice'}
          </span>
          {questions.length > 0 && phase !== 'summary' && (
            <span className="text-[10px] text-zinc-600">
              {currentIdx + (phase === 'evaluating' ? 1 : 0)} / {questions.length}
            </span>
          )}
        </div>
        {phase !== 'idle' && (
          <button onClick={reset} title="Restart"
            className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
            <RotateCcw size={11} /> Restart
          </button>
        )}
      </div>

      {/* Progress bar */}
      {questions.length > 0 && phase !== 'summary' && (
        <div className="h-0.5 bg-zinc-800/60 shrink-0">
          <div
            className={clsx('h-full transition-all duration-500', progressColor)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* ── Body: content + sidebar ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Scrollable main content */}
        <div ref={evalRef} className="flex-1 overflow-y-auto min-h-0">

          {/* ── Idle ── */}
          {phase === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
              <div className={clsx(
                'w-16 h-16 rounded-2xl flex items-center justify-center',
                isBehavioral
                  ? 'bg-violet-500/10 border border-violet-500/20'
                  : 'bg-indigo-500/10 border border-indigo-500/20',
              )}>
                {isBehavioral
                  ? <Brain size={28} className="text-violet-400" />
                  : <Code2 size={28} className="text-indigo-400" />
                }
              </div>
              <div className="space-y-2">
                <h2 className="text-[15px] font-bold text-zinc-200">
                  {isBehavioral ? 'Behavioral Practice' : 'Technical Practice'}
                </h2>
                <p className="text-[12px] text-zinc-500 max-w-[360px] leading-relaxed">
                  {isBehavioral
                    ? '10 behavioral questions tailored to your resume and JD. STAR-format style — easy to hard. Answer by voice, get scored feedback, then a final strengths & weaknesses report.'
                    : '10 technical questions tailored to your role — algorithms, system design, architecture trade-offs. Easy to hard. Answer by voice, get expert feedback per question, then a final report.'
                  }
                </p>
              </div>
              {error && (
                <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
                  <AlertCircle size={12} /> {error}
                </div>
              )}
              <button
                onClick={startSession}
                className={clsx(
                  'flex items-center gap-2 text-white text-[12px] font-semibold px-6 py-2.5 rounded-xl transition-colors',
                  btnActive,
                )}
              >
                Start Practice Session
                <ChevronRight size={14} />
              </button>
              <p className="text-[9px] text-zinc-700">Chrome/Edge · Requires microphone</p>
            </div>
          )}

          {/* ── Loading ── */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Loader2 size={24} className={clsx('animate-spin', spinnerColor)} />
              <p className="text-[12px] text-zinc-500">{loadingMsg}</p>
            </div>
          )}

          {/* ── Answering ── */}
          {phase === 'answering' && currentQ && (
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={clsx(
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize',
                    DIFF_COLOR[currentQ.difficulty] ?? DIFF_COLOR.medium,
                  )}>
                    {currentQ.difficulty}
                  </span>
                  <span className="text-[10px] text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-full px-2 py-0.5">
                    {CAT_LABEL[currentQ.category] ?? currentQ.category}
                  </span>
                  <span className="text-[10px] text-zinc-700 ml-auto">
                    Q{currentIdx + 1} of {questions.length}
                  </span>
                </div>
                <p className="text-[15px] font-medium text-zinc-100 leading-relaxed">
                  {currentQ.question}
                </p>
              </div>

              <div className="border-t border-zinc-800/50" />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500 font-medium">Your Answer</span>
                  <div className="flex items-center gap-2">
                    {isRecording && (
                      <span className="flex items-center gap-1 text-[10px]">
                        {audioActive
                          ? <><Volume2 size={10} className="text-emerald-400" /><span className="text-emerald-400">Audio</span></>
                          : <><VolumeX size={10} className="text-zinc-600" /><span className="text-zinc-600">Waiting…</span></>
                        }
                      </span>
                    )}
                    <button
                      onClick={toggleRecording}
                      className={clsx(
                        'flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-all',
                        isRecording
                          ? 'bg-red-500/15 border-red-500/40 text-red-400 hover:bg-red-500/25'
                          : isBehavioral
                            ? 'bg-violet-600/15 border-violet-500/40 text-violet-300 hover:bg-violet-600/25'
                            : 'bg-indigo-600/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-600/25',
                      )}
                    >
                      {isRecording ? <MicOff size={11} /> : <Mic size={11} />}
                      {isRecording ? 'Stop' : 'Record'}
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <textarea
                    value={transcript + (interim ? ' ' + interim : '')}
                    onChange={e => setTranscript(e.target.value)}
                    placeholder="Speak your answer or type it here…"
                    rows={5}
                    className={clsx(
                      'w-full bg-zinc-900/60 border border-zinc-800 rounded-xl px-4 py-3 text-[12px] text-zinc-300 placeholder-zinc-700 resize-none outline-none transition-colors font-sans leading-relaxed',
                      isBehavioral ? 'focus:border-violet-500/50' : 'focus:border-indigo-500/50',
                    )}
                  />
                  {isRecording && (
                    <div className="absolute top-3 right-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse block" />
                    </div>
                  )}
                </div>

                {error && <p className="text-[10px] text-red-400">{error}</p>}

                <div className="flex justify-end">
                  <button
                    onClick={submitAnswer}
                    disabled={!(transcript + interim).trim()}
                    className={clsx(
                      'flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-semibold px-5 py-2 rounded-xl transition-colors',
                      btnActive,
                    )}
                  >
                    Submit Answer
                    <ChevronRight size={13} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Evaluating ── */}
          {phase === 'evaluating' && currentQ && (
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className={clsx(
                    'text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize',
                    DIFF_COLOR[currentQ.difficulty] ?? DIFF_COLOR.medium,
                  )}>
                    {currentQ.difficulty}
                  </span>
                </div>
                <p className="text-[13px] text-zinc-400">{currentQ.question}</p>
              </div>

              <div className="bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-4 py-3">
                <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-widest mb-1.5">Your answer</p>
                <p className="text-[11px] text-zinc-400 italic leading-relaxed">
                  {pairs.length > 0 ? pairs[pairs.length - 1]?.answer ?? '' : transcript}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-widest">Evaluation</p>
                {evalContent ? (
                  <div className="deep-prose text-[12px] text-zinc-300">
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(evalContent) }} />
                    <span className={clsx('inline-block w-1.5 h-3 animate-pulse ml-0.5 align-middle', cursorColor)} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Loader2 size={13} className={clsx('animate-spin', spinnerColor)} />
                    <span className="text-[11px]">Claude is evaluating…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Post-evaluation: next button ── */}
          {phase === 'evaluating' && pairs.length > 0 && pairs[pairs.length - 1].evaluating === false && evalContent && (
            <div className="max-w-2xl mx-auto px-6 pb-8">
              <div className="flex justify-between items-center pt-2">
                <div className="flex items-center gap-2">
                  {pairs[pairs.length - 1].score !== null && (
                    <span className={clsx(
                      'text-[13px] font-bold',
                      (pairs[pairs.length - 1].score ?? 0) >= 7 ? 'text-emerald-400' :
                      (pairs[pairs.length - 1].score ?? 0) >= 5 ? 'text-amber-400' : 'text-red-400',
                    )}>
                      {pairs[pairs.length - 1].score}/10
                    </span>
                  )}
                </div>
                <button
                  onClick={nextQuestion}
                  className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[12px] font-semibold px-5 py-2 rounded-xl transition-colors"
                >
                  {currentIdx + 1 >= questions.length ? (
                    <><BarChart2 size={13} /> View Report</>
                  ) : (
                    <>Next Question <ChevronRight size={13} /></>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── Summary ── */}
          {phase === 'summary' && (
            <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
              <div className="grid grid-cols-5 gap-2">
                {pairs.map((p, i) => (
                  <div key={i} className={clsx(
                    'rounded-lg border p-2 text-center',
                    p.score !== null && p.score >= 7 ? 'border-emerald-500/30 bg-emerald-500/5' :
                    p.score !== null && p.score >= 5 ? 'border-amber-500/30 bg-amber-500/5' :
                    'border-red-500/30 bg-red-500/5',
                  )}>
                    <p className="text-[9px] text-zinc-600 mb-0.5">Q{i + 1}</p>
                    <p className={clsx(
                      'text-[13px] font-bold',
                      p.score !== null && p.score >= 7 ? 'text-emerald-400' :
                      p.score !== null && p.score >= 5 ? 'text-amber-400' : 'text-red-400',
                    )}>
                      {p.score ?? '?'}<span className="text-[9px] text-zinc-600">/10</span>
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-800/50" />

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle size={13} className={accentClass} />
                  <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Performance Report</span>
                </div>
                {summaryContent ? (
                  <div className="deep-prose text-[12px] text-zinc-300">
                    <div dangerouslySetInnerHTML={{ __html: renderMarkdown(summaryContent) }} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-zinc-600">
                    <Loader2 size={13} className={clsx('animate-spin', spinnerColor)} />
                    <span className="text-[11px]">Generating report…</span>
                  </div>
                )}
              </div>

              <button
                onClick={reset}
                className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[12px] font-semibold px-5 py-2 rounded-xl transition-colors"
              >
                <RotateCcw size={13} /> Practice Again
              </button>
            </div>
          )}
        </div>

        {/* ── Score sidebar ── */}
        {showSidebar && (
          <ScoreSidebar
            pairs={pairs}
            liveScore={liveScore}
            totalQ={questions.length}
            questionType={questionType}
          />
        )}
      </div>
    </div>
  )
}
