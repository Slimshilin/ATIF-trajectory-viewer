import { useState } from 'react'
import { Pill } from './ui'
import Markdown from './Markdown'
import CodeBlock from './CodeBlock'
import type { TaskFile } from '../lib/types'

const SHEET_DELIM = '@@SHEET:'

function MarkdownView({ content }: { content: string }) {
  return (
    <div className="max-h-[34rem] overflow-auto">
      <Markdown content={content} />
    </div>
  )
}

export function DiffView({ content }: { content: string }) {
  return (
    <pre className="max-h-[34rem] overflow-auto rounded-lg border border-line bg-code font-mono text-[12px] leading-relaxed">
      {content.split('\n').map((line, i) => {
        const c = line[0]
        const cls =
          c === '+' && !line.startsWith('+++')
            ? 'bg-emerald-500/10 text-emerald-300'
            : c === '-' && !line.startsWith('---')
              ? 'bg-rose-500/10 text-rose-300'
              : line.startsWith('@@')
                ? 'text-sky-400'
                : line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')
                  ? 'text-zinc-500'
                  : 'text-zinc-400'
        return (
          <div key={i} className={'px-3 ' + cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function HtmlView({ content }: { content: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Pill className="bg-emerald-500/15 text-emerald-300">Live preview</Pill>
        sandboxed iframe
      </div>
      <iframe
        title="html-preview"
        srcDoc={content}
        sandbox=""
        className="h-80 w-full rounded-lg border border-line bg-white"
      />
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-300">View source</summary>
        <div className="mt-2"><CodeBlock content={content} language="html" /></div>
      </details>
    </div>
  )
}

function csvRows(content: string): string[][] {
  return content
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.length)
    .slice(0, 200)
    .map((line) => {
      // minimal CSV: split on commas not inside quotes
      const out: string[] = []
      let cur = '', q = false
      for (const ch of line) {
        if (ch === '"') q = !q
        else if (ch === ',' && !q) { out.push(cur); cur = '' }
        else cur += ch
      }
      out.push(cur)
      return out
    })
}

function SheetGrid({ csv }: { csv: string }) {
  const rows = csvRows(csv)
  if (rows.length === 0) return <p className="p-4 text-sm text-zinc-600">Empty sheet.</p>
  const cols = Math.max(...rows.map((r) => r.length))
  const colLetter = (n: number) => { let s = ''; n++; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
  return (
    <div className="max-h-[34rem] overflow-auto rounded-lg border border-line">
      <table className="border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-line bg-ink-800" />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} className="min-w-[80px] border-b border-r border-line/60 bg-ink-800 px-2 py-1 font-medium text-zinc-500">{colLetter(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="sticky left-0 z-10 border-b border-r border-line bg-ink-800 px-2 py-1 text-center text-zinc-500">{i + 1}</td>
              {Array.from({ length: cols }, (_, j) => (
                <td key={j} className="max-w-[220px] truncate border-b border-r border-line/40 px-2 py-1 text-zinc-200" title={r[j]}>{r[j] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SpreadsheetView({ content }: { content: string }) {
  // multi-sheet: split on @@SHEET:<name>@@ markers
  const sheets = content.includes(SHEET_DELIM)
    ? content.split(SHEET_DELIM).filter(Boolean).map((blk) => {
        const nl = blk.indexOf('\n')
        return { name: blk.slice(0, nl).replace(/@@$/, ''), csv: blk.slice(nl + 1) }
      })
    : [{ name: 'Sheet1', csv: content }]
  const [active, setActive] = useState(0)
  const cur = sheets[Math.min(active, sheets.length - 1)]
  return (
    <div className="space-y-2">
      {sheets.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {sheets.map((s, i) => (
            <button key={i} onClick={() => setActive(i)}
              className={'rounded px-2.5 py-1 text-xs font-medium ' + (i === active ? 'bg-emerald-500/20 text-emerald-200' : 'bg-ink-800 text-zinc-400 hover:text-zinc-200')}>
              ▦ {s.name}
            </button>
          ))}
        </div>
      )}
      <SheetGrid csv={cur.csv} />
    </div>
  )
}

function ImageView({ file }: { file: TaskFile }) {
  // inline only if content is a data/URL ref
  const src = file.content && /^(data:|https?:)/.test(file.content.trim()) ? file.content.trim() : undefined
  if (!src) return <BinaryView file={file} />
  return (
    <div className="flex justify-center rounded-lg border border-line bg-code p-4">
      <img src={src} alt={file.path} className="max-h-96 rounded" />
    </div>
  )
}

function BinaryView({ file }: { file: TaskFile }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
      <div className="text-3xl text-zinc-700">{file.kind === 'image' ? '🖼' : file.kind === 'pdf' ? '▤' : '▦'}</div>
      <div className="mt-2 text-sm text-zinc-400">{file.note ?? `${file.kind} file (not inlined)`}</div>
      <code className="mt-1 block font-mono text-xs text-zinc-600">{file.path}</code>
    </div>
  )
}

function prettyJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    return content
  }
}

export default function FileRenderer({ file }: { file: TaskFile }) {
  if (file.kind === 'image') return <ImageView file={file} />
  if (file.content == null) return <BinaryView file={file} />
  switch (file.kind) {
    case 'markdown':
      return <MarkdownView content={file.content} />
    case 'diff':
      return <DiffView content={file.content} />
    case 'html':
      return <HtmlView content={file.content} />
    case 'spreadsheet':
      return <SpreadsheetView content={file.content} />
    case 'json': {
      // ARC-style grids ship as JSON 2D number arrays — render as colored cells
      // (or as a tabbed pair of grids for ARC "examples" payloads).
      const grids = tryParseArcGrids(file.content)
      if (grids) return <ArcGridView grids={grids} />
      return <CodeBlock content={prettyJson(file.content)} language="json" path={file.path} />
    }
    case 'code':
    case 'text':
    default:
      return <CodeBlock content={file.content} language={file.language} path={file.path} />
  }
}

// ---------------------------------------------------------------------------
// ARC AGI grid renderer — 2D number arrays (palette 0–9) as colored cells.
// Handles the three shapes the dataset ships:
//   - single grid: [[…], …]
//   - example pair: { "input": [[…]], "output": [[…]] }
//   - training array: { "train": [{input, output}], "test": [{input, output}] }
// ---------------------------------------------------------------------------

const ARC_PALETTE = [
  '#000000', // 0 black
  '#0074D9', // 1 blue
  '#FF4136', // 2 red
  '#2ECC40', // 3 green
  '#FFDC00', // 4 yellow
  '#AAAAAA', // 5 gray
  '#F012BE', // 6 pink
  '#FF851B', // 7 orange
  '#7FDBFF', // 8 cyan
  '#870C25', // 9 maroon
]

type Grid = number[][]
interface NamedGrid { name: string; grid: Grid }

function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false
  const cols = Array.isArray(v[0]) ? (v[0] as unknown[]).length : -1
  if (cols <= 0 || cols > 40) return false
  if (v.length > 40) return false
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== cols) return false
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return false
    }
  }
  return true
}

function tryParseArcGrids(content: string): NamedGrid[] | null {
  let v: unknown
  try { v = JSON.parse(content) } catch { return null }
  // single grid
  if (isGrid(v)) return [{ name: 'grid', grid: v }]
  // {input, output}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (isGrid(o.input) && isGrid(o.output)) return [{ name: 'input', grid: o.input }, { name: 'output', grid: o.output }]
    // ARC train/test arrays
    if (Array.isArray(o.train) || Array.isArray(o.test)) {
      const out: NamedGrid[] = []
      for (const [k, arr] of Object.entries(o)) {
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            const ex = arr[i] as { input?: unknown; output?: unknown }
            if (ex && isGrid(ex.input)) out.push({ name: `${k}[${i}] input`, grid: ex.input })
            if (ex && isGrid(ex.output)) out.push({ name: `${k}[${i}] output`, grid: ex.output })
          }
        }
      }
      if (out.length) return out
    }
  }
  return null
}

function ArcGridView({ grids }: { grids: NamedGrid[] }) {
  return (
    <div className="space-y-5 p-3">
      {grids.map((g) => <ArcGrid key={g.name} {...g} />)}
    </div>
  )
}

function ArcGrid({ name, grid }: NamedGrid) {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  // Auto-size cells so the whole grid stays under ~480px on the long side.
  const cell = Math.max(8, Math.min(28, Math.floor(480 / Math.max(rows, cols))))
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <span className="font-mono font-semibold uppercase tracking-wide text-zinc-300">{name}</span>
        <span className="text-zinc-600">{cols}×{rows}</span>
      </div>
      <div
        className="inline-block rounded border border-line bg-ink-950 p-1"
        role="img"
        aria-label={`${name} grid ${cols} by ${rows}`}
      >
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 1 }}>
          {grid.flatMap((row, r) =>
            row.map((v, c) => (
              <div
                key={`${r}-${c}`}
                title={`(${r},${c})=${v}`}
                style={{
                  width: cell,
                  height: cell,
                  background: ARC_PALETTE[v] ?? '#444',
                }}
              />
            )),
          )}
        </div>
      </div>
    </div>
  )
}
