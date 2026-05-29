# AFT local bridge

Runs the **Agent Failure Taxonomy** audit through a subscription-authenticated
terminal agent (**Claude Code** or **Codex**) instead of an API key — so the
analysis is billed to your Pro/Max/Plus subscription, not a metered key.

It receives a trial's files from the viewer, materializes `./trial/` and
`./task/` in a temp dir, and runs the CLI agent **in that dir** so it performs
the real, file-reading, multi-step AFT audit (no token truncation).

## Run

```bash
# from cc_viewer/
npm run bridge          # serves http://localhost:8765
```

`GET /health` → `{ has:{claude,codex}, auth:{claude,codex} }` (installed + logged in).
`POST /login {cli}` → runs `codex login` (browser OAuth, incl. Google SSO via
ChatGPT); for Claude, log in once with `claude` → `/login` (Pro/Max), `claude
setup-token`, or set `ANTHROPIC_API_KEY`.
`POST /login {cli:"codex", token}` → **headless** login: pipes the token to
`codex login --with-access-token` (ChatGPT access token) or `--with-api-key`
(an `sk-…` key) on stdin — no browser. This is how subscription auth works on a
remote/containerised bridge where no browser is available.

In the viewer: open a trajectory → **AFT** tab → ⚙ → **Engine** + **Subscription**
+ model + reasoning effort → **Connect** (if needed) → **Apply AFT analysis**.

### Verified commands the bridge runs
- Claude Code: `claude -p "<prompt>" --output-format json --model <m> --dangerously-skip-permissions`
  (not `--bare`, so a Pro/Max subscription is used; parses `.result`).
- Codex: `codex exec --sandbox workspace-write -o <file> -m <m> -c model_reasoning_effort="<low|medium|high|xhigh>" "<prompt>"`.
  Reasoning effort is a real Codex flag; Claude Code has no effort flag (effort
  only affects the API path), so it's ignored for the Claude CLI.

## Local vs hosted (Vercel) — what actually runs where

| | Local / self-hosted (bridge running) | Static deploy (Vercel) |
|---|---|---|
| Subscription (Claude Code / Codex) | ✅ yes — this bridge | ❌ no — a static host can't run a CLI, hold an OAuth login, or spawn Docker |
| API key (in-browser) | ✅ | ✅ |
| Pre-computed reports | ✅ | ✅ |

So the "click Subscription → browser login → agent runs" flow is real **locally
or on a server you control**. On Vercel, use pre-computed reports + the API-key
option. Nothing is faked: if the bridge isn't reachable, the panel says so.

## Pre-compute for a public deploy (automatic, no key for visitors)

A static public site can't spawn a CLI, so generate the AFT reports **before
deploying** — they're then baked in as static files and the viewer loads them
automatically when a trajectory opens (no key, no button).

```bash
npm run aft:batch                  # all failed runs (resumes; skips done)
npm run aft:batch -- --limit 20    # cap this pass
npm run aft:batch -- --vendor snorkel --timeout 300000
```

Writes `public/aft/<runId>.json` + `public/aft/index.json`. Commit those, build,
deploy. The AFT panel shows "✦ Pre-analyzed" for runs that have one; visitors
can still "↻ re-run" if they add their own key/bridge. Long trajectories may
need a bigger `--timeout`.

## Docker runtime (clean container per analysis)

By default the bridge runs the CLI on the host (`ANALYZER_RUNTIME=host`). Set
`ANALYZER_RUNTIME=docker` to run **each analysis in a throwaway container** with
only the workspace mounted (`-v <tmp>:/work`), memory/CPU caps, and teardown
after — true isolation, suitable for untrusted input or multi-user hosting.

```bash
npm run analyzer:image          # docker build -t aft-analyzer -f bridge/analyzer.Dockerfile bridge
npm run bridge:docker           # ANALYZER_RUNTIME=docker node bridge/aft-bridge.mjs
# tuning: ANALYZER_DOCKER_IMAGE, ANALYZER_DOCKER_MEMORY=2g, ANALYZER_DOCKER_CPUS=2
```

- **API-key mode in Docker:** clean — the bridge injects the key as `-e` for that
  one run (the browser/API path can POST `apiKey` to `/aft`).
- **Subscription mode in Docker:** a fresh container isn't logged in. Either bake a
  pre-authenticated image, or start the bridge with `ANALYZER_DOCKER_MOUNT_AUTH=1`
  to mount `~/.codex` + `~/.claude` read-only into the container. The honest
  default refuses subscription-in-docker without one of these.

`GET /health` reports `runtime` and `dockerImage` so the UI can show the mode.

## Hosting it (so subscription analysis works online)

Vercel can't run a CLI, but the bridge is a plain Node server — deploy it to any
container host and point the AFT panel's **Bridge URL** at it:

- **Render / Fly.io / Railway / a VM / Google Cloud Run** — run
  `node bridge/aft-bridge.mjs` (or the `aft-analyzer` image) with `claude`/`codex`
  installed and authenticated (mounted creds or API keys as secrets).
- On Cloud Run, put the CLIs *in the service image* and run `host` mode (the
  service container is already the sandbox) rather than docker-in-docker.

## Notes
- Nothing leaves your machine except the call to your local CLI.
- The temp `./trial` + `./task` dir is deleted after each run.
- `PORT=9000 npm run bridge` to change the port (set the same URL in the panel).
- A purely static public deploy can't spawn a CLI; run this bridge locally and
  point the panel at `http://localhost:8765` (or use an API key there instead).
