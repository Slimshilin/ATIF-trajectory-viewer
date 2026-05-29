import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { Loading, Pill, StatCell, StatusBadge } from '../components/ui'
import GradePanel from '../components/GradePanel'
import Markdown from '../components/Markdown'
import EnvironmentStage from '../components/EnvironmentStage'
import CodeBlock from '../components/CodeBlock'
import AftPanel from '../components/AftPanel'
import type { AftReport } from '../lib/aft'
import { FORMAT_LABELS, ROLE_STYLES, fmtDuration, fmtReward, fmtTokens, prettyModel } from '../lib/format'
import { useDatasetStore, useLookups } from '../lib/dataset'
import type { HumanLabel, LabelDecision, Mutation, Run, Step } from '../lib/types'

const MUT_STYLES: Record<Mutation['kind'], string> = {
  file: 'bg-sky-500/15 text-sky-300',
  spreadsheet: 'bg-emerald-500/15 text-emerald-300',
  document: 'bg-violet-500/15 text-violet-300',
  git: 'bg-amber-500/15 text-amber-300',
  command: 'bg-zinc-500/15 text-zinc-300',
  answer: 'bg-rose-500/15 text-rose-300',
  other: 'bg-zinc-500/15 text-zinc-300',
}

/** Run-wide artifact-change view: every state-changing step, grouped & jumpable. */
function RunArtifacts({
  run,
  activeStep,
  onJump,
}: {
  run: Run
  activeStep: number
  onJump: (i: number) => void
}) {
  const changeSteps = run.steps.filter((s) => s.mutations && s.mutations.length > 0)
  const total = changeSteps.reduce((n, s) => n + (s.mutations?.length ?? 0), 0)

  if (changeSteps.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-ink-700 px-3 py-6 text-center text-sm text-zinc-600">
        This run made no detected artifact changes (no file/sheet/doc/git/answer writes).
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink-700 bg-ink-950 p-3 text-sm text-zinc-400">
        <span className="text-zinc-200">{total}</span> change{total !== 1 ? 's' : ''} across{' '}
        <span className="text-zinc-200">{changeSteps.length}</span> step{changeSteps.length !== 1 ? 's' : ''}.
      </div>

      {run.artifacts && run.artifacts.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Artifacts touched</div>
          <div className="space-y-1">
            {run.artifacts.map((a) => (
              <code key={a} className="block truncate rounded bg-ink-800 px-2 py-1 font-mono text-[11px] text-zinc-300">
                {a}
              </code>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Change timeline</div>
        <div className="space-y-3">
          {changeSteps.map((s) => (
            <div key={s.index}>
              <button
                onClick={() => onJump(s.index)}
                className={clsx(
                  'mb-1.5 flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors',
                  s.index === activeStep ? 'text-accent' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                <span className="font-medium">step {s.index + 1}</span>
                <span className="h-px flex-1 bg-ink-700" />
                <span>{s.mutations!.length} change{s.mutations!.length !== 1 ? 's' : ''}</span>
              </button>
              <MutationList mutations={s.mutations!} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MutationList({ mutations }: { mutations: Mutation[] }) {
  return (
    <div className="space-y-2">
      {mutations.map((m, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-ink-700">
          <div className="flex items-center gap-2 bg-ink-800 px-3 py-2">
            <span className={clsx('chip capitalize', MUT_STYLES[m.kind])}>{m.kind}</span>
            <span className="truncate text-sm text-zinc-200">{m.summary}</span>
            <code className="ml-auto shrink-0 font-mono text-[11px] text-violet-300">{m.tool}</code>
          </div>
          {m.target && (
            <div className="border-t border-ink-800 px-3 py-1.5">
              <code className="font-mono text-[11px] text-zinc-500">{m.target}</code>
            </div>
          )}
          {m.detail && (
            <div className="max-h-72 overflow-auto border-t border-ink-800 bg-ink-950 px-3 py-2">
              {m.kind === 'answer' || m.kind === 'document' ? (
                <Markdown content={m.detail} />
              ) : (
                <pre className="whitespace-pre-wrap text-[12px] text-zinc-400">{m.detail}</pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const ROLE_GLYPH: Record<string, string> = {
  user: '👤',
  agent: '✦',
  assistant: '✦',
  system: '⚙',
  tool: '↩',
}

const DECISION_STYLES: Record<LabelDecision, string> = {
  correct: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  incorrect: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  unsure: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
}

function stepTitle(s: Step): string {
  if (s.toolCalls?.length) return s.toolCalls.map((t) => t.name).join(', ')
  if (s.role === 'tool') return `${s.toolName ?? 'tool'} result`
  if (s.text) return s.text.replace(/\s+/g, ' ').slice(0, 60)
  if (s.observation) return 'observation'
  return s.role
}

export default function TrajectoryViewer() {
  const { taskId, runId } = useParams()
  const { data, error } = useDatasetStore()
  const lk = useLookups(data)

  // Deep-link a step via ?step=N (used by the guided tour and shareable links).
  const [searchParams] = useSearchParams()
  const stepParam = searchParams.get('step')
  const [activeStep, setActiveStep] = useState(() => {
    const n = Number(stepParam)
    return stepParam != null && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  })
  useEffect(() => {
    if (stepParam == null) return
    const n = Number(stepParam)
    if (Number.isFinite(n) && n >= 0) setActiveStep(Math.floor(n))
  }, [stepParam])
  const [panel, setPanel] = useState<'step' | 'artifacts' | 'analysis' | 'aft' | 'labels'>('step')
  const [aftSteps, setAftSteps] = useState<Set<number>>(new Set())
  const [labels, setLabels] = useState<HumanLabel[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1) // steps per second
  const timelineRef = useRef<ImperativePanelHandle>(null)
  const [timelineCollapsed, setTimelineCollapsed] = useState(false)
  const toggleTimeline = () => {
    const p = timelineRef.current
    if (!p) return
    p.isCollapsed() ? p.expand() : p.collapse()
  }

  const stepLabel = useMemo(() => labels.find((l) => l.stepIndex === activeStep), [labels, activeStep])
  const stepCount = data?.runs.find((x) => x.id === runId)?.steps.length ?? 0

  // Reset to the start when a different trajectory opens.
  useEffect(() => {
    setActiveStep(0)
    setPlaying(false)
  }, [runId])

  const handleAftReport = useCallback((r: AftReport | null) => {
    const s = new Set<number>()
    if (r) {
      if (r.outcome.step_where_lost != null) s.add(r.outcome.step_where_lost)
      for (const m of r.failure_modes) for (const i of m.step_indices ?? []) s.add(i)
    }
    setAftSteps(s)
  }, [])

  // Film playback: advance one step per tick while playing.
  useEffect(() => {
    if (!playing) return
    if (activeStep >= stepCount - 1) {
      setPlaying(false)
      return
    }
    const id = setTimeout(() => setActiveStep((s) => Math.min(s + 1, stepCount - 1)), 1000 / speed)
    return () => clearTimeout(id)
  }, [playing, activeStep, speed, stepCount])

  if (error) return <div className="p-8 text-rose-400">Failed to load dataset: {error}</div>
  if (!data || !lk) return <Loading />
  const task = lk.task(taskId!)
  const run = lk.run(runId!)
  if (!task || !run) return <div className="p-8 text-zinc-400">Run not found.</div>
  const agent = lk.agent(run.agentId)

  // Metric-only runs (e.g. Theta) ship aggregate numbers but no trajectory.
  if (run.steps.length === 0) {
    return (
      <>
        <PageHeader
          title={agent ? prettyModel(agent.model) : run.agentId}
          subtitle={`${task.title} · ${run.stepCount} steps · reward ${fmtReward(run.reward)}`}
          actions={
            <>
              <Pill>{FORMAT_LABELS[run.format]}</Pill>
              <StatusBadge status={run.status} />
              <Link to={`/tasks/${task.id}`} className="btn-ghost">← Task</Link>
            </>
          }
        />
        <div className="p-8">
          <div className="card p-6 text-sm text-zinc-400">
            <p>
              This run is <span className="text-zinc-200">metrics-only</span> — the vendor exported
              aggregate results without a step-by-step trajectory.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCell label="Reward" value={fmtReward(run.reward)} />
              <StatCell label="Steps" value={run.stepCount} />
              <StatCell label="Prompt tok" value={fmtTokens(run.tokens?.prompt)} />
              <StatCell label="Completion tok" value={fmtTokens(run.tokens?.completion)} />
            </div>
          </div>
        </div>
      </>
    )
  }

  const step = run.steps[Math.min(activeStep, run.steps.length - 1)]

  function upsertLabel(patch: Partial<HumanLabel>) {
    setLabels((prev) => {
      const existing = prev.find((l) => l.stepIndex === activeStep)
      const rest = prev.filter((l) => l.stepIndex !== activeStep)
      return [
        ...rest,
        {
          stepIndex: activeStep,
          decision: existing?.decision ?? 'unsure',
          note: existing?.note ?? '',
          author: 'you',
          createdAt: new Date().toISOString(),
          ...patch,
        },
      ]
    })
  }

  return (
    <>
      <PageHeader
        title={`${agent ? prettyModel(agent.model) : run.agentId}`}
        subtitle={`${task.title} · ${run.steps.length} steps · ${run.turns} turns · ${fmtDuration(run.durationSec)}${run.tokens?.prompt ? ` · ${fmtTokens(run.tokens.prompt)} prompt tok` : ''}`}
        actions={
          <>
            <Pill>{FORMAT_LABELS[run.format]}</Pill>
            <span className="text-sm tabular-nums text-zinc-400">reward {fmtReward(run.reward)}</span>
            <StatusBadge status={run.status} />
            <Link to={`/tasks/${task.id}`} className="btn-ghost">← Task</Link>
          </>
        }
      />

      {/* Film transport */}
      <Transport
        active={activeStep}
        count={run.steps.length}
        playing={playing}
        speed={speed}
        title={stepTitle(step)}
        role={step.role}
        elapsedSec={step.tSec ?? null}
        totalSec={run.durationSec}
        onPlay={() => {
          if (activeStep >= run.steps.length - 1) setActiveStep(0)
          setPlaying((p) => !p)
        }}
        onPrev={() => { setPlaying(false); setActiveStep((s) => Math.max(0, s - 1)) }}
        onNext={() => { setPlaying(false); setActiveStep((s) => Math.min(run.steps.length - 1, s + 1)) }}
        onSeek={(i) => { setPlaying(false); setActiveStep(i) }}
        onSpeed={setSpeed}
        stepsCollapsed={timelineCollapsed}
        onToggleSteps={toggleTimeline}
      />

      <PanelGroup direction="horizontal" className="h-[calc(100%-89px-57px)]" autoSaveId="traj-cols">
        <Panel
          ref={timelineRef}
          collapsible
          collapsedSize={0}
          defaultSize={19}
          minSize={12}
          onCollapse={() => setTimelineCollapsed(true)}
          onExpand={() => setTimelineCollapsed(false)}
        >
        {/* Step timeline */}
        <div data-tour="timeline" className="h-full overflow-y-auto p-3">
          <div className="mb-2 px-1 text-xs uppercase tracking-wide text-zinc-500">
            {run.steps.length} steps
          </div>
          <ol className="space-y-1">
            {run.steps.map((s) => {
              const lbl = labels.find((l) => l.stepIndex === s.index)
              return (
                <li key={s.index}>
                  <button
                    onClick={() => { setPlaying(false); setActiveStep(s.index) }}
                    className={clsx(
                      'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                      s.index === activeStep ? 'bg-ink-800 ring-1 ring-accent/40' : 'hover:bg-ink-800/50',
                    )}
                  >
                    <span className={clsx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[11px]', ROLE_STYLES[s.role] ?? 'bg-ink-700')}>
                      {ROLE_GLYPH[s.role] ?? '•'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-xs text-zinc-500">#{s.index + 1}</span>
                        {s.edits?.length ? (
                          <span className="chip bg-emerald-500/15 text-emerald-300" title="environment change">▦</span>
                        ) : s.toolCalls?.length ? (
                          <span className="chip bg-violet-500/15 text-violet-300">tool</span>
                        ) : null}
                        {s.mutations?.length ? (
                          <span className="chip bg-accent/15 text-accent" title="artifact change">±{s.mutations.length}</span>
                        ) : null}
                        {aftSteps.has(s.index) ? (
                          <span className="chip bg-rose-500/20 text-rose-300" title="AFT-flagged failure step">AFT</span>
                        ) : null}
                        {lbl && (
                          <span className={clsx('h-2 w-2 rounded-full', {
                            'bg-emerald-400': lbl.decision === 'correct',
                            'bg-rose-400': lbl.decision === 'incorrect',
                            'bg-amber-400': lbl.decision === 'unsure',
                          })} />
                        )}
                      </span>
                      <span className="block truncate text-zinc-200">{stepTitle(s)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        </Panel>
        <PanelResizeHandle className="w-1 bg-ink-700 transition-colors hover:bg-accent/50" />

        {/* Environment stage — the "film screen" */}
        <Panel defaultSize={53} minSize={25}>
        <div data-tour="stage" className="h-full min-w-0 overflow-hidden">
          <EnvironmentStage steps={run.steps} activeStep={activeStep} task={task} />
        </div>
        </Panel>
        <PanelResizeHandle className="w-1 bg-ink-700 transition-colors hover:bg-accent/50" />

        {/* Right rail: Step detail / Artifacts / Analysis / Label */}
        <Panel defaultSize={28} minSize={16}>
        <div className="flex h-full flex-col overflow-hidden border-l border-ink-700">
          <div data-tour="rail-tabs" className="flex border-b border-ink-700">
            {([
              ['step', 'Step'],
              ['analysis', 'Reward & Verifier log'],
              ['artifacts', `Changes${run.artifacts?.length ? ` (${run.artifacts.length})` : ''}`],
              ['aft', 'AFT'],
              ['labels', 'Label/Note'],
            ] as const).map(([p, lbl]) => (
              <button
                key={p}
                data-tour={`tab-${p}`}
                onClick={() => setPanel(p)}
                title={lbl}
                className={clsx(
                  'flex-1 px-1.5 py-2.5 text-center text-[11px] font-medium leading-tight transition-colors',
                  panel === p ? 'bg-ink-800 text-white' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div data-tour="rail-content" className="flex-1 overflow-y-auto p-4">
            {panel === 'step' ? (
              <StepPanel step={step} />
            ) : panel === 'analysis' ? (
              <GradePanel grade={run.grade} failureReason={run.failureReason} />
            ) : panel === 'aft' ? (
              <AftPanel
                run={run}
                task={task}
                agent={agent}
                vendor={lk.vendor(run.vendorId)}
                activeStep={activeStep}
                onJumpToStep={(i) => { setPlaying(false); setActiveStep(i) }}
                onReport={handleAftReport}
              />
            ) : panel === 'artifacts' ? (
              <RunArtifacts run={run} activeStep={activeStep} onJump={(i) => { setPlaying(false); setActiveStep(i) }} />
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Label step #{activeStep + 1}</div>
                  <p className="mb-3 truncate text-sm text-zinc-400">{stepTitle(step)}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['correct', 'incorrect', 'unsure'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => upsertLabel({ decision: d })}
                        className={clsx(
                          'rounded-lg px-2 py-2 text-xs font-medium capitalize ring-1 transition-colors',
                          stepLabel?.decision === d ? DECISION_STYLES[d] : 'text-zinc-400 ring-ink-700 hover:bg-ink-800',
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Note</div>
                  <textarea
                    value={noteDraft || stepLabel?.note || ''}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={3}
                    placeholder="Why is this step right/wrong?"
                    className="w-full resize-none rounded-lg border border-ink-700 bg-ink-950 p-2 text-sm text-zinc-200 outline-none focus:border-accent"
                  />
                  <button
                    className="btn-primary mt-2 w-full justify-center"
                    onClick={() => { upsertLabel({ note: noteDraft }); setNoteDraft('') }}
                  >
                    Save note
                  </button>
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">Labels ({labels.length})</div>
                  <div className="space-y-2">
                    {labels.length === 0 && <p className="text-sm text-zinc-600">No labels yet.</p>}
                    {[...labels].sort((a, b) => a.stepIndex - b.stepIndex).map((l) => (
                      <button
                        key={l.stepIndex}
                        onClick={() => setActiveStep(l.stepIndex)}
                        className="block w-full rounded-lg border border-ink-700 p-2 text-left hover:bg-ink-800/40"
                      >
                        <div className="flex items-center gap-2">
                          <span className={clsx('chip capitalize', DECISION_STYLES[l.decision])}>{l.decision}</span>
                          <span className="text-xs text-zinc-500">step {l.stepIndex + 1}</span>
                        </div>
                        {l.note && <p className="mt-1 text-xs text-zinc-400">{l.note}</p>}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-zinc-600">Labels are client-side only in this demo (not persisted).</p>
              </div>
            )}
          </div>
        </div>
        </Panel>
      </PanelGroup>
    </>
  )
}

function Transport({
  active, count, playing, speed, title, role, elapsedSec, totalSec, stepsCollapsed,
  onPlay, onPrev, onNext, onSeek, onSpeed, onToggleSteps,
}: {
  active: number; count: number; playing: boolean; speed: number; title: string; role: string
  elapsedSec: number | null; totalSec: number | null; stepsCollapsed: boolean
  onPlay: () => void; onPrev: () => void; onNext: () => void
  onSeek: (i: number) => void; onSpeed: (s: number) => void; onToggleSteps: () => void
}) {
  const hasTime = elapsedSec != null && totalSec != null && totalSec > 1
  return (
    <div data-tour="transport" className="flex items-center gap-3 border-b border-ink-700 bg-ink-900/60 px-4 py-2.5">
      <button
        onClick={onToggleSteps}
        className="btn-ghost px-2"
        title={stepsCollapsed ? 'Show steps panel' : 'Hide steps panel'}
      >
        {stepsCollapsed ? '☰' : '⟨'} <span className="text-xs">Steps</span>
      </button>
      <div className="flex items-center gap-1">
        <button onClick={onPrev} disabled={active === 0} className="btn-ghost px-2 disabled:opacity-30" title="Previous step">⏮</button>
        <button onClick={onPlay} className="btn-primary px-3" title={playing ? 'Pause' : 'Play'}>
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={onNext} disabled={active >= count - 1} className="btn-ghost px-2 disabled:opacity-30" title="Next step">⏭</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
          {active + 1} / {count}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(0, count - 1)}
          value={active}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="h-1 w-44 cursor-pointer accent-accent"
        />
      </div>
      {hasTime ? (
        <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400" title="elapsed / total wall-clock time">
          ⏱ {fmtDuration(elapsedSec!)} <span className="text-zinc-600">/ {fmtDuration(totalSec!)}</span>
        </span>
      ) : totalSec && totalSec > 1 ? (
        <span className="shrink-0 font-mono text-xs text-zinc-500" title="total wall-clock time">⏱ {fmtDuration(totalSec)} total</span>
      ) : null}
      <span className={clsx('chip shrink-0 capitalize', ROLE_STYLES[role])}>{role}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-400">{title}</span>
      <div className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
        speed
        {[0.5, 1, 2, 4].map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={clsx('rounded px-1.5 py-0.5', speed === s ? 'bg-accent text-white' : 'hover:text-zinc-200')}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  )
}

function StepPanel({ step }: { step: Step }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={clsx('grid h-6 w-6 place-items-center rounded text-xs', ROLE_STYLES[step.role])}>
          {ROLE_GLYPH[step.role] ?? '•'}
        </span>
        <h2 className="text-sm font-semibold capitalize text-white">{step.role}</h2>
        <span className="text-xs text-zinc-500">step {step.index + 1}</span>
        {step.tokens?.completion != null && (
          <span className="ml-auto text-[11px] text-zinc-500">
            {fmtTokens(step.tokens.prompt)} in · {fmtTokens(step.tokens.completion)} out
          </span>
        )}
      </div>
      {step.reasoning && (
        <Field label="Reasoning" muted><Markdown content={step.reasoning} className="opacity-90" /></Field>
      )}
      {step.text && (
        <Field label={step.role === 'tool' ? 'Tool message' : 'Message'}>
          <SmartContent text={step.text} />
        </Field>
      )}
      {step.toolCalls?.map((tc, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            Tool call
            <Pill className="bg-violet-500/15 font-mono text-violet-300 normal-case">{tc.name}</Pill>
          </div>
          <CodeBlock content={prettyJson(tc.args)} language="json" lineNumbers={false} />
        </div>
      ))}
      {step.observation && (
        <Field label="Observation" muted><SmartContent text={step.observation} mono /></Field>
      )}
      {step.mutations && step.mutations.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
            Artifact changes
            <span className="chip bg-accent/15 text-accent normal-case">{step.mutations.length}</span>
          </div>
          <MutationList mutations={step.mutations} />
        </div>
      )}
      {!step.text && !step.reasoning && !step.toolCalls?.length && !step.observation && (
        <p className="text-sm text-zinc-600">No content for this step.</p>
      )}
    </div>
  )
}

function Field({ label, children, muted }: { label: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={clsx(
        'max-h-96 overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-3',
        muted && 'text-zinc-400',
      )}>
        {children}
      </div>
    </div>
  )
}

/** Render text as pretty JSON if it parses, otherwise as Markdown. */
function SmartContent({ text, mono }: { text: string; mono?: boolean }) {
  const t = text.trim()
  if (mono && (t.startsWith('{') || t.startsWith('['))) {
    try {
      return <CodeBlock content={JSON.stringify(JSON.parse(t), null, 2)} language="json" lineNumbers={false} />
    } catch {
      /* fall through to markdown */
    }
  }
  // Tool observations are often plain logs, not markdown — keep them monospace
  // unless they clearly contain markdown structure.
  const looksMarkdown = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|\|.*\||```)/.test(text) || /\*\*[^*]+\*\*/.test(text)
  if (mono && !looksMarkdown) {
    return (
      <pre className="overflow-auto whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-300">
        {text}
      </pre>
    )
  }
  return <Markdown content={text} />
}

function prettyJson(s?: string): string {
  if (!s) return ''
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
