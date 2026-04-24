/**
 * Safe Mermaid renderer.
 *
 * Mermaid source is LLM-generated, so SVG output is treated as untrusted:
 * - mermaid is initialized once with `securityLevel: 'strict'` + `htmlLabels: false`
 *   to prevent script execution and arbitrary HTML in node labels
 * - The rendered SVG is then post-sanitized via DOMParser to strip any `on*`
 *   handler attributes and `javascript:` URLs before being inserted into the DOM
 */
import type { MermaidConfig } from 'mermaid'

let _initPromise: Promise<typeof import('mermaid').default> | null = null

function getMermaid(extraConfig: Partial<MermaidConfig> = {}) {
  if (_initPromise) return _initPromise
  _initPromise = import('mermaid').then(m => {
    m.default.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
      flowchart: { htmlLabels: false, curve: 'basis' },
      ...extraConfig,
    })
    return m.default
  })
  return _initPromise
}

/**
 * Initialize Mermaid with custom theme variables. Safe to call repeatedly;
 * the first call wins and subsequent ones are no-ops.
 */
export function configureMermaid(config: Partial<MermaidConfig>) {
  if (!_initPromise) getMermaid(config)
}

const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:']

function sanitizeNode(el: Element) {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name)
      continue
    }
    if (name === 'href' || name === 'xlink:href' || name === 'src') {
      const value = attr.value.trim().toLowerCase()
      if (value.startsWith('javascript:') || value.startsWith('data:text/html')) {
        el.removeAttribute(attr.name)
        continue
      }
      // Allow only safe protocols on absolute URLs; relative URLs are fine.
      try {
        const u = new URL(attr.value, 'https://placeholder.invalid')
        if (!u.protocol.startsWith('http') && !SAFE_PROTOCOLS.includes(u.protocol) && attr.value.includes(':')) {
          el.removeAttribute(attr.name)
        }
      } catch {
        /* relative — fine */
      }
    }
  }
  for (const child of Array.from(el.children)) sanitizeNode(child)
}

function sanitizeSvg(svgText: string): string {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  // Strip <script> elements entirely
  doc.querySelectorAll('script').forEach(s => s.remove())
  if (doc.documentElement) sanitizeNode(doc.documentElement)
  return new XMLSerializer().serializeToString(doc.documentElement)
}

/**
 * Render Mermaid source to a sanitized SVG string. Throws on malformed source.
 */
export async function renderSafeMermaid(id: string, code: string): Promise<string> {
  const mermaid = await getMermaid()
  const { svg } = await mermaid.render(id, code.trim())
  return sanitizeSvg(svg)
}
