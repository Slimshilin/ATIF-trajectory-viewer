// ---------------------------------------------------------------------------
// ARC-AGI grid rendering — 2D number arrays (palette 0–9) drawn as colored
// cells. Shared by FileRenderer (clicked .json files), Markdown (grids embedded
// in instruction text), and the trajectory step view. Kept in its own module so
// Markdown can use it without a circular import through FileRenderer.
//
// Handles the three shapes the dataset ships:
//   - single grid:   [[…], …]
//   - example pair:  { "input": [[…]], "output": [[…]] }
//   - training set:  { "train": [{input, output}], "test": [{input, output}] }
// ---------------------------------------------------------------------------

export const ARC_PALETTE = [
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

export type Grid = number[][]
export interface NamedGrid { name: string; grid: Grid }

export function isArcGrid(v: unknown): v is Grid {
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

export function tryParseArcGrids(content: string): NamedGrid[] | null {
  let v: unknown
  try { v = JSON.parse(content) } catch { return null }
  // single grid
  if (isArcGrid(v)) return [{ name: 'grid', grid: v }]
  // {input, output}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (isArcGrid(o.input) && isArcGrid(o.output)) return [{ name: 'input', grid: o.input }, { name: 'output', grid: o.output }]
    // ARC train/test arrays
    if (Array.isArray(o.train) || Array.isArray(o.test)) {
      const out: NamedGrid[] = []
      for (const [k, arr] of Object.entries(o)) {
        if (Array.isArray(arr)) {
          for (let i = 0; i < arr.length; i++) {
            const ex = arr[i] as { input?: unknown; output?: unknown }
            if (ex && isArcGrid(ex.input)) out.push({ name: `${k}[${i}] input`, grid: ex.input })
            if (ex && isArcGrid(ex.output)) out.push({ name: `${k}[${i}] output`, grid: ex.output })
          }
        }
      }
      if (out.length) return out
    }
  }
  return null
}

/** Read an ARC grid that starts at `lines[start]` and may span several lines
 *  (pretty-printed). Returns the parsed grids and how many lines were consumed,
 *  or null if the block isn't a clean ARC grid. Used by the Markdown renderer
 *  to turn inline `[[…]]` payloads in instructions into colored grids. */
export function readArcGridBlock(
  lines: string[],
  start: number,
): { grids: NamedGrid[]; consumed: number } | null {
  if (!/^\s*\[/.test(lines[start] ?? '')) return null
  let depth = 0
  let consumed = 0
  const buf: string[] = []
  for (let i = start; i < lines.length && consumed < 80; i++) {
    const l = lines[i]
    buf.push(l)
    consumed++
    for (const ch of l) {
      if (ch === '[') depth++
      else if (ch === ']') depth--
    }
    if (depth <= 0) break
  }
  if (depth !== 0) return null
  const grids = tryParseArcGrids(buf.join('\n').trim())
  return grids ? { grids, consumed } : null
}

export function ArcGridView({ grids }: { grids: NamedGrid[] }) {
  return (
    <div className="space-y-5 p-3">
      {grids.map((g, i) => <ArcGrid key={`${g.name}-${i}`} {...g} />)}
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
