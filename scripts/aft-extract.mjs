// Materialise a compact, human-readable SOURCES file for one run so an auditor
// (subagent) can produce an AFT report without loading the whole dataset.json.
//   node scripts/aft-extract.mjs <runId>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const runId = process.argv[2]
if (!runId) { console.error('usage: aft-extract.mjs <runId>'); process.exit(1) }

const d = JSON.parse(readFileSync(new URL('../public/dataset.json', import.meta.url), 'utf8'))
const run = d.runs.find((r) => r.id === runId)
if (!run) { console.error('run not found:', runId); process.exit(1) }
const task = d.tasks.find((t) => t.id === run.taskId)
const agent = d.agents.find((a) => a.id === run.agentId)

const clip = (s, n) => (s == null ? '' : String(s).length > n ? String(s).slice(0, n) + ' …[truncated]' : String(s))
const editSummary = (e) => {
  if (e.t === 'sheet') return `sheet ${e.target ?? ''}!${e.sheet} @${e.anchor}: ${e.cells?.length ?? 0} rows`
  if (e.t === 'formula') return `formula ${e.target ?? ''}!${e.sheet}: ${(e.formulas ?? []).map((f) => `${f.c}=${f.f}`).join(', ')}`
  if (e.t === 'doc') return `doc ${e.target ?? ''} ${e.op}: ${clip(e.text, 200)}`
  if (e.t === 'web') return `web ${e.url ?? ''}: ${clip(e.content, 300)}`
  if (e.t === 'computer') return `computer ${e.action ?? ''} @${e.coord ?? ''} ${clip(e.text, 60)}`
  if (e.t === 'screenshot') return `screenshot ${e.url}`
  if (e.t === 'answer') return `ANSWER: ${clip(e.content, 600)}`
  return JSON.stringify(e).slice(0, 120)
}

let out = ''
out += `# AFT SOURCES for trial ${run.id}\n\n`
out += `task_id: ${run.taskId}\nbenchmark: ${task?.source ?? ''}\nharness: ${agent?.harness ?? ''}\nagent_model: ${agent?.model ?? ''}\n`
out += `reward: ${run.reward}\nstatus: ${run.status}\npassed: ${run.passed}\nperformance: ${run.passed ? 1 : 0}\nn_steps: ${run.steps.length}\n\n`

out += `## TASK INSTRUCTION\n${clip(task?.instruction, 4000) || '(none provided)'}\n\n`

// rubric / evaluation files first, then a few others
const files = task?.files ?? []
const rubric = files.filter((f) => /rubric|eval|grad|criteri|README/i.test(f.path) && f.content)
out += `## TASK FILES (rubric / key files)\n`
for (const f of rubric.slice(0, 4)) out += `\n### ${f.path}\n${clip(f.content, 2500)}\n`
out += `\n(other files: ${files.map((f) => f.path).slice(0, 30).join(', ')})\n\n`

// verifier / grade
out += `## VERIFIER / GRADE\n`
if (run.grade) {
  out += `score: ${run.grade.score} / ${run.grade.maxScore ?? 1}\n`
  if (run.grade.gate) out += `gate: ${JSON.stringify(run.grade.gate)}\n`
  if (run.grade.subscores?.length) out += `subscores: ${run.grade.subscores.map((s) => `${s.label}=${s.score}`).join(', ')}\n`
  if (run.grade.summary) out += `\nverifier log:\n${clip(run.grade.summary, 3000)}\n`
  for (const f of run.grade.findings ?? []) out += `finding [${f.severity}] ${f.category}: ${f.summary} — ${clip(f.detail, 300)}\n`
} else {
  out += `(no grader/verifier output shipped — reward=${run.reward}. Judge closeness from the trajectory + task rubric.)\n`
}
if (run.failureReason) out += `failureReason: ${clip(run.failureReason, 500)}\n`
out += `\n`

// trajectory
out += `## TRAJECTORY (${run.steps.length} steps)\n`
for (const s of run.steps) {
  out += `\n--- step ${s.index} [${s.role}] ---\n`
  if (s.reasoning) out += `reasoning: ${clip(s.reasoning, 500)}\n`
  if (s.text) out += `text: ${clip(s.text, 500)}\n`
  for (const tcl of s.toolCalls ?? []) out += `tool: ${tcl.name}(${clip(tcl.args, 240)})\n`
  if (s.observation) out += `observation: ${clip(s.observation, 500)}\n`
  for (const e of s.edits ?? []) out += `edit: ${editSummary(e)}\n`
}

mkdirSync(new URL('../../.aftwork/', import.meta.url), { recursive: true })
const path = new URL(`../../.aftwork/${run.id}.txt`, import.meta.url)
writeFileSync(path, out)
console.log('wrote', path.pathname, `(${out.length} bytes, ${run.steps.length} steps)`)
