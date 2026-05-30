import type { Agent, Run, Task, Vendor } from './types'
import { prettyModel } from './format'

// ---------------------------------------------------------------------------
// Agent Failure Taxonomy (AFT v1.0) analysis. Runs a single-shot LLM audit of a
// trajectory directly from the browser using a user-supplied API key.
// Anthropic + OpenAI both permit direct browser calls (with the right header /
// flag), so no backend is required; the key never leaves the user's browser.
// ---------------------------------------------------------------------------

export interface AftMode {
  name: string
  description: string
  evidence_quote: string
  step_indices: number[] | null
  aft: { A: string; B: string; C: string; D: string }
  counterfactual: { single_step_fix: boolean; X: string; Y: string } | null
  /** Which judge:round audit passes flagged this (A,B,C,D) — present on the
   *  aggregated bundle reports (e.g. ["opus:r1", "gpt:r2"]). */
  seen_by?: string[]
  /** How many of the 15 passes flagged it. */
  occurrences?: number
}

export interface AftReport {
  task: { id: string; benchmark: string; task_broken: boolean; broken_reason: string | null }
  trial: { id: string; harness: string; model: string; reward: number; exception_type: string | null; n_steps: number }
  outcome: {
    closeness: 'near-miss' | 'partial' | 'far' | 'success'
    step_where_lost: number | null
    unproductive_iteration_count: number
    headline: string
    what_verifier_checked: string
    what_agent_produced: string
    exact_failure_quote: string
    test_stdout_available: boolean
  }
  failure_modes: AftMode[]
  reward_hacking: { verdict: 'clean' | 'suspicious' | 'hack'; categories_triggered: string[]; evidence: string }
  task_quality: { verdict: 'accept' | 'accept_with_caveats' | 'reject'; issues: string[]; verifier_structurally_hackable: boolean; structural_hackability_notes: string | null }
  notes_for_aggregation: string
  /** Present on aggregated bundle reports: provenance of the merge. */
  aggregated_from?: { total_audits: number; judges: string[]; distinct_modes: number; primary: string; note: string }
}

export type AftEngine = 'claude' | 'codex'
export type AftEffort = 'minimal' | 'low' | 'medium' | 'high'

export interface AftConfig {
  /** Which provider to run the audit with. */
  engine: AftEngine
  model: string
  effort: AftEffort
  /** API key — kept in the browser only; the audit is a direct browser call. */
  apiKey: string
}

export const ENGINE_MODELS: Record<AftEngine, string[]> = {
  claude: ['claude-opus-4-7', 'claude-sonnet-4-5'],
  codex: ['gpt-5.1-codex', 'gpt-5.1', 'gpt-5-codex'],
}
export const ENGINE_LABEL: Record<AftEngine, string> = { claude: 'Claude Code', codex: 'Codex' }
export const EFFORTS: AftEffort[] = ['minimal', 'low', 'medium', 'high']

const THINK_BUDGET: Record<AftEffort, number> = { minimal: 0, low: 2048, medium: 6144, high: 12288 }

const PROMPT_VARS_MAX_TRAJ = 60000

function serializeTrajectory(run: Run): string {
  const lines: string[] = []
  for (const s of run.steps) {
    const parts = [`### step ${s.index} · role=${s.role}`]
    if (s.reasoning) parts.push(`reasoning: ${s.reasoning}`)
    if (s.text) parts.push(`text: ${s.text}`)
    for (const tc of s.toolCalls ?? []) parts.push(`tool_call ${tc.name}(${(tc.args ?? '').slice(0, 600)})`)
    if (s.observation) parts.push(`observation: ${s.observation.slice(0, 800)}`)
    for (const m of s.mutations ?? []) parts.push(`mutation: ${m.kind} ${m.target ?? ''} — ${m.summary}`)
    lines.push(parts.join('\n'))
  }
  let out = lines.join('\n\n')
  if (out.length > PROMPT_VARS_MAX_TRAJ) out = out.slice(0, PROMPT_VARS_MAX_TRAJ) + '\n…[trajectory truncated]'
  return out
}

function aftVars(run: Run, task: Task, agent?: Agent, vendor?: Vendor) {
  const scoreMode = run.grade?.maxScore && run.grade.maxScore !== 1 ? 'threshold' : 'pass_fail'
  return {
    task_id: task.metadata?.task_key ? String(task.metadata.task_key) : task.id,
    benchmark: vendor?.name ?? task.source,
    trial_id: run.id,
    harness: agent?.harness ?? 'unknown',
    agent_model: prettyModel(agent?.model),
    reward: String(run.reward ?? 'null'),
    exception: run.failureReason ? JSON.stringify(run.failureReason) : 'null',
    score_mode: scoreMode,
    raw_reward: String(run.reward ?? 'null'),
    threshold: scoreMode === 'threshold' ? String(run.grade?.maxScore) : 'null',
    score: String(run.grade?.score ?? run.reward ?? 'null'),
    performance: run.passed ? '1' : '0',
  }
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let p = template
  for (const [k, v] of Object.entries(vars)) p = p.replaceAll(`{${k}}`, v)
  return p.replaceAll('{{', '{').replaceAll('}}', '}')
}

export function buildAftPrompt(template: string, run: Run, task: Task, agent?: Agent, vendor?: Vendor): string {
  let p = fillTemplate(template, aftVars(run, task, agent, vendor))
  const sources = [
    '\n\n==================  SOURCES (inline)  ==================',
    `## TASK INSTRUCTION\n${(task.instruction ?? '(none provided)').slice(0, 8000)}`,
    `## HARBOR RESULT\nreward=${run.reward}; passed=${run.passed}; status=${run.status}; failure_reason=${run.failureReason ?? 'null'}`,
    run.grade
      ? `## VERIFIER / GRADE\n${JSON.stringify({ score: run.grade.score, maxScore: run.grade.maxScore, subscores: run.grade.subscores, summary: run.grade.summary, gate: run.grade.gate, findings: run.grade.findings }, null, 1).slice(0, 4000)}`
      : '## VERIFIER / GRADE\n(no grader output shipped)',
    `## TRAJECTORY (${run.steps.length} steps)\n${serializeTrajectory(run)}`,
  ].join('\n\n')
  return p + sources
}

// --- provider calls (direct from browser) ----------------------------------

async function callAnthropic(cfg: AftConfig, prompt: string): Promise<string> {
  const budget = THINK_BUDGET[cfg.effort] ?? 0
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: budget ? budget + 4096 : 4096,
    messages: [{ role: 'user', content: prompt }],
  }
  if (budget >= 1024) body.thinking = { type: 'enabled', budget_tokens: budget }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return (data.content ?? []).filter((b: { type?: string }) => b.type === 'text').map((b: { text?: string }) => b.text ?? '').join('')
}

async function callOpenAI(cfg: AftConfig, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: cfg.effort,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export async function runAft(cfg: AftConfig, prompt: string): Promise<AftReport> {
  const raw = cfg.engine === 'claude' ? await callAnthropic(cfg, prompt) : await callOpenAI(cfg, prompt)
  return parseAftReport(raw)
}

/** Extract the last/largest JSON object from the model output. */
export function parseAftReport(text: string): AftReport {
  // try fenced or trailing JSON, else last balanced object
  const candidates: string[] = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/g)
  if (fence) for (const f of fence) candidates.push(f.replace(/```(?:json)?/g, '').trim())
  // last balanced {...}
  const last = text.lastIndexOf('}')
  if (last !== -1) {
    let depth = 0
    for (let i = last; i >= 0; i--) {
      if (text[i] === '}') depth++
      else if (text[i] === '{') { depth--; if (depth === 0) { candidates.push(text.slice(i, last + 1)); break } }
    }
  }
  for (const c of candidates.reverse()) {
    try {
      const obj = JSON.parse(c)
      if (obj.failure_modes && obj.outcome) return obj as AftReport
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not parse an AFT JSON report from the model output.')
}

// --- AFT facet labels (for display) ----------------------------------------

export const AFT_A: Record<string, string> = {
  A1: 'Understanding & planning', A2: 'Locating & exploring', A3: 'Executing & generating',
  A4: 'Verifying & testing', A5: 'Iterating & converging', A6: 'Terminating & delivering',
}
export const AFT_B: Record<string, string> = {
  B1: 'Reasoning defect', B2: 'Knowledge gap', B3: 'Context-management failure',
  B4: 'Tool / environment interaction', B5: 'Spec non-compliance', B6: 'Coordination & communication',
}
export const AFT_D: Record<string, string> = {
  D1: 'Recoverable, mild', D2: 'Recoverable, moderate', D3: 'Unrecoverable', D4: 'Cascading', D5: 'Silent',
}
export const AFT_C: Record<string, string> = {
  'C1.1': 'Requirement misunderstanding', 'C1.2': 'Role overreach', 'C1.3': 'Instruction non-compliance',
  'C2.1': 'Logical error', 'C2.2': 'Reasoning-action mismatch', 'C2.3': 'Hallucination', 'C2.4': 'Problem misidentification', 'C2.5': 'Blind strategy switch',
  'C3.1': 'Surface-match locating', 'C3.2': 'Wrong search scope', 'C3.3': 'Issue-description misled',
  'C4.1': 'Insufficient surrounding-context', 'C4.2': 'Type/data-structure error', 'C4.3': 'Missing error handling', 'C4.4': 'Incomplete fix', 'C4.5': 'Evasive fix', 'C4.6': 'Overfit fix', 'C4.7': 'Performance regression', 'C4.8': 'Dependency/compat break',
  'C5.1': 'Conversation/history loss', 'C5.2': 'Selective amnesia', 'C5.3': 'State drift', 'C5.4': 'Context bloat',
  'C6.1': 'Step repetition/loop', 'C6.2': 'Premature termination', 'C6.3': 'Task drift/off-track', 'C6.4': 'Non-monotonic iteration', 'C6.5': 'Non-convergence',
  'C7.1': 'Validation missing/incomplete', 'C7.2': 'Validation-logic error', 'C7.3': 'Ignored validation feedback', 'C7.4': 'Validation skipped',
  'C8.1': 'Wrong tool choice', 'C8.2': 'Tool-call format error', 'C8.3': 'Missing dependency', 'C8.4': 'Tool-output misread',
}
export function aftLabel(code: string): string {
  return AFT_A[code] ?? AFT_B[code] ?? AFT_D[code] ?? AFT_C[code] ?? ''
}
