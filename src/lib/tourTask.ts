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
  <text x="14" y="26" font-size="14" fill="white" font-weight="600">Spreadsheet (toy) - widget_sales.xlsx</text>
  <rect x="0" y="40" width="720" height="30" fill="#e7e5e4"/>
  <text x="14" y="60" font-size="12" fill="#3f3f46">File . Edit . View . Formulas . Data . Review</text>
  <g font-size="12" fill="#27272a">
    <rect x="10" y="80" width="700" height="24" fill="#d4d4d8"/>
    <text x="20" y="96" font-weight="600">A</text><text x="105" y="96" font-weight="600">B</text>
    <text x="190" y="96" font-weight="600">C</text><text x="275" y="96" font-weight="600">D</text>
    <text x="360" y="96" font-weight="600">E (Total $)</text>
    <line x1="10" y1="104" x2="710" y2="104" stroke="#a1a1aa"/>
    <text x="20" y="128">Widget</text><text x="105" y="128">Oct</text><text x="190" y="128">Nov</text>
    <text x="275" y="128">Dec</text><text x="360" y="128">=(B:D sum) * price</text>
    <text x="20" y="152">Widget-A</text><text x="105" y="152">12</text><text x="190" y="152">14</text>
    <text x="275" y="152">18</text><text x="360" y="152" fill="#15803d">439.56</text>
    <text x="20" y="176">Widget-B</text><text x="105" y="176">8</text><text x="190" y="176">11</text>
    <text x="275" y="176">13</text><text x="360" y="176" fill="#15803d">464.00</text>
    <text x="20" y="200">Widget-C</text><text x="105" y="200">21</text><text x="190" y="200">19</text>
    <text x="275" y="200">24</text><text x="360" y="200" fill="#15803d">272.00</text>
    <text x="20" y="224">Widget-D</text><text x="105" y="224">6</text><text x="190" y="224">7</text>
    <text x="275" y="224">9</text><text x="360" y="224" fill="#15803d">659.78</text>
    <line x1="10" y1="240" x2="710" y2="240" stroke="#a1a1aa" stroke-dasharray="3"/>
    <text x="20" y="262" font-weight="700">TOTAL</text>
    <text x="360" y="262" font-weight="700" fill="#15803d">1,835.34</text>
  </g>
  <rect x="0" y="430" width="720" height="30" fill="#107c41"/>
  <text x="14" y="450" font-size="11" fill="white">Q4 . AcmeDemo (fictitious)        Ready</text>
</svg>`

const SVG_EXCEL_CONFIRM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 460" font-family="ui-sans-serif,system-ui">
  <rect width="720" height="460" fill="#f4f4f5"/>
  <rect width="720" height="40" fill="#107c41"/>
  <text x="14" y="26" font-size="14" fill="white" font-weight="600">Spreadsheet (toy) - widget_sales.xlsx - verified</text>
  <rect x="100" y="120" width="520" height="220" rx="10" fill="white" stroke="#a1a1aa" stroke-width="1.5"/>
  <circle cx="360" cy="190" r="36" fill="#dcfce7" stroke="#15803d" stroke-width="2"/>
  <path d="M345 192 l12 12 l24 -28" stroke="#15803d" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="360" y="262" font-size="18" fill="#27272a" text-anchor="middle" font-weight="600">Totals verified</text>
  <text x="360" y="290" font-size="13" fill="#52525b" text-anchor="middle">Toy Q4 total reconciled to $1,835.34</text>
  <rect x="280" y="306" width="160" height="32" rx="6" fill="#15803d"/>
  <text x="360" y="327" font-size="13" fill="white" text-anchor="middle" font-weight="600">OK</text>
  <rect x="0" y="430" width="720" height="30" fill="#107c41"/>
  <text x="14" y="450" font-size="11" fill="white">Q4 . AcmeDemo (fictitious)        Verified</text>
</svg>`

// Encode a Unicode string as base64 — `btoa` only accepts Latin1, but our SVG
// mockups include em-dashes and other non-Latin1 glyphs. We URL-encode first,
// then unescape to a Latin1-safe byte stream, then base64.
function utf8b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}
const SHOT_A = `data:image/svg+xml;base64,${utf8b64(SVG_EXCEL_OPEN)}`
const SHOT_B = `data:image/svg+xml;base64,${utf8b64(SVG_EXCEL_CONFIRM)}`

const vendor: Vendor = { id: TOUR_VENDOR_ID, name: 'Guided Tour (synthetic)' }

const agents: Agent[] = [
  { id: 'tour-claude-opus', harness: 'Claude Code', model: 'claude-opus-4-7', family: 'Anthropic', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-codex', harness: 'Codex CLI', model: 'gpt-5.3-codex', family: 'OpenAI', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-openhands', harness: 'OpenHands', model: 'gemini-3-1-pro', family: 'Google', vendorId: TOUR_VENDOR_ID },
  { id: 'tour-claude-sonnet', harness: 'Claude Code', model: 'claude-sonnet-4-6', family: 'Anthropic', vendorId: TOUR_VENDOR_ID },
]

const INSTRUCTION = `# AcmeDemo Inc. · Widget Sales Recap (toy demo task)

> **Note:** this is a fully fictitious task used only to exercise every viewer
> feature in a single run. AcmeDemo Inc., its widgets, and all numbers below
> are made up — there is no real customer, system, or data here.

You are working inside a tiny demo container. Complete all four parts:

1. **Build** a sales sheet from \`data/widget_sales.csv\` (4 toy widgets) with a
   live total formula.
2. **Fetch** the current quarter total from a demo dashboard at
   \`http://demo-dashboard.local/q4\` and use that figure, not the CSV.
3. **Verify** the result on the desktop spreadsheet app (screenshot it).
4. **Write a one-paragraph recap** in markdown summarising the totals.

The toy grader checks: cell accuracy, dashboard freshness, recap completeness,
and basic formatting.`

const DOCKERFILE = `# Toy demo image — not used in production
FROM python:3.11-slim
WORKDIR /app
COPY workspace/ /app/
RUN pip install --no-cache-dir pandas openpyxl requests
CMD ["python", "analysis/build_sheet.py"]`

const COMPOSE = `# Toy compose — illustrative only, all hostnames are demo-local
services:
  app:
    build: .
    working_dir: /app
    depends_on: [demo-dashboard]
  demo-dashboard:
    image: nginx:alpine
    ports: ["8091:80"]`

const files: Task['files'] = [
  { path: 'Dockerfile', kind: 'code', language: 'docker', content: DOCKERFILE },
  { path: 'docker-compose.yml', kind: 'code', language: 'yaml', content: COMPOSE },
  { path: 'workspace/README.md', kind: 'markdown', content: '# AcmeDemo workspace (toy demo)\n\nThis tree is purely illustrative — every value is fabricated for the viewer tour.\nRun `python analysis/build_sheet.py` to (in this fiction) build the sales sheet.\n' },
  { path: 'workspace/data/widget_sales.csv', kind: 'text', content: 'widget,oct,nov,dec,unit_price\nWidget-A,12,14,18,9.99\nWidget-B,8,11,13,14.50\nWidget-C,21,19,24,4.25\nWidget-D,6,7,9,29.99' },
  { path: 'workspace/analysis/build_sheet.py', kind: 'code', language: 'python', content: '# Toy stub — the agent fills this in during the demo trajectory.\nimport pandas as pd\n\ndef build_sales_sheet(df):\n    """total = sum(oct..dec) * unit_price."""\n    raise NotImplementedError\n' },
  { path: 'workspace/RUBRIC.md', kind: 'markdown', content: '# Toy evaluation rubric (demo)\n\n- Cell accuracy — 40%\n- Dashboard freshness (use the live figure) — 25%\n- Recap completeness — 25%\n- Formatting (bold totals, units) — 10%\n' },
]

const task: Task = {
  id: TOUR_TASK_ID,
  vendorId: TOUR_VENDOR_ID,
  title: '🎬 Guided Tour — AcmeDemo widget task (fictitious)',
  source: 'harbor',
  category: 'Tour',
  difficulty: 'demo',
  instruction: INSTRUCTION,
  files,
  tier: 'example',
  metadata: { synthetic: true, disclaimer: 'All numbers, hostnames, and company names in this task are fabricated for the tour.' },
}

// ---- the hero trajectory: one run that touches every artifact type ---------
const tc = (name: string, args: object): NonNullable<Step['toolCalls']> => [{ name, args: JSON.stringify(args) }]

const steps: Step[] = [
  { index: 0, role: 'user', text: INSTRUCTION, tSec: 0 },
  { index: 1, role: 'assistant', reasoning: 'Plan: (1) inspect the AcmeDemo workspace and widget sales data, (2) build a sales sheet with a live total formula, (3) pull the current quarter total from the demo dashboard, (4) verify on the desktop app, (5) write the recap paragraph.', text: 'Starting with the workspace layout and the widget sales data.', tSec: 6 },
  { index: 2, role: 'assistant', toolCalls: tc('bash', { command: 'ls -la /app && ls /app/data' }), observation: 'Dockerfile  analysis/  data/  README.md\nwidget_sales.csv  RUBRIC.md', tSec: 14 },
  { index: 3, role: 'assistant', toolCalls: tc('bash', { command: 'cat /app/data/widget_sales.csv' }), observation: 'widget,oct,nov,dec,unit_price\nWidget-A,12,14,18,9.99\n...4 widgets total', tSec: 25 },
  {
    index: 4, role: 'assistant', text: 'Implementing the toy sheet-builder script.',
    toolCalls: tc('create_file', { path: 'analysis/build_sheet.py', file_text: 'import pandas as pd\n\ndef build_sales_sheet(df):\n    df["units"] = df[["oct","nov","dec"]].sum(axis=1)\n    df["total"] = df["units"] * df["unit_price"]\n    return df\n' }),
    observation: 'Wrote analysis/build_sheet.py (6 lines).',
    mutations: [{ kind: 'file', tool: 'create_file', target: 'analysis/build_sheet.py', summary: 'created build_sheet.py' }],
    tSec: 70,
  },
  {
    index: 5, role: 'assistant', text: 'Building the sales grid from the widget data.',
    edits: [{ t: 'sheet', target: 'widget_sales.xlsx', sheet: 'Q4', anchor: 'A1', cells: [['Widget', 'Oct', 'Nov', 'Dec', 'Total ($)'], ['Widget-A', '12', '14', '18', '439.56'], ['Widget-B', '8', '11', '13', '464.00'], ['Widget-C', '21', '19', '24', '272.00'], ['Widget-D', '6', '7', '9', '659.78']] }],
    tSec: 120,
  },
  {
    index: 6, role: 'assistant', text: 'Adding live formulas for unit count and totals.',
    edits: [{ t: 'formula', target: 'widget_sales.xlsx', sheet: 'Q4', formulas: [{ c: 'E2', f: '=(B2+C2+D2)*F2' }, { c: 'E6', f: '=SUM(E2:E5)' }] }],
    tSec: 165,
  },
  {
    index: 7, role: 'assistant', text: 'Totals row and formatting.',
    edits: [{ t: 'sheet', target: 'widget_sales.xlsx', sheet: 'Q4', anchor: 'A6', cells: [['TOTAL', '', '', '', '1835.34']] }],
    mutations: [{ kind: 'spreadsheet', tool: 'excel_write', target: 'widget_sales.xlsx', summary: 'wrote totals row' }],
    tSec: 200,
  },
  {
    index: 8, role: 'assistant', text: 'Fetching the live demo dashboard figure.',
    toolCalls: tc('web_fetch', { url: 'http://demo-dashboard.local/q4' }),
    edits: [{ t: 'web', url: 'http://demo-dashboard.local/q4', content: '# AcmeDemo · Q4 Widget Dashboard (toy demo)\n\n**Live Q4 total: $1,902.10**  _(updated 2 hours ago — fictitious)_\n\n| Metric | Value |\n| --- | --- |\n| Units sold | 162 |\n| Avg price | $11.74 |\n| Top widget | Widget-D |\n\n> Note: the CSV snapshot ($1,835.34) is stale — use the live figure above.' }],
    tSec: 250,
  },
  {
    index: 9, role: 'assistant', text: 'Opening the desktop spreadsheet app to verify.',
    toolCalls: tc('computer', { action: 'screenshot' }),
    edits: [{ t: 'computer', action: 'open', coord: [640, 360], text: 'Spreadsheet' }, { t: 'screenshot', url: SHOT_A }],
    tSec: 300,
  },
  {
    index: 10, role: 'assistant', text: 'Confirming the totals match in the app.',
    edits: [{ t: 'screenshot', url: SHOT_B }],
    tSec: 330,
  },
  {
    index: 11, role: 'assistant', text: 'Drafting the demo recap.',
    edits: [{ t: 'doc', target: 'recap.md', op: 'heading', text: 'AcmeDemo · Q4 Widget Sales Recap (toy)', level: 1 }],
    tSec: 360,
  },
  {
    index: 12, role: 'assistant', text: 'Recap body.',
    edits: [{ t: 'doc', target: 'recap.md', op: 'para', text: 'Q4 widget sales total $1,835.34 across the four toy widgets. See the attached sheet for the breakdown.' }],
    mutations: [{ kind: 'document', tool: 'write_file', target: 'recap.md', summary: 'wrote recap body' }],
    tSec: 395,
  },
  {
    index: 13, role: 'assistant', text: 'Final answer.',
    edits: [{ t: 'answer', content: '**Done.** Built `T12_model.xlsx` with live formulas, verified in the desktop app, and wrote `memo.md`. Trailing-12 income: **$111,540**.' }],
    tSec: 410,
  },
  { index: 14, role: 'assistant', text: 'Toy sheet built and recap saved.', tSec: 418 },
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
  artifacts: ['widget_sales.xlsx', 'recap.md', 'analysis/build_sheet.py'],
  tokens: { prompt: 48200, completion: 9100, costUsd: 0.41 },
  failureReason: 'Used the stale CSV total ($1,835.34) instead of the live demo-dashboard figure ($1,902.10); recap omitted the per-widget breakdown.',
  grade: {
    score: 0.62,
    maxScore: 1,
    gate: { 'workspace builds': true, 'sheet built': true, 'dashboard figure current': false, 'recap complete': false },
    subscores: [
      { label: 'Cell accuracy', score: 0.92 },
      { label: 'Dashboard freshness', score: 0.0 },
      { label: 'Recap completeness', score: 0.5 },
      { label: 'Formatting', score: 0.8 },
    ],
    summary: `### Toy verifier log (demo only)

\`\`\`
[1/4] workspace builds .......... PASS
[2/4] cell accuracy ............. PASS  (37/40 cells exact; 0.92)
[3/4] dashboard freshness ....... FAIL  used 1835.34 (CSV) — live value is 1902.10
[4/4] recap completeness ........ PARTIAL  per-widget breakdown missing (0.5)
\`\`\`

**Weighted score: 0.62 / 1.00.** The toy agent built the widget-sales sheet
correctly and formatted it, but reported the **stale CSV total** instead of the
live demo-dashboard number it had successfully fetched, and the recap omitted
the per-widget breakdown.`,
    findings: [
      { category: 'Data freshness', severity: 'critical', summary: 'Reported stale total', detail: 'Live demo dashboard returned $1,902.10 but the recap and final answer used the CSV snapshot $1,835.34.' },
      { category: 'Deliverable completeness', severity: 'major', summary: 'Recap missing per-widget breakdown', detail: 'The toy rubric requires a per-widget total table; the recap had only a one-line summary.' },
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
