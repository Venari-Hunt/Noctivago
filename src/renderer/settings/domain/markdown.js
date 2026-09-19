// A small Markdown reader for plugin READMEs in the Browse window. Anyone can
// write a README, so this never produces HTML: it turns the text into plain
// blocks and inline pieces that components/Markdown.jsx renders as React
// elements. Raw HTML tags are dropped, images become links, and only http(s)
// links survive. No DOM.
//
// Blocks:  { type: 'heading', level, inline } | { type: 'paragraph', inline }
//          | { type: 'list', ordered, items: [inline] } | { type: 'quote', inline }
//          | { type: 'code', text } | { type: 'table', rows: [[inline]] } | { type: 'hr' }
// Inline:  { type: 'text', text } | { type: 'code', text }
//          | { type: 'strong' | 'em', children } | { type: 'link', href, children }

const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const QUOTE = /^\s*>\s?(.*)$/
const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const HTML_TAG = /<(script|style)\b[\s\S]*?<\/\1\s*>|<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/gi

const INLINE =
  /`([^`]+)`|!\[([^\]]*)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?[^)]*\)|\[([^\]]+)\]\(\s*<?((?:[^()\s>]|\([^()\s]*\))+)>?[^)]*\)|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])|(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])|<(https?:\/\/[^>\s]+)>/g

// Where a README link may point. Relative links resolve against the repo on
// GitHub; anything that isn't http(s) after that (javascript:, file:, in-page
// anchors) returns null and is shown as plain text.
export function safeHref(href, repo) {
  if (typeof href !== 'string' || !href || href.startsWith('#')) return null
  let url
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(href)
      ? new URL(href)
      : new URL(href.replace(/^\.?\//, ''), `https://github.com/${repo}/blob/HEAD/`)
  } catch {
    return null
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
}

function stripHtml(text) {
  return text.replace(HTML_TAG, '')
}

function pushText(out, text) {
  const clean = stripHtml(text)
  if (!clean) return
  const last = out[out.length - 1]
  if (last?.type === 'text') last.text += clean
  else out.push({ type: 'text', text: clean })
}

export function parseInline(text, repo) {
  const out = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    pushText(out, text.slice(at, m.index))
    at = m.index + m[0].length
    const [, code, imgAlt, imgSrc, linkText, linkHref, strong1, strong2, em1, em2, autolink] = m
    if (code !== undefined) out.push({ type: 'code', text: code })
    else if (imgSrc !== undefined) addLink(out, imgSrc, [{ type: 'text', text: imgAlt ? `[image: ${imgAlt}]` : '[image]' }], repo)
    else if (linkHref !== undefined) addLink(out, linkHref, parseInline(linkText, repo), repo)
    else if (strong1 !== undefined || strong2 !== undefined) out.push({ type: 'strong', children: parseInline(strong1 ?? strong2, repo) })
    else if (em1 !== undefined || em2 !== undefined) out.push({ type: 'em', children: parseInline(em1 ?? em2, repo) })
    else if (autolink !== undefined) addLink(out, autolink, [{ type: 'text', text: autolink }], repo)
  }
  pushText(out, text.slice(at))
  return out
}

function addLink(out, href, children, repo) {
  const safe = safeHref(href, repo)
  if (safe) out.push({ type: 'link', href: safe, children })
  else out.push(...children)
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

export function parseMarkdown(source, repo) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let paragraph = []
  let list = null

  const inline = (text) => parseInline(text, repo)
  const flushParagraph = () => {
    const text = stripHtml(paragraph.join(' ')).trim()
    if (text) blocks.push({ type: 'paragraph', inline: inline(paragraph.join(' ').trim()) })
    paragraph = []
  }
  const flushList = () => {
    if (list) blocks.push(list)
    list = null
  }
  const flush = () => {
    flushParagraph()
    flushList()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (FENCE.test(line)) {
      flush()
      const fence = line.trim().slice(0, 3)
      const code = []
      while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(lines[i])
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    let m
    if ((m = HEADING.exec(line))) {
      flush()
      blocks.push({ type: 'heading', level: m[1].length, inline: inline(m[2]) })
    } else if (HR.test(line)) {
      flush()
      blocks.push({ type: 'hr' })
    } else if ((m = BULLET.exec(line)) || (m = NUMBERED.exec(line))) {
      flushParagraph()
      const ordered = !BULLET.test(line)
      if (list && list.ordered !== ordered) flushList()
      list ??= { type: 'list', ordered, items: [] }
      list.items.push(inline(m[1]))
    } else if (QUOTE.test(line)) {
      flush()
      const quoted = []
      for (; i < lines.length && (m = QUOTE.exec(lines[i])); i++) quoted.push(m[1])
      i--
      blocks.push({ type: 'quote', inline: inline(quoted.join(' ').trim()) })
    } else if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[i + 1] ?? '')) {
      flush()
      const rows = [tableCells(line).map(inline)]
      for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) rows.push(tableCells(lines[i]).map(inline))
      i--
      blocks.push({ type: 'table', rows })
    } else if (list && /^\s{2,}\S/.test(line)) {
      // A wrapped list item continues the previous one.
      list.items[list.items.length - 1].push({ type: 'text', text: ' ' }, ...inline(line.trim()))
    } else {
      flushList()
      paragraph.push(line.trim())
    }
  }
  flush()
  return blocks
}
