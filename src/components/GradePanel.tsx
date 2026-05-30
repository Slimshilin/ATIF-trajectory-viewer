import clsx from 'clsx'
import { fmtReward } from '../lib/format'
import type { Grade } from '../lib/types'

function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = max ? Math.max(0, Math.min(1, value / max)) : 0
  const color = pct >= 0.8 ? 'bg-emerald-400' : pct >= 0.5 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={clsx('h-full rounded-full', color)} style={{ width: `${pct * 100}%` }} />
    </div>
  )
}

export default function GradePanel({
  grade,
  failureReason,
  verifierLog,
}: {
  grade?: Grade | null
  failureReason?: string | null
  verifierLog?: string | null
}) {
  if (!grade) {
    return (
      <div className="space-y-2 text-sm text-zinc-400">
        <p>No grader/verifier output was shipped with this trajectory by the vendor.</p>
        <p className="text-xs text-zinc-600">
          For a model-driven diagnosis of this run, use the <span className="text-zinc-300">AFT</span> tab.
        </p>
      </div>
    )
  }

  const score = grade.score ?? 0
  const max = grade.maxScore ?? 1
  const passed = grade.gate ? Object.values(grade.gate).every((v) => v !== false) : score / max >= 0.999

  return (
    <div className="space-y-4">
      {/* Headline score */}
      <div className="rounded-lg border border-ink-700 bg-ink-950 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Overall score</span>
          <span className={clsx('chip', passed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300')}>
            {passed ? 'passed' : 'failed'}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-white">{fmtReward(score)}</span>
          <span className="text-sm text-zinc-500">/ {max}</span>
        </div>
        <div className="mt-2"><ScoreBar value={score} max={max} /></div>
      </div>

      {/* Conjunctive gate */}
      {grade.gate && (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(grade.gate).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs">
              <span className={clsx('h-2 w-2 rounded-full', v === false ? 'bg-rose-400' : v ? 'bg-emerald-400' : 'bg-zinc-600')} />
              <span className="capitalize text-zinc-400">{k.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Subscores */}
      {grade.subscores.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Subscores</div>
          {grade.subscores.map((s) => (
            <div key={s.label}>
              <div className="mb-0.5 flex items-center justify-between text-xs">
                <span className="capitalize text-zinc-400">{s.label}</span>
                <span className="tabular-nums text-zinc-300">{s.score.toFixed(2)}</span>
              </div>
              <ScoreBar value={s.score} max={1} />
            </div>
          ))}
        </div>
      )}

      {/* Verifier log — the real test-stdout.txt from the job, foldable. */}
      {(verifierLog || grade.summary || failureReason) && (
        <details className="rounded-lg border border-ink-700 bg-ink-950" open>
          <summary className="cursor-pointer px-3 py-2 text-xs uppercase tracking-wide text-zinc-400 hover:text-zinc-200">
            Verifier log{verifierLog ? '' : ' (summary)'}
          </summary>
          <div className="space-y-2 border-t border-ink-800 p-3">
            {failureReason && (
              <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 font-mono text-xs text-rose-200">
                {failureReason}
              </div>
            )}
            {grade.summary && <div className="font-mono text-[11px] text-zinc-500">{grade.summary}</div>}
            {verifierLog && (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-ink-800 bg-ink-900 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-300">
                {verifierLog}
              </pre>
            )}
          </div>
        </details>
      )}

      {/* Findings (e.g. missing facts) */}
      {grade.findings && grade.findings.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Findings ({grade.findings.length})
          </div>
          {grade.findings.map((f, i) => (
            <div key={i} className="rounded-lg border border-ink-700 p-2.5">
              <div className="flex items-center gap-2">
                <span className="chip bg-amber-500/15 text-amber-300">{f.category}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-300">{f.summary}</p>
              {f.detail && <p className="mt-1 text-xs text-zinc-500">{f.detail}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
