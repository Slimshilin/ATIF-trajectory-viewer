import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AgentMetrics, Dataset, Run, Stat } from './types'
import { TOUR_BUNDLE, TOUR_VENDOR_ID } from './tourTask'

export interface UploadBundle {
  vendors: Dataset['vendors']
  agents: Dataset['agents']
  tasks: Dataset['tasks']
  runs: Dataset['runs']
}

interface Store {
  data: Dataset | null
  error: string | null
  addUpload: (b: UploadBundle) => void
  clearUploads: () => void
  uploadedCount: number
}

const UP_KEY = 'tv-uploads'
const DatasetContext = createContext<Store>({ data: null, error: null, addUpload: () => {}, clearUploads: () => {}, uploadedCount: 0 })

function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  const map = new Map(base.map((x) => [x.id, x]))
  for (const x of extra) map.set(x.id, x)
  return [...map.values()]
}

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadBundle[]>(() => {
    try { return JSON.parse(localStorage.getItem(UP_KEY) ?? '[]') } catch { return [] }
  })

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dataset.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: Dataset) => setBase(d))
      .catch((e) => setError(String(e)))
  }, [])

  const data: Dataset | null = base
    ? [TOUR_BUNDLE, ...uploads].reduce<Dataset>((acc, u) => ({
        ...acc,
        vendors: mergeById(acc.vendors, u.vendors),
        agents: mergeById(acc.agents, u.agents),
        tasks: mergeById(acc.tasks, u.tasks),
        runs: mergeById(acc.runs, u.runs),
      }), base)
    : null

  const addUpload = (b: UploadBundle) => {
    setUploads((prev) => {
      const next = [...prev, b]
      try { localStorage.setItem(UP_KEY, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }
  const clearUploads = () => { setUploads([]); localStorage.removeItem(UP_KEY) }

  const uploadedCount = uploads.reduce((n, u) => n + u.tasks.length, 0)

  return <DatasetContext.Provider value={{ data, error, addUpload, clearUploads, uploadedCount }}>{children}</DatasetContext.Provider>
}

export function useDataset(): Dataset | null {
  return useContext(DatasetContext).data
}

export function useDatasetStore(): Store {
  return useContext(DatasetContext)
}

// --- lookups ---------------------------------------------------------------

export function useLookups(d: Dataset | null) {
  if (!d) return null
  return {
    vendor: (id: string) => d.vendors.find((v) => v.id === id),
    agent: (id: string) => d.agents.find((a) => a.id === id),
    task: (id: string) => d.tasks.find((t) => t.id === id),
    run: (id: string) => d.runs.find((r) => r.id === id),
    runsForTask: (taskId: string) => d.runs.filter((r) => r.taskId === taskId),
    runsForAgent: (agentId: string) => d.runs.filter((r) => r.agentId === agentId),
  }
}

// --- metrics ---------------------------------------------------------------

function stat(values: number[]): Stat {
  if (!values.length) return { avg: 0, min: 0, max: 0, count: 0 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  return { avg, min, max, count: values.length }
}

export function leaderboard(d: Dataset): AgentMetrics[] {
  return d.agents
    .map((agent) => {
      const runs = d.runs.filter((r) => r.agentId === agent.id)
      const rewards = runs.map((r) => r.reward).filter((x): x is number => x != null)
      return {
        agent,
        vendor: d.vendors.find((v) => v.id === agent.vendorId),
        runs: runs.length,
        scored: rewards.length,
        passRate: runs.length ? runs.filter((r) => r.passed).length / runs.length : 0,
        bestReward: rewards.length ? Math.max(...rewards) : null,
        worstReward: rewards.length ? Math.min(...rewards) : null,
        reward: stat(rewards),
        steps: stat(runs.map((r) => r.stepCount ?? r.steps.length).filter((n) => n > 0)),
        turns: stat(runs.map((r) => r.turns)),
        durationSec: stat(
          runs.map((r) => r.durationSec).filter((x): x is number => x != null && x > 1),
        ),
      }
    })
    .filter((m) => m.runs > 0)
    .sort((a, b) => b.passRate - a.passRate || b.reward.avg - a.reward.avg)
}

/** Leaderboard grouped per vendor: vendorId -> ranked AgentMetrics. */
export function leaderboardByVendor(d: Dataset): { vendorId: string; rows: AgentMetrics[] }[] {
  const all = leaderboard(d)
  const byVendor = new Map<string, AgentMetrics[]>()
  for (const m of all) {
    const v = m.agent.vendorId
    if (!byVendor.has(v)) byVendor.set(v, [])
    byVendor.get(v)!.push(m)
  }
  return d.vendors
    .filter((v) => v.id !== TOUR_VENDOR_ID && byVendor.has(v.id))
    .map((v) => ({ vendorId: v.id, rows: byVendor.get(v.id)! }))
}

/** All tasks except the synthetic guided-tour task (URL-reachable only). */
export function visibleTasks(d: Dataset, _isTencent: boolean = false) {
  return d.tasks.filter((t) => t.vendorId !== TOUR_VENDOR_ID)
}

export function aggregate(runs: Run[]) {
  const rewards = runs.map((r) => r.reward).filter((x): x is number => x != null)
  return {
    runs: runs.length,
    scored: rewards.length,
    passRate: runs.length ? runs.filter((r) => r.passed).length / runs.length : 0,
    reward: stat(rewards),
    steps: stat(runs.map((r) => r.stepCount ?? r.steps.length).filter((n) => n > 0)),
    turns: stat(runs.map((r) => r.turns)),
    durationSec: stat(runs.map((r) => r.durationSec).filter((x): x is number => x != null && x > 1)),
  }
}
