# ATIF Trajectory Viewer

An open-source, browser-based viewer for **Harbor-formatted agent tasks and
ATIF agent trajectories**. Open a task, walk through the trajectory like a
film, compare what the *human* sees with what the *agent* sees inside the
container, mark steps correct or incorrect, and inspect failure modes via a
structured taxonomy.

Built with **React + Vite + TypeScript + Tailwind**. No backend, no login, no
data storage — the entire site is a static bundle. Ships pre-loaded with 10
Terminal-Bench 2.1 tasks and a curated set of public agent trajectories
(Claude Code, Codex, Terminus-2/3, OpenHands, and others). Upload your own
Harbor tasks directly from the **Upload** page — they stay in your browser.

## Features

### 1. Agent view vs Human view (the headline)

For every task, the viewer can show two filesystems side-by-side:

- **Human view** — the raw task directory exactly as you'd `ls` it:
  `instruction.md`, `task.toml`, `environment/`, `tests/`, `solution/`.
- **Agent view** — what the agent actually sees *inside* the container:
  the working tree built by applying the Dockerfile's `COPY` / `WORKDIR`
  rules, with the agent's runtime edits overlaid step-by-step.

The agent view is reconstructed by parsing every tool call the agent
issued. File-editing tools (`str_replace`, `write_file`, `apply_patch`, …)
are tracked directly. Shell-based writes are tracked too — when the agent
runs `cat > script.py <<EOF`, `echo "…" > foo.txt`, `tee config.yaml`, or
`cp / mv / rm`, the viewer parses the command and applies its effect to
the virtual filesystem. Click any file in the agent view to see its
contents at the current step.

### 2. Trajectory replay

The trajectory viewer plays the run like a film:

- a left-rail **step timeline** with role-typed icons (user / agent / tool)
  and `±n` badges marking steps that mutated state;
- a center pane showing the active step's **message, reasoning, tool calls
  (name + args), observation, and per-step tokens**;
- a right-side **artifact stage** that re-renders whatever the agent
  changed at that step — a live spreadsheet, a rendered web page,
  computer-use screenshots, a document being authored, or a terminal /
  file workspace — synchronized to the timeline scrubber.

### 3. Human annotation

Each step has a small inline form for human review: mark it **correct**,
**incorrect**, or **unsure**, and add a free-text note. Labels persist in
`localStorage` only — nothing leaves the browser, no server, no account.

### 4. Agent Failure Taxonomy (AFT) panel

An LLM-as-judge audit of the run mapped to four orthogonal AFT v1.0 axes:

| Axis | Question |
|------|----------|
| **A — Stage** | *When* in the trajectory did it go wrong? |
| **B — Root cause** | *Why* did it happen? |
| **C — Behaviour** | *What* did the agent do (or fail to do)? |
| **D — Impact** | *How bad* was it? |

Pre-computed reports load automatically when present (`public/aft/<runId>.json`).
For runs without one, click **Apply AFT analysis** in the panel: the viewer
calls the Anthropic or OpenAI API directly from the browser using your
API key (stored only in `localStorage`, never uploaded anywhere), or — if
you're running `npm run bridge` locally — calls your subscription-authenticated
`claude` or `codex` CLI. Every failure mode in a report carries `step_indices`
that are clickable and jump the timeline to the relevant step for double-validation.

### 5. Verifier log + rubric + reward visualization

Per-run grading is rendered all in one panel:

- the raw **score** (and `maxScore` if the grader uses one), with
  pass / fail badge;
- the **gate** dictionary (when the grader uses a conjunctive scheme
  e.g. `answer_correct ∧ state_correct ∧ safety_correct`);
- per-rubric **subscores** as labeled bars;
- the verifier's free-text **summary / log**;
- structured **findings** (severity + category + detail) when the grader
  emits them.

### 6. Artifact changes (state-mutation log)

Every step that changed state — a file edit, a `git commit`, a sheet write,
a document insert, an answer submission — is summarised in an **Artifact
changes** section under that step, with a per-run **artifacts** chip-list at
the top so you can see at a glance what the agent touched.

## Run locally

```bash
npm install
npm run dev                 # http://localhost:5173
npm run build               # type-check + production build to dist/
npm run preview             # serve the build
```

`public/dataset.json` is committed — `npm run dev` works without re-ingesting.

To regenerate `dataset.json` from the raw sources:

```bash
# 1. Clone Terminal-Bench 2.1 task definitions (Apache-2.0)
git clone --depth 1 https://github.com/harbor-framework/terminal-bench-2-1.git \
  data/terminal-bench-2-1

# 2. Run the ingester. It fetches the matching trajectories LAZILY over HTTP
#    from the official harborframework/terminal-bench-2-leaderboard dataset
#    on HuggingFace (Apache-2.0) and caches them under data/hf-leaderboard-cache/.
#    No bulk repo download.
python3 scripts/ingest.py
```

The script normalizes both sources into the shapes in `src/lib/types.ts`
and writes `public/dataset.json`. Tweak `TASK_PICKS` and `TB_AGENTS` at the
top of `scripts/ingest.py` to change which tasks / agent submissions are
bundled.

## Bring your own data

The viewer renders **any** dataset that matches the schema in
`src/lib/types.ts` (`Dataset = { vendors, agents, tasks, runs, showcase? }`):

- **From a Harbor task zip:** drop the zip onto `/upload` and it's parsed
  in-browser — no upload, no server. Useful for showing your own
  `task.toml` / `instruction.md` + tests + solution to colleagues.
- **From a trajectory file:** the uploader also accepts an ATIF
  `trajectory.json` and joins it to the task it came from.
- **As a custom data source:** write your own version of `scripts/ingest.py`
  for whatever format your benchmark ships, output `public/dataset.json`
  to the same schema, and the viewer renders it.

The repo is intentionally a **demo of the viewer mechanics, not a fixed
benchmark dashboard.** Swap the ingest, change the failure-mode taxonomy,
add new source coverage notes, replace the showcase — everything is one
typed file away.

## Pages

| Route | Page | Notes |
|-------|------|-------|
| `/` | **Quick start** | One-screen intro + guided-tour launcher. |
| `/showcase` | **Feature showcase** | Hero cards demonstrating every viewer feature, plus a coverage map confirming each capability is reachable from the bundled data. |
| `/tasks` | **Tasks** | Task cards grouped by source, with feature badges (terminal · spreadsheet · web · screenshots · AFT · verifier log · …) inferred from the actual run content. Each source section shows a `Coverage` note describing what was inlined vs intentionally skipped. |
| `/tasks/:id` | **Task detail** | Instruction (markdown), expected-tools / expected-answer (when shipped), Human ⇄ Agent file browser, multi-run statistics, runs table. |
| `/tasks/:id/runs/:runId` | **Trajectory viewer** | Step timeline, message/reasoning/tool-call/observation, artifact stage (spreadsheet / web / screenshots / document / answer), AFT panel, verifier-log / grade panel, per-step human-annotation form. |
| `/insights` | **AFT insights** | Cross-cutting view of every pre-computed AFT report — outcomes, failure-mode frequencies, and links back to the individual trajectories. |
| `/upload` | **Upload** | Drop a Harbor task zip or ATIF trajectory — parsed in-browser, never leaves your machine. |
| `/overview` | **Leaderboard** | Model rankings across task sources: pass rate, reward avg/min/max, steps, turns, duration. (URL-reachable; not in the sidebar.) |

## Deploy (Vercel)

Import the repo, the build (`npm run build`, output `dist`) is detected
automatically. `vercel.json` adds the SPA rewrite. `public/dataset.json` is
shipped as a static asset.

## Usage analytics (optional)

Two opt-in tracking layers are wired up; both **no-op out of the box** so
forks aren't tied to anyone else's account.

### Vercel Web Analytics

Already wired in `src/main.tsx` via `@vercel/analytics/react`. To turn it on
for your deploy: **Vercel → Project → Analytics → Enable**. The package
sends nothing on local dev or on non-Vercel hosts.

### Google Analytics 4

Set `VITE_GA_ID` in your host's environment variables (or `.env.local`
locally) to your GA4 measurement ID (`G-XXXXXXXXXX`) and redeploy. The
loader in `src/lib/analytics.ts` injects gtag, and `App.tsx`'s
`RouteTracker` fires a `page_view` event on every SPA route change. With no
ID set, nothing is loaded.

`trackEvent(name, params)` in `src/lib/analytics.ts` is available for
custom events — wire it up where you want richer behaviour data (e.g.
tour-start, AFT-applied, upload-completed).

## License

Apache-2.0. The Terminal-Bench 2.1 task definitions
([harbor-framework/terminal-bench-2-1](https://github.com/harbor-framework/terminal-bench-2-1))
and trajectories
([harborframework/terminal-bench-2-leaderboard](https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard))
are also Apache-2.0; this repo redistributes them under the same terms with
attribution preserved in each source's `coverage` note.

## Acknowledgements

- [Terminal-Bench](https://www.tbench.ai/) (Laude Institute / harbor-framework) for the benchmark and tasks.
- [yoonho lee](https://huggingface.co/yoonholee) for the public TB trajectory dump.
- Anthropic Claude Code, OpenAI Codex CLI, and OpenHands — the agents whose runs you're inspecting.
