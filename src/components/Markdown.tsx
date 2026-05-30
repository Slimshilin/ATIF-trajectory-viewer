import { type ReactNode } from 'react'
import { highlight } from '../lib/highlight'
import { ArcGridView, readArcGridBlock } from './ArcGrid'

// ---------------------------------------------------------------------------
// Dependency-free Markdown renderer tuned for agent output (reports, tables,
// code, lists). Renders no raw HTML, so it's safe for untrusted vendor text.
// Not a full CommonMark implementation — covers the constructs agents emit.
// ---------------------------------------------------------------------------

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // order matters: code first (so we don't format inside it), then images,
  // then links, then emphasis
  const pattern = /(`[^`]+`)|(!\[[^\]]*\]\([^)]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      nodes.push(
        <code key={k} className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[12px] text-accent">
          {tok.slice(1, -1)}
        </code>,
      )
    } else if (tok.startsWith('![')) {
      const im = /!\[([^\]]*)\]\(([^)]+)\)/.exec(tok)!
      const alt = im[1]
      const src = im[2].trim()
      // Only embed self-contained sources (data URIs / absolute URLs); a
      // relative path wouldn't resolve in the viewer, so show it as a label.
      nodes.push(/^(https?:|data:)/i.test(src)
        ? <img key={k} src={src} alt={alt} className="my-2 max-w-full rounded border border-line" />
        : <span key={k} className="text-zinc-500">🖼 {alt || src}</span>)
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      nodes.push(<strong key={k} className="font-semibold text-white">{tok.slice(2, -2)}</strong>)
    } else if (tok.startsWith('~~')) {
      nodes.push(<span key={k} className="text-zinc-500 line-through">{tok.slice(2, -2)}</span>)
    } else if (tok.startsWith('[')) {
      const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok)!
      nodes.push(
        <a key={k} href={lm[2]} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 hover:decoration-accent">
          {lm[1]}
        </a>,
      )
    } else {
      nodes.push(<em key={k} className="italic text-zinc-200">{tok.slice(1, -1)}</em>)
    }
    last = m.index + tok.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function Table({ rows, key }: { rows: string[][]; key: string }) {
  const [head, ...body] = rows
  return (
    <div key={key} className="my-2 overflow-x-auto rounded-lg border border-ink-700">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-ink-800 text-xs uppercase tracking-wide text-zinc-400">
          <tr>{head.map((c, i) => <th key={i} className="px-3 py-1.5 font-medium">{inline(c, `th${i}`)}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="border-t border-ink-800">
              {r.map((c, ci) => <td key={ci} className="px-3 py-1.5 tabular-nums text-zinc-300">{inline(c, `td${ri}-${ci}`)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
}

export default function Markdown({ content, className = '' }: { content: string; className?: string }) {
  const lines = content.split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let key = 0

  const flushList = (items: string[], ordered: boolean) => {
    const Tag = ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={key++} className={ordered ? 'ml-5 list-decimal space-y-1' : 'ml-5 list-disc space-y-1'}>
        {items.map((it, idx) => <li key={idx} className="text-zinc-300">{inline(it, `li${key}-${idx}`)}</li>)}
      </Tag>,
    )
  }

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (/^\s*```/.test(line)) {
      const lang = line.replace(/```/, '').trim()
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++ // closing fence
      blocks.push(
        <pre key={key++} className="hljs my-2 overflow-x-auto rounded-lg border border-line bg-code p-3 text-[12.5px] leading-relaxed text-zinc-200">
          <code dangerouslySetInnerHTML={{ __html: highlight(buf.join('\n'), lang) }} />
        </pre>,
      )
      continue
    }

    // ARC-AGI grid: an inline JSON 2D number array (palette 0–9), possibly
    // spanning several lines — render as colored cells instead of a wall of
    // numbers. Common in ARC instructions ("INPUT:\n[[…]]") and step text.
    if (/^\s*\[/.test(line)) {
      const arc = readArcGridBlock(lines, i)
      if (arc) {
        blocks.push(<ArcGridView key={key++} grids={arc.grids} />)
        i += arc.consumed
        continue
      }
    }

    // table: header row followed by a separator row of ---|---
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const rows: string[][] = [splitRow(line)]
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      blocks.push(<Table key={`tbl${key++}`} rows={rows} />)
      continue
    }

    // headings
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const lvl = h[1].length
      const sz = lvl <= 1 ? 'text-lg' : lvl === 2 ? 'text-base' : 'text-sm'
      blocks.push(
        <div key={key++} className={`mt-3 font-semibold text-white ${sz}`}>{inline(h[2], `h${key}`)}</div>,
      )
      i++
      continue
    }

    // horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-ink-700" />)
      i++
      continue
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(
        <blockquote key={key++} className="my-2 border-l-2 border-ink-600 pl-3 text-zinc-400">
          {inline(buf.join(' '), `bq${key}`)}
        </blockquote>,
      )
      continue
    }

    // lists
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ''))
      flushList(items, false)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))
      flushList(items, true)
      continue
    }

    // blank line
    if (!line.trim()) {
      i++
      continue
    }

    // paragraph (gather consecutive non-empty, non-special lines). Stop at an
    // ARC grid line even with no blank line before it — e.g. "--Test Input--\n
    // [[…]]" — so the grid renders as cells, not swallowed as paragraph text.
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) &&
      !(/^\s*\[/.test(lines[i]) && readArcGridBlock(lines, i))
    ) {
      buf.push(lines[i++])
    }
    blocks.push(<p key={key++} className="text-zinc-300">{inline(buf.join(' '), `p${key}`)}</p>)
  }

  return <div className={`space-y-1.5 text-sm leading-relaxed ${className}`}>{blocks}</div>
}
