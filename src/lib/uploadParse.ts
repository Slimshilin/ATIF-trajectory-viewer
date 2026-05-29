import { unzipSync, strFromU8 } from 'fflate'
import type { Agent, Edit, FileKind, Mutation, Run, Step, Task, Vendor } from './types'

// ---------------------------------------------------------------------------
// Parse an uploaded Harbor task+job zip entirely in the browser into the
// normalized dataset shapes. Mirrors scripts/ingest.py for the ATIF and
// OpenAI-messages trajectory formats.
// ---------------------------------------------------------------------------

export interface ParsedUpload {
  vendors: Vendor[]
  agents: Agent[]
  tasks: Task[]
  runs: Run[]
  warnings: string[]
}

const UPLOAD_VENDOR: Vendor = { id: 'upload', name: 'Uploaded' }

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function clip(s: unknown, n = 6000): string | undefined {
  if (s == null) return undefined
  const t = typeof s === 'string' ? s : JSON.stringify(s)
  return t.length <= n ? t : t.slice(0, n) + `\n…[+${t.length - n} chars]`
}
function kindFromPath(p: string): FileKind {
  const s = p.toLowerCase()
  if (/\.(png|jpe?g|gif|svg|webp)$/.test(s)) return 'image'
  if (/\.(md|markdown)$/.test(s)) return 'markdown'
  if (/\.json$/.test(s)) return 'json'
  if (/\.(html?|vue)$/.test(s)) return 'html'
  if (/\.(diff|patch)$/.test(s)) return 'diff'
  if (/\.(csv|tsv)$/.test(s)) return 'spreadsheet'
  if (/\.(toml|txt|ini|cfg|lock|env)$/.test(s) || /dockerfile$/.test(s)) return 'text'
  return 'code'
}

// --- agent identity (mirror of ingest) -------------------------------------
const HARNESS_MAP: Record<string, string> = {
  'openhands-sdk': 'OpenHands', openhands: 'OpenHands', opencode: 'OpenCode',
  codex: 'Codex CLI', 'claude-code': 'Claude Code', 'gemini-cli': 'Gemini CLI',
}
function cleanModel(raw?: string | null) {
  if (!raw) return null
  let m = String(raw).split('/').pop()!.replace(/_/g, '-').trim().toLowerCase()
  m = m.replace(/^(anthropic|openai|google|openrouter)-/, '')
  return m || null
}
function modelFamily(raw?: string | null) {
  const s = String(raw ?? '').toLowerCase()
  if (s.includes('claude')) return 'Anthropic'
  if (s.includes('gemini')) return 'Google'
  if (s.includes('gpt') || s.includes('codex') || s.includes('openai')) return 'OpenAI'
  return 'unknown'
}
function makeAgent(harnessRaw: string | null, modelRaw: string | null, agents: Map<string, Agent>): string {
  const model = cleanModel(modelRaw)
  const harness = harnessRaw ? HARNESS_MAP[harnessRaw.toLowerCase()] ?? null : null
  const family = modelFamily(modelRaw ?? harnessRaw)
  const id = slug(`${harness ?? 'agent'}-${model ?? 'model'}-upload`)
  if (!agents.has(id)) agents.set(id, { id, harness, model, family, vendorId: 'upload' })
  return id
}

// --- mutations + edits (compact port) --------------------------------------
function asDict(args: unknown): Record<string, any> {
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return {} } }
  if (args && typeof args === 'object') {
    const o = args as Record<string, any>
    if (Object.keys(o).length === 1 && o.data && typeof o.data === 'object') return o.data
    return o
  }
  return {}
}
function editsFor(toolCalls: { name?: string; function_name?: string; arguments?: unknown; function?: any }[] | undefined, obs?: string | null): Edit[] {
  const out: Edit[] = []
  for (const tc of toolCalls ?? []) {
    const name = (tc.function_name ?? tc.function?.name ?? tc.name ?? '').toLowerCase()
    const a = asDict(tc.arguments ?? tc.function?.arguments)
    if (name.includes('excel') && name.includes('write') && a.data) out.push({ t: 'sheet', target: a.filepath, sheet: a.sheet_name ?? 'Sheet1', anchor: a.start_cell ?? 'A1', cells: capGrid(a.data) })
    else if (name.includes('excel') && (name.includes('formula') || name.includes('set')) && a.formulas) out.push({ t: 'formula', target: a.filepath, sheet: a.sheet_name ?? 'Sheet1', formulas: a.formulas.slice(0, 300).map((f: any) => ({ c: f.cell, f: String(f.formula).slice(0, 120) })) })
    else if (name.includes('sheets') && name.includes('update') && a.values) { const [sheet, cells] = String(a.range ?? '').split('!'); out.push({ t: 'sheet', target: a.spreadsheet_id, sheet: sheet || 'Sheet1', anchor: (cells ?? 'A1').split(':')[0] || 'A1', cells: capGrid(a.values) }) }
    else if (name.startsWith('word_') || (name.includes('word') && name.includes('add'))) out.push({ t: 'doc', target: a.filename, op: name.includes('heading') ? 'heading' : 'para', text: clip(a.text, 2000) ?? '', level: a.level })
    else if ((name.includes('fetch') || name.endsWith('open_url')) && (a.url || a.data?.url)) out.push({ t: 'web', url: a.url ?? a.data?.url, content: clip(obs, 8000) })
    else if (name === 'computer') out.push({ t: 'computer', action: a.action, coord: a.coordinate, text: clip(a.text, 200) })
    else if (name.includes('submit_final_answer') || name.endsWith('finish')) { const ans = a.answer ?? a.result ?? a.summary; if (ans) out.push({ t: 'answer', content: clip(ans, 10000)! }) }
  }
  return out
}
function capGrid(rows: any[][]): string[][] {
  return (rows ?? []).slice(0, 80).map((r) => (Array.isArray(r) ? r : [r]).slice(0, 40).map((c) => String(c).slice(0, 80)))
}
function mutationsFor(toolCalls: any[] | undefined): Mutation[] {
  const out: Mutation[] = []
  for (const tc of toolCalls ?? []) {
    const name = (tc.function_name ?? tc.function?.name ?? tc.name ?? '').toLowerCase()
    const a = asDict(tc.arguments ?? tc.function?.arguments)
    if (name.includes('excel') || (name.includes('sheets') && name.includes('update'))) out.push({ kind: 'spreadsheet', tool: name, target: a.filepath ?? a.spreadsheet_id, summary: `${a.sheet_name ?? a.range ?? 'sheet'} write` })
    else if (name.startsWith('word_')) out.push({ kind: 'document', tool: name, target: a.filename, summary: clip(a.text, 80) ?? 'edit' })
    else if (name.includes('git_commit')) out.push({ kind: 'git', tool: name, target: a.repo_path, summary: 'commit' })
    else if (name.includes('submit_final_answer') || name.endsWith('finish')) out.push({ kind: 'answer', tool: name, target: 'final answer', summary: 'submitted final answer' })
    else if (/(^|_)(write_file|create_file|str_replace|edit_file|apply_patch)(_|$)/.test(name)) out.push({ kind: 'file', tool: name, target: a.path ?? a.filepath, summary: 'file edit' })
  }
  return out
}

// --- ATIF + messages step normalization ------------------------------------
function normAtifStep(s: any, i: number): Step {
  const tcs = (s.tool_calls ?? []).map((tc: any) => ({ name: tc.function_name ?? tc.function?.name ?? 'tool', args: clip(tc.arguments ?? tc.function?.arguments, 2000) }))
  let obs: any = s.observation
  if (obs && typeof obs === 'object') {
    if (Array.isArray(obs.results)) obs = obs.results.map((r: any) => String(r.content ?? JSON.stringify(r))).join('\n\n')
    else obs = JSON.stringify(obs)
  }
  return {
    index: i, role: s.source ?? 'agent', text: clip(s.message), reasoning: clip(s.reasoning_content, 3000),
    toolCalls: tcs.length ? tcs : null, observation: clip(obs, 4000) ?? null,
    tokens: s.metrics ? { prompt: s.metrics.prompt_tokens, completion: s.metrics.completion_tokens } : null,
    timestamp: s.timestamp ?? null, mutations: mutationsFor(s.tool_calls).length ? mutationsFor(s.tool_calls) : null,
    edits: editsFor(s.tool_calls, typeof obs === 'string' ? obs : null).length ? editsFor(s.tool_calls, typeof obs === 'string' ? obs : null) : null,
  }
}
function splitContent(c: any): [string | null, string[]] {
  if (typeof c === 'string' || c == null) return [c ?? null, []]
  if (Array.isArray(c)) {
    const texts: string[] = [], imgs: string[] = []
    for (const it of c) {
      if (it?.type === 'text') texts.push(it.text ?? '')
      else if (it?.type === 'image_url') { const u = it.image_url?.url ?? it.image_url; if (u && !String(u).startsWith('data:')) imgs.push(u) }
      else if (typeof it === 'string') texts.push(it)
    }
    return [texts.join('\n') || null, imgs]
  }
  return [JSON.stringify(c), []]
}
function normMessages(messages: any[]): Step[] {
  return messages.slice(0, 120).map((m, i) => {
    const tcs = (m.tool_calls ?? []).map((tc: any) => ({ name: tc.function?.name ?? 'tool', args: clip(tc.function?.arguments, 1800) }))
    const [text, imgs] = splitContent(m.content)
    const edits = editsFor(m.tool_calls, m.role === 'tool' ? text : null)
    for (const url of imgs.slice(0, 2)) edits.push({ t: 'screenshot', url })
    return {
      index: i, role: m.role, text: m.role !== 'tool' ? clip(text) : null, reasoning: clip(m.thinking ?? m.reasoning_content, 2500),
      toolCalls: tcs.length ? tcs : null, observation: m.role === 'tool' ? clip(text, 1800) ?? null : null,
      toolName: m.tool_name ?? m.name ?? null, tokens: null, timestamp: null,
      mutations: mutationsFor(m.tool_calls).length ? mutationsFor(m.tool_calls) : null, edits: edits.length ? edits : null,
    }
  })
}

interface RunMeta {
  harness?: string | null
  model?: string | null
  score?: number | null
  passed?: boolean | null
  summary?: string | null
  durationSec?: number | null
  failureReason?: string | null
  idHint?: string
}

function isoDur(a?: string, b?: string): number | null {
  if (!a || !b) return null
  const x = Date.parse(a), y = Date.parse(b)
  return isFinite(x) && isFinite(y) ? Math.max(0, (y - x) / 1000) : null
}

function buildRun(d: any, taskId: string, agents: Map<string, Agent>, idHint: string, meta: RunMeta = {}): Run {
  const isAtif = typeof d.schema_version === 'string' && d.schema_version.startsWith('ATIF')
  const messages = d.transcript ?? d.messages
  let steps: Step[], harnessRaw: string | null = null, modelRaw: string | null = null
  if (isAtif || Array.isArray(d.steps)) {
    steps = (d.steps ?? []).slice(0, 120).map((s: any, i: number) => normAtifStep(s, i))
    harnessRaw = d.agent?.name ?? null
    modelRaw = d.agent?.model_name ?? (d.steps ?? []).find((s: any) => s.model_name)?.model_name ?? null
  } else {
    steps = normMessages(messages ?? [])
  }
  // reward / pass — meta (from jobs/verifier) wins over anything in the trajectory file
  let score: number | null = meta.score ?? null
  if (score == null) {
    if (d.verifier_execution) score = d.verifier_execution.score
    else if (typeof d.reward === 'number') score = d.reward
    else if (d.extra?.verification) score = d.extra.verification.score
  }
  if (typeof score === 'boolean') score = score ? 1 : 0
  const passed = meta.passed != null ? meta.passed : d.passed != null ? !!d.passed : score != null && score >= 0.999
  const harness = meta.harness ?? harnessRaw
  const model = meta.model ?? modelRaw
  const fm = d.final_metrics ?? {}
  const summary = meta.summary ?? null
  const subscores = d.extra?.verification?.grade?.subscores
    ? Object.entries(d.extra.verification.grade.subscores).map(([k, v]) => ({ label: k, score: v as number }))
    : []
  const grade = score != null || summary ? { score, maxScore: 1, subscores, summary } : null
  return {
    id: slug(`${taskId}-${meta.idHint ?? d.session_id ?? idHint}`),
    taskId, agentId: makeAgent(harness, model, agents), vendorId: 'upload', format: isAtif ? 'atif' : 'fleet',
    status: passed ? 'passed' : score != null ? 'failed' : 'completed', passed, reward: score,
    steps, stepCount: steps.length,
    artifacts: [...new Set(steps.flatMap((s) => (s.mutations ?? []).map((m) => m.target).filter(Boolean) as string[]))].slice(0, 30),
    turns: steps.filter((s) => s.role === 'agent' || s.role === 'assistant').length,
    durationSec: meta.durationSec ?? null, tokens: { prompt: fm.total_prompt_tokens, completion: fm.total_completion_tokens },
    grade, failureReason: meta.failureReason ?? (typeof d.exception === 'string' ? d.exception : null),
  }
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/')
const baseOf = (p: string) => p.split('/').filter(Boolean).pop() ?? p

export function parseUpload(buf: Uint8Array): ParsedUpload {
  const warnings: string[] = []
  // Allow large trajectory.json (agent logs can be tens of MB); cap others at 5MB.
  const files = unzipSync(buf, {
    filter: (f) =>
      !f.name.includes('__MACOSX') && !f.name.endsWith('/') &&
      (f.size < 5_000_000 || (/trajectory\.json$/.test(f.name) && f.size < 60_000_000)),
  })
  const text: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files)) {
    try { text[name] = strFromU8(bytes) } catch { /* binary */ }
  }
  const paths = Object.keys(text)
  const readJson = (p: string): any => { try { return p in text ? JSON.parse(text[p]) : null } catch { return null } }

  const agents = new Map<string, Agent>()
  const tasks: Task[] = []
  const runs: Run[] = []
  const usedIds = new Set<string>()
  const uniqueId = (base: string) => { let id = base, i = 2; while (usedIds.has(id)) id = `${base}-${i++}`; usedIds.add(id); return id }

  // Every directory that directly holds an instruction.md or task.toml is a task.
  const taskDirs = [...new Set(paths.filter((p) => /(^|\/)(instruction\.md|task\.toml)$/i.test(p)).map(dirOf))].sort()

  function looksTraj(d: any) {
    return d && (d.schema_version || Array.isArray(d.steps) || Array.isArray(d.transcript) || Array.isArray(d.messages))
  }

  function addTask(taskDir: string) {
    const dirName = baseOf(taskDir) || 'uploaded-task'
    const instrP = paths.find((p) => p === `${taskDir}/instruction.md`)
    const tomlP = paths.find((p) => p === `${taskDir}/task.toml`)
    const title = (instrP && /^#\s*(.+)$/m.exec(text[instrP])?.[1]) || dirName
    const taskId = uniqueId(slug(`upload-${dirName}`))
    // task-directory files, excluding the jobs/ run data and binaries
    const taskFiles = paths
      .filter((p) => p.startsWith(taskDir + '/') && !p.startsWith(`${taskDir}/jobs/`))
      .filter((p) => !/\.(zip|tar|gz|png|jpe?g|gif|webp|pdf|xlsx?)$/i.test(p))
      .slice(0, 60)
      .map((p) => ({ path: p.slice(taskDir.length + 1), kind: kindFromPath(p), content: clip(text[p], 20000) }))
    tasks.push({
      id: taskId, vendorId: 'upload', title: String(title).slice(0, 120), source: 'harbor',
      category: 'Uploaded', difficulty: tomlP ? (/difficulty\s*=\s*"([^"]+)"/.exec(text[tomlP])?.[1] ?? '') : '',
      instruction: instrP ? clip(text[instrP], 8000) : undefined, files: taskFiles, tier: 'example',
      metadata: { task_dir: dirName },
    })

    // --- trials under <task>/jobs/<trial>/agent/trajectory.json (Harbor jobs format) ---
    const jobsRoot = `${taskDir}/jobs`
    const trialDirs = [...new Set(
      paths.filter((p) => p.startsWith(jobsRoot + '/') && /\/agent\/trajectory\.json$/.test(p))
        .map((p) => p.replace(/\/agent\/trajectory\.json$/, '')),
    )]
    for (const J of trialDirs) {
      const traj = readJson(`${J}/agent/trajectory.json`)
      if (!looksTraj(traj)) continue
      const cfg = readJson(`${J}/config.json`)
      const res = readJson(`${J}/result.json`)
      const rewardTxt = text[`${J}/verifier/reward.txt`]
      const stdout = text[`${J}/verifier/test-stdout.txt`]
      let score: number | null = rewardTxt != null && rewardTxt.trim() !== '' ? Number(rewardTxt) : null
      if (score == null || isNaN(score)) score = res?.verifier_result?.rewards?.reward ?? null
      const dur = isoDur(res?.agent_execution?.started_at ?? res?.started_at, res?.agent_execution?.finished_at ?? res?.finished_at)
      try {
        runs.push(buildRun(traj, taskId, agents, baseOf(J), {
          harness: cfg?.agent?.name ?? res?.agent_info?.name ?? null,
          model: cfg?.agent?.model_name ?? res?.agent_info?.model_info?.name ?? null,
          score: typeof score === 'number' && !isNaN(score) ? score : null,
          summary: clip(stdout, 8000) ?? null,
          durationSec: dur,
          idHint: baseOf(J),
        }))
      } catch (e) { warnings.push(`skipped ${J}: ${e instanceof Error ? e.message : e}`) }
    }

    // --- back-compat: <task>/trajectories/*.json or loose *.json directly in jobs/ ---
    for (const p of paths) {
      if (!p.endsWith('.json')) continue
      const inTraj = p.startsWith(`${taskDir}/trajectories/`)
      const looseJob = p.startsWith(jobsRoot + '/') && dirOf(p) === jobsRoot
      if (!inTraj && !looseJob) continue
      if (/\/(config|result|debug_analysis|manifest)\.json$/i.test(p)) continue
      const d = readJson(p)
      if (!looksTraj(d)) continue
      try { runs.push(buildRun(d, taskId, agents, baseOf(p).replace('.json', ''))) }
      catch (e) { warnings.push(`skipped ${p}: ${e instanceof Error ? e.message : e}`) }
    }
  }

  for (const T of taskDirs) addTask(T)

  // Fallback: a zip of bare trajectory JSON(s) with no task dir.
  if (tasks.length === 0) {
    const taskId = uniqueId('upload-trajectories')
    let added = false
    for (const p of paths) {
      if (!p.endsWith('.json')) continue
      const d = readJson(p)
      if (!looksTraj(d)) continue
      if (!added) {
        tasks.push({ id: taskId, vendorId: 'upload', title: 'Uploaded trajectories', source: 'harbor', category: 'Uploaded', difficulty: '', files: [], tier: 'example', metadata: {} })
        added = true
      }
      try { runs.push(buildRun(d, taskId, agents, baseOf(p).replace('.json', ''))) } catch { /* skip */ }
    }
  }

  if (tasks.length === 0 && runs.length === 0)
    throw new Error('No Harbor task (instruction.md/task.toml) or trajectory JSON found. Expected each task dir to contain instruction.md + jobs/<trial>/agent/trajectory.json.')

  return { vendors: [UPLOAD_VENDOR], agents: [...agents.values()], tasks, runs, warnings }
}
