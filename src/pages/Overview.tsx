import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { Loading, RangeStat } from '../components/ui'
import { FAMILY_STYLES, fmtDuration, fmtPct, fmtReward, prettyModel } from '../lib/format'
import { leaderboardByVendor, useDatasetStore, visibleTasks } from '../lib/dataset'
import { useAuth } from '../lib/auth'
import clsx from 'clsx'

export default function Overview() {
  const { data, error } = useDatasetStore()
  const { isTencent } = useAuth()
  if (error) return <div className="p-8 text-rose-400">Failed to load dataset: {error}</div>
  if (!data) return <Loading />

  const visible = visibleTasks(data, isTencent)
  const allowedVendors = new Set(visible.map((t) => t.vendorId))
  const boards = leaderboardByVendor(data).filter((b) => allowedVendors.has(b.vendorId))

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Per-vendor model leaderboards · ${data.vendors.length} ${data.vendors.length === 1 ? 'vendor' : 'vendors'}`}
      />
      <div className="space-y-6 p-8">
        {boards.length === 0 && (
          <div className="card p-6 text-sm text-zinc-400">No runs available for your account.</div>
        )}
        {boards.map(({ vendorId, rows }) => {
          const vendor = data.vendors.find((v) => v.id === vendorId)!
          const taskCount = visible.filter((t) => t.vendorId === vendorId).length
          return (
            <section key={vendorId} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink-700 bg-ink-800/40 px-5 py-3">
                <h2 className="font-semibold text-white">{vendor.name}</h2>
                <Link to="/tasks" className="text-xs text-accent hover:underline">{taskCount} tasks →</Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <th className="px-4 py-2.5 font-medium">Model</th>
                      <th className="px-4 py-2.5 font-medium">Harness</th>
                      <th className="px-4 py-2.5 font-medium">Runs</th>
                      <th className="px-4 py-2.5 font-medium">Pass rate</th>
                      <th className="px-4 py-2.5 font-medium">Reward (min–max)</th>
                      <th className="px-4 py-2.5 font-medium">Steps</th>
                      <th className="px-4 py-2.5 font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.agent.id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={clsx('chip', FAMILY_STYLES[m.agent.family] ?? FAMILY_STYLES.unknown)}>
                              {m.agent.family}
                            </span>
                            <span className={clsx('font-mono', m.agent.model ? 'text-white' : 'text-zinc-500 italic')}>
                              {prettyModel(m.agent.model)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-300">
                          {m.agent.harness ?? <span className="text-zinc-600">not reported</span>}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-zinc-300">
                          {m.runs}{m.scored < m.runs && <span className="ml-1 text-xs text-zinc-600">({m.scored} scored)</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-ink-700">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${m.passRate * 100}%` }} />
                            </div>
                            <span className="tabular-nums text-zinc-200">{fmtPct(m.passRate)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {m.scored ? <RangeStat stat={m.reward} fmt={fmtReward} /> : <span className="text-zinc-600">not graded</span>}
                        </td>
                        <td className="px-4 py-2.5"><RangeStat stat={m.steps} /></td>
                        <td className="px-4 py-2.5"><RangeStat stat={m.durationSec} fmt={fmtDuration} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
        <p className="text-xs text-zinc-600">
          Harness (Claude Code · Codex · OpenHands · OpenCode …) and model are tracked separately; either
          may read <span className="text-zinc-400">not reported</span> when a vendor's export omits it.
          Ranges show average (min–max).
        </p>
      </div>
    </>
  )
}
