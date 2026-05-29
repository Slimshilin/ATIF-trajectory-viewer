import clsx from 'clsx'
import type { ReactNode } from 'react'
import { STATUS_STYLES } from '../lib/format'
import type { Stat } from '../lib/types'

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('chip capitalize', STATUS_STYLES[status] ?? STATUS_STYLES.error)}>
      {status}
    </span>
  )
}

export function StatCell({
  label,
  value,
  sub,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  )
}

/** Compact "avg (min–max)" stat display. Shows — when no data. */
export function RangeStat({
  stat,
  fmt = (n) => n.toFixed(0),
}: {
  stat: Stat
  fmt?: (n: number) => string
}) {
  if (!stat.count) return <span className="text-zinc-600">—</span>
  return (
    <span className="tabular-nums">
      <span className="text-zinc-100">{fmt(stat.avg)}</span>
      {stat.count > 1 && (
        <span className="ml-1 text-xs text-zinc-500">
          ({fmt(stat.min)}–{fmt(stat.max)})
        </span>
      )}
    </span>
  )
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('chip bg-ink-800 text-zinc-300', className)}>{children}</span>
}

export function Loading({ label = 'Loading dataset…' }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center text-sm text-zinc-500">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-accent" />
        {label}
      </div>
    </div>
  )
}
