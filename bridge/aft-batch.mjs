#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Pre-compute AFT reports for the dataset so they appear automatically on the
// public site (no API key / bridge needed by visitors). Uses your local
// subscription CLI (claude / codex), like the bridge, but in batch.
//
// Run (from cc_viewer/):
//   npm run aft:batch                 # all failed runs (resumes; skips done)
//   npm run aft:batch -- --limit 10   # cap how many this pass
//   npm run aft:batch -- --vendor snorkel
//   npm run aft:batch -- --cli codex
//
// Output: public/aft/<runId>.json  +  public/aft/index.json (manifest)
// Re-run anytime; existing reports are skipped unless --force.
// ---------------------------------------------------------------------------
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }
const has = (k) => args.includes(`--${k}`)
const LIMIT = Number(opt('limit', 1e9))
const VENDOR = opt('vendor', null)
const FORCE = has('force')
const TIMEOUT_MS = Number(opt('timeout', 240000))
const RUNS = (opt('runs', '') || '').split(',').map((s) => s.trim()).filter(Boolean)
const SHOWCASE = has('showcase')

const ROOT = new URL('..', import.meta.url).pathname
const OUT_DIR = join(ROOT, 'public', 'aft')
const dataset = JSON.parse(readFileSync(join(ROOT, 'public', 'dataset.json'), 'utf8'))
const template = readFileSync(join(ROOT, 'public', 'aft-prompt.agentic.md'), 'utf8')

function whichCli() {
  const want = opt('cli', 'auto')
  const have = (c) => { try { execSync(`command -v ${c}`, { stdio: 'ignore' }); return true } catch { return false } }
  if (want !== 'auto') return have(want) ? want : null
  return have('claude') ? 'claude' : have('codex') ? 'codex' : null
}
const CLI = whichCli()
if (!CLI) { console.error('No claude/codex on PATH. Log in to one first.'); process.exit(1) }

function fill(run, task, agent, vendor) {
  const sm = run.grade?.maxScore && run.grade.maxScore !== 1 ? 'threshold' : 'pass_fail'
  const vars = {
    task_id: task.metadata?.task_key ?? task.id, benchmark: vendor?.name ?? task.source,
    trial_id: run.id, harness: agent?.harness ?? 'unknown', agent_model: agent?.model ?? 'unknown',
    reward: String(run.reward ?? 'null'), exception: run.failureReason ? JSON.stringify(run.failureReason) : 'null',
    score_mode: sm, raw_reward: String(run.reward ?? 'null'), threshold: sm === 'threshold' ? String(run.grade?.maxScore) : 'null',
    score: String(run.grade?.score ?? run.reward ?? 'null'), performance: run.passed ? '1' : '0',
  }
  let p = template
  for (const [k, v] of Object.entries(vars)) p = p.split(`{${k}}`).join(v)
  return p.split('{{').join('{').split('}}').join('}')
}
function files(run, task) {
  const f = { 'trial/trajectory.json': JSON.stringify({ id: run.id, steps: run.steps }, null, 1),
    'trial/result.json': JSON.stringify({ reward: run.reward, performance: run.passed ? 1 : 0, exception: run.failureReason ?? null }),
    'trial/test_stdout.txt': run.failureReason || run.grade?.summary || (run.grade ? JSON.stringify(run.grade, null, 1) : '(none)') }
  for (const tf of task.files) if (tf.content != null && tf.kind !== 'image') f[`task/${tf.path}`] = tf.content
  if (task.instruction) f['task/instruction.md'] = task.instruction
  return f
}
const MODEL = opt('model', null)
const EFFORT = opt('effort', null)
function runAgent(prompt, cwd) {
  let args
  if (CLI === 'claude') { args = ['-p', prompt, '--dangerously-skip-permissions']; if (MODEL) args.push('--model', MODEL) }
  else { args = ['exec', '--skip-git-repo-check']; if (MODEL) args.push('-m', MODEL); if (EFFORT) args.push('-c', `model_reasoning_effort="${EFFORT}"`); args.push(prompt) }
  const spec = [CLI, args]
  return new Promise((resolve) => {
    const c = spawn(spec[0], spec[1], { cwd, env: { ...process.env, NO_COLOR: '1', CI: '1' } })
    let out = ''
    const t = setTimeout(() => { c.kill('SIGKILL'); resolve({ raw: out, timeout: true }) }, TIMEOUT_MS)
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', () => {})
    c.on('error', (e) => { clearTimeout(t); resolve({ raw: out, error: String(e) }) })
    c.on('close', () => { clearTimeout(t); resolve({ raw: out }) })
  })
}
function parseReport(raw) {
  const last = raw.lastIndexOf('}'); if (last < 0) return null
  let depth = 0
  for (let i = last; i >= 0; i--) { if (raw[i] === '}') depth++; else if (raw[i] === '{') { if (--depth === 0) { try { const o = JSON.parse(raw.slice(i, last + 1)); return (o.failure_modes && o.outcome && o.outcome.closeness) ? o : null } catch { return null } } } }
  return null
}

mkdirSync(OUT_DIR, { recursive: true })
const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]))
const tasks = byId(dataset.tasks), agents = byId(dataset.agents), vendors = byId(dataset.vendors)
let targets
if (RUNS.length) {
  const wanted = new Set(RUNS)
  targets = dataset.runs.filter((r) => wanted.has(r.id) && r.steps.length > 2)
} else if (SHOWCASE) {
  const ids = new Set((dataset.showcase || []).map((p) => p.runId).filter(Boolean))
  targets = dataset.runs.filter((r) => ids.has(r.id) && r.steps.length > 2)
} else {
  // default: every failed run with a real trajectory
  targets = dataset.runs.filter((r) => !r.passed && r.steps.length > 2)
}
if (VENDOR) targets = targets.filter((r) => r.vendorId === VENDOR)
targets = targets.filter((r) => FORCE || !existsSync(join(OUT_DIR, `${r.id}.json`))).slice(0, LIMIT)

console.log(`AFT batch via ${CLI}: ${targets.length} run(s) to process.`)
let ok = 0
for (const [i, run] of targets.entries()) {
  const task = tasks[run.taskId]; if (!task) continue
  const prompt = fill(run, task, agents[run.agentId], vendors[run.vendorId])
  const dir = mkdtempSync(join(tmpdir(), 'aftb-'))
  try {
    for (const [rel, content] of Object.entries(files(run, task))) { const full = join(dir, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content) }
    process.stdout.write(`[${i + 1}/${targets.length}] ${run.id} … `)
    const { raw, error, timeout } = await runAgent(prompt, dir)
    const rep = parseReport(raw || '')
    if (rep) { writeFileSync(join(OUT_DIR, `${run.id}.json`), JSON.stringify(rep)); ok++; console.log(`✓ ${rep.outcome.closeness}`) }
    else console.log(`✗ no report${timeout ? ' (timeout)' : error ? ` (${error})` : ''}`)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
// manifest
const ids = readdirSync(OUT_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => f.replace('.json', ''))
writeFileSync(join(OUT_DIR, 'index.json'), JSON.stringify(ids))
console.log(`Done. ${ok} new report(s); ${ids.length} total in public/aft/.`)
