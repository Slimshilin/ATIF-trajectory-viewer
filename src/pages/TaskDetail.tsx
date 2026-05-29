import { useParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { Loading, Pill, RangeStat, StatusBadge } from '../components/ui'
import EnvironmentPanel from '../components/EnvironmentPanel'
import EnvFileBrowser from '../components/EnvFileBrowser'
import { FORMAT_LABELS, fmtDuration, fmtPct, fmtReward, prettyModel } from '../lib/format'
import { aggregate, useDatasetStore, useLookups } from '../lib/dataset'
import type { Stat } from '../lib/types'

export default function TaskDetail() {
  const { taskId } = useParams()
  const { data, error } = useDatasetStore()
  const lk = useLookups(data)

  if (error) return <div className="p-8 text-rose-400">Failed to load dataset: {error}</div>
  if (!data || !lk) return <Loading />
  const task = lk.task(taskId!)
  if (!task) return <div className="p-8 text-zinc-400">Task not found.</div>

  const vendor = lk.vendor(task.vendorId)
  const runs = lk.runsForTask(task.id)
  const agg = aggregate(runs)
  const meta = task.metadata ?? {}

  return (
    <>
      <PageHeader
        title={task.title}
        subtitle={`${vendor?.name} · ${FORMAT_LABELS[task.source]}${task.category ? ` · ${task.category}` : ''}`}
        actions={task.difficulty ? <Pill className="capitalize">{task.difficulty}</Pill> : undefined}
      />
      <div className="space-y-8 p-8">
        {/* Instruction is intentionally NOT shown here — visitors find it as
            instruction.md in the file tree (Human view) below, like any other
            file in a Harbor task. This avoids the duplication where the same
            text rendered twice. The data-tour anchor is kept on the env panel
            for the guided tour so the tutorial spotlight still has a target. */}

        {/* Environment (Dockerfile / compose interpretation) */}
        <EnvironmentPanel task={task} />

        {/* OAI-messages style metadata */}
        {(meta.expected_tools as string[] | undefined)?.length || meta.expected_answer ? (
          <section className="grid gap-4 lg:grid-cols-2">
            {(meta.expected_tools as string[] | undefined)?.length ? (
              <div className="card p-5">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Expected tools</h2>
                <div className="flex flex-wrap gap-1.5">
                  {(meta.expected_tools as string[]).map((t, i) => (
                    <Pill key={i} className="bg-violet-500/15 font-mono text-violet-300">{t}</Pill>
                  ))}
                </div>
                {(meta.pass_rate_gpt != null || meta.pass_rate_opus != null) && (
                  <div className="mt-3 flex gap-4 text-xs text-zinc-500">
                    {meta.pass_rate_gpt != null && <span>GPT pass {fmtPct(meta.pass_rate_gpt as number)}</span>}
                    {meta.pass_rate_opus != null && <span>Opus pass {fmtPct(meta.pass_rate_opus as number)}</span>}
                  </div>
                )}
              </div>
            ) : null}
            {meta.expected_answer ? (
              <div className="card p-5">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Expected answer</h2>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm text-zinc-400">
                  {String(meta.expected_answer)}
                </pre>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* On-disk replay recordings (mp4/gif) that the source didn't inline */}
        {(meta.replay_recordings as string[] | undefined)?.length ? (
          <div className="card p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Replay recordings (on disk, not inlined)
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              The data source ships GIF / MP4 screen captures of each agent solving this puzzle.
              They're listed here so they're discoverable, but kept out of the bundle to
              control size — open the source archive on disk to view them.
            </p>
            <ul className="space-y-1 font-mono text-xs text-zinc-300">
              {(meta.replay_recordings as string[]).map((fn) => (
                <li key={fn}>• {fn}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Human view (raw task dir) ⇄ Agent view (container filesystem) */}
        {task.files.length > 0 && <EnvFileBrowser task={task} />}

        {/* Multi-run statistics */}
        {runs.length > 1 && (
          <section data-tour="task-stats">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Across {runs.length} runs
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="card px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-zinc-500">Pass rate</div>
                <div className="mt-1 text-2xl font-semibold text-white">{fmtPct(agg.passRate)}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{runs.filter((r) => r.passed).length}/{runs.length} passed</div>
              </div>
              <StatTriple label="Reward" stat={agg.reward} fmt={fmtReward} />
              <StatTriple label="Steps" stat={agg.steps} fmt={(n) => String(Math.round(n))} />
              <StatTriple label="Time spent" stat={agg.durationSec} fmt={fmtDuration} />
            </div>
          </section>
        )}

        {/* Runs */}
        <section data-tour="task-runs">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Agent runs ({runs.length})
            </h2>
            {runs.length > 0 && (
              <div className="text-xs text-zinc-500">
                pass {fmtPct(agg.passRate)} · reward <RangeStat stat={agg.reward} fmt={fmtReward} /> ·
                steps <RangeStat stat={agg.steps} />
              </div>
            )}
          </div>
          {runs.length === 0 ? (
            <div className="card px-4 py-6 text-center text-sm text-zinc-600">
              No trajectories for this task in the sample set.
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3 font-medium">Model</th>
                    <th className="px-4 py-3 font-medium">Harness</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Reward</th>
                    <th className="px-4 py-3 font-medium">Steps</th>
                    <th className="px-4 py-3 font-medium">Turns</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const agent = lk.agent(run.agentId)
                    return (
                      <tr key={run.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40">
                        <td className={`px-4 py-3 font-mono ${agent?.model ? 'text-zinc-200' : 'italic text-zinc-500'}`}>
                          {agent ? prettyModel(agent.model) : run.agentId}
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{agent?.harness ?? <span className="text-zinc-600">not reported</span>}</td>
                        <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{fmtReward(run.reward)}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{run.stepCount}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{run.turns}</td>
                        <td className="px-4 py-3 tabular-nums text-zinc-300">{fmtDuration(run.durationSec)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to={`/tasks/${task.id}/runs/${run.id}`} className="btn-ghost">
                            View trajectory →
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/** max / avg / min summary for one metric across runs. */
function StatTriple({ label, stat, fmt }: { label: string; stat: Stat; fmt: (n: number) => string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      {stat.count === 0 ? (
        <div className="mt-1 text-2xl font-semibold text-zinc-600">—</div>
      ) : (
        <>
          <div className="mt-1 text-2xl font-semibold text-white tabular-nums">{fmt(stat.avg)}</div>
          <div className="mt-0.5 flex gap-3 text-xs tabular-nums text-zinc-500">
            <span className="text-emerald-300">max {fmt(stat.max)}</span>
            <span>avg {fmt(stat.avg)}</span>
            <span className="text-rose-300">min {fmt(stat.min)}</span>
          </div>
        </>
      )}
    </div>
  )
}
