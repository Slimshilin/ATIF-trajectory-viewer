import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { Loading } from '../components/ui'
import { useDatasetStore, visibleTasks } from '../lib/dataset'
import { useAuth } from '../lib/auth'
import { startTour, buildTourSteps } from '../lib/tour'
import type { Dataset, Run } from '../lib/types'

const edits = (r: Run, t: string) => r.steps.reduce((n, s) => n + (s.edits?.filter((e) => e.t === t).length ?? 0), 0)
const tools = (r: Run, re: RegExp) => r.steps.reduce((n, s) => n + (s.toolCalls?.filter((c) => re.test(c.name)).length ?? 0), 0)
const userTurns = (r: Run) => r.steps.filter((s) => s.role === 'user').length

function best(d: Dataset, score: (r: Run) => number): Run | undefined {
  let top: Run | undefined
  let bestScore = 0
  for (const r of d.runs) {
    const s = score(r)
    if (s > bestScore) { bestScore = s; top = r }
  }
  return top
}

// Feature bullets DERIVED from the actual run, so a card never claims something
// the example doesn't really contain.
function bullets(r: Run | undefined, aft: boolean): string[] {
  if (!r) return []
  const out: string[] = ['▶ Film playback + step timing']
  if (edits(r, 'sheet') + edits(r, 'formula') > 0) out.push('Live spreadsheet / Excel stage')
  if (edits(r, 'web') > 0) out.push('Rendered web page')
  if (edits(r, 'screenshot') > 0) out.push('Computer-use screenshots')
  if (edits(r, 'doc') > 0) out.push('Rendered document')
  if (edits(r, 'answer') > 0) out.push('Final report / answer')
  if (userTurns(r) > 1) out.push('Conversation flow')
  if (tools(r, /bash|edit|str_replace|write|apply/i) > 0) out.push('Terminal + clickable files')
  if (r.grade) out.push('Reward & verifier log')
  if (aft) out.push('AFT failure analysis (clickable steps)')
  return out
}

export default function Showcase() {
  const { data, error } = useDatasetStore()
  const { isTencent } = useAuth()
  const navigate = useNavigate()
  const [aftIds, setAftIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}aft/index.json`).then((r) => (r.ok ? r.json() : [])).then((ids: string[]) => setAftIds(new Set(ids))).catch(() => {})
  }, [])
  if (error) return <div className="p-8 text-rose-400">Failed to load dataset: {error}</div>
  if (!data) return <Loading />

  const visibleIds = new Set(visibleTasks(data, isTencent).map((t) => t.id))
  const d2: Dataset = { ...data, runs: data.runs.filter((r) => visibleIds.has(r.taskId)), tasks: data.tasks.filter((t) => visibleIds.has(t.id)) }

  // Prefer a run that already has a pre-computed AFT report (so the example also
  // demonstrates the analysis); fall back to the best overall otherwise.
  const pick = (score: (r: Run) => number) => best(d2, (r) => (aftIds.has(r.id) ? score(r) * 1000 : score(r)))

  const spreadsheetRun = pick((r) => edits(r, 'sheet') + edits(r, 'formula'))
  const convoRun = pick((r) => (userTurns(r) > 1 ? userTurns(r) + (r.grade ? 5 : 0) : 0))
  const ideRun = pick((r) => tools(r, /bash|edit|str_replace|apply/i))
  const desktopRun = pick((r) => edits(r, 'screenshot'))
  const webRun = pick((r) => edits(r, 'web'))
  const composeTask =
    d2.tasks.find((t) => t.files.some((f) => /docker-compose/i.test(f.path))) ??
    d2.tasks.find((t) => t.files.some((f) => /dockerfile/i.test(f.path)))

  const taskLink = (r?: Run) => (r ? `/tasks/${r.taskId}` : '/tasks')
  // when the example is analyzed, deep-link straight to the run so the AFT/stage is one click away
  const runLink = (r?: Run) => (r ? `/tasks/${r.taskId}/runs/${r.id}` : '/tasks')

  const heroes = [
    { title: 'Financial-model trajectory', sub: 'Halluminate · spreadsheet build', to: taskLink(spreadsheetRun), shows: bullets(spreadsheetRun, !!spreadsheetRun && aftIds.has(spreadsheetRun.id)) },
    { title: 'Multi-turn finance agent', sub: 'Snorkel · simulated user', to: taskLink(convoRun), shows: bullets(convoRun, !!convoRun && aftIds.has(convoRun.id)) },
    { title: 'Coding agent in an IDE', sub: 'FleetAI · full-stack', to: taskLink(ideRun), shows: [...bullets(ideRun, !!ideRun && aftIds.has(ideRun.id)), 'Human ⇄ Agent filesystem'] },
    { title: 'Computer-use / desktop', sub: 'FleetAI · GUI automation', to: runLink(desktopRun), shows: bullets(desktopRun, !!desktopRun && aftIds.has(desktopRun.id)) },
    { title: 'Web research & rendering', sub: 'Chakra · fetched pages', to: runLink(webRun), shows: bullets(webRun, !!webRun && aftIds.has(webRun.id)) },
    { title: 'Harbor task & environment', sub: composeTask ? composeTask.title : 'Dockerfile / compose', to: composeTask ? `/tasks/${composeTask.id}` : '/tasks', shows: ['Dockerfile / compose → Agent view', 'Human ⇄ Agent filesystem', 'Multi-format file render', 'Per-task multi-run stats'] },
  ].filter((h) => h.to !== '/tasks')

  // ---- coverage checklist: prove every capability is demonstrated somewhere --
  const has = (pred: (r: Run) => boolean) => d2.runs.some(pred)
  const cov: { label: string; ok: boolean; to: string }[] = [
    { label: 'Film playback + timing', ok: has((r) => r.steps.length > 1), to: runLink(spreadsheetRun) },
    { label: 'Spreadsheet / Excel stage', ok: !!spreadsheetRun, to: runLink(spreadsheetRun) },
    { label: 'Rendered web page', ok: !!webRun, to: runLink(webRun) },
    { label: 'Computer-use screenshots', ok: !!desktopRun, to: runLink(desktopRun) },
    { label: 'Rendered document', ok: has((r) => edits(r, 'doc') > 0), to: runLink(pick((r) => edits(r, 'doc'))) },
    { label: 'Final report / answer', ok: has((r) => edits(r, 'answer') > 0), to: runLink(pick((r) => edits(r, 'answer'))) },
    { label: 'Conversation flow', ok: !!convoRun, to: runLink(convoRun) },
    { label: 'Terminal + clickable files', ok: !!ideRun, to: runLink(ideRun) },
    { label: 'Human ⇄ Agent filesystem', ok: !!composeTask, to: composeTask ? `/tasks/${composeTask.id}` : '/tasks' },
    { label: 'Reward & verifier log', ok: has((r) => !!r.grade?.summary || !!(r.grade?.findings?.length)), to: runLink(convoRun) },
    { label: 'AFT failure analysis', ok: aftIds.size > 0, to: runLink(spreadsheetRun) },
    { label: 'Human labels / notes', ok: true, to: runLink(spreadsheetRun) },
    { label: 'Per-vendor leaderboards', ok: true, to: '/overview' },
    { label: 'Per-task multi-run stats', ok: has((r) => d2.runs.filter((x) => x.taskId === r.taskId).length > 1), to: taskLink(spreadsheetRun) },
    { label: 'Upload a Harbor zip', ok: true, to: '/upload' },
    { label: 'Task feature badges', ok: true, to: '/tasks' },
  ]
  const covered = cov.filter((c) => c.ok).length

  return (
    <>
      <PageHeader
        title="Feature showcase"
        subtitle="Curated examples — each demonstrates several features. The coverage map below proves every capability is reachable."
        actions={<button onClick={() => startTour(buildTourSteps(), navigate)} className="btn-primary">▶ Start guided tour</button>}
      />
      <div className="space-y-6 p-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {heroes.map((h, i) => (
            <Link key={h.title} to={h.to} className="card flex flex-col p-5 transition-colors hover:border-accent/50 hover:bg-ink-800/40">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/20 text-xs font-bold text-accent">{i + 1}</span>
                <div>
                  <h3 className="font-medium text-white">{h.title}</h3>
                  <div className="text-[11px] text-zinc-500">{h.sub}</div>
                </div>
              </div>
              <ul className="mt-3 space-y-1">
                {h.shows.map((s) => (
                  <li key={s} className="flex items-center gap-2 text-sm text-zinc-300"><span className="text-accent">✓</span>{s}</li>
                ))}
              </ul>
              <span className="mt-3 text-xs text-accent">Open →</span>
            </Link>
          ))}
        </div>

        {/* per-vendor curated picks (selection-easy launcher) */}
        {data.showcase && data.showcase.length > 0 && (
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Per-vendor showcase</h3>
              <span className="text-xs text-zinc-500">
                {data.showcase.length} typical examples across {new Set(data.showcase.map((p) => p.vendorId)).size} vendors · click to open
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.showcase
                .filter((p) => visibleIds.has(p.taskId) && (!p.runId || d2.runs.some((r) => r.id === p.runId)))
                .map((p) => {
                  const v = data.vendors.find((x) => x.id === p.vendorId)
                  const aft = p.runId && aftIds.has(p.runId)
                  // Always land on the task page (file tree + runs table) — opening a
                  // specific run is one click from there, but the task page lets the
                  // user pick which run to inspect.
                  const to = `/tasks/${p.taskId}`
                  return (
                    <Link
                      key={`${p.vendorId}-${p.runId ?? p.taskId}`}
                      to={to}
                      className="flex flex-col gap-1 rounded-lg border border-ink-700 px-3 py-2.5 text-sm transition-colors hover:border-accent/50 hover:bg-ink-800/40"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                          {v?.name ?? p.vendorId}
                        </span>
                        <span className={p.passed === true ? 'text-emerald-400' : p.passed === false ? 'text-rose-400' : 'text-zinc-500'}>
                          {p.passed === true ? '● pass' : p.passed === false ? '● fail' : '○ task only'}
                        </span>
                        {aft && <span className="rounded bg-accent/15 px-1.5 text-[10px] text-accent">AFT</span>}
                        {p.stepCount > 0 && <span className="ml-auto text-xs text-zinc-500">{p.stepCount} steps</span>}
                      </div>
                      <div className="truncate font-medium text-zinc-100" title={p.taskTitle}>{p.taskTitle}</div>
                      <div className="text-xs text-zinc-500">{p.why}</div>
                    </Link>
                  )
                })}
            </div>
          </div>
        )}

        {/* coverage checklist */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Coverage map</h3>
            <span className="text-xs text-zinc-500">{covered} / {cov.length} capabilities reachable from real data</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cov.map((c) => (
              <Link key={c.label} to={c.to} className="flex items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:bg-ink-800/40">
                <span className={c.ok ? 'text-emerald-400' : 'text-zinc-600'}>{c.ok ? '✓' : '—'}</span>
                <span className={c.ok ? 'text-zinc-200' : 'text-zinc-600'}>{c.label}</span>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-xs text-zinc-600">
          Recording tip: the six cards cover playback, all artifact stages (spreadsheet · web · screenshots · document · answer),
          conversation, the IDE, the Harbor environment, reward/verifier logs, and AFT. The guided tour walks the same surface end-to-end on one task.
        </p>
      </div>
    </>
  )
}
