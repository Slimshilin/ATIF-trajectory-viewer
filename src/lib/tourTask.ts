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

// Computer-use screenshots. The two PNGs in `public/tour/` are heavily blurred
// + watermarked DEMO versions of a real desktop screenshot — they look like
// "an agent operating a GUI" without exposing any recognisable content.
const SHOT_A = `${import.meta.env.BASE_URL}tour/blurred-computer-use.png`
const SHOT_B = `${import.meta.env.BASE_URL}tour/blurred-computer-use-verified.png`

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

const TASK_TOML = `# Toy task.toml — purely illustrative, all values fabricated for the tour.
schema_version = "1.0"

[task]
name = "tour/acmedemo-widget-sales"
authors = [{ name = "ATIF Trajectory Viewer demo" }]
keywords = ["tour", "demo", "synthetic"]

[metadata]
difficulty = "easy"
category = "tour-demo"

[verifier]
timeout_sec = 60.0

[agent]
timeout_sec = 300.0

[environment]
build_timeout_sec = 60.0
`

const DOCKERFILE = `# Toy demo image — not used in production
FROM python:3.11-slim
WORKDIR /app
COPY data/ /app/data/
COPY README.md /app/
RUN pip install --no-cache-dir pandas openpyxl requests
CMD ["python", "/app/run.py"]
`

const TEST_SH = `#!/usr/bin/env bash
# Toy verifier (demo only) — checks the AcmeDemo widget sheet exists and the
# Q4 grand total matches the live dashboard figure ($1,902.10).
set -euo pipefail
xlsx="/app/widget_sales.xlsx"
[ -f "$xlsx" ] || { echo "FAIL: $xlsx not built"; exit 1; }
total="$(python3 -c "import openpyxl, sys; wb=openpyxl.load_workbook('$xlsx', data_only=True); print(wb.active['E6'].value)" 2>/dev/null || true)"
if [ "$total" = "1902.10" ]; then
  echo "PASS: live total matches dashboard"; exit 0
fi
echo "FAIL: total=$total (expected 1902.10 — did the agent use the live demo dashboard?)"
exit 1
`

const SOLVE_SH = `#!/usr/bin/env bash
# Toy oracle solution (demo only) — what a passing agent would do.
set -euo pipefail
curl -sf http://demo-dashboard.local/q4 -o /tmp/q4.html
python3 <<'PY'
import openpyxl, pandas as pd
df = pd.read_csv('/app/data/widget_sales.csv')
df['units'] = df[['oct','nov','dec']].sum(axis=1)
df['total'] = df['units'] * df['unit_price']
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Q4'
ws.append(['Widget', 'Oct', 'Nov', 'Dec', 'Total ($)'])
for _, r in df.iterrows():
    ws.append([r['widget'], r['oct'], r['nov'], r['dec'], round(r['total'], 2)])
# Use the LIVE figure, not the CSV sum — this is the gotcha the verifier checks.
ws.append(['TOTAL', '', '', '', 1902.10])
wb.save('/app/widget_sales.xlsx')
PY
`

const README_MD = `# AcmeDemo workspace (toy demo)

This tree is purely illustrative — every value is fabricated for the viewer
tour. Run \`python /app/run.py\` to (in this fiction) build the sales sheet.
`

const RUBRIC_MD = `# Toy evaluation rubric (demo)

- Cell accuracy — 40%
- Dashboard freshness (use the live figure) — 25%
- Recap completeness — 25%
- Formatting (bold totals, units) — 10%
`

const files: Task['files'] = [
  { path: 'task.toml', kind: 'text', language: 'toml', content: TASK_TOML },
  { path: 'instruction.md', kind: 'markdown', content: INSTRUCTION },
  { path: 'environment/Dockerfile', kind: 'code', language: 'docker', content: DOCKERFILE },
  { path: 'environment/README.md', kind: 'markdown', content: README_MD },
  { path: 'environment/data/widget_sales.csv', kind: 'text', content: 'widget,oct,nov,dec,unit_price\nWidget-A,12,14,18,9.99\nWidget-B,8,11,13,14.50\nWidget-C,21,19,24,4.25\nWidget-D,6,7,9,29.99' },
  { path: 'environment/RUBRIC.md', kind: 'markdown', content: RUBRIC_MD },
  { path: 'tests/test.sh', kind: 'code', language: 'bash', content: TEST_SH },
  { path: 'solution/solve.sh', kind: 'code', language: 'bash', content: SOLVE_SH },
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
  { index: 3, role: 'assistant', toolCalls: tc('bash', { command: 'cat /app/data/widget_sales.csv' }), observation: 'widget,oct,nov,dec,unit_price\nWidget-X1,xx,xx,xx,xx.xx\n…4 fake widgets total', tSec: 25 },
  {
    index: 4, role: 'assistant', text: 'Implementing the toy sheet-builder script.',
    toolCalls: tc('create_file', { path: 'analysis/build_sheet.py', file_text: 'import pandas as pd\n\ndef build_sales_sheet(df):\n    df["units"] = df[["oct","nov","dec"]].sum(axis=1)\n    df["total"] = df["units"] * df["unit_price"]\n    return df\n' }),
    observation: 'Wrote analysis/build_sheet.py (6 lines).',
    mutations: [{ kind: 'file', tool: 'create_file', target: 'analysis/build_sheet.py', summary: 'created build_sheet.py' }],
    tSec: 70,
  },
  {
    index: 5, role: 'assistant', text: 'Building the sales grid from the widget data.',
    edits: [{ t: 'sheet', target: 'widget_sales.xlsx', sheet: 'Q4', anchor: 'A1', cells: [['Widget', 'Oct', 'Nov', 'Dec', 'Total ($)'], ['Widget-X1', 'xx', 'xx', 'xx', 'xxx.xx'], ['Widget-X2', 'xx', 'xx', 'xx', 'xxx.xx'], ['Widget-X3', 'xx', 'xx', 'xx', 'xxx.xx'], ['Widget-X4', 'xx', 'xx', 'xx', 'xxx.xx']] }],
    tSec: 120,
  },
  {
    index: 6, role: 'assistant', text: 'Adding live formulas for unit count and totals.',
    edits: [{ t: 'formula', target: 'widget_sales.xlsx', sheet: 'Q4', formulas: [{ c: 'E2', f: '=(B2+C2+D2)*F2' }, { c: 'E6', f: '=SUM(E2:E5)' }] }],
    tSec: 165,
  },
  {
    index: 7, role: 'assistant', text: 'Totals row and formatting.',
    edits: [{ t: 'sheet', target: 'widget_sales.xlsx', sheet: 'Q4', anchor: 'A6', cells: [['TOTAL', '', '', '', 'x,xxx.xx']] }],
    mutations: [{ kind: 'spreadsheet', tool: 'excel_write', target: 'widget_sales.xlsx', summary: 'wrote totals row' }],
    tSec: 200,
  },
  {
    index: 8, role: 'assistant', text: 'Fetching the live demo dashboard figure.',
    toolCalls: tc('web_fetch', { url: 'http://demo-dashboard.local/q4' }),
    edits: [{ t: 'web', url: 'http://demo-dashboard.local/q4', content: '# AcmeDemo · Q4 Widget Dashboard (toy demo)\n\n**Live Q4 total: $x,xxx.xx**  _(updated x hours ago — fictitious)_\n\n| Metric | Value |\n| --- | --- |\n| Units sold | xxx |\n| Avg price | $xx.xx |\n| Top widget | Widget-Xn |\n\n> Note: the CSV snapshot ($x,xxx.xx) is stale — use the live figure above.' }],
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
    edits: [{ t: 'doc', target: 'recap.md', op: 'para', text: 'Q4 widget sales total $x,xxx.xx across the four toy widgets. See the attached sheet for the breakdown.' }],
    mutations: [{ kind: 'document', tool: 'write_file', target: 'recap.md', summary: 'wrote recap body' }],
    tSec: 395,
  },
  {
    index: 13, role: 'assistant', text: 'Final answer.',
    edits: [{ t: 'answer', content: '**Done.** Built `widget_sales.xlsx` with live formulas, verified in the desktop app, and wrote `recap.md`. Q4 total: **$x,xxx.xx**.' }],
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
  failureReason: 'Used the stale CSV total ($x,xxx.xx) instead of the live demo-dashboard figure ($x,xxx.xx); recap omitted the per-widget breakdown.',
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
    summary: `### Toy verifier log (demo only — values dummified)

\`\`\`
[1/4] workspace builds .......... PASS
[2/4] cell accuracy ............. PASS  (xx/xx cells exact; 0.92)
[3/4] dashboard freshness ....... FAIL  used $x,xxx.xx (CSV) — live value is $x,xxx.xx
[4/4] recap completeness ........ PARTIAL  per-widget breakdown missing (0.5)
\`\`\`

**Weighted score: 0.62 / 1.00 (toy weights).** The toy agent built the
widget-sales sheet and formatted it, but reported the **stale CSV total**
instead of the live demo-dashboard number it had successfully fetched, and the
recap omitted the per-widget breakdown. All numbers above are placeholders —
this run is fabricated for the tour.`,
    findings: [
      { category: 'Data freshness', severity: 'critical', summary: 'Reported stale total', detail: 'Live demo dashboard returned $x,xxx.xx but the recap and final answer used the CSV snapshot $x,xxx.xx.' },
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
