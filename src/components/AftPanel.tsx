import { useEffect, useState } from 'react'
import clsx from 'clsx'
import AftReference from './AftReference'
import { useAuth } from '../lib/auth'
import {
  buildAftPrompt, buildAftAgenticPrompt, buildBridgeFiles, runAft, runAftViaBridge,
  aftLabel, ENGINE_MODELS, ENGINE_LABEL, EFFORTS, DEFAULT_BRIDGE_URL,
  type AftConfig, type AftEngine, type AftReport,
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
  const base: AftConfig = { engine: 'claude', auth: 'subscription', model: ENGINE_MODELS.claude[0], effort: 'medium', apiKey: '', bridgeUrl: DEFAULT_BRIDGE_URL }
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
  const { isTencent, record } = useAuth()
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
  const [health, setHealth] = useState<{ has: Record<string, boolean>; auth: Record<string, boolean> } | 'down' | null>(null)
  const [connecting, setConnecting] = useState(false)
  const bridgeBase = (cfg.bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/$/, '')

  async function pingHealth() {
    try { const r = await fetch(`${bridgeBase}/health`); setHealth(r.ok ? await r.json() : 'down') } catch { setHealth('down') }
  }
  useEffect(() => {
    if (cfg.auth === 'subscription' && (editing || !report)) pingHealth()
  }, [cfg.auth, cfg.bridgeUrl, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  async function connect() {
    setConnecting(true); setErr(null)
    try {
      const r = await fetch(`${bridgeBase}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cli: cfg.engine }) })
      const d = await r.json()
      if (d.needsManual) setErr(d.message)
      await pingHealth()
    } catch {
      setErr(`Could not reach the bridge at ${bridgeBase}. Run "npm run bridge".`)
    } finally { setConnecting(false) }
  }

  useEffect(() => { onReport(report) }, [report, onReport])
  useEffect(() => {
    const cached = (() => { try { return JSON.parse(localStorage.getItem(reportKey) ?? 'null') } catch { return null } })()
    setReport(cached)
    setPrecomputed(false)
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
    if (cfg.auth === 'api' && !cfg.apiKey) { setEditing(true); return }
    setLoading(true)
    try {
      let rep: AftReport
      if (cfg.auth === 'subscription') {
        const tmpl = await fetch(`${import.meta.env.BASE_URL}aft-prompt.agentic.md`).then((r) => r.text())
        const prompt = buildAftAgenticPrompt(tmpl, run, task, agent, vendor)
        rep = await runAftViaBridge(cfg, prompt, buildBridgeFiles(run, task))
      } else {
        const tmpl = await fetch(`${import.meta.env.BASE_URL}aft-prompt.md`).then((r) => r.text())
        rep = await runAft(cfg, buildAftPrompt(tmpl, run, task, agent, vendor))
      }
      setReport(rep)
      setPrecomputed(false)
      localStorage.setItem(reportKey, JSON.stringify(rep))
      record({ type: 'aft_analysis', runId: run.id, closeness: rep.outcome.closeness, engine: cfg.engine, auth: cfg.auth })
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

      {(editing || (!report && cfg.auth === 'api' && !cfg.apiKey)) && (
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

          <Field label="Authentication">
            <div className="flex gap-1.5">
              {(['subscription', 'api'] as const).map((a) => (
                <button key={a} onClick={() => saveCfg({ ...cfg, auth: a })}
                  className={clsx('flex-1 rounded px-2 py-1 font-medium capitalize', cfg.auth === a ? 'bg-ink-700 text-white' : 'bg-ink-800 text-zinc-400')}>
                  {a === 'subscription' ? 'Subscription' : 'API key'}
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

          {cfg.auth === 'subscription' ? (
            <>
              <Field label="Bridge URL">
                <input value={cfg.bridgeUrl ?? DEFAULT_BRIDGE_URL} onChange={(e) => saveCfg({ ...cfg, bridgeUrl: e.target.value })} placeholder="http://localhost:8765"
                  className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent" />
              </Field>
              {/* live status + connect */}
              {health === 'down' || health === null ? (
                <div className="space-y-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-200">
                  <div className="flex items-center justify-between">
                    <span>{health === null ? 'checking bridge…' : '⚠ bridge not reachable'}</span>
                    <button onClick={pingHealth} className="text-zinc-300 hover:text-white">retry</button>
                  </div>
                  {health === 'down' && (
                    <button onClick={() => saveCfg({ ...cfg, auth: 'api' })} className="w-full rounded bg-accent px-2 py-1 font-medium text-white hover:bg-accent-soft">
                      → Analyze online with your API key (no bridge needed)
                    </button>
                  )}
                </div>
              ) : !health.has[cfg.engine] ? (
                <p className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-rose-200">
                  {ENGINE_LABEL[cfg.engine]} CLI not installed on the bridge host.
                </p>
              ) : health.auth[cfg.engine] ? (
                <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-200">
                  ✓ {ENGINE_LABEL[cfg.engine]} connected (subscription)
                </p>
              ) : (
                <button onClick={connect} disabled={connecting}
                  className="w-full rounded bg-accent px-2 py-1.5 font-medium text-white hover:bg-accent-soft disabled:opacity-50">
                  {connecting ? 'Opening login…' : `🔗 Connect ${ENGINE_LABEL[cfg.engine]} (browser login)`}
                </button>
              )}
              <p className="text-[10px] leading-relaxed text-zinc-600">
                Runs {ENGINE_LABEL[cfg.engine]} via your <span className="text-zinc-400">subscription login</span>. Connect opens the CLI's browser OAuth (Codex → ChatGPT incl. Google SSO; Claude → run <code className="font-mono">claude</code> then <code className="font-mono">/login</code> once). Start the bridge locally: <code className="font-mono text-accent">npm run bridge</code>. <span className="text-zinc-500">Subscription runs locally/self-hosted only — a hosted (Vercel) site can't run a CLI; use an API key or pre-computed reports there.</span>
              </p>
            </>
          ) : (
            <>
              <Field label="API key">
                <input type="password" value={cfg.apiKey} onChange={(e) => saveCfg({ ...cfg, apiKey: e.target.value })} placeholder={cfg.engine === 'claude' ? 'sk-ant-…' : 'sk-…'}
                  className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-zinc-200 outline-none focus:border-accent" />
              </Field>
              <p className="text-[10px] leading-relaxed text-zinc-600">
                Calls {cfg.engine === 'claude' ? 'the Anthropic API' : 'the OpenAI API'} directly from this browser. The key is stored only in localStorage; never uploaded anywhere.
              </p>
            </>
          )}
        </div>
      )}

      {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">{err}</p>}

      {!report && !loading && !err && (
        <p className="text-xs text-zinc-500">
          This run isn't pre-analyzed. Open <span className="text-zinc-300">⚙</span> to run a live AFT audit —
          with your own <span className="text-zinc-300">API key</span> (in-browser, works anywhere) or the local
          <span className="text-zinc-300"> subscription bridge</span>. Pre-analyzed runs show their report here automatically.
        </p>
      )}

      {report && <Report report={report} activeStep={activeStep} onJumpToStep={onJumpToStep} feedback={feedback} setFb={setFb} canRecord={isTencent} />}

      {showRef && <AftReference onClose={() => setShowRef(false)} />}
    </div>
  )
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
  report, activeStep, onJumpToStep, feedback, setFb, canRecord,
}: {
  report: AftReport; activeStep: number; onJumpToStep: (i: number) => void
  feedback: Record<number, { decision: string; note: string }>; setFb: (i: number, p: Partial<{ decision: string; note: string }>) => void
  canRecord: boolean
}) {
  const o = report.outcome
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
        <div className="text-xs uppercase tracking-wide text-zinc-500">Failure modes ({report.failure_modes.length})</div>
        {report.failure_modes.map((m, i) => {
          const fb = feedback[i] ?? { decision: '', note: '' }
          const onStep = m.step_indices?.includes(activeStep)
          return (
            <div key={i} className={clsx('rounded-lg border p-3', onStep ? 'border-accent/50 bg-accent/5' : 'border-ink-700')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-white">{m.name}</span>
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
              {/* human review */}
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
