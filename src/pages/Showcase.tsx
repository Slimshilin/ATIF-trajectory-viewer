import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  PlayCircle, Table2, Image as ImageIcon, Grid3x3, Globe, Upload as UploadIcon, type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Loading } from '../components/ui'
import { useDatasetStore } from '../lib/dataset'
import { startTour, buildTourSteps } from '../lib/tour'
import { TOUR_TASK_ID, TOUR_RUN_ID } from '../lib/tourTask'

// ---------------------------------------------------------------------------
// Feature showcase — minimal, deliberately curated.
//
// The user feedback: most features (verifier log, reward, AFT, step review,
// terminal + agent FS, replay) are visible on EVERY task. So one well-chosen
// "anchor" run demonstrates all of them at once. The other cards each surface
// ONE special-format artifact that needs its own renderer: spreadsheet,
// image, ARC grid, web page. The catalog at /tasks shows the full set.
// ---------------------------------------------------------------------------

// Anchor task: real benchmark with substantial trajectory + pre-baked AFT.
// `gso-speedup-pandas-period-fmt` ships ~100 steps of agent code edits +
// verifier output + an opus__r1 audit report → it shows everything the viewer
// can do in one click.
const ANCHOR_TASK = 'hi-gso-speedup-pandas-period-fmt'

// Special-feature picks.
const FEATURE_PICKS = {
  spreadsheet: { taskId: 'hi-spreadsheetbench-sort-spreadsheet-by-helper' },
  image:       { taskId: 'hi-labbench-habenula-fluorescence-change' },
  grid:        { taskId: 'hi-arcagi2-grid-transform-de80' },
  web:         { taskId: TOUR_TASK_ID, runId: TOUR_RUN_ID, runStep: 8 }, // tour run renders web page
} as const

interface Card {
  id: string
  Icon: LucideIcon
  title: string
  subtitle: string
  body: string
  to: string
  cta: string
  badge?: string
}

export default function Showcase() {
  const { data, error } = useDatasetStore()
  const navigate = useNavigate()
  const [aftIds, setAftIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}aft/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: string[]) => setAftIds(new Set(ids)))
      .catch(() => {})
  }, [])

  if (error) return <div className="p-8 text-rose-400">Failed to load dataset: {error}</div>
  if (!data) return <Loading />

  // Anchor — open its first run directly so the viewer shows everything.
  const anchorTask = data.tasks.find((t) => t.id === ANCHOR_TASK)
  const anchorRun = anchorTask ? data.runs.find((r) => r.taskId === ANCHOR_TASK) : undefined
  const anchorAft = anchorRun && aftIds.has(anchorRun.id)

  const cards: Card[] = []

  if (anchorTask && anchorRun) {
    cards.push({
      id: 'anchor',
      Icon: PlayCircle,
      title: 'One run, every general feature',
      subtitle: anchorTask.title,
      body:
        'Click in to see replay, step timeline, terminal + agent filesystem (with the Human ⇄ Agent toggle), ' +
        'reward + verifier log, AFT failure analysis with clickable step jumps, per-step human annotation, and ' +
        'the change/artifact log — all on one real benchmark run with a pre-baked audit.',
      to: `/tasks/${anchorTask.id}/runs/${anchorRun.id}`,
      cta: 'Open run',
      badge: anchorAft ? '✦ Pre-analyzed' : undefined,
    })
  }

  // Special-feature cards — one task each, focused on the rare renderer they exercise.
  const spreadsheet = data.tasks.find((t) => t.id === FEATURE_PICKS.spreadsheet.taskId)
  if (spreadsheet) cards.push({
    id: 'spreadsheet',
    Icon: Table2,
    title: 'Spreadsheet rendering',
    subtitle: spreadsheet.title,
    body:
      'Multi-sheet `.xlsx` workbooks parsed at ingest into the @@SHEET marker format and rendered ' +
      'as tabbed grids — sticky row/col headers, type-cast cells, click any sheet tab to switch.',
    to: `/tasks/${spreadsheet.id}`,
    cta: 'Open task',
  })

  const image = data.tasks.find((t) => t.id === FEATURE_PICKS.image.taskId)
  if (image) cards.push({
    id: 'image',
    Icon: ImageIcon,
    title: 'Inlined images',
    subtitle: image.title,
    body:
      'Any .png / .jpg / .svg file under the task directory is base64-inlined at ingest, so binary ' +
      'figures (here a fluorescence micrograph) render in the file viewer with no asset hosting.',
    to: `/tasks/${image.id}`,
    cta: 'Open task',
  })

  const grid = data.tasks.find((t) => t.id === FEATURE_PICKS.grid.taskId)
  if (grid) cards.push({
    id: 'grid',
    Icon: Grid3x3,
    title: 'ARC AGI grid renderer',
    subtitle: grid.title,
    body:
      "JSON files that match the ARC shape (2D integer arrays, palette 0–9) render as colored cell " +
      "grids instead of raw numbers — including the canonical ARC palette (black / blue / red / green / " +
      "yellow / gray / pink / orange / cyan / maroon).",
    to: `/tasks/${grid.id}`,
    cta: 'Open task',
  })

  const web = FEATURE_PICKS.web
  cards.push({
    id: 'web',
    Icon: Globe,
    title: 'Web-page artifact stage',
    subtitle: 'Tour run (synthetic) · step 8',
    body:
      'When an agent fetches a URL the right rail re-renders the page content (markdown / HTML) at that ' +
      'step — useful for diagnosing whether the agent used the live figure vs. a cached snapshot. ' +
      'Demonstrated on the synthetic tour run because no real benchmark fetches a static page.',
    to: `/tasks/${web.taskId}/runs/${web.runId}?step=${web.runStep}`,
    cta: 'Jump to step 8',
  })

  cards.push({
    id: 'upload',
    Icon: UploadIcon,
    title: 'Upload your own',
    subtitle: 'Drop a Harbor task zip',
    body:
      'The /upload page parses an entire Harbor task directory in-browser — no upload, no server. Useful ' +
      'for showing your own task.toml / instruction / tests / solution to colleagues without redeploying.',
    to: '/upload',
    cta: 'Open upload',
  })

  return (
    <>
      <PageHeader
        title="Feature showcase"
        subtitle="One anchor run for the general features, one card per specialised renderer. The full catalog lives under Tasks."
        actions={
          <button onClick={() => startTour(buildTourSteps(), navigate)} className="btn-primary">
            ▶ Start guided tour
          </button>
        }
      />
      <div className="space-y-6 p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c, i) => (
            <Link
              key={c.id}
              to={c.to}
              className="card flex flex-col p-5 transition-colors hover:border-accent/50 hover:bg-ink-800/40"
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
                  <c.Icon size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-white">{c.title}</h3>
                    {i === 0 && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">Start here</span>}
                  </div>
                  <div className="truncate text-[11px] text-zinc-500">{c.subtitle}</div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-300">{c.body}</p>
              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="text-accent">{c.cta} →</span>
                {c.badge && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300">{c.badge}</span>}
              </div>
            </Link>
          ))}
        </div>
        <p className="text-xs text-zinc-600">
          Everything else — model leaderboards across all task sources, the AFT taxonomy reference,
          per-step annotations — is reachable from the anchor run or the <Link to="/tasks" className="text-zinc-400 hover:text-zinc-200">Tasks catalog</Link>.
        </p>
      </div>
    </>
  )
}
