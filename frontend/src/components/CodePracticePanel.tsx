/**
 * CodePracticePanel — coding interview practice tab.
 * Left: problem statement (description, examples, constraints).
 * Right: code editor + evaluation result.
 * Difficulty selector → generate problem → write code → submit → Claude scores it.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Code2, ChevronRight, RotateCcw, Loader2, Copy, Check,
  AlertCircle, Play,
} from 'lucide-react'
import { useSessionStore } from '../store/sessionStore'
import { getCodeProblem, evaluateCode, type CodeProblem } from '../api/client'
import { renderMarkdown } from '../utils/markdown'
import clsx from 'clsx'

type Problem = CodeProblem

type Lang = 'python' | 'java'
type Phase = 'idle' | 'loading' | 'coding' | 'evaluating' | 'done'

const DIFF_COLOR = {
  easy:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  hard:   'text-red-400 bg-red-400/10 border-red-400/20',
}

const STARTER: Record<Lang, (title: string) => string> = {
  python: (t) => `# ${t}\ndef solution():\n    # Write your solution here\n    pass\n`,
  java:   (t) => `// ${t}\nclass Solution {\n    public void solve() {\n        // Write your solution here\n    }\n}\n`,
}

/* ── Simple code editor ───────────────────────────────────────── */

function CodeEditor({
  value, onChange, language,
}: { value: string; onChange: (v: string) => void; language: Lang }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lines = value.split('\n')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const indent = language === 'python' ? '    ' : '    '
      const newVal = value.slice(0, start) + indent + value.slice(end)
      onChange(newVal)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + indent.length
      })
    }
    // Auto-close brackets
    const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
    if (pairs[e.key]) {
      const ta = e.currentTarget
      const start = ta.selectionStart
      const end = ta.selectionEnd
      if (start === end) {
        e.preventDefault()
        const newVal = value.slice(0, start) + e.key + pairs[e.key] + value.slice(end)
        onChange(newVal)
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1 })
      }
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden font-mono text-[12px] bg-zinc-950 min-h-0">
      {/* Line numbers */}
      <div className="select-none text-right text-zinc-700 px-3 py-3 bg-zinc-950 border-r border-zinc-800/40 text-[11px] leading-[1.6] shrink-0 overflow-hidden"
        style={{ minWidth: 40 }}
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="flex-1 bg-zinc-950 text-zinc-300 px-4 py-3 outline-none resize-none leading-[1.6] caret-violet-400"
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace' }}
      />
    </div>
  )
}

/* ── Main component ───────────────────────────────────────────── */

export default function CodePracticePanel() {
  const { sessionId } = useSessionStore()

  const [phase, setPhase]         = useState<Phase>('idle')
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy')
  const [problem, setProblem]     = useState<Problem | null>(null)
  const [language, setLanguage]   = useState<Lang>('python')
  const [code, setCode]           = useState('')
  const [evalContent, setEvalContent] = useState('')
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)
  const [showHint, setShowHint]   = useState(false)

  const evalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (evalRef.current) evalRef.current.scrollTop = evalRef.current.scrollHeight
  }, [evalContent])

  const loadProblem = useCallback(async () => {
    if (!sessionId) { setError('No session. Upload resume + JD first.'); return }
    setError('')
    setPhase('loading')
    setEvalContent(''); setShowHint(false)

    const result = await getCodeProblem(sessionId, difficulty)
    if (!result) { setError('Failed to generate problem. Try again.'); setPhase('idle'); return }

    setProblem(result)
    setCode(STARTER[language](result.title))
    setPhase('coding')
  }, [sessionId, difficulty, language])

  // When language changes while coding, update starter only if code is unchanged
  const handleLanguageChange = (lang: Lang) => {
    setLanguage(lang)
    if (problem && phase === 'coding') {
      setCode(STARTER[lang](problem.title))
    }
  }

  const submitCode = useCallback(async () => {
    if (!sessionId || !problem) return
    if (!code.trim()) { setError('Write some code first.'); return }
    setError('')
    setPhase('evaluating')
    setEvalContent('')

    await evaluateCode(sessionId, problem.title, problem.description, code, language, {
      onToken: t => setEvalContent(prev => prev + t),
      onDone: () => setPhase('done'),
      onError: msg => { setEvalContent(`⚠ ${msg}`); setPhase('done') },
    })
  }, [sessionId, problem, code, language])

  const nextProblem = () => {
    setPhase('idle'); setProblem(null); setCode('')
    setEvalContent(''); setError(''); setShowHint(false)
  }

  /* ── Render ───────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">

      {/* Header */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-zinc-800/50 shrink-0">
        <div className="flex items-center gap-3">
          <Code2 size={13} className="text-cyan-400" />
          <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-widest">Coding Practice</span>
          {problem && (
            <span className={clsx(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize',
              DIFF_COLOR[problem.difficulty] ?? DIFF_COLOR.easy,
            )}>
              {problem.difficulty}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(phase === 'done' || phase === 'evaluating') && (
            <button onClick={nextProblem}
              className="flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              <RotateCcw size={11} /> New Problem
            </button>
          )}
        </div>
      </div>

      {/* ── Idle: difficulty picker ── */}
      {phase === 'idle' && (
        <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Code2 size={28} className="text-cyan-400" />
          </div>
          <div className="space-y-2">
            <h2 className="text-[15px] font-bold text-zinc-200">Coding Practice</h2>
            <p className="text-[12px] text-zinc-500 max-w-[340px] leading-relaxed">
              Get a coding problem tailored to your role. Write a solution, submit, and Claude will
              evaluate your correctness, complexity, and code quality.
            </p>
          </div>

          {/* Difficulty picker */}
          <div className="flex items-center gap-2">
            {(['easy', 'medium', 'hard'] as const).map(d => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={clsx(
                  'text-[11px] font-semibold px-4 py-2 rounded-xl border transition-all capitalize',
                  difficulty === d
                    ? DIFF_COLOR[d]
                    : 'border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400',
                )}
              >
                {d}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-2">
              <AlertCircle size={12} /> {error}
            </div>
          )}

          <button
            onClick={loadProblem}
            className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white text-[12px] font-semibold px-6 py-2.5 rounded-xl transition-colors"
          >
            Get Problem
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {phase === 'loading' && (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <Loader2 size={24} className="text-cyan-400 animate-spin" />
          <p className="text-[12px] text-zinc-500">Generating problem…</p>
        </div>
      )}

      {/* ── Coding + Evaluating + Done: 2-column layout ── */}
      {(phase === 'coding' || phase === 'evaluating' || phase === 'done') && problem && (
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left: Problem */}
          <div className="w-[38%] shrink-0 flex flex-col overflow-y-auto border-r border-zinc-800/60 px-5 py-5 space-y-4 min-h-0">
            <div>
              <h2 className="text-[14px] font-bold text-zinc-100 mb-1">{problem.title}</h2>
              <p className="text-[11px] text-zinc-400 leading-relaxed">{problem.description}</p>
            </div>

            {problem.examples.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Examples</p>
                {problem.examples.map((ex, i) => (
                  <pre key={i}
                    className="text-[10px] text-zinc-400 bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-3 py-2 mb-2 font-mono whitespace-pre-wrap leading-relaxed">
                    {ex}
                  </pre>
                ))}
              </div>
            )}

            {problem.constraints.length > 0 && (
              <div>
                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-2">Constraints</p>
                <ul className="space-y-1">
                  {problem.constraints.map((c, i) => (
                    <li key={i} className="text-[10px] text-zinc-500 font-mono">{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {problem.expected_time && (
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg px-3 py-2 space-y-1">
                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Expected Complexity</p>
                <p className="text-[10px] text-zinc-500 font-mono">Time: {problem.expected_time}</p>
                {problem.expected_space && <p className="text-[10px] text-zinc-500 font-mono">Space: {problem.expected_space}</p>}
              </div>
            )}

            {problem.hint && (
              <div>
                <button
                  onClick={() => setShowHint(v => !v)}
                  className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  {showHint ? '▼ Hide hint' : '▶ Show hint'}
                </button>
                {showHint && (
                  <p className="text-[11px] text-zinc-500 mt-2 leading-relaxed italic">{problem.hint}</p>
                )}
              </div>
            )}

            <button
              onClick={nextProblem}
              className="text-[10px] text-zinc-700 hover:text-zinc-500 transition-colors mt-auto pt-4"
            >
              ← Different problem
            </button>
          </div>

          {/* Right: Editor + Eval */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* Editor toolbar */}
            <div className="flex items-center gap-2 px-4 h-10 border-b border-zinc-800/50 shrink-0">
              {/* Language selector */}
              <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
                {(['python', 'java'] as Lang[]).map(lang => (
                  <button
                    key={lang}
                    onClick={() => handleLanguageChange(lang)}
                    className={clsx(
                      'text-[10px] font-semibold px-2.5 py-0.5 rounded-md transition-colors capitalize',
                      language === lang
                        ? 'bg-zinc-700/70 text-zinc-200'
                        : 'text-zinc-600 hover:text-zinc-400',
                    )}
                  >
                    {lang === 'python' ? 'Python' : 'Java'}
                  </button>
                ))}
              </div>

              {/* Copy */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(code)
                  setCopied(true); setTimeout(() => setCopied(false), 1500)
                }}
                className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy'}
              </button>

              {/* Submit */}
              <button
                onClick={submitCode}
                disabled={phase === 'evaluating' || !code.trim()}
                className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {phase === 'evaluating' ? (
                  <><Loader2 size={11} className="animate-spin" /> Evaluating…</>
                ) : (
                  <><Play size={11} /> Submit</>
                )}
              </button>
            </div>

            {/* Code editor area */}
            <div className={clsx(
              'overflow-hidden',
              phase === 'coding' ? 'flex-1' : 'flex-[0_0_45%]',
            )}>
              <CodeEditor value={code} onChange={setCode} language={language} />
            </div>

            {/* Evaluation panel */}
            {(phase === 'evaluating' || phase === 'done') && (
              <div className="flex-1 border-t border-zinc-800/50 overflow-y-auto min-h-0 bg-zinc-900/30" ref={evalRef}>
                <div className="px-5 py-4">
                  <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-3">Evaluation</p>
                  {evalContent ? (
                    <div>
                      <div
                        className="deep-prose text-[12px] text-zinc-300"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(evalContent) }}
                      />
                      {phase === 'evaluating' && (
                        <span className="inline-block w-1.5 h-3 bg-cyan-400 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-zinc-600">
                      <Loader2 size={11} className="animate-spin text-cyan-400" />
                      <span className="text-[11px]">Claude is reviewing your code…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
