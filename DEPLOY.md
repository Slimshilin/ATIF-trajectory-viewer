# Deploying the viewer (public, online)

The site is a static build — it works on Vercel (or any static host). AFT
analysis is handled with **no backend** via two paths:

- **Pre-computed reports** for the sample dataset → load automatically for every
  visitor (zero cost, zero backend).
- **Bring-your-own API key** (in-browser) → for ad-hoc runs and uploaded
  trajectories. The key stays in the visitor's browser.

(The local **subscription bridge** is for your own machine / a self-hosted box;
a static deploy can't run a CLI. The panel says so honestly when no bridge is
reachable.)

## Steps

```bash
cd cc_viewer

# 1. Pre-compute AFT reports with YOUR subscription/CLI (or an API key path).
#    Resumable: re-run anytime; finished reports are skipped.
npm run bridge            # (separate terminal) if using subscription CLIs
npm run aft:batch -- --timeout 300000        # all failed runs
#    or in chunks:  npm run aft:batch -- --limit 25
#    These write public/aft/<runId>.json + index.json — commit them.

# 2. Build.
npm run build             # → dist/

# 3. Deploy (Vercel): import the repo, Root Directory = cc_viewer.
#    Vercel auto-detects Vite (build `npm run build`, output `dist`).
#    vercel.json already adds the SPA rewrite.
```

## Can people analyze online (no backend)? Yes — two ways

1. **Pre-computed reports** — appear automatically (✦ Pre-analyzed), no key.
2. **Bring-your-own API key (live, in-browser)** — a visitor opens an
   un-analyzed run → **AFT → ⚙ → API key**, picks engine (Claude→Anthropic /
   Codex→OpenAI) + model + reasoning effort, pastes their key, **Apply**. The
   request goes **straight from their browser to the provider** (Anthropic via
   the `anthropic-dangerous-direct-browser-access` header; OpenAI allows browser
   calls), so it works on a pure static deploy with **no backend**. The key is
   stored only in their browser. This is the "analyze online easily" path.

The only mode that needs a backend is **Subscription** (it runs the CLI). When
the bridge isn't reachable (e.g. on the hosted site) the panel shows a one-click
**"Analyze online with your API key"** button that switches to mode 2.

### How to test it
- **Locally, as production:** `npm run build && npm run preview`, open a failed
  run → AFT. Pre-analyzed runs render with no key. For the live path, ⚙ → API
  key → paste a real Anthropic/OpenAI key → Apply; a parsed report appears (a
  bad key surfaces an inline error — nothing is faked).
- **On the deployed site:** same steps. Verify (a) pre-analyzed runs load with no
  key, and (b) the API-key path returns a report with your key. If a key is
  wrong/over quota you'll see the provider's error inline.

## What visitors get online
- Open any trajectory with a pre-computed report → **✦ Pre-analyzed**, instant, no key.
- A run without one → the AFT panel explains they can add their **own API key**
  (in-browser) to analyze it live, or it stays un-analyzed (never faked).
- Login (Tencent vs guest), tasks, file/Excel/web rendering, the trajectory
  player, uploads, etc. are all fully static and work as-is.

## Porting to Vercel — concrete steps

The viewer is a static Vite build, so the **frontend** goes on Vercel directly:

1. Push the repo (already done). In Vercel: **New Project → import the repo**.
2. **Root Directory = `cc_viewer`**. Framework preset: **Vite** (auto-detected;
   build `npm run build`, output `dist`). `vercel.json` already adds the SPA
   rewrite so deep links resolve.
3. Make sure `public/dataset.json` and `public/aft/*.json` are committed — they
   ship as static assets (the AFT reports auto-load, no backend).
4. Deploy. Visitors get: login, tasks, rendering, playback, pre-computed AFT,
   and **live AFT via their own API key** (in-browser, no backend).

That's the whole public site. The **only** thing Vercel can't host is the
terminal-agent backend (subscription/Docker), because it has no long-lived
process. If you want that online too, host the bridge separately (next section)
and set the AFT panel's **Bridge URL** to it — the static Vercel frontend will
call it directly (the bridge already sends permissive CORS headers).

## If you later want live subscription analysis online
Host the bridge (`bridge/aft-bridge.mjs`) on a platform that runs long-lived
containers (Render / Fly.io / Google Cloud Run / a VM) with `claude`/`codex`
installed and logged in, then set the AFT panel's **Bridge URL** to that host.
That's the only way to run the terminal agent online — it can't live on Vercel.
