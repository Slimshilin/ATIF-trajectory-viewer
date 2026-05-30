import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import AftReference from './AftReference'
import { useAuth } from '../lib/auth'
import {
  buildAftPrompt, runAft,
  aftLabel, ENGINE_MODELS, ENGINE_LABEL, EFFORTS,
  type AftConfig, type AftEngine, type AftReport, type AftMode,
} from '../lib/aft'
import type { Agent, Run, Task, Vendor } from '../lib/types'

const CFG_KEY = 'tv-aft-cfg'
const closenessStyle: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-300',
  'near-miss': 'bg-amber-500/15 text-amber-300',
  partial: 'bg-orange-500/15 text-orange-300',
  far: 'bg-rose-500/15 text-rose-300',
}

function loadCfg(): AftConfig {
  const base: AftConfig = { engine: 'claude', model: ENGINE_MODELS.claude[0], effort: 'medium', apiKey: '' }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(CFG_KEY) ?? '{}') }
  } catch {
    return base
  }
}

export default function AftPanel({
  run, task, agent, vendor, activeStep, onJumpToStep, onReport,
}: {
  run: Run; task: Task; agent?: Agent; vendor?: Vendor
  activeStep: number; onJumpToStep: (i: number) => void; onReport: (r: AftReport | null) => void
}) {
  const { isMember, record } = useAuth()
  const reportKey = `tv-aft-report:${run.id}`
  const fbKey = `tv-aft-fb:${run.id}`

  const [cfg, setCfg] = useState<AftConfig>(loadCfg)
  const [editing, setEditing] = useState(false)
  const [report, setReport] = useState<AftReport | null>(() => {
    try { return JSON.parse(localStorage.getItem(reportKey) ?? 'null') } catch { return null }
  })
  const [feedback, setFeedback] = useState<Record<number, { decision: string; note: string }>>(() => {
    try { return JSON.parse(localStorage.getItem(fbKey) ?? '{}') } catch { return {} }
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showRef, setShowRef] = useState(false)
  const [precomputed, setPrecomputed] = useState(false)
  // null = consensus (default); "judge:round" = a single raw audit pass.
  const [pass, setPass] = useState<string | null>(null)
  const [showPasses, setShowPasses] = useState(false)

  // The report actually shown: consensus by default, or one raw judge×round
  // pass when selected. (Switching passes also re-points the AFT step highlight.)
  const shownReport = useMemo<AftReport | null>(() => {
    if (!report) return null
    if (!pass || !report.passes) return report
    const p = report.passes.find((x) => `${x.judge}:${x.round}` === pass)
    return p
      ? { ...report, outcome: p.outcome, failure_modes: p.failure_modes, reward_hacking: p.reward_hacking, task_quality: p.task_quality, aggregated_from: undefined }
      : report
  }, [report, pass])

  useEffect(() => { onReport(shownReport) }, [shownReport, onReport])
  useEffect(() => {
    const cached = (() => { try { return JSON.parse(localStorage.getItem(reportKey) ?? 'null') } catch { return null } })()
    setReport(cached)
    setPrecomputed(false)
    setPass(null)
    setFeedback((() => { try { return JSON.parse(localStorage.getItem(fbKey) ?? '{}') } catch { return {} } })())
    // Auto-load a pre-computed report (baked in for the public site) if present.
    if (!cached) {
      let alive = true
      fetch(`${import.meta.env.BASE_URL}aft/${run.id}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((rep) => { if (alive && rep) { setReport(rep); setPrecomputed(true) } })
        .catch(() => {})
      return () => { alive = false }
    }
  }, [run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function saveCfg(next: AftConfig) {
    setCfg(next)
    localStorage.setItem(CFG_KEY, JSON.stringify({ ...next, apiKey: next.apiKey })) // key stays in this browser only
  }

  async function apply() {
    setErr(null)
    if (!cfg.apiKey) { setEditing(true); return }
    setLoading(true)
    try {
      const tmpl = await fetch(`${import.meta.env.BASE_URL}aft-prompt.md`).then((r) => r.text())
      const rep = await runAft(cfg, buildAftPrompt(tmpl, run, task, agent, vendor))
      setReport(rep)
      setPrecomputed(false)
      localStorage.setItem(reportKey, JSON.stringify(rep))
      record({ type: 'aft_analysis', runId: run.id, closeness: rep.outcome.closeness, engine: cfg.engine })
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }

  function setFb(i: number, patch: Partial<{ decision: string; note: string }>) {
    const cur = feedback[i] ?? { decision: '', note: '' }
    const next = { ...feedback, [i]: { ...cur, ...patch } }
    setFeedback(next)
    localStorage.setItem(fbKey, JSON.stringify(next))
    record({ type: 'aft_feedback', runId: run.id, mode: i, ...next[i] })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {report ? (
          <span className="flex items-center gap-2 text-xs text-zinc-400">
            {precomputed
              ? <span className="chip bg-accent/15 text-accent">✦ Pre-analyzed</span>
              : <span className="chip bg-emerald-500/15 text-emerald-300">✓ Analyzed</span>}
            <button onClick={apply} disabled={loading} className="text-zinc-500 hover:text-zinc-200">
              {loading ? 'Analyzing…' : '↻ re-run'}
            </button>
          </span>
        ) : (
          <button className="btn-primary" onClick={apply} disabled={loading}>
            {loading ? 'Analyzing…' : '✦ Apply AFT analysis'}
          </button>
        )}
        <div className="flex items-center gap-2 text-xs">
          <button data-tour="aft-taxonomy" onClick={() => setShowRef(true)} className="text-accent hover:underline">View taxonomy ↗</button>
          <button onClick={() => setEditing((e) => !e)} className="text-zinc-500 hover:text-zinc-200" title="analysis settings">⚙</button>
        </div>
      </div>

      {(editing || (!report && !cfg.apiKey)) && (
        <div className="card space-y-2.5 p-3 text-xs">
          <Field label="Engine">
            <div className="flex gap-1.5">
              {(['claude', 'codex'] as AftEngine[]).map((e) => (
                <button key={e} onClick={() => saveCfg({ ...cfg, engine: e, model: ENGINE_MODELS[e][0] })}
                  className={clsx('flex-1 rounded px-2 py-1 font-medium', cfg.engine === e ? 'bg-accent text-white' : 'bg-ink-800 text-zinc-400')}>
                  {ENGINE_LABEL[e]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Model">
            <div className="mb-1 flex flex-wrap gap-1">
              {ENGINE_MODELS[cfg.engine].map((m) => (
                <button key={m} onClick={() => saveCfg({ ...cfg, model: m })}
                  className={clsx('rounded px-2 py-0.5 font-mono text-[11px]', cfg.model === m ? 'bg-accent/20 text-accent' : 'bg-ink-800 text-zinc-400')}>{m}</button>
              ))}
            </div>
            <input value={cfg.model} onChange={(e) => saveCfg({ ...cfg, model: e.target.value })} placeholder="model id"
              className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent" />
          </Field>

          <Field label="Reasoning effort">
            <div className="flex gap-1">
              {EFFORTS.map((e) => (
                <button key={e} onClick={() => saveCfg({ ...cfg, effort: e })}
                  className={clsx('flex-1 rounded px-1.5 py-1 capitalize', cfg.effort === e ? 'bg-ink-700 text-white' : 'bg-ink-800 text-zinc-400')}>{e}</button>
              ))}
            </div>
          </Field>

          <Field label="API key">
            <input type="password" value={cfg.apiKey} onChange={(e) => saveCfg({ ...cfg, apiKey: e.target.value })} placeholder={cfg.engine === 'claude' ? 'sk-ant-…' : 'sk-…'}
              className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-zinc-200 outline-none focus:border-accent" />
          </Field>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            Calls {cfg.engine === 'claude' ? 'the Anthropic API' : 'the OpenAI API'} directly from this browser. The key is stored only in localStorage; never uploaded anywhere.
          </p>
        </div>
      )}

      {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">{err}</p>}

      {!report && !loading && !err && (
        <p className="text-xs text-zinc-500">
          This run isn't pre-analyzed. Open <span className="text-zinc-300">⚙</span> to run a live AFT audit
          with your own <span className="text-zinc-300">API key</span> — it runs in-browser and the key never
          leaves this tab. Pre-analyzed runs show their report here automatically.
        </p>
      )}

      {report && report.passes && report.passes.length > 0 && (
        <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setPass(null)}
              className={clsx('rounded px-2 py-0.5 font-medium', pass === null ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'bg-ink-800 text-zinc-400 hover:text-zinc-200')}
            >
              Consensus (majority)
            </button>
            <button onClick={() => setShowPasses((s) => !s)} className="text-zinc-500 hover:text-zinc-200">
              {showPasses ? '▾' : '▸'} {report.passes.length} individual passes
            </button>
          </div>
          {showPasses && (
            <div className="mt-2 space-y-1">
              {['opus', 'gpt', 'composer'].map((judge) => {
                const rounds = report.passes!
                  .filter((p) => p.judge === judge)
                  .sort((a, b) => Number(a.round) - Number(b.round))
                if (!rounds.length) return null
                return (
                  <div key={judge} className="flex flex-wrap items-center gap-1">
                    <span className="w-16 shrink-0 font-mono text-zinc-500">{judge}</span>
                    {rounds.map((p) => {
                      const key = `${p.judge}:${p.round}`
                      return (
                        <button
                          key={key}
                          onClick={() => setPass(key)}
                          className={clsx('rounded px-2 py-0.5', pass === key ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'bg-ink-800 text-zinc-400 hover:text-zinc-200')}
                        >
                          r{p.round}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {shownReport && (
        <>
          {pass && (
            <p className="text-[11px] text-zinc-500">
              Showing the raw <span className="text-zinc-300">{pass.replace(':', ' · ')}</span> audit pass (1 of {report?.passes?.length}). Switch to <span className="text-zinc-300">Consensus</span> for the merged view.
            </p>
          )}
          <Report report={shownReport} activeStep={activeStep} onJumpToStep={onJumpToStep} feedback={feedback} setFb={setFb} canRecord={isMember} reviewable={pass === null} />
        </>
      )}

      {showRef && <AftReference onClose={() => setShowRef(false)} />}
    </div>
  )
}

/** "opus:r1","opus:r3","gpt:r2" → "opus(r1,r3), gpt(r2)" */
function formatJudges(seenBy: string[]): string {
  const byJudge = new Map<string, string[]>()
  for (const s of seenBy) {
    const idx = s.indexOf(':')
    const j = idx >= 0 ? s.slice(0, idx) : s
    const r = idx >= 0 ? s.slice(idx + 1) : ''
    if (!byJudge.has(j)) byJudge.set(j, [])
    if (r) byJudge.get(j)!.push(r)
  }
  return [...byJudge.entries()].map(([j, rs]) => (rs.length ? `${j}(${rs.join(',')})` : j)).join(', ')
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  )
}

// Color the four AFT facets so stage/cause/behavior/impact scan at a glance.
const FACET_STYLE: Record<string, string> = {
  A: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/25',      // stage (when)
  B: 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/25', // root cause (why)
  C: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25',    // behavior (what)
  D: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25',       // impact (how bad)
}
function Chip({ code }: { code: string }) {
  const label = aftLabel(code)
  const style = FACET_STYLE[code[0]] ?? 'bg-ink-800 text-zinc-300'
  return (
    <span className={'chip ' + style} title={`${code} · ${label}`}>
      <span className="font-mono font-semibold">{code}</span>{label && <span className="ml-1 opacity-80">{label}</span>}
    </span>
  )
}

function Report({
  report, activeStep, onJumpToStep, feedback, setFb, canRecord, reviewable = true,
}: {
  report: AftReport; activeStep: number; onJumpToStep: (i: number) => void
  feedback: Record<number, { decision: string; note: string }>; setFb: (i: number, p: Partial<{ decision: string; note: string }>) => void
  canRecord: boolean; reviewable?: boolean
}) {
  const o = report.outcome
  // Order failure modes by the earliest step each one touches (modes with no
  // step land last); ties keep the more-agreed-upon mode first.
  const minStep = (m: AftMode) => (m.step_indices && m.step_indices.length ? Math.min(...m.step_indices) : Infinity)
  const sortedModes = [...report.failure_modes].sort(
    (a, b) => minStep(a) - minStep(b) || (b.occurrences ?? 0) - (a.occurrences ?? 0),
  )
  // Consensus view only: filter to modes flagged by ≥ N distinct judges.
  const isConsensus = !!report.aggregated_from
  const judgeCount = (m: AftMode) => new Set((m.seen_by ?? []).map((s) => s.split(':')[0])).size
  const [minJudges, setMinJudges] = useState(1)
  const shownModes = isConsensus ? sortedModes.filter((m) => judgeCount(m) >= minJudges) : sortedModes
  return (
    <div className="space-y-4">
      <div data-tour="aft-outcome" className="rounded-lg border border-ink-700 bg-ink-950 p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className={clsx('chip capitalize', closenessStyle[o.closeness])}>{o.closeness}</span>
          {o.step_where_lost != null && (
            <button onClick={() => onJumpToStep(o.step_where_lost!)} className="chip bg-rose-500/15 text-rose-300 hover:bg-rose-500/25">
              lost at step {o.step_where_lost + 1}
            </button>
          )}
        </div>
        <p className="text-sm text-zinc-200">{o.headline}</p>
        {o.exact_failure_quote && (
          <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-ink-900 p-2 text-[11px] text-rose-300">{o.exact_failure_quote}</pre>
        )}
        <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
          <div><span className="text-zinc-400">verifier checked:</span> {o.what_verifier_checked}</div>
          <div><span className="text-zinc-400">agent produced:</span> {o.what_agent_produced}</div>
        </div>
      </div>

      <div data-tour="aft-failures" className="space-y-2">
        <div className="flex items-baseline justify-between text-xs uppercase tracking-wide text-zinc-500">
          <span>Failure modes ({shownModes.length === report.failure_modes.length ? report.failure_modes.length : `${shownModes.length} of ${report.failure_modes.length}`})</span>
          {report.aggregated_from && (
            <span className="normal-case tracking-normal text-zinc-600" title={report.aggregated_from.note}>
              merged from {report.aggregated_from.total_audits} judge×round audits
            </span>
          )}
        </div>
        {isConsensus && (
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="uppercase tracking-wide">flagged by ≥</span>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                onClick={() => setMinJudges(n)}
                className={clsx('rounded px-1.5 py-0.5', minJudges === n ? 'bg-accent/20 text-accent ring-1 ring-accent/40' : 'bg-ink-800 text-zinc-400 hover:text-zinc-200')}
              >
                {n} judge{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        )}
        {shownModes.length === 0 && (
          <p className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-xs text-zinc-600">
            No failure mode was flagged by ≥ {minJudges} judges.
          </p>
        )}
        {shownModes.map((m) => {
          // Key feedback by the mode's position in the canonical list so it
          // stays stable across sorting / judge-filtering.
          const i = report.failure_modes.indexOf(m)
          const fb = feedback[i] ?? { decision: '', note: '' }
          const onStep = m.step_indices?.includes(activeStep)
          return (
            <div key={i} className={clsx('rounded-lg border p-3', onStep ? 'border-accent/50 bg-accent/5' : 'border-ink-700')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-white">{m.name}</span>
                {m.occurrences != null && m.seen_by && m.seen_by.length > 0 && (
                  <span className="chip bg-ink-800 text-zinc-400" title={`flagged by ${m.seen_by.join(', ')}`}>
                    {m.occurrences}× · {formatJudges(m.seen_by)}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <Chip code={m.aft.A} /><Chip code={m.aft.B} /><Chip code={m.aft.C} /><Chip code={m.aft.D} />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-300">{m.description}</p>
              {m.evidence_quote && (
                <pre className="mt-1.5 overflow-auto whitespace-pre-wrap rounded bg-ink-950 p-2 text-[11px] text-zinc-400">“{m.evidence_quote}”</pre>
              )}
              {m.step_indices && m.step_indices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.step_indices.map((s) => (
                    <button key={s} onClick={() => onJumpToStep(s)} className="chip bg-ink-800 text-accent hover:bg-ink-700">→ step {s + 1}</button>
                  ))}
                </div>
              )}
              {m.counterfactual && (
                <div className="mt-2 rounded border border-ink-700 bg-ink-950 p-2 text-[11px] text-zinc-400">
                  <div><span className="text-emerald-400">should:</span> {m.counterfactual.X}</div>
                  <div><span className="text-rose-400">did:</span> {m.counterfactual.Y}</div>
                  {m.counterfactual.single_step_fix && <div className="mt-0.5 text-zinc-600">single-step fix</div>}
                </div>
              )}
              {/* human review — only on the consensus view (raw passes are read-only source) */}
              {reviewable && (
                <>
                  <div className="mt-2 flex items-center gap-1.5 border-t border-ink-800 pt-2">
                    <span className="text-[10px] uppercase tracking-wide text-zinc-600">your review:</span>
                    {(['agree', 'disagree'] as const).map((d) => (
                      <button key={d} onClick={() => setFb(i, { decision: fb.decision === d ? '' : d })}
                        className={clsx('chip', fb.decision === d ? (d === 'agree' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300') : 'bg-ink-800 text-zinc-400 hover:text-zinc-200')}>
                        {d === 'agree' ? '👍 agree' : '👎 disagree'}
                      </button>
                    ))}
                  </div>
                  <input value={fb.note} onChange={(e) => setFb(i, { note: e.target.value })} placeholder="add a note…"
                    className="mt-1.5 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-accent" />
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Task quality (verdict + issues) usually has more text than the
          reward-hacking verdict, so give it the wider column. */}
      <div className="grid grid-cols-[2fr_3fr] gap-2 text-xs">
        <div className="rounded-lg border border-ink-700 p-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Reward hacking</div>
          <div className={clsx('mt-0.5 font-medium', report.reward_hacking.verdict === 'clean' ? 'text-emerald-300' : 'text-amber-300')}>
            {report.reward_hacking.verdict}
          </div>
          {report.reward_hacking.evidence && <p className="mt-1 text-[11px] text-zinc-500">{report.reward_hacking.evidence}</p>}
        </div>
        <div className="rounded-lg border border-ink-700 p-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Task quality</div>
          <div className="mt-0.5 font-medium text-zinc-200">{report.task_quality.verdict}</div>
          {report.task_quality.issues?.length > 0 && <p className="mt-1 text-[11px] text-zinc-500">{report.task_quality.issues.join('; ')}</p>}
        </div>
      </div>

      {!canRecord && <p className="text-[10px] text-zinc-600">Guest session — this analysis &amp; your reviews are kept only in this browser, not synced.</p>}
    </div>
  )
}
