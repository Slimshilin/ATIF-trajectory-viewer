import { useMemo, useState, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import Markdown from './Markdown'
import FileRenderer from './FileRenderer'
import FileTree from './FileTree'
import { interpretEnvironment } from '../lib/dockerfile'
import { buildAgentFs, type FsNode } from '../lib/agentfs'
import {
  reconstructStage,
  reconstructWorkspace,
  numToCol,
  type FileEntry,
  type SheetState,
  type DocState,
  type ComputerState,
  type ScreenshotState,
  type WebState,
  type AnswerState,
  type Workspace,
} from '../lib/stage'
import type { FileKind, Step, Task, TaskFile } from '../lib/types'

type ArtifactRef =
  | { kind: 'sheet'; id: string; label: string }
  | { kind: 'doc'; id: string; label: string }
  | { kind: 'web'; id: 'web'; label: string }
  | { kind: 'computer'; id: 'computer'; label: string }
  | { kind: 'answer'; id: 'answer'; label: string }
  | { kind: 'arc'; id: 'arc'; label: string }
  | { kind: 'file'; id: string; label: string }

function baseName(p?: string) {
  if (!p) return 'sheet'
  return p.split('/').pop() ?? p
}

// --- Spreadsheet -----------------------------------------------------------

function SpreadsheetGrid({ sheet, activeStep }: { sheet: SheetState; activeStep: number }) {
  const rows = Math.min(sheet.maxRow + 1, 80)
  const cols = Math.min(sheet.maxCol + 1, 32)
  const colIdx = Array.from({ length: cols }, (_, i) => i)
  const rowIdx = Array.from({ length: rows }, (_, i) => i)
  return (
    <div className="overflow-auto rounded-lg border border-ink-700 bg-ink-950">
      <table className="border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-10 w-10 border-b border-r border-ink-700 bg-ink-800" />
            {colIdx.map((c) => (
              <th key={c} className="min-w-[84px] border-b border-r border-ink-800 bg-ink-800 px-2 py-1 font-medium text-zinc-500">
                {numToCol(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIdx.map((r) => (
            <tr key={r}>
              <td className="sticky left-0 z-10 border-b border-r border-ink-800 bg-ink-800 px-2 py-1 text-center font-medium text-zinc-500">
                {r + 1}
              </td>
              {colIdx.map((c) => {
                const ref = numToCol(c) + (r + 1)
                const cell = sheet.cells.get(ref)
                const fresh = cell && cell.step === activeStep
                return (
                  <td
                    key={c}
                    title={cell?.formula ? cell.formula : cell?.value}
                    className={clsx(
                      'max-w-[200px] truncate border-b border-r border-ink-800 px-2 py-1',
                      cell?.formula ? 'font-mono text-sky-300' : 'text-zinc-200',
                      fresh && 'bg-accent/25 ring-1 ring-accent/60',
                    )}
                  >
                    {cell?.value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// --- Document --------------------------------------------------------------

function DocView({ doc, activeStep }: { doc: DocState; activeStep: number }) {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-ink-700 bg-white/95 p-8 text-zinc-900 shadow-lg">
      {doc.blocks.length === 0 && <p className="text-zinc-400">Empty document.</p>}
      {doc.blocks.map((b, i) => {
        const fresh = b.step === activeStep
        const cls = clsx('transition-colors', fresh && 'rounded bg-yellow-200/70 px-1')
        if (b.op === 'heading') {
          const lvl = b.level ?? 1
          const size = lvl <= 1 ? 'text-2xl' : lvl === 2 ? 'text-xl' : 'text-lg'
          return <div key={i} className={clsx('mt-4 font-bold', size, cls)}>{b.text}</div>
        }
        return <p key={i} className={clsx('mt-2 leading-relaxed', cls)}>{b.text}</p>
      })}
    </div>
  )
}

// --- Web -------------------------------------------------------------------

function WebView({ web }: { web: WebState }) {
  return (
    <div className="overflow-hidden rounded-lg border border-ink-700 bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-300 bg-zinc-100 px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </div>
        <div className="ml-2 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-zinc-600">
          {web.url ?? 'about:blank'}
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto bg-white px-6 py-4 text-zinc-800">
        {web.content ? (
          <div className="prose-sm">
            <Markdown content={cleanFetch(web.content)} className="[&_*]:!text-zinc-800" />
          </div>
        ) : (
          <p className="text-zinc-400">No page content captured.</p>
        )}
      </div>
    </div>
  )
}

function cleanFetch(s: string) {
  return s.replace(/^\[Tool '[^']+' executed\.\]\n?/, '')
}

// --- Computer use ----------------------------------------------------------

function ComputerView({ comp, screenshot, run }: { comp?: ComputerState; screenshot?: ScreenshotState; run: { x: number; y: number } }) {
  const isClick = (comp?.action ?? '').includes('click')

  // Real screenshot: render the image with a cursor overlay (percentage-based).
  if (screenshot) {
    const lx = comp?.coord ? (comp.coord[0] / run.x) * 100 : null
    const ly = comp?.coord ? (comp.coord[1] / run.y) * 100 : null
    return (
      <div className="space-y-3">
        <div className="relative mx-auto inline-block overflow-hidden rounded-lg border border-ink-700">
          <img
            src={screenshot.url}
            alt="agent screen"
            className="block max-w-full"
            onError={(e) => {
              const img = e.currentTarget
              if (img.dataset.fallback) return
              img.dataset.fallback = '1'
              img.src =
                'data:image/svg+xml;utf8,' +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="100%" height="100%" fill="#16181d"/><text x="50%" y="46%" fill="#71717a" font-family="sans-serif" font-size="18" text-anchor="middle">screenshot unavailable</text><text x="50%" y="56%" fill="#52525b" font-family="sans-serif" font-size="12" text-anchor="middle">the session image could not be loaded</text></svg>',
                )
            }}
          />
          {lx != null && ly != null && (
            <>
              {isClick && (
                <span className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-accent/50"
                  style={{ left: `${lx}%`, top: `${ly}%` }} />
              )}
              <span className="absolute z-10 -translate-x-1/4 -translate-y-1/4 text-xl drop-shadow"
                style={{ left: `${lx}%`, top: `${ly}%` }}>▲</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
          {comp?.action && <span className="chip bg-violet-500/15 text-violet-300">{comp.action}</span>}
          {comp?.coord && <span className="font-mono text-xs text-zinc-500">({comp.coord[0]}, {comp.coord[1]})</span>}
          {comp?.text && <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-xs text-zinc-300">typed: {comp.text}</span>}
          <span className="text-[11px] text-zinc-600">live screenshot from the session</span>
        </div>
      </div>
    )
  }

  // Fallback: synthetic viewport (no screenshot in the export)
  const W = 640, H = 400
  const sx = run.x ? W / run.x : 0.5
  const sy = run.y ? H / run.y : 0.5
  const pt = comp?.coord ? { x: comp.coord[0] * sx, y: comp.coord[1] * sy } : null
  return (
    <div className="space-y-3">
      <div className="relative mx-auto overflow-hidden rounded-lg border border-ink-700 bg-gradient-to-br from-ink-800 to-ink-950" style={{ width: W, height: H }}>
        <div className="absolute inset-0 grid place-items-center text-xs text-zinc-600">
          virtual desktop · no screenshot in this export
        </div>
        {comp?.trail.map((c, i) => (
          <span key={i} className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/30" style={{ left: c[0] * sx, top: c[1] * sy }} />
        ))}
        {pt && (
          <>
            {isClick && <span className="absolute -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-accent/40" style={{ left: pt.x, top: pt.y, width: 28, height: 28 }} />}
            <span className="absolute z-10 -translate-x-1/2 -translate-y-1/2 text-lg" style={{ left: pt.x, top: pt.y }}>▲</span>
          </>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className="chip bg-violet-500/15 text-violet-300">{comp?.action ?? 'action'}</span>
        {comp?.coord && <span className="font-mono text-xs text-zinc-500">({comp.coord[0]}, {comp.coord[1]})</span>}
        {comp?.text && <span className="rounded bg-ink-800 px-2 py-0.5 font-mono text-xs text-zinc-300">typed: {comp.text}</span>}
      </div>
    </div>
  )
}

// --- Answer ----------------------------------------------------------------

function AnswerView({ answer }: { answer: AnswerState }) {
  return (
    <div className="mx-auto max-w-3xl rounded-lg border border-ink-700 bg-ink-950 p-6">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Final answer / report</div>
      <Markdown content={answer.content} />
    </div>
  )
}

// --- Stage shell -----------------------------------------------------------

/** Hard-coded ARC AGI detection — when a task ships an `expected.json` whose
 *  content parses as an ARC-shape 2D number array (palette 0–9), or its id
 *  starts with `hi-arcagi`, we surface a dedicated grid-comparison panel.
 *  This is intentionally task-specific: ARC payloads aren't representable as
 *  any of the generic "edit" shapes the stage normally handles. */
function findArcExpected(task?: Task): number[][] | null {
  if (!task) return null
  const candidates = task.files.filter((f) => /(^|\/)(expected|solution)\.json$/i.test(f.path))
  for (const f of candidates) {
    if (!f.content) continue
    try {
      const v = JSON.parse(f.content)
      if (isArcShape(v)) return v as number[][]
    } catch { /* not JSON */ }
  }
  return null
}

function isArcShape(v: unknown): v is number[][] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 40) return false
  const cols = Array.isArray(v[0]) ? (v[0] as unknown[]).length : -1
  if (cols <= 0 || cols > 40) return false
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== cols) return false
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 9) return false
    }
  }
  return true
}

/** Scan arbitrary text (a tool observation, a command) for the LAST ARC-shaped
 *  2D number array it contains. Uses a balanced-bracket walk so it handles the
 *  grid being embedded in prose like `Output:\n30 30\n[[0,0,…]]`. */
function extractArcGridFromText(text: string): number[][] | null {
  let found: number[][] | null = null
  for (let i = 0; i + 1 < text.length; i++) {
    if (text[i] !== '[') continue
    // The next non-whitespace char must also be '[' — i.e. an array-of-arrays
    // opener — so we match both `[[…` and pretty-printed `[\n  […`.
    let k = i + 1
    while (k < text.length && /\s/.test(text[k])) k++
    if (text[k] !== '[') continue
    let depth = 0
    let j = i
    for (; j < text.length; j++) {
      if (text[j] === '[') depth++
      else if (text[j] === ']') { depth--; if (depth === 0) break }
    }
    if (depth !== 0) break // unbalanced (likely truncated) — stop
    try {
      const v = JSON.parse(text.slice(i, j + 1))
      if (isArcShape(v)) found = v as number[][] // keep last match
    } catch { /* not JSON — skip */ }
    i = j // continue past this array
  }
  return found
}

/** The agent's `output.json` grid as captured at a specific step. */
interface ArcAgentOutput { grid: number[][]; stepIndex: number }

/** Walk the trajectory up to `upto` and find the agent's latest `output.json`
 *  grid, returning the producing step index too. Covers three write styles,
 *  newest step first:
 *   1. write_file / Write tool calls whose content is the grid JSON,
 *   2. shell `cat > … << EOF` / `echo … > output.json` literals, and
 *   3. computed writes the agent then prints — e.g. `… && python3 -c
 *      'print(json.dumps(g))'` — by reading the grid out of the step's
 *      OBSERVATION whenever that step touches output.json. */
function findArcAgentOutput(steps: Step[], upto: number): ArcAgentOutput | null {
  for (let i = Math.min(upto, steps.length - 1); i >= 0; i--) {
    const s = steps[i]
    let touchesOutput = false
    for (const tc of s.toolCalls ?? []) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.args ?? '{}') } catch { /* fall through */ }
      const path = (args.file_path ?? args.path ?? args.filepath) as string | undefined
      const content = (args.content ?? args.new_content ?? args.file_text) as string | undefined
      if (typeof path === 'string' && /output\.json$/i.test(path)) {
        touchesOutput = true
        if (typeof content === 'string') {
          try {
            const v = JSON.parse(content)
            if (isArcShape(v)) return { grid: v as number[][], stepIndex: i }
          } catch { /* keep scanning */ }
        }
      }
      // Shell write captured in a bash command string (keystrokes covers
      // Terminus-style trajectories that ship a `{keystrokes, duration}` arg).
      const cmd = (args.command ?? args.cmd ?? args.keystrokes ?? args.input) as string | undefined
      if (typeof cmd === 'string' && /output\.json/.test(cmd)) {
        touchesOutput = true
        const hd = cmd.match(/cat\s*<<\s*['"]?(\w+)['"]?\s*>?\s*\S*output\.json[\s\S]*?\n([\s\S]+?)\n\1\s*$/m)
          || cmd.match(/cat\s*>?\s*\S*output\.json\s*<<\s*['"]?(\w+)['"]?\s*\n([\s\S]+?)\n\1\s*$/m)
          || cmd.match(/echo\s+(?:-\w+\s+)?['"]([\s\S]+?)['"]\s*>+\s*\S*output\.json/)
        if (hd) {
          try {
            const v = JSON.parse(hd[2] ?? hd[1])
            if (isArcShape(v)) return { grid: v as number[][], stepIndex: i }
          } catch { /* not parseable */ }
        }
      }
    }
    // Computed-then-printed writes: if this step deals with output.json, the
    // grid is usually echoed back in its observation. Read it from there.
    const obs = s.observation
    if (typeof obs === 'string' && (touchesOutput || /output\.json/.test(obs))) {
      const g = extractArcGridFromText(obs)
      if (g) return { grid: g, stepIndex: i }
    }
  }
  return null
}

function ArtifactViewer({ steps, activeStep, task, ws }: { steps: Step[]; activeStep: number; task?: Task; ws: Workspace }) {
  const stage = useMemo(() => reconstructStage(steps, activeStep), [steps, activeStep])

  // Files the agent wrote/edited (with captured content) become renderable
  // artifacts too — so "what the agent did to the files" shows here, not just
  // spreadsheets/docs/grids. Most-recently-written first, capped to stay tidy.
  const WRITE_OPS = new Set(['create', 'edit', 'append'])
  const writtenFiles = useMemo(
    () =>
      ws.files
        .filter((f) => WRITE_OPS.has(f.op) && f.content)
        .sort((a, b) => b.step - a.step)
        .slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws.files],
  )
  const fileChangedAt = ws.files.find((f) => f.step === activeStep && WRITE_OPS.has(f.op) && f.content)

  // ARC-AGI hard-coded panel: expected grid (always) + agent's latest output.
  const arcExpected = useMemo(() => findArcExpected(task), [task])
  const arcAgent = useMemo(
    () => (arcExpected ? findArcAgentOutput(steps, activeStep) : null),
    [arcExpected, steps, activeStep],
  )
  const isArc = !!arcExpected

  // bounds for computer coordinate scaling (max coord across whole run)
  const compBounds = useMemo(() => {
    let x = 1024, y = 768
    for (const s of steps) {
      for (const e of (s.edits ?? [])) {
        if (e.t === 'computer' && e.coord) {
          x = Math.max(x, e.coord[0]); y = Math.max(y, e.coord[1])
        }
      }
    }
    return { x: x * 1.02, y: y * 1.05 }
  }, [steps])

  const artifacts = useMemo<ArtifactRef[]>(() => {
    const list: ArtifactRef[] = []
    if (isArc) list.push({ kind: 'arc', id: 'arc', label: 'ARC grid (expected ↔ agent)' })
    stage.sheets.forEach((s) => list.push({ kind: 'sheet', id: s.key, label: baseName(s.target) + (s.name ? ` · ${s.name}` : '') }))
    stage.docs.forEach((d) => list.push({ kind: 'doc', id: d.key, label: d.name }))
    if (stage.web) list.push({ kind: 'web', id: 'web', label: 'Web page' })
    if (stage.computer || stage.screenshot)
      list.push({ kind: 'computer', id: 'computer', label: stage.screenshot ? 'Screen' : 'Desktop' })
    if (stage.answer) list.push({ kind: 'answer', id: 'answer', label: 'Final answer' })
    writtenFiles.forEach((f) => list.push({ kind: 'file', id: f.path, label: baseName(f.path) }))
    return list
  }, [stage, isArc, writtenFiles])

  const [selected, setSelected] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)

  // auto-follow: when the active step changes something, focus that artifact —
  // a written file takes priority so you see exactly what the agent just wrote.
  useEffect(() => {
    if (fileChangedAt) { setSelected('file:' + fileChangedAt.path); return }
    const changed = [...stage.changedAt]
    if (!changed.length) return
    const c = changed[0]
    if (c.startsWith('sheet:')) setSelected('sheet:' + c.slice(6))
    else if (c.startsWith('doc:')) setSelected('doc:' + c.slice(4))
    else setSelected(c) // 'web' | 'computer' | 'answer'
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, stage, fileChangedAt?.path])

  // Even with no generic visual, the ARC mode always renders the expected grid.
  if (!stage.hasVisual && !isArc && writtenFiles.length === 0) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-xs text-zinc-600">
        No rendered artifact yet — the agent hasn't written a file or produced a spreadsheet, document, web view, screenshot, or answer up to this step.
      </div>
    )
  }

  const cur =
    artifacts.find((a) => keyFor(a) === selected) ??
    artifacts.find((a) => stage.changedAt.has(changeKey(a))) ??
    artifacts[0]

  return (
    <div data-tour="artifact-view" className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-ink-700 px-3 py-1.5">
        <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-600">Artifact</span>
        {artifacts.map((a) => {
          const active = cur && keyFor(a) === keyFor(cur)
          const justChanged = stage.changedAt.has(changeKey(a))
          return (
            <button
              key={keyFor(a)}
              onClick={() => setSelected(keyFor(a))}
              className={clsx(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition-colors',
                active ? `${KIND_STYLE[a.kind] ?? 'bg-ink-700 text-white ring-ink-600'}` : 'bg-ink-800 text-zinc-400 ring-transparent hover:text-zinc-200',
              )}
            >
              <span className={active ? '' : 'text-zinc-500'}>{ICON[a.kind]}</span>
              <span className="max-w-[150px] truncate">{a.label}</span>
              {justChanged && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))} className="btn-ghost px-2 py-0.5" title="Zoom out">−</button>
          <span className="w-10 text-center text-xs tabular-nums text-zinc-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(2)))} className="btn-ghost px-2 py-0.5" title="Zoom in">+</button>
          <button onClick={() => setZoom(1)} className="btn-ghost px-2 py-0.5 text-xs" title="Reset zoom">reset</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-ink-950/40 p-4">
        <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${100 / zoom}%` }}>
          {cur?.kind === 'sheet' && (
            <SpreadsheetGrid sheet={stage.sheets.find((s) => s.key === cur.id)!} activeStep={activeStep} />
          )}
          {cur?.kind === 'doc' && (
            <DocView doc={stage.docs.find((d) => d.key === cur.id)!} activeStep={activeStep} />
          )}
          {cur?.kind === 'web' && stage.web && <WebView web={stage.web} />}
          {cur?.kind === 'computer' && (stage.computer || stage.screenshot) && (
            <ComputerView comp={stage.computer} screenshot={stage.screenshot} run={compBounds} />
          )}
          {cur?.kind === 'answer' && stage.answer && <AnswerView answer={stage.answer} />}
          {cur?.kind === 'arc' && arcExpected && <ArcCompareView expected={arcExpected} agent={arcAgent} />}
          {cur?.kind === 'file' && (() => {
            const f = ws.files.find((x) => x.path === cur.id)
            return f?.content
              ? <FileRenderer file={{ path: f.path, kind: kindFromPath(f.path), content: f.content }} />
              : <div className="p-4 text-xs text-zinc-600">No captured content for {cur.id}.</div>
          })()}
        </div>
      </div>
    </div>
  )
}

const ICON: Record<string, string> = { sheet: '▦', doc: '▤', web: '🌐', computer: '🖥', answer: '★', arc: '▤', file: '📄' }
// Distinct accent per artifact type so switching between them reads at a glance.
const KIND_STYLE: Record<string, string> = {
  sheet: 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40',
  doc: 'bg-violet-500/20 text-violet-200 ring-violet-500/40',
  web: 'bg-sky-500/20 text-sky-200 ring-sky-500/40',
  computer: 'bg-amber-500/20 text-amber-200 ring-amber-500/40',
  answer: 'bg-rose-500/20 text-rose-200 ring-rose-500/40',
  arc: 'bg-fuchsia-500/20 text-fuchsia-200 ring-fuchsia-500/40',
  file: 'bg-zinc-500/20 text-zinc-100 ring-zinc-500/40',
}

// ---------------------------------------------------------------------------
// ARC AGI compare view — expected grid + agent's latest output.json side-by-side.
// ---------------------------------------------------------------------------

const ARC_PALETTE = [
  '#000000', '#0074D9', '#FF4136', '#2ECC40', '#FFDC00',
  '#AAAAAA', '#F012BE', '#FF851B', '#7FDBFF', '#870C25',
]

/** Render a grid as colored cells. When `compareTo` (same shape) is supplied,
 *  cells whose value differs are outlined so mismatches are visible at a glance. */
function ArcMiniGrid({ grid, compareTo }: { grid: number[][]; compareTo?: number[][] | null }) {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const cell = Math.max(8, Math.min(22, Math.floor(420 / Math.max(rows, cols))))
  const canDiff = !!compareTo && compareTo.length === rows && (compareTo[0]?.length ?? -1) === cols
  return (
    <div className="inline-block rounded border border-line bg-ink-950 p-1">
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 1 }}>
        {grid.flatMap((row, r) =>
          row.map((v, c) => {
            const diff = canDiff && compareTo![r][c] !== v
            return (
              <div key={`${r}-${c}`}
                title={diff ? `(${r},${c})=${v} · expected ${compareTo![r][c]}` : `(${r},${c})=${v}`}
                style={{
                  width: cell, height: cell, background: ARC_PALETTE[v] ?? '#444',
                  boxShadow: diff ? 'inset 0 0 0 2px #fff, 0 0 0 1px #ff4136' : undefined,
                }}
              />
            )
          }),
        )}
      </div>
    </div>
  )
}

function ArcCompareView({ expected, agent }: { expected: number[][]; agent: ArcAgentOutput | null }) {
  const grid = agent?.grid ?? null
  const sameShape = grid && expected.length === grid.length &&
    expected[0]?.length === grid[0]?.length
  const matches = sameShape && expected.every((r, i) => r.every((v, j) => v === grid![i][j]))
  const diffCount = sameShape && !matches
    ? expected.reduce((n, r, i) => n + r.reduce((m, v, j) => m + (v === grid![i][j] ? 0 : 1), 0), 0)
    : 0
  return (
    <div className="space-y-3 text-sm text-zinc-300">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-ink-800 px-2 py-1 uppercase tracking-wide text-zinc-400">ARC AGI</span>
        {grid
          ? matches
            ? <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-200 ring-1 ring-emerald-500/40">✓ matches expected</span>
            : sameShape
              ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-200 ring-1 ring-amber-500/40">✗ {diffCount} cell{diffCount !== 1 ? 's' : ''} differ</span>
              : <span className="rounded bg-rose-500/20 px-2 py-1 text-rose-200 ring-1 ring-rose-500/40">✗ output shape {grid.length}×{grid[0]?.length} ≠ expected {expected.length}×{expected[0]?.length}</span>
          : <span className="rounded bg-ink-800 px-2 py-1 text-zinc-500">agent has not written /testbed/output.json yet</span>}
        {agent && <span className="text-[10px] text-zinc-500">captured at step {agent.stepIndex + 1}</span>}
      </div>
      {/* The grids are a viewer-side colorization to aid human review — the
          agent itself only ever read/wrote the raw integer matrix. */}
      <p className="rounded border border-ink-700 bg-ink-900/60 px-2 py-1.5 text-[10px] leading-relaxed text-zinc-500">
        🎨 Viewer colorization. The agent did <span className="text-zinc-400">not</span> see these
        colors — it worked only with the raw integer matrix (ARC palette 0–9). Mismatched cells are
        outlined in <span className="text-rose-300">white/red</span>.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">Expected</div>
          <ArcMiniGrid grid={expected} />
          <div className="mt-1 text-[10px] text-zinc-600">{expected.length}×{expected[0]?.length}</div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fuchsia-300">Agent output</div>
          {grid ? (
            <>
              <ArcMiniGrid grid={grid} compareTo={expected} />
              <div className="mt-1 text-[10px] text-zinc-600">{grid.length}×{grid[0]?.length} · from step {agent!.stepIndex + 1}</div>
            </>
          ) : (
            <div className="grid h-40 place-items-center rounded-lg border border-dashed border-line p-6 text-center text-xs text-zinc-600">
              the agent did not write a 2D-grid JSON to <code>output.json</code> by this step
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function keyFor(a: ArtifactRef): string {
  return a.kind === 'sheet' ? 'sheet:' + a.id : a.kind === 'doc' ? 'doc:' + a.id : a.kind === 'file' ? 'file:' + a.id : a.kind
}
function changeKey(a: ArtifactRef): string {
  return a.kind === 'sheet' ? 'sheet:' + a.id : a.kind === 'doc' ? 'doc:' + a.id : a.kind === 'file' ? 'file:' + a.id : a.kind
}

// ===========================================================================
// IDE workspace: file explorer (left) + terminal / conversation (right)
// ===========================================================================

function kindFromPath(path: string): FileKind {
  const p = path.toLowerCase()
  if (/\.(png|jpe?g|gif|svg|webp)$/.test(p)) return 'image'
  if (/\.(md|markdown)$/.test(p)) return 'markdown'
  if (/\.json$/.test(p)) return 'json'
  if (/\.(html?|vue)$/.test(p)) return 'html'
  if (/\.(diff|patch)$/.test(p)) return 'diff'
  if (/\.(csv|tsv|xlsx|xls)$/.test(p)) return 'spreadsheet'
  return 'code'
}


// Normalize FileEntry.op to the FileTree status-dot vocabulary.
function normOp(op: string): string {
  if (op === 'create') return 'created'
  if (op === 'edit' || op === 'str_replace' || op === 'insert') return 'modified'
  if (op === 'env') return 'env'
  if (op === 'view' || op === 'touched') return 'touched'
  return op
}

/** Foldable, icon'd file tree — same component the task page uses, so the
 *  trajectory Human/Agent view matches it (layers, icons, status dots). */
function FileExplorer({
  fileList,
  openPath,
  onOpen,
  emptyHint,
}: {
  fileList: FileEntry[]
  openPath: string | null
  onOpen: (p: string) => void
  activeStep?: number
  emptyHint?: string
}) {
  const treeFiles: TaskFile[] = useMemo(
    () => fileList.map((f) => ({ path: f.path, kind: kindFromPath(f.path), content: f.content })),
    [fileList],
  )
  const statusByPath = useMemo(
    () => Object.fromEntries(fileList.map((f) => [f.path, normOp(f.op)])),
    [fileList],
  )
  // Show the GitHub-style legend whenever the tree carries any status other
  // than `env` — i.e. as soon as the agent has touched a file.
  const hasChanges = Object.values(statusByPath).some((v) => v && v !== 'env')
  return (
    <div className="flex h-full flex-col bg-ink-900/40">
      <div className="border-b border-ink-700 px-3 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
        Files ({fileList.length})
      </div>
      {hasChanges && (
        <div className="border-b border-ink-700 px-3 py-1.5 text-[10px] text-zinc-500">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <FileLegendChip cls="bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-500/40" letter="A" label="added" />
            <FileLegendChip cls="bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/40" letter="M" label="modified" />
            <FileLegendChip cls="bg-sky-500/25 text-sky-200 ring-1 ring-sky-500/40" letter="T" label="touched" />
            <FileLegendChip cls="bg-rose-500/25 text-rose-200 ring-1 ring-rose-500/40" letter="D" label="deleted" />
            <span className="text-zinc-600">unbadged = env</span>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {fileList.length === 0 ? (
          <p className="px-3 py-2 text-xs leading-relaxed text-zinc-500">{emptyHint ?? 'No files yet.'}</p>
        ) : (
          <FileTree files={treeFiles} selected={openPath ?? undefined} onSelect={(f) => onOpen(f.path)} statusByPath={statusByPath} />
        )}
      </div>
    </div>
  )
}

function FileLegendChip({ cls, letter, label }: { cls: string; letter: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('inline-grid h-3.5 w-3.5 place-items-center rounded font-mono text-[9px] font-bold', cls)}>{letter}</span>
      <span className="text-zinc-500">{label}</span>
    </span>
  )
}

function Terminal({ ws, activeStep }: { ws: Workspace; activeStep: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeStep])
  if (ws.terminal.length === 0) {
    return <div className="grid h-full place-items-center p-4 text-xs text-zinc-600">No tool/terminal activity yet.</div>
  }
  return (
    <div ref={ref} data-tour="ide-terminal" className="h-full overflow-auto bg-ink-950 p-3 font-mono text-[12px] leading-relaxed">
      {ws.terminal.map((e, i) => (
        <div key={i} data-active={e.step === activeStep} className={clsx('mb-2', e.step === activeStep && 'rounded bg-accent/10 ring-1 ring-accent/30')}>
          <div className={clsx('px-1', e.isBash ? 'text-emerald-300' : 'text-violet-300')}>
            {e.isBash ? e.command : <span>▸ {e.command}</span>}
          </div>
          {e.output && (
            <div className="whitespace-pre-wrap px-1 text-zinc-500">
              {e.output.length > 1600 ? e.output.slice(0, 1600) + '\n…' : e.output}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const ROLE_AVATAR: Record<string, { icon: string; name: string; cls: string; bubble: string; side: 'left' | 'right' }> = {
  user: { icon: '🧑‍💼', name: 'User', cls: 'bg-sky-500/15 ring-sky-500/30', bubble: 'rounded-tl-sm bg-sky-500/10 text-zinc-100', side: 'left' },
  assistant: { icon: '🤖', name: 'Agent', cls: 'bg-violet-500/15 ring-violet-500/30', bubble: 'rounded-tr-sm bg-violet-500/10 text-zinc-100', side: 'right' },
  agent: { icon: '🤖', name: 'Agent', cls: 'bg-violet-500/15 ring-violet-500/30', bubble: 'rounded-tr-sm bg-violet-500/10 text-zinc-100', side: 'right' },
  tool: { icon: '🛠', name: 'Tool result', cls: 'bg-emerald-500/15 ring-emerald-500/30', bubble: 'rounded-tl-sm bg-emerald-500/10 text-zinc-100', side: 'left' },
}

function InteractionFlow({ ws, activeStep }: { ws: Workspace; activeStep: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeStep])
  return (
    <div ref={ref} className="h-full space-y-3 overflow-auto p-4">
      {ws.conversation.map((m, i) => {
        const a = ROLE_AVATAR[m.role] ?? { icon: '•', name: m.role, cls: 'bg-ink-800 ring-ink-700', bubble: 'bg-ink-800 text-zinc-200', side: 'left' as const }
        const isLeft = a.side === 'left'
        const active = m.step === activeStep
        return (
          <div key={i} data-active={active} className={clsx('flex gap-2', isLeft ? 'flex-row' : 'flex-row-reverse')}>
            <div className={clsx('grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ring-1', a.cls)}>{a.icon}</div>
            <div className={clsx('max-w-[80%] rounded-2xl px-3 py-2 text-sm', a.bubble, active && 'ring-2 ring-accent/50')}>
              <div className={clsx('mb-0.5 text-[10px] uppercase tracking-wide text-zinc-500', !isLeft && 'text-right')}>{a.name}</div>
              {m.content?.startsWith('→ called') ? (
                <span className="font-mono text-xs text-violet-300">{m.content}</span>
              ) : (
                <div className="line-clamp-[12]"><Markdown content={m.content || '…'} /></div>
              )}
            </div>
          </div>
        )
      })}
      {ws.conversation.length === 0 && <p className="text-xs text-zinc-600">No conversation messages.</p>}
    </div>
  )
}

function FileTab({ path, content }: { path: string; content?: string }) {
  if (!content) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-xs text-zinc-600">
        <div>
          <code className="text-zinc-400">{path}</code>
          <div className="mt-1">No captured content — the agent referenced this file but its contents weren't recorded.</div>
        </div>
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto p-3">
      <FileRenderer file={{ path, kind: kindFromPath(path), content }} />
    </div>
  )
}

function WorkspacePanel({ ws, activeStep, task }: { ws: Workspace; activeStep: number; task?: Task }) {
  // right pane tab: 'terminal' | 'chat' | 'file:<path>'
  const isConvo = ws.userTurns > 1
  const [tab, setTab] = useState<string>(ws.terminal.length ? 'terminal' : isConvo ? 'chat' : 'terminal')
  const [fsView, setFsView] = useState<'agent' | 'human'>('agent')

  // Auto-follow: when the active step writes/edits a file, open it so you can
  // see exactly which file the agent changed at this step and how it renders.
  useEffect(() => {
    const changed = ws.files.filter(
      (f) => f.step === activeStep && (f.op === 'create' || f.op === 'edit' || f.op === 'append'),
    )
    if (changed.length) setTab('file:' + changed[changed.length - 1].path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep])

  const humanFiles: FileEntry[] = useMemo(
    () =>
      (task?.files ?? [])
        .filter((f) => f.content != null)
        .map((f) => ({ path: f.path, content: f.content, step: -1, op: 'env' })),
    [task],
  )
  const env = useMemo(() => (task ? interpretEnvironment(task) : null), [task])
  const hasEnv = !!env
  const services = useMemo(() => (env ? [...env.services.map((s) => s.name), ...(env.enabledApps ?? [])] : []), [env])

  // Agent view, consistent with the task page: when the task is containerised,
  // reconstruct the container filesystem via the Dockerfile COPY/WORKDIR rules
  // (buildAgentFs), then overlay the files the agent actually created/modified.
  // For non-containerised tasks we fall back to the raw seeded files + touches.
  const touched = useMemo<FsNode[]>(
    () =>
      ws.files
        .filter((f) => f.op && f.op !== 'env')
        .map((f) => ({
          path: f.path,
          content: f.content,
          status: f.op === 'create' ? 'created' : f.op === 'view' || f.op === 'touched' ? 'touched' : 'modified',
          origin: f.path,
        })),
    [ws.files],
  )
  const agentFs = useMemo(() => (task && hasEnv ? buildAgentFs(task, touched) : null), [task, hasEnv, touched])
  const st2op = (s: string) => (s === 'created' ? 'create' : s === 'modified' ? 'edit' : s === 'env' ? 'env' : 'touched')
  const agentFiles: FileEntry[] = useMemo(
    () => (agentFs ? agentFs.nodes.map((n) => ({ path: n.path, content: n.content, step: -1, op: st2op(n.status) })) : ws.files),
    [agentFs, ws.files],
  )

  const fileList = fsView === 'agent' ? agentFiles : humanFiles
  const agentEmptyHint = fsView === 'agent' && hasEnv && agentFiles.length === 0
    ? `No agent filesystem to show — the Dockerfile copies no files into the container (base image “${env?.baseImage ?? ''}” provides the tree) and this run wrote none.${services.length ? ` The agent worked against services: ${services.join(', ')}.` : ''}`
    : undefined
  const openFile = tab.startsWith('file:') ? tab.slice(5) : null
  const openFileEntry = openFile ? fileList.find((f) => f.path === openFile) ?? ws.files.find((f) => f.path === openFile) : null

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={28} minSize={14}>
        <div data-tour="ide-files" className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-ink-700 px-2 py-1">
            <button data-tour="ws-view-agent" onClick={() => setFsView('agent')} className={clsx('rounded px-2 py-0.5 text-[11px] font-medium', fsView === 'agent' ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200')} title="Container filesystem the agent sees">🤖 Agent</button>
            <button data-tour="ws-view-human" onClick={() => setFsView('human')} disabled={!humanFiles.length} className={clsx('rounded px-2 py-0.5 text-[11px] font-medium disabled:opacity-30', fsView === 'human' ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200')} title="Raw task directory">👤 Human</button>
            {services.length > 0 && (
              <span className="ml-auto flex items-center gap-1 truncate" title="other services running alongside">
                {services.slice(0, 3).map((s) => (
                  <span key={s} className="rounded-full bg-ink-800 px-1.5 text-[9px] text-zinc-400">🫧 {s}</span>
                ))}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <FileExplorer fileList={fileList} openPath={openFile} onOpen={(p) => setTab('file:' + p)} activeStep={activeStep} emptyHint={agentEmptyHint} />
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="w-1 bg-ink-700 transition-colors hover:bg-accent/50" />
      <Panel defaultSize={74} minSize={30}>
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-ink-700 px-2 py-1">
            <TabBtn active={tab === 'terminal'} onClick={() => setTab('terminal')}>Terminal</TabBtn>
            {isConvo && <TabBtn active={tab === 'chat'} onClick={() => setTab('chat')}>Conversation</TabBtn>}
            {openFile && (
              <TabBtn active onClick={() => {}}>
                <span className="max-w-[160px] truncate">{openFile.split('/').pop()}</span>
                <span onClick={(e) => { e.stopPropagation(); setTab(ws.terminal.length ? 'terminal' : 'chat') }} className="ml-1 text-zinc-500 hover:text-white">×</span>
              </TabBtn>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'terminal' && <Terminal ws={ws} activeStep={activeStep} />}
            {tab === 'chat' && <InteractionFlow ws={ws} activeStep={activeStep} />}
            {openFile && <FileTab path={openFile} content={openFileEntry?.content} />}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center rounded px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-ink-800 text-white' : 'text-zinc-500 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  )
}

export default function EnvironmentStage({ steps, activeStep, task }: { steps: Step[]; activeStep: number; task?: Task }) {
  const ws = useMemo(() => reconstructWorkspace(steps, activeStep, task?.files), [steps, activeStep, task])
  return (
    <PanelGroup direction="vertical" className="h-full" autoSaveId="stage-vertical">
      <Panel defaultSize={52} minSize={18}>
        <WorkspacePanel ws={ws} activeStep={activeStep} task={task} />
      </Panel>
      <PanelResizeHandle className="h-1 bg-ink-700 transition-colors hover:bg-accent/50" />
      <Panel defaultSize={48} minSize={15}>
        <ArtifactViewer steps={steps} activeStep={activeStep} task={task} ws={ws} />
      </Panel>
    </PanelGroup>
  )
}
