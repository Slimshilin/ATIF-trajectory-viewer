import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { Loading } from '../components/ui'
import { useDatasetStore } from '../lib/dataset'
import { aftLabel } from '../lib/aft'
import { TOUR_VENDOR_ID, TOUR_RUN_ID } from '../lib/tourTask'
import type { AftReport } from '../lib/aft'

const CLOSE_ORDER = ['success', 'near-miss', 'partial', 'far'] as const
const CLOSE_STYLE: Record<string, string> = {
  success: 'bg-emerald-500/70', 'near-miss': 'bg-lime-500/70', partial: 'bg-amber-500/70', far: 'bg-rose-500/70',
}
const CLOSE_DOT: Record<string, string> = {
  success: 'bg-emerald-400', 'near-miss': 'bg-lime-400', partial: 'bg-amber-400', far: 'bg-rose-400',
}
const FACET_NAME: Record<string, string> = { A: 'Stage (when)', B: 'Root cause (why)', C: 'Behaviour (what)', D: 'Impact (how bad)' }
const FACET_COLOR: Record<string, string> = { A: 'bg-sky-500/70', B: 'bg-violet-500/70', C: 'bg-amber-500/70', D: 'bg-rose-500/70' }

interface Loaded extends AftReport { _id: string }
interface Entry {
  id: string; report: Loaded
  taskId: string; taskTitle: string
  vendorId: string; vendorName: string; category: string
  model: string; harness: string; closeness: string
}

// ---- presentational ----
function Bar({ label, n, max, color }: { label: string; n: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-3 px-1 py-0.5">
      <div className="w-44 shrink-0 truncate text-xs text-zinc-300" title={label}>{label}</div>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-800">
        <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${max ? (n / max) * 100 : 0}%` }} />
      </div>
      <div className="w-8 shrink-0 text-right text-xs tabular-nums text-zinc-400">{n}</div>
    </div>
  )
}

type TriState = 'all' | 'some' | 'none'
function Tri({ state, onChange }: { state: TriState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some' }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === 'all'}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
    />
  )
}

export default function AftInsights() {
  const { data } = useDatasetStore()
  const [reports, setReports] = useState<Loaded[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string> | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    fetch(`${base}aft/index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(async (ids: string[]) => {
        const loaded = await Promise.all(
          ids.map((id) => fetch(`${base}aft/${id}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => (j ? { ...j, _id: id } as Loaded : null)).catch(() => null)),
        )
        setReports(loaded.filter((x): x is Loaded => !!x))
      })
      .catch((e) => setErr(String(e)))
  }, [])

  // join reports with dataset → entries (excluding the synthetic tour run)
  const entries = useMemo<Entry[]>(() => {
    if (!reports || !data) return []
    const out: Entry[] = []
    for (const rep of reports) {
      if (rep._id === TOUR_RUN_ID) continue
      const run = data.runs.find((r) => r.id === rep._id)
      const vendorId = run?.vendorId ?? 'other'
      if (vendorId === TOUR_VENDOR_ID) continue
      const task = run ? data.tasks.find((t) => t.id === run.taskId) : data.tasks.find((t) => t.id === rep.task?.id)
      const agent = run ? data.agents.find((a) => a.id === run.agentId) : undefined
      out.push({
        id: rep._id, report: rep,
        taskId: task?.id ?? rep.task?.id ?? 'unknown',
        taskTitle: task?.title ?? rep.task?.id ?? 'Unknown task',
        vendorId, vendorName: data.vendors.find((v) => v.id === vendorId)?.name ?? 'Other',
        category: task?.category ?? 'Uncategorised',
        model: rep.trial?.model ?? agent?.model ?? '—',
        harness: rep.trial?.harness ?? agent?.harness ?? '—',
        closeness: rep.outcome.closeness,
      })
    }
    return out
  }, [reports, data])

  // default-select everything once entries are ready
  useEffect(() => { if (entries.length && sel === null) setSel(new Set(entries.map((e) => e.id))) }, [entries, sel])

  // hierarchy: vendor → category → task → entries
  const tree = useMemo(() => {
    const vmap = new Map<string, { id: string; name: string; cats: Map<string, Map<string, { title: string; runs: Entry[] }>> }>()
    for (const e of entries) {
      if (!vmap.has(e.vendorId)) vmap.set(e.vendorId, { id: e.vendorId, name: e.vendorName, cats: new Map() })
      const v = vmap.get(e.vendorId)!
      if (!v.cats.has(e.category)) v.cats.set(e.category, new Map())
      const c = v.cats.get(e.category)!
      if (!c.has(e.taskId)) c.set(e.taskId, { title: e.taskTitle, runs: [] })
      c.get(e.taskId)!.runs.push(e)
    }
    return [...vmap.values()].map((v) => ({
      ...v,
      cats: [...v.cats.entries()].map(([cat, tasks]) => ({ cat, tasks: [...tasks.entries()].map(([taskId, t]) => ({ taskId, ...t })) })),
    }))
  }, [entries])

  if (err) return <div className="p-8 text-rose-400">Failed to load AFT reports: {err}</div>
  if (!reports || !data || sel === null) return <Loading />
  if (entries.length === 0) {
    return (
      <>
        <PageHeader
          title="AFT insights"
          subtitle="Cross-cutting view of every pre-computed AFT report"
        />
        <div className="p-8">
          <div className="card mx-auto max-w-2xl p-7 text-sm leading-relaxed text-zinc-300">
            <h2 className="mb-3 text-lg font-semibold text-white">No pre-computed AFT reports yet</h2>
            <p>
              The <strong>Agent Failure Taxonomy</strong> panel maps each run's
              failure to four orthogonal axes — when it went wrong (Stage),
              why (Root cause), what the agent did (Behaviour), and how bad
              (Impact). This page aggregates across reports once they exist.
            </p>
            <p className="mt-3">
              To add a report, open any trajectory and click{' '}
              <span className="text-zinc-200">Apply AFT analysis</span> — it runs with your own
              Anthropic / OpenAI API key directly in the browser (the key is never uploaded). The
              result is cached locally, and any reports baked into{' '}
              <code className="rounded bg-ink-800 px-1">public/aft/&lt;runId&gt;.json</code> load
              automatically on every visitor session with no key required.
            </p>
          </div>
        </div>
      </>
    )
  }

  const selected = sel
  const stateOf = (ids: string[]): TriState => {
    const n = ids.filter((id) => selected.has(id)).length
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some'
  }
  const toggle = (ids: string[]) => {
    setSel((prev) => {
      const next = new Set(prev)
      const allOn = ids.every((id) => next.has(id))
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)))
      return next
    })
  }
  const toggleOpen = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  const chosen = entries.filter((e) => selected.has(e.id))

  // aggregation over the SELECTED entries
  const closeness: Record<string, number> = {}
  const hacking: Record<string, number> = {}
  const facet: Record<'A' | 'B' | 'C' | 'D', Record<string, number>> = { A: {}, B: {}, C: {}, D: {} }
  let modes = 0
  for (const e of chosen) {
    const r = e.report
    closeness[r.outcome.closeness] = (closeness[r.outcome.closeness] ?? 0) + 1
    hacking[r.reward_hacking?.verdict ?? 'clean'] = (hacking[r.reward_hacking?.verdict ?? 'clean'] ?? 0) + 1
    for (const m of r.failure_modes ?? []) {
      modes++
      ;(['A', 'B', 'C', 'D'] as const).forEach((k) => { const c = m.aft?.[k]; if (c) facet[k][c] = (facet[k][c] ?? 0) + 1 })
    }
  }
  const top = (m: Record<string, number>, n = 8) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n)
  const closeMax = Math.max(...CLOSE_ORDER.map((c) => closeness[c] ?? 0), 1)
  const allIds = entries.map((e) => e.id)

  return (
    <>
      <PageHeader
        title="AFT insights"
        subtitle={`${chosen.length} of ${entries.length} analyzed runs selected · ${modes} failure modes`}
        actions={
          <div className="flex gap-2">
            <button onClick={() => setSel(new Set(allIds))} className="btn-ghost border border-line text-xs">Select all</button>
            <button onClick={() => setSel(new Set())} className="btn-ghost border border-line text-xs">Clear</button>
          </div>
        }
      />
      <div className="grid gap-6 p-8 lg:grid-cols-[320px_1fr]">
        {/* ---- selection tree ---- */}
        <div className="card h-fit p-3 lg:sticky lg:top-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pick runs to aggregate</span>
            <Tri state={stateOf(allIds)} onChange={() => toggle(allIds)} />
          </div>
          <div className="max-h-[70vh] space-y-0.5 overflow-y-auto">
            {tree.map((v) => {
              const vIds = v.cats.flatMap((c) => c.tasks.flatMap((t) => t.runs.map((r) => r.id)))
              const vKey = `v:${v.id}`
              return (
                <div key={v.id}>
                  <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-ink-800/50">
                    <button onClick={() => toggleOpen(vKey)} className="text-zinc-500 hover:text-zinc-200">
                      <ChevronRight size={14} className={clsx('transition-transform', open.has(vKey) && 'rotate-90')} />
                    </button>
                    <Tri state={stateOf(vIds)} onChange={() => toggle(vIds)} />
                    <span className="flex-1 truncate text-sm font-medium text-zinc-200">{v.name}</span>
                    <span className="text-[10px] text-zinc-600">{vIds.filter((id) => selected.has(id)).length}/{vIds.length}</span>
                  </div>
                  {open.has(vKey) && v.cats.map((c) => {
                    const cIds = c.tasks.flatMap((t) => t.runs.map((r) => r.id))
                    const cKey = `${vKey}/c:${c.cat}`
                    return (
                      <div key={c.cat} className="ml-4">
                        <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-ink-800/50">
                          <button onClick={() => toggleOpen(cKey)} className="text-zinc-500 hover:text-zinc-200">
                            <ChevronRight size={13} className={clsx('transition-transform', open.has(cKey) && 'rotate-90')} />
                          </button>
                          <Tri state={stateOf(cIds)} onChange={() => toggle(cIds)} />
                          <span className="flex-1 truncate text-xs text-zinc-300">{c.cat}</span>
                          <span className="text-[10px] text-zinc-600">{cIds.length}</span>
                        </div>
                        {open.has(cKey) && c.tasks.map((t) => {
                          const tIds = t.runs.map((r) => r.id)
                          const tKey = `${cKey}/t:${t.taskId}`
                          return (
                            <div key={t.taskId} className="ml-4">
                              <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-ink-800/50">
                                <button onClick={() => toggleOpen(tKey)} className="text-zinc-500 hover:text-zinc-200">
                                  <ChevronRight size={12} className={clsx('transition-transform', open.has(tKey) && 'rotate-90')} />
                                </button>
                                <Tri state={stateOf(tIds)} onChange={() => toggle(tIds)} />
                                <span className="flex-1 truncate text-xs text-zinc-400" title={t.title}>{t.title}</span>
                                <span className="text-[10px] text-zinc-600">{tIds.length}</span>
                              </div>
                              {open.has(tKey) && t.runs.map((r) => (
                                <div key={r.id} className="ml-5 flex items-center gap-1.5 rounded px-1 py-1 hover:bg-ink-800/50">
                                  <Tri state={selected.has(r.id) ? 'all' : 'none'} onChange={() => toggle([r.id])} />
                                  <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', CLOSE_DOT[r.closeness] ?? 'bg-zinc-600')} />
                                  <span className="flex-1 truncate text-[11px] text-zinc-400">{r.model} · {r.harness}</span>
                                  <Link to={`/tasks/${r.taskId}/runs/${r.id}`} title="open trajectory" className="text-zinc-600 hover:text-accent"><ExternalLink size={12} /></Link>
                                </div>
                              ))}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* ---- charts (recompute on selection) ---- */}
        <div className="space-y-6">
          {chosen.length === 0 ? (
            <div className="card p-8 text-center text-sm text-zinc-500">Select one or more runs on the left to aggregate their failure analysis.</div>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold text-white">How close did runs get?</h3>
                  <div className="space-y-1.5">
                    {CLOSE_ORDER.map((c) => <Bar key={c} label={c} n={closeness[c] ?? 0} max={closeMax} color={CLOSE_STYLE[c]} />)}
                  </div>
                  <p className="mt-3 text-[11px] text-zinc-600">success = passed the gate · far = far from a passing solution.</p>
                </div>
                <div className="card p-5">
                  <h3 className="mb-3 text-sm font-semibold text-white">Reward-hacking screen</h3>
                  <div className="space-y-1.5">
                    {['clean', 'suspicious', 'hack'].map((v) => (
                      <Bar key={v} label={v} n={hacking[v] ?? 0} max={Math.max(...Object.values(hacking), 1)} color={v === 'clean' ? 'bg-emerald-500/70' : v === 'hack' ? 'bg-rose-500/70' : 'bg-amber-500/70'} />
                    ))}
                  </div>
                  <p className="mt-3 text-[11px] text-zinc-600">Each audit also flags whether the run gamed the grader.</p>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(['A', 'B', 'C', 'D'] as const).map((k) => {
                  const rows = top(facet[k])
                  const max = Math.max(...rows.map((r) => r[1]), 1)
                  return (
                    <div key={k} className="card p-5">
                      <h3 className="mb-3 text-sm font-semibold text-white">Facet {k} · <span className="text-zinc-400">{FACET_NAME[k]}</span></h3>
                      <div className="space-y-1.5">
                        {rows.length === 0 && <p className="text-xs text-zinc-600">No codes in this selection.</p>}
                        {rows.map(([code, n]) => <Bar key={code} label={`${code} ${aftLabel(code)}`} n={n} max={max} color={FACET_COLOR[k]} />)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
