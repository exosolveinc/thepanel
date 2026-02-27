/**
 * Lightweight markdown renderer — no external dependency.
 * Handles the common cases needed for interview answers.
 */
export function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML (security)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Code blocks (must be before inline code)
    .replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
      `<pre><code>${code.trim()}</code></pre>`,
    )

    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')

    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')

    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Horizontal rule (before blockquote to avoid conflicts)
    .replace(/^---+$/gm, '<hr/>')

    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

    // Unordered list items — batch them into <ul>
    .replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
      const items = block
        .trim()
        .split('\n')
        .map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`)
        .join('')
      return `<ul>${items}</ul>`
    })

    // Ordered list items
    .replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block
        .trim()
        .split('\n')
        .map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`)
        .join('')
      return `<ol>${items}</ol>`
    })

    // Paragraphs (double newline)
    .replace(/\n{2,}/g, '</p><p>')

    // Single newlines
    .replace(/\n/g, '<br/>')

  return `<p>${html}</p>`
}
