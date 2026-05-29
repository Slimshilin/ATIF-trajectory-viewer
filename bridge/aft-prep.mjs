#!/usr/bin/env node
// Materialize ./trial + ./task + PROMPT.txt for one or more runs into
// /tmp/aftwork/<runId>/ so a subagent can perform the AFT audit by reading them.
// Usage: node bridge/aft-prep.mjs <runId> [runId...]
//        node bridge/aft-prep.mjs --failed --limit 8   (auto-pick pending failed runs)
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const dataset = JSON.parse(readFileSync(join(ROOT, 'public', 'dataset.json'), 'utf8'))
const template = readFileSync(join(ROOT, 'public', 'aft-prompt.agentic.md'), 'utf8')
const OUT_AFT = join(ROOT, 'public', 'aft')
const WORK = '/tmp/aftwork'

const byId = (a) => Object.fromEntries(a.map((x) => [x.id, x]))
const tasks = byId(dataset.tasks), agents = byId(dataset.agents), vendors = byId(dataset.vendors)

const args = process.argv.slice(2)
let ids = args.filter((a) => !a.startsWith('--'))
if (args.includes('--failed')) {
  const i = args.indexOf('--limit'); const lim = i >= 0 ? Number(args[i + 1]) : 8
  ids = dataset.runs
    .filter((r) => !r.passed && r.steps.length > 2 && !existsSync(join(OUT_AFT, `${r.id}.json`)))
    .slice(0, lim)
    .map((r) => r.id)
}

function fill(run, task, agent, vendor) {
  const sm = run.grade?.maxScore && run.grade.maxScore !== 1 ? 'threshold' : 'pass_fail'
  const v = { task_id: task.metadata?.task_key ?? task.id, benchmark: vendor?.name ?? task.source, trial_id: run.id,
    harness: agent?.harness ?? 'unknown', agent_model: agent?.model ?? 'unknown', reward: String(run.reward ?? 'null'),
    exception: run.failureReason ? JSON.stringify(run.failureReason) : 'null', score_mode: sm, raw_reward: String(run.reward ?? 'null'),
    threshold: sm === 'threshold' ? String(run.grade?.maxScore) : 'null', score: String(run.grade?.score ?? run.reward ?? 'null'), performance: run.passed ? '1' : '0' }
  let p = template
  for (const [k, val] of Object.entries(v)) p = p.split(`{${k}}`).join(val)
  return p.split('{{').join('{').split('}}').join('}')
}

const prepared = []
for (const id of ids) {
  const run = dataset.runs.find((r) => r.id === id)
  if (!run) { console.error('no run', id); continue }
  const task = tasks[run.taskId]
  const dir = join(WORK, id)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const files = {
    'trial/trajectory.json': JSON.stringify({ id: run.id, steps: run.steps }, null, 1),
    'trial/result.json': JSON.stringify({ reward: run.reward, performance: run.passed ? 1 : 0, exception: run.failureReason ?? null }),
    'trial/test_stdout.txt': run.failureReason || run.grade?.summary || (run.grade ? JSON.stringify(run.grade, null, 1) : '(none)'),
    'PROMPT.txt': fill(run, task, agents[run.agentId], vendors[run.vendorId]),
  }
  for (const tf of task.files) if (tf.content != null && tf.kind !== 'image') files[`task/${tf.path}`] = tf.content
  if (task.instruction) files['task/instruction.md'] = task.instruction
  for (const [rel, content] of Object.entries(files)) { const f = join(dir, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, content) }
  prepared.push({ id, dir })
}
console.log(JSON.stringify({ outDir: OUT_AFT, prepared }, null, 2))
