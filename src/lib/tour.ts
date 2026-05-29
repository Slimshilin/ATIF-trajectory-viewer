import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { TOUR_TASK_ID, TOUR_RUN_ID, TOUR_STEPS } from './tourTask'

// ---------------------------------------------------------------------------
// Interactive spotlight tour.
//
// The walkthrough runs entirely on ONE synthetic task (see tourTask.ts) that
// was fabricated to contain every artifact type, pass + fail runs with
// durations, a clear verifier log, real changes, and a precomputed AFT report.
// Because everything lives on one task/run we never hop between tasks — so no
// step ever lands on an empty file or a blank artifact stage, and there are no
// skips. The trajectory steps deep-link to the exact step where each artifact
// is rendered via ?step=N.
// ---------------------------------------------------------------------------

interface TStep {
  path: string // pathname (+ optional ?step=N)
  sel: string
  title: string
  body: string
  note?: string
  side?: 'left' | 'right' | 'top' | 'bottom'
  action?: () => void // run before highlighting (switch a tab / toggle a view)
}

// The task-page portion of the tour walks a REAL benchmark task so visitors
// see actual task.toml / instruction / environment content rather than a
// synthetic demo. The trajectory-stage portion stays on the curated tour run
// so every artifact type (spreadsheet, web, screenshots, doc, answer) is
// guaranteed to render — no real benchmark trajectory has all of them.
const REAL_TASK_ID = 'hi-spreadsheetbench-sort-spreadsheet-by-helper'
const taskPath = `/tasks/${REAL_TASK_ID}`
const runAt = (step?: number) => `/tasks/${TOUR_TASK_ID}/runs/${TOUR_RUN_ID}${step != null ? `?step=${step}` : ''}`

const clickTab = (p: string) => (document.querySelector(`[data-tour="tab-${p}"]`) as HTMLElement | null)?.click()
const clickSel = (s: string) => (document.querySelector(s) as HTMLElement | null)?.click()

export function buildTourSteps(): TStep[] {
  return [
    // ---------------- Task page ----------------
    {
      path: taskPath, sel: '[data-tour="task-instruction"]', side: 'right',
      title: 'The task',
      note: 'It bundles every feature into one run so no step is ever empty.',
      body: 'Every task page opens with the exact prompt the agent was given — the goal, the inputs it may use, and the success criteria. Everything below describes how agents attempted it.',
    },
    {
      path: taskPath, sel: '[data-tour="task-env"]', side: 'top',
      title: 'Environment — from the Dockerfile',
      body: 'For a containerised task we parse the <code>Dockerfile</code> and surface the base image plus the services the agent can reach. This is auto-derived from the files in <code>environment/</code>.',
    },
    {
      path: taskPath, sel: '[data-tour="task-files"]', side: 'top',
      title: 'Files — the Human view', action: () => clickSel('[data-tour="task-view-human"]'),
      body: '<b>👤 Human view</b> is the raw task directory exactly as a benchmark author shipped it — <code>task.toml</code>, <code>instruction.md</code>, the <code>environment/</code> tree (Dockerfile + inputs), the <code>solution/</code> (oracle answer), and the <code>tests/</code>. Browse it as a foldable tree with type icons.',
    },
    {
      path: taskPath, sel: '[data-tour="task-files"]', side: 'top',
      title: 'Now switch to the Agent view', action: () => clickSel('[data-tour="task-view-agent"]'),
      body: 'We just clicked <b>🤖 Agent view</b> (top-left of this panel). Same files, but <i>as the container sees them</i>: the <code>Dockerfile COPY</code> rules remap paths into <code>/app/…</code>, and status dots mark <i>env</i> / <i>created</i> / <i>modified</i> entries. Toggle the two to see exactly what the agent worked against.',
    },
    {
      path: taskPath, sel: '[data-tour="task-runs"]', side: 'top',
      title: 'The runs',
      body: 'Each row is one agent run: model, harness (Claude Code / Codex / Gemini CLI / Terminus / Qwen …), status, reward, steps, duration. Real benchmark trajectories ship here — open a run to play it back step by step. For the rest of the tour we hop to a synthetic demo run that exercises every artifact type at once.',
    },

    // ---------------- Trajectory mechanics ----------------
    {
      path: runAt(TOUR_STEPS.spreadsheet), sel: '[data-tour="transport"]', side: 'bottom',
      title: 'Play it like a film',
      body: '<b>▶ Play</b> replays the run step by step. Scrub the bar to any step, jump prev/next, change speed (0.5–4×), and watch the <b>elapsed / total</b> wall-clock time.',
    },
    {
      path: runAt(TOUR_STEPS.spreadsheet), sel: '[data-tour="timeline"]', side: 'right',
      title: 'Step timeline',
      body: 'Every step in order. <b>▦</b> marks environment changes, <b>±n</b> marks artifact mutations, and <b>AFT</b>-flagged failure steps stand out. Collapse the panel to reclaim space.',
    },
    {
      path: runAt(TOUR_STEPS.fileEdit), sel: '[data-tour="ide-files"]', side: 'right',
      title: 'Workspace · files (with the Agent ⇄ Human toggle)',
      body: 'The filesystem the agent worked in — a foldable tree with status dots. The <b>🤖 Agent / 👤 Human</b> toggle at the top switches between the container view and the raw repo, just like the task page. Click any file to open it inline.',
    },
    {
      path: runAt(TOUR_STEPS.fileEdit), sel: '[data-tour="ide-terminal"]', side: 'left',
      title: 'Workspace · terminal',
      body: 'The agent ↔ environment log: <code>$ bash</code> commands and their output (here <code>ls /app</code>, <code>cat rent_roll.csv</code>), or each tool call and its result. For simulated-user tasks a Conversation tab shows the chat instead.',
    },

    // ---------------- Artifact stage — every representation ----------------
    {
      path: runAt(TOUR_STEPS.spreadsheet), sel: '[data-tour="artifact-view"]', side: 'left',
      title: 'Artifact stage · spreadsheet',
      body: 'The live result the agent is producing — here a <b>spreadsheet</b> grid with the T12 cell values and live formulas, updating as you play. Zoom and resize freely. The stage auto-detects the artifact type per step:',
    },
    {
      path: runAt(TOUR_STEPS.web), sel: '[data-tour="artifact-view"]', side: 'left',
      title: 'Artifact stage · web page',
      body: 'At this step the agent fetched the internal dashboard — the stage now renders the <b>web page</b> it pulled (note it flags the CSV figure as stale; that detail matters for the failure analysis later).',
    },
    {
      path: runAt(TOUR_STEPS.screenshots), sel: '[data-tour="artifact-view"]', side: 'left',
      title: 'Artifact stage · computer-use screenshots',
      body: 'For desktop / computer-use steps the stage shows real <b>screenshots</b> of the live screen, with the agent’s cursor overlaid — so you can watch it operate the GUI.',
    },
    {
      path: runAt(TOUR_STEPS.document), sel: '[data-tour="artifact-view"]', side: 'left',
      title: 'Artifact stage · document',
      body: 'And when the agent writes prose, the stage renders the <b>document</b> (headings + body) it is drafting — here the reconciliation memo. Spreadsheet, web, screenshots, document, final answer — all one panel, auto-selected.',
    },

    // ---------------- Right rail ----------------
    {
      path: runAt(TOUR_STEPS.fileEdit), sel: '[data-tour="rail-content"]', side: 'left',
      title: 'Right rail · Step detail', action: () => clickTab('step'),
      body: 'The selected step’s message, reasoning, the tool call + arguments, the observation it got back, and any artifact changes it made.',
    },
    {
      path: runAt(), sel: '[data-tour="rail-content"]', side: 'left',
      title: 'Right rail · Reward & Verifier log', action: () => clickTab('analysis'),
      body: 'The grader’s score (0.62) and per-criterion subscores on top, then the verifier’s raw log — here you can read line-by-line <i>why</i>: T12 accuracy passed, but “dashboard freshness” FAILED (it used the stale CSV value) and the memo was incomplete.',
    },
    {
      path: runAt(TOUR_STEPS.answer), sel: '[data-tour="rail-content"]', side: 'left',
      title: 'Right rail · Changes', action: () => clickTab('artifacts'),
      body: 'Every state-changing step — the created <code>reconcile.py</code>, the spreadsheet writes, the memo — collected into one timeline. Click any entry to jump straight to that step.',
    },

    // ---------------- AFT — broken into a proper sub-tutorial ----------------
    {
      path: runAt(TOUR_STEPS.lost), sel: '[data-tour="aft-taxonomy"]', side: 'left', action: () => clickTab('aft'),
      title: 'AFT · the failure taxonomy',
      body: 'Failures are coded on four axes — <b>A</b> = <i>stage</i> (where it broke), <b>B</b> = <i>root cause</i>, <b>C</b> = <i>behaviour</i> (the specific mistake), <b>D</b> = <i>impact</i>. Each mode below carries an <b>A×B×C×D</b> code. Click <b>“View taxonomy ↗”</b> (highlighted) any time to read what every code means.',
    },
    {
      path: runAt(TOUR_STEPS.lost), sel: '[data-tour="aft-outcome"]', side: 'left',
      title: 'AFT · how far from done, and what was graded',
      body: 'First, the verdict: a <b>closeness</b> chip (here <i>partial</i>) and the <b>step where the run was lost</b> (click it to jump there). Below, the <b>rubric</b> the verifier actually checked and what the agent produced — so you can judge the gap at a glance.',
    },
    {
      path: runAt(TOUR_STEPS.lost), sel: '[data-tour="aft-failures"]', side: 'left',
      title: 'AFT · failure modes — click to locate the step',
      body: 'Then 1–3 concrete failure modes, each with its A×B×C×D code, a verbatim <b>evidence quote</b>, and a “should have / instead” counterfactual. The <b>→ step N</b> buttons jump the whole viewer to the exact step that caused the failure — try clicking one to land on it in the timeline.',
    },
    {
      path: runAt(), sel: '[data-tour="rail-content"]', side: 'left',
      title: 'Right rail · Label / Note', action: () => clickTab('labels'),
      body: 'Finally, your own human review: mark steps correct / incorrect / unsure and add notes — to agree or disagree with the AFT audit. For Logged-in users these are saved; guests keep them in-browser. That’s the full tour!',
    },
  ]
}

function waitFor(sel: string, timeout = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const tick = () => {
      const el = document.querySelector(sel)
      if (el) return resolve(el)
      if (Date.now() - t0 > timeout) return resolve(null)
      requestAnimationFrame(tick)
    }
    tick()
  })
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const samePath = (p: string) => `${window.location.pathname}${window.location.search}` === p

export function startTour(steps: TStep[], navigate: (p: string) => void) {
  if (!steps.length) return
  let done = false
  const finish = () => { if (done) return; done = true; navigate('/showcase') } // return to the showcase when the tour ends
  const d = driver({
    allowClose: true, overlayOpacity: 0.72, stagePadding: 6, stageRadius: 8,
    popoverClass: 'tour-pop', animate: true, onDestroyed: finish,
    // Explicit "Skip tour" button in the footer — clearer than the corner ✕,
    // and ends the tour from any step (onDestroyed returns to the showcase).
    onPopoverRender: (popover) => {
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.textContent = 'Skip tour'
      skip.className = 'driver-skip-btn'
      skip.addEventListener('click', () => d.destroy())
      popover.footer.insertBefore(skip, popover.footer.firstChild)
    },
  })
  let i = 0
  const total = steps.length
  // A persistent reminder shown on EVERY step that this is a fabricated task.
  const SYNTH = '🎬 This walkthrough runs on a <b>synthetic demo task</b> built for the tour — not a real benchmark run.'

  const render = async () => {
    const s = steps[i]
    if (!samePath(s.path)) { navigate(s.path); await sleep(240) }
    if (s.action) { s.action(); await sleep(220) }
    const el = await waitFor(s.sel)
    if (!el) { // every step is pre-resolved, but never stall
      if (i < total - 1) { i++; return render() }
      d.destroy(); return
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    await sleep(140)
    const note = s.note ? `<div style="margin-top:8px;font-size:11px;opacity:.8">${s.note}</div>` : ''
    const synth = `<div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.1);font-size:11px;opacity:.7">${SYNTH}</div>`
    d.highlight({
      element: s.sel,
      popover: {
        title: s.title,
        description: `${s.body}${note}${synth}<div style="margin-top:8px;opacity:.45;font-size:11px">Step ${i + 1} of ${total}</div>`,
        side: s.side ?? 'bottom',
        align: 'start',
        showButtons: ['previous', 'next', 'close'],
        nextBtnText: i === total - 1 ? 'Done ✓' : 'Next →',
        prevBtnText: '← Back',
        onNextClick: () => { if (i < total - 1) { i++; render() } else d.destroy() },
        onPrevClick: () => { if (i > 0) { i--; render() } },
        // driver.js needs an explicit close handler whenever other on*Click
        // handlers are set — without this, the ✕ corner button is dead.
        onCloseClick: () => d.destroy(),
      },
    })
  }
  render()
}
