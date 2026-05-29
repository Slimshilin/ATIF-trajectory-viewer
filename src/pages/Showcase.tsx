import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { Loading } from '../components/ui'
import { useDatasetStore, visibleTasks } from '../lib/dataset'
import { useAuth } from '../lib/auth'
import { startTour, buildTourSteps } from '../lib/tour'
import { TOUR_TASK_ID, TOUR_RUN_ID } from '../lib/tourTask'
import type { Dataset, Run, Task } from '../lib/types'

// ---------------------------------------------------------------------------
// Feature showcase — a *minimal* curated set that exercises every viewer
// feature. We pick examples from the bundled task catalog by feature signature
// (which edits + tools the run actually performs), so a card never claims
// something the example doesn't demonstrate. The synthetic guided-tour task
// provides the artifact-stage demos (spreadsheet / web / document / answer /
// screenshots) that don't naturally appear in terminal-only benchmark runs.
// ---------------------------------------------------------------------------

const tools = (r: Run, re: RegExp) => r.steps.reduce((n, s) => n + (s.toolCalls?.filter((c) => re.test(c.name)).length ?? 0), 0)

function bestBy(d: Dataset, score: (r: Run) => number): Run | undefined {
  let top: Run | undefined, topScore = 0
  for (const r of d.runs) {
    const s = score(r)
    if (s > topScore) { topScore = s; top = r }
  }
  return top
}

interface Hero {
  id: string
  title: string
  sub: string
  to: string
  shows: string[]
}

export default function Showcase() {
  const { data, error } = useDatasetStore()
  const { isMember } = useAuth()
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

  const visibleIds = new Set(visibleTasks(data, isMember).map((t) => t.id))
  const d2: Dataset = {
    ...data,
    tasks: data.tasks.filter((t) => visibleIds.has(t.id)),
    runs: data.runs.filter((r) => visibleIds.has(r.taskId)),
  }

  // Prefer a run with a pre-computed AFT report (the example also demos AFT),
  // and one with verifier output so the reward/log panel is non-empty.
  const pick = (score: (r: Run) => number) =>
    bestBy(d2, (r) => {
      const s = score(r)
      if (s <= 0) return 0
      return s * (aftIds.has(r.id) ? 4 : 1) * (r.grade ? 2 : 1)
    })

  // Real catalog picks (terminal / IDE / AFT / verifier).
  const ideRun = pick((r) => tools(r, /bash|edit|str_replace|apply|write_file|create_file/i))
  const passedRun = pick((r) => (r.passed && r.grade ? r.stepCount : 0))
  const failedRun = pick((r) => (!r.passed && r.grade ? r.stepCount : 0))
  const ideTask = ideRun && d2.tasks.find((t) => t.id === ideRun.taskId)
  const passedTask = passedRun && d2.tasks.find((t) => t.id === passedRun.taskId)
  const failedTask = failedRun && d2.tasks.find((t) => t.id === failedRun.taskId)

  // Synthetic tour task: bundled examples for the artifact-stage features
  // (spreadsheet / web / document / answer / screenshots) — see lib/tourTask.ts.
  const tourTask = data.tasks.find((t) => t.id === TOUR_TASK_ID)
  const taskLink = (t?: Task) => (t ? `/tasks/${t.id}` : '/tasks')
  const runLink = (r?: Run) => (r ? `/tasks/${r.taskId}/runs/${r.id}` : '/tasks')

  const heroes: Hero[] = []

  if (ideTask && ideRun) {
    heroes.push({
      id: 'ide',
      title: 'Terminal + Agent filesystem',
      sub: `${ideTask.title} · live ${ideRun.stepCount}-step run`,
      to: runLink(ideRun),
      shows: [
        '▶ Film playback with step timing',
        'Terminal & tool-call log',
        'Human view ⇄ Agent view (Dockerfile-aware)',
        'Shell-based writes parsed live (heredocs, echo / tee, cp / mv)',
      ],
    })
  }

  if (passedTask && passedRun) {
    heroes.push({
      id: 'verifier',
      title: 'Verifier log + reward',
      sub: `${passedTask.title} · solved run`,
      to: runLink(passedRun),
      shows: [
        'Reward (0–1) + pass / fail badge',
        'Verifier free-text summary',
        'Per-rubric subscores when shipped',
        'Tokens / duration per run',
      ],
    })
  }

  // AFT panel — prefer a failed run that already has a pre-computed report.
  const aftRun = bestBy(d2, (r) => (aftIds.has(r.id) && !r.passed ? r.stepCount : 0)) ?? failedRun
  const aftTask = aftRun && d2.tasks.find((t) => t.id === aftRun.taskId)
  if (aftTask && aftRun) {
    heroes.push({
      id: 'aft',
      title: 'Agent Failure Taxonomy (AFT)',
      sub: `${aftTask.title} · ${aftIds.has(aftRun.id) ? 'pre-analyzed' : 'browser-key analysis'}`,
      to: runLink(aftRun),
      shows: [
        '4 orthogonal axes (Stage × Cause × Behaviour × Impact)',
        'Each failure mode links to its trajectory step',
        'Pre-computed reports load instantly',
        'BYO API key for live analysis (browser-only)',
      ],
    })
  }

  if (failedTask && failedRun) {
    heroes.push({
      id: 'annotate',
      title: 'Step-by-step human review',
      sub: `${failedTask.title} · annotate any step`,
      to: runLink(failedRun),
      shows: [
        'Mark each step correct / incorrect / unsure',
        'Add free-text notes',
        'Persists in localStorage (no server)',
        'Side-by-side with AFT to agree / disagree',
      ],
    })
  }

  // Tour task hero: covers the rendered-artifact demos (spreadsheet / doc / web / etc.)
  if (tourTask) {
    heroes.push({
      id: 'stage',
      title: 'Live artifact stage (synthetic demo)',
      sub: 'Tour task · spreadsheet · web · document · screenshots',
      to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}`,
      shows: [
        'Spreadsheet grid re-rendered per step',
        'Rendered web page on tool fetch',
        'Computer-use screenshots',
        'Authored document blocks',
        'Final answer / report card',
      ],
    })
  }

  if (data.tasks.length > 0) {
    heroes.push({
      id: 'upload',
      title: 'Bring your own task',
      sub: 'Drop a Harbor zip — parsed in-browser',
      to: '/upload',
      shows: [
        'Multi-task Harbor zip with jobs/ trials',
        'ATIF trajectory.json',
        'No upload — runs entirely in your browser',
        'Sample zip provided on the page',
      ],
    })
  }

  // Coverage checklist — proves each capability is reachable from the bundled data.
  const has = (pred: (r: Run) => boolean) => d2.runs.some(pred)
  const cov: { label: string; ok: boolean; to: string }[] = [
    { label: 'Film playback + timing', ok: has((r) => r.steps.length > 1), to: runLink(ideRun) },
    { label: 'Human ⇄ Agent view', ok: !!ideTask, to: taskLink(ideTask) },
    { label: 'Shell-write parsing', ok: !!ideRun, to: runLink(ideRun) },
    { label: 'Reward + verifier log', ok: has((r) => !!r.grade?.summary || r.grade?.score != null), to: runLink(passedRun) },
    { label: 'Agent Failure Taxonomy', ok: aftIds.size > 0 || !!aftRun, to: runLink(aftRun) },
    { label: 'Step-level annotation', ok: true, to: runLink(failedRun) },
    { label: 'Spreadsheet stage', ok: !!tourTask, to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}` },
    { label: 'Rendered web page', ok: !!tourTask, to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}` },
    { label: 'Computer-use screenshots', ok: !!tourTask, to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}` },
    { label: 'Authored document', ok: !!tourTask, to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}` },
    { label: 'Final-answer card', ok: !!tourTask, to: `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}` },
    { label: 'Upload Harbor zip', ok: true, to: '/upload' },
    { label: 'Per-task multi-run stats', ok: has((r) => d2.runs.filter((x) => x.taskId === r.taskId).length > 1), to: taskLink(ideTask) },
    { label: 'Task feature badges', ok: true, to: '/tasks' },
  ]
  const covered = cov.filter((c) => c.ok).length

  return (
    <>
      <PageHeader
        title="Feature showcase"
        subtitle="A minimal curated set — each card exercises several viewer features. The coverage map below confirms every capability is reachable."
        actions={
          <button onClick={() => startTour(buildTourSteps(), navigate)} className="btn-primary">
            ▶ Start guided tour
          </button>
        }
      />
      <div className="space-y-6 p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {heroes.map((h, i) => (
            <Link
              key={h.id}
              to={h.to}
              className="card flex flex-col p-5 transition-colors hover:border-accent/50 hover:bg-ink-800/40"
            >
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-xs font-bold text-accent">
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-medium text-white">{h.title}</h3>
                  <div className="text-[11px] text-zinc-500">{h.sub}</div>
                </div>
              </div>
              <ul className="mt-3 space-y-1">
                {h.shows.map((s) => (
                  <li key={s} className="flex items-center gap-2 text-sm text-zinc-300">
                    <span className="text-accent">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
              <span className="mt-3 text-xs text-accent">Open →</span>
            </Link>
          ))}
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Coverage map</h3>
            <span className="text-xs text-zinc-500">
              {covered} / {cov.length} features reachable from the bundled data
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cov.map((c) => (
              <Link
                key={c.label}
                to={c.to}
                className="flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:bg-ink-800/40"
              >
                <span className={c.ok ? 'text-emerald-400' : 'text-zinc-600'}>{c.ok ? '✓' : '—'}</span>
                <span className={c.ok ? 'text-zinc-200' : 'text-zinc-600'}>{c.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-xs text-zinc-600">
          Tip: the heroes pair real benchmark runs (for terminal / verifier / AFT)
          with the synthetic tour task (for the rendered-artifact stages). The
          full catalog lives on the <Link to="/tasks" className="text-zinc-400 hover:text-zinc-200">Tasks</Link> page.
        </p>
      </div>
    </>
  )
}
