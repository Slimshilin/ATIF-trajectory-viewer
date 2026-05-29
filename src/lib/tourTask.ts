// ---------------------------------------------------------------------------
// Synthetic "Guided Tour" task — a single, clearly-labeled fabricated task
// that exercises EVERY feature the viewer can show, so the interactive
// walkthrough can stay on one coherent task / run instead of hopping
// between real ones (which produces empty artifact stages and skipped steps).
//
// All content here is hand-written demo material. The two "computer-use"
// screenshots are inline SVG mockups encoded as data URIs — no external
// asset is loaded, so the tour works offline and ships no third-party data.
// This task is hidden from the Tasks list and the Overview leaderboards
// (see dataset.tsx) but is reachable by URL for the guided walkthrough.
// ---------------------------------------------------------------------------
import type { Agent, Run, Step, Task, Vendor } from './types'
import type { UploadBundle } from './dataset'

export const TOUR_VENDOR_ID = 'tour'
export const TOUR_TASK_ID = 'tour-demo'
export const TOUR_RUN_ID = 'tour-demo-hero'

// Step indices the tour points at (kept in sync with the hero run + AFT report).
export const TOUR_STEPS = {
  fileEdit: 4,
  spreadsheet: 7,
  web: 8,
  screenshots: 10,
  document: 12,
  answer: 13,
  lost: 8,
} as const

// Inline SVG mockups, base64-encoded → data URIs. Both depict a fake
// "Spreadsheet" window so the computer-use stage renders something plausible
// without loading any external image.
const SVG_EXCEL_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 460" font-family="ui-sans-serif,system-ui">
  <rect width="720" height="460" fill="#f4f4f5"/>
  <rect width="720" height="40" fill="#107c41"/>
  <text x="14" y="26" font-size="14" fill="white" font-weight="600">Spreadsheet — T12_model.xlsx</text>
  <rect x="0" y="40" width="720" height="30" fill="#e7e5e4"/>
  <text x="14" y="60" font-size="12" fill="#3f3f46">File · Edit · View · Formulas · Data · Review</text>
  <g font-size="12" fill="#27272a">
    <rect x="10" y="80" width="700" height="24" fill="#d4d4d8"/>
    <text x="20" y="96" font-weight="600">A</text><text x="105" y="96" font-weight="600">B</text>
    <text x="190" y="96" font-weight="600">C</text><text x="275" y="96" font-weight="600">D</text>
    <text x="360" y="96" font-weight="600">E (Income·T12)</text>
    <line x1="10" y1="104" x2="710" y2="104" stroke="#a1a1aa"/>
    <text x="20" y="128">Unit</text><text x="105" y="128">Jul</text><text x="190" y="128">Aug</text>
    <text x="275" y="128">Sep</text><text x="360" y="128">=AVERAGE(B:D)*12</text>
    <text x="20" y="152">A-101</text><text x="105" y="152">2400</text><text x="190" y="152">2400</text>
    <text x="275" y="152">2475</text><text x="360" y="152" fill="#15803d">29,700</text>
    <text x="20" y="176">A-102</text><text x="105" y="176">2200</text><text x="190" y="176">2260</text>
    <text x="275" y="176">2260</text><text x="360" y="176" fill="#15803d">26,880</text>
    <text x="20" y="200">B-201</text><text x="105" y="200">3100</text><text x="190" y="200">3100</text>
    <text x="275" y="200">3180</text><text x="360" y="200" fill="#15803d">37,520</text>
    <text x="20" y="224">B-202</text><text x="105" y="224">2950</text><text x="190" y="224">2950</text>
    <text x="275" y="224">2950</text><text x="360" y="224" fill="#15803d">35,400</text>
    <line x1="10" y1="240" x2="710" y2="240" stroke="#a1a1aa" stroke-dasharray="3"/>
    <text x="20" y="262" font-weight="700">TOTAL</text>
    <text x="360" y="262" font-weight="700" fill="#15803d">129,500</text>
  </g>
  <rect x="0" y="430" width="720" height="30" fill="#107c41"/>
  <text x="14" y="450" font-size="11" fill="white">Sheet1 · T12 · Expenses        Ready</text>
</svg>`

const SVG_EXCEL_CONFIRM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 460" font-family="ui-sans-serif,system-ui">
  <rect width="720" height="460" fill="#f4f4f5"/>
  <rect width="720" height="40" fill="#107c41"/>
  <text x="14" y="26" font-size="14" fill="white" font-weight="600">Spreadsheet — T12_model.xlsx — verified</text>
  <rect x="100" y="120" width="520" height="220" rx="10" fill="white" stroke="#a1a1aa" stroke-width="1.5"/>
  <circle cx="360" cy="190" r="36" fill="#dcfce7" stroke="#15803d" stroke-width="2"/>
  <path d="M345 192 l12 12 l24 -28" stroke="#15803d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="360" y="262" font-size="18" fill="#27272a" text-anchor="middle" font-weight="600">Totals verified</text>
  <text x="360" y="290" font-size="13" fill="#52525b" text-anchor="middle">T12 income reconciled to 129,500</text>
  <rect x="280" y="306" width="160" height="32" rx="6" fill="#15803d"/>
  <text x="360" y="327" font-size="13" fill="white" text-anchor="middle" font-weight="600">OK</text>
  <rect x="0" y="430" width="720" height="30" fill="#107c41"/>
  <text x="14" y="450" font-size="11" fill="white">Sheet1 · T12 · Expenses        Verified</text>
</svg>`

// btoa is available in every browser; SSR isn't a concern (Vite ships SPA bundles).
const SHOT_A = `data:image/svg+xml;base64,${btoa(SVG_EXCEL_OPEN)}`
const SHOT_B = `data:image/svg+xml;base64,${btoa(SVG_EXCEL_CONFIRM)}`

const vendor: Vendor = { id: TOUR_VENDOR_ID, name: 'Guided Tour (synthetic)' }

const agents: Agent[] = [
  { id: 'tour-claude-opus', harness: 'Claude Code', model: 'claude-opus-4-7', family: 'Anthropic', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-codex', harness: 'Codex CLI', model: 'gpt-5.3-codex', family: 'OpenAI', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-openhands', harness: 'OpenHands', model: 'gemini-3-1-pro', family: 'Google', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-claude-sonnet', harness: 'Claude Code', model: 'claude-sonnet-4-6', family: 'Anthropic', vendorId: TOUR_VENDOR_ID },
]

const INSTRUCTION = `# Q3 Portfolio Reconciliation & Memo

You are working inside a containerised finance workspace. Complete all four parts:

1. **Reconcile** \`data/rent_roll.csv\` against the trailing-12-month (T12) figures and
   build a clean T12 spreadsheet with **live formulas** (income = last-3-months × 4,
   NOI = revenue − expenses).
2. **Fetch the latest figures** from the internal dashboard at
   \`http://dashboard:8091/portfolio/q3\` and use the *current* revenue number
   (do **not** rely on the cached CSV value).
3. **Verify** the reconciliation in the desktop Excel app (screenshot the result).
4. **Write a one-page memo** in markdown summarising the reconciliation, including a
   **month-over-month variance table**.

The grader checks T12 accuracy, dashboard freshness, memo completeness, and formatting.`

const DOCKERFILE = `FROM python:3.11-slim
WORKDIR /app
COPY workspace/ /app/
RUN pip install --no-cache-dir pandas openpyxl requests
EXPOSE 8091
CMD ["python", "analysis/reconcile.py"]`

const COMPOSE = `services:
  app:
    build: .
    working_dir: /app
    depends_on: [db, dashboard]
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: portfolio
    ports: ["5432:5432"]
  dashboard:
    image: nginx:alpine
    ports: ["8091:80"]`

const files: Task['files'] = [
  { path: 'Dockerfile', kind: 'code', language: 'docker', content: DOCKERFILE },
  { path: 'docker-compose.yml', kind: 'code', language: 'yaml', content: COMPOSE },
  { path: 'workspace/README.md', kind: 'markdown', content: '# Portfolio workspace\n\nRun `python analysis/reconcile.py` to rebuild the T12 model.\nThe live dashboard is served on `:8091`.' },
  { path: 'workspace/data/rent_roll.csv', kind: 'text', content: 'unit,jul,aug,sep,monthly_rent\nA-101,2400,2400,2475,2475\nA-102,2200,2260,2260,2260\nB-201,3100,3100,3180,3180\nB-202,2950,2950,2950,3010' },
  { path: 'workspace/analysis/reconcile.py', kind: 'code', language: 'python', content: '# stub — the agent fills this in\nimport pandas as pd\n\ndef build_t12(df):\n    """income = last 3 months * 4; NOI = revenue - expenses"""\n    raise NotImplementedError' },
  { path: 'workspace/(4)_(Evaluation)_RUBRIC.md', kind: 'markdown', content: '# Evaluation rubric\n\n- T12 cell accuracy — 40%\n- Dashboard freshness (use live figure) — 25%\n- Memo completeness (incl. variance table) — 25%\n- Formatting (bold totals, currency) — 10%' },
]

const task: Task = {
  id: TOUR_TASK_ID,
  vendorId: TOUR_VENDOR_ID,
  title: '🎬 Guided Tour — Feature Demo (synthetic)',
  source: 'harbor',
  category: 'Tour',
  difficulty: 'demo',
  instruction: INSTRUCTION,
  files,
  tier: 'example',
  metadata: { synthetic: true },
}

// ---- the hero trajectory: one run that touches every artifact type ---------
const tc = (name: string, args: object): NonNullable<Step['toolCalls']> => [{ name, args: JSON.stringify(args) }]

const steps: Step[] = [
  { index: 0, role: 'user', text: INSTRUCTION, tSec: 0 },
  { index: 1, role: 'assistant', reasoning: 'Plan: (1) inspect the workspace and rent-roll, (2) build the T12 sheet with live formulas, (3) pull the current revenue from the dashboard, (4) verify in the desktop app, (5) write the memo.', text: 'Starting with the workspace layout and the rent-roll data.', tSec: 6 },
  { index: 2, role: 'assistant', toolCalls: tc('bash', { command: 'ls -la /app && ls /app/data' }), observation: 'Dockerfile  analysis/  data/  README.md\nrent_roll.csv  (4)_(Evaluation)_RUBRIC.md', tSec: 14 },
  { index: 3, role: 'assistant', toolCalls: tc('bash', { command: 'cat /app/data/rent_roll.csv' }), observation: 'unit,jul,aug,sep,monthly_rent\nA-101,2400,2400,2475,2475\n...4 units total', tSec: 25 },
  {
    index: 4, role: 'assistant', text: 'Implementing the reconciliation script.',
    toolCalls: tc('create_file', { path: 'analysis/reconcile.py', file_text: 'import pandas as pd\n\ndef build_t12(df):\n    df["income"] = df[["jul","aug","sep"]].mean(axis=1) * 12\n    df["noi"] = df["income"] - df.get("expenses", 0)\n    return df\n' }),
    observation: 'Wrote analysis/reconcile.py (8 lines).',
    mutations: [{ kind: 'file', tool: 'create_file', target: 'analysis/reconcile.py', summary: 'created reconcile.py' }],
    tSec: 70,
  },
  {
    index: 5, role: 'assistant', text: 'Building the T12 grid from the rent roll.',
    edits: [{ t: 'sheet', target: 'T12_model.xlsx', sheet: 'T12', anchor: 'A1', cells: [['Unit', 'Jul', 'Aug', 'Sep', 'Income (T12)'], ['A-101', '2400', '2400', '2475', '29700'], ['A-102', '2200', '2260', '2260', '8920'], ['B-201', '3100', '3100', '3180', '37520'], ['B-202', '2950', '2950', '2950', '35400']] }],
    tSec: 120,
  },
  {
    index: 6, role: 'assistant', text: 'Adding live formulas for income and NOI.',
    edits: [{ t: 'formula', target: 'T12_model.xlsx', sheet: 'T12', formulas: [{ c: 'E2', f: '=AVERAGE(B2:D2)*12' }, { c: 'E6', f: '=SUM(E2:E5)' }, { c: 'F6', f: '=E6-Expenses!B6' }] }],
    tSec: 165,
  },
  {
    index: 7, role: 'assistant', text: 'Totals row and formatting.',
    edits: [{ t: 'sheet', target: 'T12_model.xlsx', sheet: 'T12', anchor: 'A6', cells: [['TOTAL', '', '', '', '111540']] }],
    mutations: [{ kind: 'spreadsheet', tool: 'excel_write', target: 'T12_model.xlsx', summary: 'wrote totals row' }],
    tSec: 200,
  },
  {
    index: 8, role: 'assistant', text: 'Fetching the live dashboard figure.',
    toolCalls: tc('web_fetch', { url: 'http://dashboard:8091/portfolio/q3' }),
    edits: [{ t: 'web', url: 'http://dashboard:8091/portfolio/q3', content: '# Q3 Portfolio Dashboard\n\n**Live revenue (Q3): $114,200**  _(updated 2 hours ago)_\n\n| Metric | Value |\n| --- | --- |\n| Occupancy | 96.5% |\n| NOI margin | 61% |\n| Delinquency | 1.2% |\n\n> Note: the CSV snapshot ($111,540) is stale — use the live figure above.' }],
    tSec: 250,
  },
  {
    index: 9, role: 'assistant', text: 'Opening the desktop Excel app to verify.',
    toolCalls: tc('computer', { action: 'screenshot' }),
    edits: [{ t: 'computer', action: 'open', coord: [640, 360], text: 'Excel' }, { t: 'screenshot', url: SHOT_A }],
    tSec: 300,
  },
  {
    index: 10, role: 'assistant', text: 'Confirming the totals match in the app.',
    edits: [{ t: 'screenshot', url: SHOT_B }],
    tSec: 330,
  },
  {
    index: 11, role: 'assistant', text: 'Drafting the memo.',
    edits: [{ t: 'doc', target: 'memo.md', op: 'heading', text: 'Q3 Portfolio Reconciliation Memo', level: 1 }],
    tSec: 360,
  },
  {
    index: 12, role: 'assistant', text: 'Memo body.',
    edits: [{ t: 'doc', target: 'memo.md', op: 'para', text: 'The T12 reconciliation ties out across all four units. Trailing-12 income totals $111,540 per the rent roll. See the attached T12 model for the live formulas.' }],
    mutations: [{ kind: 'document', tool: 'write_file', target: 'memo.md', summary: 'wrote memo body' }],
    tSec: 395,
  },
  {
    index: 13, role: 'assistant', text: 'Final answer.',
    edits: [{ t: 'answer', content: '**Done.** Built `T12_model.xlsx` with live formulas, verified in the desktop app, and wrote `memo.md`. Trailing-12 income: **$111,540**.' }],
    tSec: 410,
  },
  { index: 14, role: 'assistant', text: 'Reconciliation complete and memo saved.', tSec: 418 },
]

const heroRun: Run = {
  id: TOUR_RUN_ID,
  taskId: TOUR_TASK_ID,
  agentId: 'tour-claude-opus',
  vendorId: TOUR_VENDOR_ID,
  format: 'harbor',
  status: 'partial',
  passed: false,
  reward: 0.62,
  steps,
  stepCount: steps.length,
  turns: 1,
  durationSec: 418,
  artifacts: ['T12_model.xlsx', 'memo.md', 'analysis/reconcile.py'],
  tokens: { prompt: 48200, completion: 9100, costUsd: 0.41 },
  failureReason: 'Used the stale CSV revenue ($111,540) instead of the live dashboard figure ($114,200); memo omitted the variance table.',
  grade: {
    score: 0.62,
    maxScore: 1,
    gate: { 'workspace builds': true, 'T12 reconciled': true, 'dashboard figure current': false, 'memo complete': false },
    subscores: [
      { label: 'T12 cell accuracy', score: 0.92 },
      { label: 'Dashboard freshness', score: 0.0 },
      { label: 'Memo completeness', score: 0.5 },
      { label: 'Formatting', score: 0.8 },
    ],
    summary: `### Verifier log

\`\`\`
[1/4] workspace builds .......... PASS
[2/4] T12 cell accuracy ......... PASS  (37/40 cells exact; 0.92)
[3/4] dashboard freshness ....... FAIL  used 111540 (CSV) — live value is 114200
[4/4] memo completeness ......... PARTIAL  variance table missing (0.5)
\`\`\`

**Weighted score: 0.62 / 1.00.** The model reconciled the trailing-12 figures
correctly and formatted the sheet, but reported the **stale CSV revenue** rather
than the live dashboard number it had successfully fetched, and the memo omitted
the required month-over-month variance table.`,
    findings: [
      { category: 'Data freshness', severity: 'critical', summary: 'Reported stale revenue', detail: 'Live dashboard returned $114,200 but the memo and answer used the CSV snapshot $111,540.' },
      { category: 'Deliverable completeness', severity: 'major', summary: 'Memo missing variance table', detail: 'The rubric requires a month-over-month variance table; the memo had only a prose summary.' },
    ],
  },
}

const sibling = (id: string, agentId: string, status: Run['status'], passed: boolean, reward: number, stepCount: number, durationSec: number): Run => ({
  id, taskId: TOUR_TASK_ID, agentId, vendorId: TOUR_VENDOR_ID, format: 'harbor',
  status, passed, reward, steps: [], stepCount, turns: 1, durationSec,
  grade: { score: reward, maxScore: 1, subscores: [] },
})

const runs: Run[] = [
  heroRun,
  sibling('tour-demo-pass-1', 'tour-codex', 'passed', true, 1.0, 22, 305),
  sibling('tour-demo-pass-2', 'tour-openhands', 'passed', true, 0.95, 31, 372),
  sibling('tour-demo-fail-1', 'tour-claude-sonnet', 'failed', false, 0.2, 41, 540),
]

export const TOUR_BUNDLE: UploadBundle = { vendors: [vendor], agents, tasks: [task], runs }
