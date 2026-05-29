#!/usr/bin/env node
// ---------------------------------------------------------------------------
// AFT local bridge: lets the (browser) Trajectory Viewer run the Agent Failure
// Taxonomy audit through a subscription-authenticated terminal agent
// (Claude Code or Codex) instead of an API key.
//
// It receives a trial's files + the AFT prompt, materializes ./trial and
// ./task in a temp dir, then runs the CLI agent IN that dir so it performs the
// real from-scratch, file-reading audit the AFT prompt was written for.
//
// Run:  node bridge/aft-bridge.mjs           (default port 8765)
//       PORT=9000 node bridge/aft-bridge.mjs
// Requires `claude` (Claude Code) and/or `codex` on your PATH, logged in with
// your subscription. Nothing is sent anywhere except to your local CLI.
// ---------------------------------------------------------------------------
import http from 'node:http'
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

const PORT = Number(process.env.PORT) || 8765
const TIMEOUT_MS = Number(process.env.AFT_TIMEOUT_MS) || 240_000

// Isolation runtime: 'host' (default — run the CLI directly) or 'docker'
// (run each analysis in a throwaway container with only the workspace mounted).
const RUNTIME = process.env.ANALYZER_RUNTIME === 'docker' ? 'docker' : 'host'
const DOCKER_IMAGE = process.env.ANALYZER_DOCKER_IMAGE || 'aft-analyzer'
const DOCKER_MOUNT_AUTH = process.env.ANALYZER_DOCKER_MOUNT_AUTH === '1'

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

function have(cmd) {
  try { execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' }); return true }
  catch { return false }
}
const HAS = { claude: have('claude'), codex: have('codex') }

// Best-effort login status (so the UI can show "connected" before running).
function authStatus() {
  const out = { claude: false, codex: false }
  if (HAS.codex) { try { execSync('codex login status', { stdio: 'ignore' }); out.codex = true } catch { /* not logged in */ } }
  if (HAS.claude) {
    out.claude = !!process.env.ANTHROPIC_API_KEY ||
      existsSync(join(homedir(), '.claude', '.credentials.json')) ||
      existsSync(join(homedir(), '.claude.json'))
  }
  return out
}

function pickCli(requested) {
  if (requested && requested !== 'auto') return HAS[requested] ? requested : null
  if (HAS.claude) return 'claude'
  if (HAS.codex) return 'codex'
  return null
}

// Run the subscription-authenticated agent in `cwd`, return its final text.
// Verified flags: Claude Code `claude -p --output-format json`; Codex
// `codex exec -m … -c model_reasoning_effort=… -o <file>`.
function runAgent(cli, prompt, cwd, model, effort, apiKey) {
  // In docker mode the CLI sees the workspace at /work; on host it's `cwd`.
  const wsDir = RUNTIME === 'docker' ? '/work' : cwd
  const outFile = `${wsDir}/_aft_out.txt`
  let args
  if (cli === 'claude') {
    // NOT --bare: keep OAuth so a Pro/Max subscription is used.
    args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions']
    if (model) args.push('--model', model)
  } else {
    const cxEffort = effort === 'minimal' ? 'low' : effort // codex: low|medium|high|xhigh
    args = ['exec', '--skip-git-repo-check', '--sandbox', 'workspace-write', '-o', outFile]
    if (model) args.push('-m', model)
    if (cxEffort) args.push('-c', `model_reasoning_effort="${cxEffort}"`)
    args.push(prompt)
  }

  // Resolve the actual command + args (wrap in `docker run` when isolating).
  let cmd = cli
  if (RUNTIME === 'docker') {
    const keyEnv = cli === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
    const dockerArgs = [
      'run', '--rm', '-i',
      '-v', `${cwd}:/work`, '-w', '/work',
      '--memory', process.env.ANALYZER_DOCKER_MEMORY || '2g',
      '--cpus', process.env.ANALYZER_DOCKER_CPUS || '2',
      '-e', 'NO_COLOR=1', '-e', 'CI=1',
    ]
    if (apiKey) dockerArgs.push('-e', `${keyEnv}=${apiKey}`)
    if (DOCKER_MOUNT_AUTH) {
      // mount the host CLI credentials read-only so a subscription works in-container
      dockerArgs.push('-v', `${process.env.HOME}/.codex:/root/.codex:ro`)
      dockerArgs.push('-v', `${process.env.HOME}/.claude:/root/.claude:ro`)
      dockerArgs.push('-v', `${process.env.HOME}/.claude.json:/root/.claude.json:ro`)
    }
    cmd = 'docker'
    args = [...dockerArgs, DOCKER_IMAGE, cli, ...args]
  }

  return new Promise((resolve) => {
    // NO_COLOR/CI keep ANSI escapes out of stdout so JSON parses cleanly.
    const env = { ...process.env, NO_COLOR: '1', CI: '1' }
    if (apiKey && RUNTIME !== 'docker') env[cli === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] = apiKey
    const child = spawn(cmd, args, { cwd, env })
    let out = '', err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ error: `timeout after ${TIMEOUT_MS}ms`, raw: out }) }, TIMEOUT_MS)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e), raw: out }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let raw = out
      const hostOut = join(cwd, '_aft_out.txt') // codex -o file, on the host (mounted in docker)
      if (cli === 'claude') { try { raw = JSON.parse(out).result ?? out } catch { /* keep stdout */ } }
      else if (existsSync(hostOut)) { try { raw = readFileSync(hostOut, 'utf8') } catch { /* keep stdout */ } }
      resolve({ raw, stderr: err, code })
    })
  })
}

// Two login paths:
//  • interactive  — `codex login` opens a browser OAuth flow (ChatGPT/Google SSO).
//  • headless     — pipe a token on stdin: `codex login --with-access-token`
//    (ChatGPT access token) or `--with-api-key` (sk-… key). This is what makes
//    subscription auth work on a remote/containerised bridge with no browser.
function runLogin(cli, token) {
  return new Promise((resolve) => {
    if (token && cli === 'codex') {
      const flag = token.startsWith('sk-') ? '--with-api-key' : '--with-access-token'
      const child = spawn('codex', ['login', flag], { env: process.env })
      let out = ''
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ error: 'login timed out' }) }, 60_000)
      child.stdout.on('data', (d) => { out += d })
      child.stderr.on('data', (d) => { out += d })
      child.on('close', () => { clearTimeout(timer); resolve({ ok: authStatus().codex, log: out.slice(-400) }) })
      child.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e) }) })
      child.stdin.end(token.trim() + '\n')
      return
    }
    if (cli === 'claude') {
      // Claude Code login is interactive (TUI /login), `claude setup-token` for a
      // long-lived subscription token, or ANTHROPIC_API_KEY for headless.
      return resolve({ needsManual: true, message: 'Log in once with: run `claude` then `/login` (Pro/Max), `claude setup-token` for a long-lived token, or set ANTHROPIC_API_KEY. Then retry.' })
    }
    const child = spawn('codex', ['login'], { env: process.env })
    let out = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ error: 'login timed out' }) }, 180_000)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', () => { clearTimeout(timer); resolve({ ok: authStatus().codex, log: out.slice(-400) }) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: String(e) }) })
  })
}

function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  })
  res.end(body)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {})
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, has: HAS, auth: authStatus(), runtime: RUNTIME, dockerImage: RUNTIME === 'docker' ? DOCKER_IMAGE : null })
  if (req.method === 'POST' && req.url === '/login') {
    let lb = ''
    req.on('data', (c) => { lb += c })
    req.on('end', async () => {
      let cli = 'codex', token
      try { const j = JSON.parse(lb); cli = j.cli || 'codex'; token = j.token } catch { /* default */ }
      if (!HAS[cli]) return send(res, 400, { error: `${cli} not installed` })
      send(res, 200, await runLogin(cli, token))
    })
    return
  }
  if (req.method !== 'POST' || req.url !== '/aft') return send(res, 404, { error: 'POST /aft or /login' })

  let buf = ''
  req.on('data', (c) => { buf += c })
  req.on('end', async () => {
    let body
    try { body = JSON.parse(buf) } catch { return send(res, 400, { error: 'invalid JSON' }) }
    const cli = pickCli(body.cli)
    if (!cli) return send(res, 400, { error: `requested CLI not found on PATH. detected: ${JSON.stringify(HAS)}` })
    const { prompt, files } = body
    if (!prompt || !files) return send(res, 400, { error: 'need { prompt, files }' })

    const root = mkdtempSync(join(tmpdir(), 'aft-'))
    try {
      for (const [rel, content] of Object.entries(files)) {
        const full = join(root, rel)
        mkdirSync(dirname(full), { recursive: true })
        writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content))
      }
      console.log(`[aft-bridge] running ${cli} (${body.model || 'default'}/${body.effort || 'default'}) runtime=${RUNTIME} in ${root} (${Object.keys(files).length} files)`)
      const r = await runAgent(cli, prompt, root, body.model, body.effort, body.apiKey)
      send(res, 200, { cli, ...r })
    } catch (e) {
      send(res, 500, { error: String(e) })
    } finally {
      try { rmSync(root, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })
})

server.listen(PORT, () => {
  console.log(`AFT bridge on http://localhost:${PORT}  (claude=${HAS.claude}, codex=${HAS.codex})`)
  if (!HAS.claude && !HAS.codex) console.log('⚠ neither `claude` nor `codex` found on PATH — install/login first.')
})
