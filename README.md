# ATIF Trajectory Viewer

**Live demo → https://atif-trajectory-viewer.vercel.app/**

A static, browser-only viewer for **Harbor-formatted agent tasks** and
**ATIF agent trajectories**. Open a task, replay the run like a film,
diagnose failures with a structured taxonomy, or drop in your own data.
No backend, no login, no upload — everything runs in your tab.

> A video walkthrough will land here soon.

## What's bundled

- **Terminal-Bench 2.1** — 10 task definitions × 4 agent submissions (Anthropic / OpenAI / Google / Z-AI), 40 trajectories fetched lazily from the official leaderboard.
- **Harbor-Index annotate bundle** — 35 tasks, 1 trial each, with **pre-baked AFT reports**. Tasks span spreadsheets, ARC-AGI grids, web search, lab images, SWE bug fixes, ML pipelines, scientific reasoning, and python performance.
- Everything cited above is Apache-2.0.

## Features

1. **Agent view ⇄ Human view.** Browse the raw task directory (`task.toml`, `instruction.md`, `environment/`, `tests/`, `solution/`) or switch to the container filesystem the agent sees, reconstructed by parsing every tool call — `Write` / `Edit` / `apply_patch` AND shell-based writes (`cat > x << EOF`, `python3 -c`, `python3 << EOF`, `echo > x`, `tee`, `cp / mv / rm / sed -i`). Files get GitHub-style status badges: **A** added · **M** modified · **T** touched · **D** deleted.
2. **Trajectory replay.** A film-style scrubber with a step timeline, the active step's message / reasoning / tool calls / observation, and a synchronized artifact stage that renders whichever artifact the step produced.
3. **Specialised renderers.** Spreadsheets become multi-tab grids. Images inline. **ARC-AGI grids** render as colored cells with an automatic expected-vs-actual comparison. Web fetches render as the page the agent saw. Computer-use steps show screenshots.
4. **Verifier log + reward.** Score, pass / fail gate, per-rubric subscores, the verifier's raw log, and structured findings — all in one panel.
5. **Agent Failure Taxonomy (AFT v1.0).** Four-axis audit (Stage × Cause × Behaviour × Impact). Pre-computed reports load instantly; for un-analyzed runs, **Apply AFT analysis** uses your browser-stored Anthropic / OpenAI key — or your local Claude Code / Codex CLI via `npm run bridge` — to generate one. Every failure mode links to the step it implicates.
6. **Step-level annotation.** Mark each step correct / incorrect / unsure with a note. Stored only in `localStorage`.
7. **Bring your own data.** Drop a Harbor task zip on `/upload`; it parses in-browser, never leaves your machine.

## Use it

1. **Online:** open https://atif-trajectory-viewer.vercel.app/ and click `▶ Start guided tour` (or the `Feature showcase`).
2. **Locally:**
   ```bash
   npm install
   npm run dev          # http://localhost:5173
   ```
3. **Your own data:** drop a Harbor task `.zip` on `/upload`, or rewrite `scripts/ingest.py` to emit `public/dataset.json` from your source and re-deploy.

For deploy, AFT-bridge, and analytics setup see [`DEPLOY.md`](./DEPLOY.md) and [`bridge/README.md`](./bridge/README.md).

## Citation

If this viewer helps your work, please cite it:

```bibtex
@software{shi_atif_trajectory_viewer_2026,
  author  = {Shi, Lin},
  title   = {ATIF Trajectory Viewer: a browser-only viewer for Harbor-formatted agent tasks and ATIF trajectories},
  year    = {2026},
  url     = {https://github.com/Slimshilin/ATIF-trajectory-viewer},
  version = {0.1}
}
```

Or inline: *Lin Shi, ATIF Trajectory Viewer, 2026. https://github.com/Slimshilin/ATIF-trajectory-viewer*

## License

Apache-2.0. Built by [Lin Shi (Slimshilin)](https://github.com/Slimshilin). Terminal-Bench 2.1 and the Harbor-Index annotate bundle are redistributed under their original Apache-2.0 terms with attribution preserved in each source's `coverage` note.
