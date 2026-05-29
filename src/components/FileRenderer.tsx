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
    case 'json':
      return <CodeBlock content={prettyJson(file.content)} language="json" path={file.path} />
    case 'code':
    case 'text':
    default:
      return <CodeBlock content={file.content} language={file.language} path={file.path} />
  }
}
