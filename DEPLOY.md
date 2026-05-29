# Deploying the viewer

The viewer is a static Vite build, so it deploys to **any** static host —
Vercel, Netlify, Cloudflare Pages, GitHub Pages, your own bucket. There is
no backend, no database, no login.

The only piece that needs a server is the **local AFT bridge** (run a
terminal agent under your own subscription credentials, against an
uploaded trajectory). The hosted site shows a clear message when no bridge
is reachable, and falls back to either pre-computed reports or an
in-browser API-key path.

## Steps (Vercel)

```bash
# 1. (Optional) Pre-compute AFT reports for the bundled runs so visitors
#    see "✦ Pre-analyzed" without needing a key.
npm run bridge                                  # separate terminal if using subscription CLIs
npm run aft:batch -- --timeout 300000           # all failed runs, resumable
# These write public/aft/<runId>.json + index.json — commit them.

# 2. Build.
npm run build                                   # → dist/

# 3. Deploy. In Vercel: New Project → import the repo. Framework preset is
#    Vite (auto-detected: build `npm run build`, output `dist`).
#    vercel.json already adds the SPA rewrite so deep links resolve.
```

`public/dataset.json` and `public/aft/*.json` ship as static assets; the
AFT panel auto-loads any pre-computed report whose `runId` matches the
open trajectory.

## AFT analysis on the deployed site — three modes

1. **Pre-computed reports** — appear automatically (✦ Pre-analyzed) for
   any run with a JSON file under `public/aft/`. Zero cost, zero backend.
2. **Bring-your-own API key (in-browser)** — visitor opens an un-analyzed
   run, hits **AFT → ⚙ → API key**, picks engine + model + reasoning
   effort, pastes their key, clicks **Apply**. The request goes straight
   from their browser to the provider (Anthropic via the
   `anthropic-dangerous-direct-browser-access` header; OpenAI allows
   browser calls). The key is stored only in their browser.
3. **Local subscription bridge** — needs `npm run bridge` running on the
   visitor's machine and `claude` / `codex` logged in. Useful for power
   users analyzing their own uploads under their Pro/Plus subscription
   instead of metered API keys.

If you want #3 hosted online, deploy `bridge/aft-bridge.mjs` to a
long-lived container host (Render / Fly.io / Cloud Run / a VM) with
`claude` and/or `codex` installed and logged in, then set the AFT panel's
**Bridge URL** to that host. Vercel can't host this — it has no
long-running process.

## What visitors get

- Browseable task tree (Human view ⇄ Agent view).
- Trajectory replay with synchronized artifact stage.
- Pre-computed AFT reports load automatically; un-analyzed runs explain
  the BYO-key path inline.
- Per-step human annotation (correct / incorrect / unsure + note), persisted
  in `localStorage` only.
- Upload your own Harbor task zip or ATIF trajectory at `/upload` —
  parsed entirely in-browser.
