export const FORMAT_LABELS: Record<string, string> = {
  atif: 'ATIF',
  snorkel: 'Snorkel',
  harbor: 'Harbor',
  fleet: 'FleetAI',
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 1) return '—'
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s ? `${m}m ${s}s` : `${m}m`
}

export function fmtPct(x: number): string {
  return `${(x * 100).toFixed(0)}%`
}

export function fmtReward(x: number | null | undefined): string {
  return x == null ? '—' : x.toFixed(2)
}

export function fmtInt(x: number): string {
  return Math.round(x).toString()
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

/** Prettify the ugly model dir names from some vendors. */
export function prettyModel(model?: string | null): string {
  if (!model) return 'not reported'
  return model
    .replace(/^openrouter\//, '')
    .replace(/^anthropic[_/]/, '')
    .replace(/^openai[_/]/, '')
    .replace(/_/g, '-')
}

export function agentHarness(harness?: string | null): string {
  return harness ?? '—'
}

export const FAMILY_STYLES: Record<string, string> = {
  Anthropic: 'bg-orange-500/15 text-orange-300',
  OpenAI: 'bg-emerald-500/15 text-emerald-300',
  Google: 'bg-sky-500/15 text-sky-300',
  unknown: 'bg-zinc-500/15 text-zinc-400',
}

export const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  failed: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  partial: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  completed: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
  error: 'bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/30',
}

export const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  major: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  minor: 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30',
}

export const ROLE_STYLES: Record<string, string> = {
  user: 'bg-sky-500/15 text-sky-300',
  agent: 'bg-violet-500/15 text-violet-300',
  assistant: 'bg-violet-500/15 text-violet-300',
  system: 'bg-zinc-500/15 text-zinc-400',
  tool: 'bg-emerald-500/15 text-emerald-300',
}
