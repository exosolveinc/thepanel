/**
 * CodePanel — shows code blocks from the last answer in the design-area slot.
 * Appears automatically when a coding question produces code but no diagram.
 */
import { useState } from 'react'
import { Code2, Copy, Check } from 'lucide-react'

/* ── Code extraction ──────────────────────────────────────────────── */

interface CodeBlock { lang: string; code: string }

function extractCodeBlocks(content: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  const seen = new Set<string>()
  for (const m of content.matchAll(/```(\w+)?\n([\s\S]*?)```/g)) {
    const lang = (m[1] || 'code').toLowerCase()
    const code = m[2].trim()
    if (code.length > 10 && !seen.has(lang)) {
      seen.add(lang)
      blocks.push({ lang, code })
    }
  }
  return blocks
}

const LANG_LABEL: Record<string, string> = {
  python: 'Python', py: 'Python',
  java: 'Java',
  javascript: 'JavaScript', js: 'JavaScript',
  typescript: 'TypeScript', ts: 'TypeScript',
  sql: 'SQL', go: 'Go', rust: 'Rust',
  cpp: 'C++', c: 'C', bash: 'Bash', shell: 'Shell', code: 'Code',
}

/* ── Syntax colouring (minimal, regex-based) ──────────────────────── */

function highlight(code: string, lang: string): string {
  let s = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (['python', 'py', 'java', 'javascript', 'js', 'typescript', 'ts', 'go', 'rust', 'cpp', 'c'].includes(lang)) {
    // strings
    s = s.replace(/(["'`])(.*?)\1/g, '<span style="color:#a3e635">$1$2$1</span>')
    // comments
    s = s.replace(/(\/\/[^\n]*|#[^\n]*)/g, '<span style="color:#52525b">$1</span>')
    // keywords
    const kws = /\b(def|class|import|from|return|if|else|elif|for|while|in|not|and|or|True|False|None|async|await|yield|lambda|pass|raise|try|except|finally|with|as|public|private|static|void|int|str|bool|float|new|this|super|extends|implements|interface|enum|const|let|var|function|=>|abstract|final)\b/g
    s = s.replace(kws, '<span style="color:#818cf8">$1</span>')
    // numbers
    s = s.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#fb923c">$1</span>')
    // function calls
    s = s.replace(/(\w+)(\s*\()/g, '<span style="color:#38bdf8">$1</span>$2')
  }

  return s
}

/* ── Component ────────────────────────────────────────────────────── */

interface CodePanelProps { content: string }

export default function CodePanel({ content }: CodePanelProps) {
  const blocks = extractCodeBlocks(content)
  const [activeIdx, setActiveIdx] = useState(0)
  const [copied, setCopied] = useState(false)

  if (blocks.length === 0) return null

  const idx    = Math.min(activeIdx, blocks.length - 1)
  const active = blocks[idx]

  function copy() {
    navigator.clipboard.writeText(active.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-9 border-b border-zinc-800/50 shrink-0">
        <Code2 size={11} className="text-zinc-600" />
        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mr-1">Code</span>

        {/* Language tabs */}
        {blocks.map((b, i) => (
          <button key={i}
            onClick={() => setActiveIdx(i)}
            className={[
              'text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-md border transition-colors leading-none',
              i === idx
                ? 'bg-indigo-950/60 border-indigo-600/50 text-indigo-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700',
            ].join(' ')}
          >
            {LANG_LABEL[b.lang] ?? b.lang}
          </button>
        ))}

        {/* Copy */}
        <button onClick={copy}
          className="ml-auto flex items-center gap-1 text-[9px] text-zinc-600 hover:text-zinc-300 transition-colors">
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Line numbers + code */}
      <div className="flex-1 overflow-y-auto overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px] font-mono leading-relaxed">
          <tbody>
            {active.code.split('\n').map((line, i) => (
              <tr key={i} className="group hover:bg-zinc-900/40">
                <td className="select-none text-right text-zinc-700 pr-4 pl-4 py-0 w-8 text-[10px] group-hover:text-zinc-600">
                  {i + 1}
                </td>
                <td
                  className="text-zinc-300 pr-6 py-0 whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: highlight(line, active.lang) }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
