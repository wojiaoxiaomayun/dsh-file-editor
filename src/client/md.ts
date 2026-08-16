/**
 * Lightweight markdown -> HTML renderer (safe: escape first, then apply
 * inline syntax). Ported from the dynamic-plugin version.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMd(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*\s][^*\n]*)\*/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const safe = /^(https?:|mailto:|\/|#|\.\/|\.\.\/)/.test(url) || !/^[a-z]+:/i.test(url)
    return safe ? `<a href="${url}" target="_blank" rel="noreferrer">${text}</a>` : text
  })
  return out
}

export function mdToHtml(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let i = 0
  let inCode = false
  let codeLang = ''
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inQuote = false
  const flushList = (): void => {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }
  const flushQuote = (): void => {
    if (inQuote) { out.push('</blockquote>'); inQuote = false }
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^```(\w*)\s*$/.exec(line)
    if (fence) {
      flushList(); flushQuote()
      if (inCode) {
        out.push(`<pre><code${codeLang ? ` class="lang-${codeLang}"` : ''}>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
        codeBuf = []; inCode = false; codeLang = ''
      } else {
        inCode = true; codeLang = fence[1]
      }
      continue
    }
    if (inCode) { codeBuf.push(line); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushList(); flushQuote()
      const level = heading[1].length
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`)
      continue
    }
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushList(); flushQuote()
      out.push('<hr>')
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushList()
      if (!inQuote) { out.push('<blockquote>'); inQuote = true }
      out.push(`<p>${inlineMd(quote[1])}</p>`)
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ul || ol) {
      flushQuote()
      const kind: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (listType !== kind) { flushList(); out.push(`<${kind}>`); listType = kind }
      out.push(`<li>${inlineMd((ul ?? ol)![1])}</li>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      flushList(); flushQuote()
      out.push('')
      continue
    }
    flushList(); flushQuote()
    const para: string[] = []
    while (i < lines.length
      && !/^\s*$/.test(lines[i])
      && !/^```/.test(lines[i])
      && !/^#{1,6}\s/.test(lines[i])
      && !/^\s*[-*+]\s/.test(lines[i])
      && !/^\s*\d+\.\s/.test(lines[i])
      && !/^>\s?/.test(lines[i])) {
      para.push(lines[i]); i++
    }
    i--
    out.push(`<p>${inlineMd(para.join(' '))}</p>`)
  }
  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`)
  flushList(); flushQuote()
  return out.join('\n')
}
