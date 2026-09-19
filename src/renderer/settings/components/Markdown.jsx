import { useMemo } from 'react'
import { parseMarkdown } from '../domain/markdown.js'

// Renders a plugin README as React elements (never as HTML). Parsing and
// link safety rules live in domain/markdown.js.
export function Markdown({ source, repo }) {
  const blocks = useMemo(() => parseMarkdown(source, repo), [source, repo])
  return <div className="store-readme">{blocks.map((b, i) => <Block key={i} block={b} />)}</div>
}

function Block({ block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 2, 6)}`
      return <Tag><Inline nodes={block.inline} /></Tag>
    }
    case 'paragraph':
      return <p><Inline nodes={block.inline} /></p>
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return <Tag>{block.items.map((item, i) => <li key={i}><Inline nodes={item} /></li>)}</Tag>
    }
    case 'quote':
      return <blockquote><Inline nodes={block.inline} /></blockquote>
    case 'code':
      return <pre><code>{block.text}</code></pre>
    case 'table':
      return (
        <div className="store-readme-table">
          <table>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => (r === 0 ? <th key={c}><Inline nodes={cell} /></th> : <td key={c}><Inline nodes={cell} /></td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'hr':
      return <hr />
    default:
      return null
  }
}

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return n.text
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'strong':
        return <strong key={i}><Inline nodes={n.children} /></strong>
      case 'em':
        return <em key={i}><Inline nodes={n.children} /></em>
      case 'link':
        return <a key={i} href={n.href} target="_blank" rel="noreferrer"><Inline nodes={n.children} /></a>
      default:
        return null
    }
  })
}
