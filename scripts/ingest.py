#!/usr/bin/env python3
"""Ingest Terminal-Bench 2.1 tasks + a curated subset of public agent
trajectories into the viewer's `public/dataset.json`.

Inputs:
  - data/terminal-bench-2-1/tasks/<name>/   — task definitions cloned from
    https://github.com/harbor-framework/terminal-bench-2-1 (Apache-2.0).
  - HuggingFace dataset `harborframework/terminal-bench-2-leaderboard`
    (Apache-2.0) — fetched lazily over HTTP, one trial at a time, and cached
    under data/hf-leaderboard-cache/ (gitignored). NEVER clones the whole repo.

Output:
  - public/dataset.json   normalized to the shapes in src/lib/types.ts.

Curated picks: 10 representative TB tasks × 4 distinct agent/model harnesses
= up to 40 trajectories. Each trajectory ships in proper ATIF format directly
from the official leaderboard submission, so provenance is clean.

Run from the repo root:
    python3 scripts/ingest.py
"""
from __future__ import annotations
import base64, json, mimetypes, os, re, time
import urllib.request, urllib.error
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
TB_TASKS = os.path.join(ROOT, "data", "terminal-bench-2-1", "tasks")
HF_CACHE = os.path.join(ROOT, "data", "hf-leaderboard-cache")
OUT = os.path.join(ROOT, "public", "dataset.json")

# Official leaderboard dataset on HuggingFace. ALL fetches go through the
# Apache-2.0 dataset's resolve endpoint with on-disk caching.
HF_API = "https://huggingface.co/api/datasets/harborframework/terminal-bench-2-leaderboard"
HF_FILE = "https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard/resolve/main"

# One agent/model pair per major model family, all confirmed to ship full
# `agent/trajectory.json` ATIF logs (some leaderboard submissions only ship
# result.json — those are skipped).
TB_AGENTS = [
    "Judy__Claude-Opus-4.6",                   # Anthropic (Judy harness)
    "CodeBrain-1__GPT-5.3-Codex",              # OpenAI    (CodeBrain harness)
    "Gemini_CLI__Gemini-3.1-Pro-Preview",      # Google    (Gemini CLI harness)
    "ClaudeCode__GLM-4.7",                     # Z-AI GLM  (Claude Code harness)
]

# 10 representative TB-2.1 tasks (curated to span categories + difficulty).
TASK_PICKS = [
    "adaptive-rejection-sampler",      # statistics / algorithms
    "break-filter-js-from-html",        # parsing
    "build-cython-ext",                 # build systems
    "cancel-async-tasks",               # debugging async
    "chess-best-move",                  # game / algorithms
    "configure-git-webserver",          # sysadmin
    "count-dataset-tokens",             # data processing
    "crack-7z-hash",                    # security
    "compile-compcert",                 # building large C projects
    "cobol-modernization",              # language modernization
]

# Up to N picks per task: prefer 1 passed + 1 failed, both from distinct agents.
RUNS_PER_TASK_PASS = 1
RUNS_PER_TASK_FAIL = 1

# Soft caps. Trajectories average ~120 steps, occasionally 600+; we keep all of
# them but rendering is paged on the client. Files are inlined as-is.
MAX_STEPS = 10_000


# ---------------------------------------------------------------------------
# Registries — populated as we walk the inputs.
# ---------------------------------------------------------------------------

vendors: dict[str, dict] = {}
agents: dict[str, dict] = {}
tasks: list[dict] = []
runs: list[dict] = []


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def vendor(name: str) -> str:
    vid = slug(name)
    vendors.setdefault(vid, {"id": vid, "name": name})
    return vid


HARNESS_MAP = {
    "claude-code": "Claude Code",
    "claude": "Claude Code",
    "codex": "Codex CLI",
    "codex-cli": "Codex CLI",
    "openhands": "OpenHands",
    "openhands-sdk": "OpenHands",
    "gemini-cli": "Gemini CLI",
    "factory droid": "Factory Droid",
    "factory-droid": "Factory Droid",
    "terminus-2": "Terminus-2",
    "terminus-3": "Terminus-3",
    "judy": "Judy",
    "forge": "Forge",
    "tarsier": "Tarsier",
}


def clean_model(raw):
    if not raw:
        return None
    m = str(raw).split("@")[0].split("/")[-1]
    m = m.replace("_", "-").strip().lower()
    m = re.sub(r"^(anthropic|openai|google|openrouter|meta|mistral)-", "", m)
    return m or None


def model_family(raw):
    s = str(raw or "").lower()
    if "claude" in s: return "Anthropic"
    if "gemini" in s: return "Google"
    if "gpt" in s or "openai" in s or "codex" in s or re.search(r"\bo[134]\b", s): return "OpenAI"
    return "unknown"


def harness_label(raw):
    if not raw:
        return None
    return HARNESS_MAP.get(str(raw).strip().lower(), str(raw).strip())


def agent(harness_raw, model_raw, vendor_id: str) -> str:
    model = clean_model(model_raw)
    harness = harness_label(harness_raw)
    family = model_family(model_raw or harness_raw)
    aid = slug(f"{harness or 'agent'}-{model or 'model'}-{vendor_id}")
    agents.setdefault(aid, {
        "id": aid, "harness": harness, "model": model, "family": family, "vendorId": vendor_id,
    })
    return aid


# ---------------------------------------------------------------------------
# File reading + classification.
# ---------------------------------------------------------------------------

LANG = {".py": "python", ".c": "c", ".cpp": "cpp", ".h": "c", ".js": "javascript",
        ".ts": "typescript", ".tsx": "tsx", ".jsx": "jsx", ".sh": "bash", ".rb": "ruby",
        ".go": "go", ".rs": "rust", ".sql": "sql", ".toml": "toml", ".json": "json"}


def file_kind(path: str) -> str:
    p = path.lower()
    if p.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
        return "image"
    if p.endswith((".md", ".markdown")): return "markdown"
    if p.endswith(".json"): return "json"
    if p.endswith((".html", ".htm")): return "html"
    if p.endswith((".csv", ".tsv")): return "spreadsheet"
    if p.endswith((".toml", ".txt", ".ini", ".cfg", ".yaml", ".yml")): return "text"
    if p.endswith((".diff", ".patch")): return "diff"
    if p.endswith((".py", ".c", ".cpp", ".h", ".js", ".ts", ".tsx", ".jsx", ".sh",
                   ".rb", ".go", ".rs", ".java", ".sql", ".dockerfile")) or os.path.basename(p) == "dockerfile":
        return "code"
    return "text"


def read_text(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def image_data_uri(path: str, max_bytes: int = 2_000_000) -> str | None:
    try:
        if os.path.getsize(path) > max_bytes:
            return None
        mime = mimetypes.guess_type(path)[0] or "image/png"
        with open(path, "rb") as f:
            return f"data:{mime};base64," + base64.b64encode(f.read()).decode("ascii")
    except Exception:
        return None


def collect_files(root: str, base: str) -> list[dict]:
    out: list[dict] = []
    for dirpath, _dirs, names in os.walk(root):
        for n in sorted(names):
            if n.startswith(".") or n.endswith(":Zone.Identifier"):
                continue
            full = os.path.join(dirpath, n)
            rel = os.path.relpath(full, base)
            kind = file_kind(n)
            ext = os.path.splitext(n)[1].lower()
            rec: dict = {"path": rel.replace(os.sep, "/"), "kind": kind}
            if kind == "image":
                uri = image_data_uri(full)
                if uri:
                    rec["content"] = uri
                else:
                    rec["note"] = "image too large to inline"
            elif ext in (".zip", ".tar", ".gz"):
                try:
                    size = os.path.getsize(full)
                except Exception:
                    size = 0
                rec["kind"] = "text"
                rec["note"] = f"archive ({size} bytes) — on disk"
            else:
                content = read_text(full)
                if content is None:
                    continue
                rec["content"] = content
                if kind == "code":
                    rec["language"] = LANG.get(ext)
            out.append(rec)
    return out


# ---------------------------------------------------------------------------
# task.toml parsing — pull difficulty/category/name out of TB task.toml files.
# ---------------------------------------------------------------------------

def task_toml_meta(text: str) -> dict:
    meta: dict = {}
    for key in ("difficulty", "category"):
        m = re.search(rf'{key}\s*=\s*"([^"]+)"', text or "")
        if m:
            meta[key] = m.group(1)
    m = re.search(r"tags\s*=\s*\[([^\]]+)\]", text or "")
    if m:
        meta["tags"] = [t.strip().strip('"') for t in m.group(1).split(",") if t.strip()]
    return meta


# ---------------------------------------------------------------------------
# Trajectory steps → normalized Step records.
# ---------------------------------------------------------------------------

# Heuristic state-change detector: when a tool call mutates the environment
# we surface it in the per-step `mutations` list (rendered as "Artifact changes").
WRITE_CMD = re.compile(
    r"(>>?|\btee\b|\bcp\b|\bmv\b|\bmkdir\b|\btouch\b|sed -i|"
    r"\bgit (add|commit|checkout|push)\b|\bmake\b|npm (run|install|ci)|"
    r"pip install|\brm\b|cargo build|cargo test|pytest|\bdd\b)"
)


def detect_mutation(name: str, raw_args) -> dict | None:
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args)
        except Exception:
            args = {"_raw": raw_args}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}
    n = (name or "").lower()
    if any(k in n for k in ("write_file", "create_file", "str_replace", "edit_file", "apply_patch")):
        return {"kind": "file", "tool": name,
                "target": args.get("path") or args.get("filepath") or args.get("file_path"),
                "summary": "file edit",
                "detail": (args.get("content") or args.get("new_str") or "")[:1500]}
    if "git_commit" in n or n.endswith("git_commit"):
        return {"kind": "git", "tool": name, "target": args.get("repo_path"),
                "summary": "commit: " + (args.get("message", "") or "").splitlines()[0][:80]}
    if any(k in n for k in ("git_add", "git_create_branch", "git_checkout", "git_push")):
        return {"kind": "git", "tool": name,
                "target": args.get("repo_path") or args.get("branch_name"),
                "summary": n.replace("git_", "").replace("_", " ")}
    if "terminal" in n or n == "bash" or n.endswith("run_command"):
        cmd = args.get("command") or args.get("cmd") or args.get("_raw") or ""
        if cmd and WRITE_CMD.search(str(cmd)):
            return {"kind": "command", "tool": name, "target": None,
                    "summary": str(cmd).strip()[:200]}
    return None


def step_from_traj_obj(o: dict, idx: int) -> dict:
    """yoonholee parquet shape: {src, msg, tools, obs}."""
    src = (o.get("src") or "agent").lower()
    role = {"user": "user", "agent": "agent", "assistant": "agent", "tool": "tool",
            "system": "system"}.get(src, src)
    tool_calls = []
    raw_tools = o.get("tools")
    if isinstance(raw_tools, list):
        for tc in raw_tools:
            if isinstance(tc, dict):
                name = tc.get("name") or tc.get("function_name") or "tool"
                args = tc.get("arguments") or tc.get("args") or tc.get("input")
                if not isinstance(args, str):
                    args = json.dumps(args, ensure_ascii=False) if args is not None else None
                tool_calls.append({"name": name, "args": args})
    muts = []
    for tc in tool_calls:
        m = detect_mutation(tc["name"], tc["args"])
        if m:
            muts.append(m)
    obs = o.get("obs")
    if isinstance(obs, (dict, list)):
        obs = json.dumps(obs, ensure_ascii=False)
    return {
        "index": idx, "role": role,
        "text": o.get("msg") if role != "tool" else None,
        "reasoning": o.get("reasoning") or None,
        "toolCalls": tool_calls or None,
        "observation": obs if role == "tool" or obs else None,
        "toolName": None,
        "tokens": None,
        "timestamp": o.get("ts") or o.get("timestamp"),
        "mutations": muts or None,
        "edits": None,
    }


def run_artifacts(steps: list) -> list:
    seen = []
    for s in steps:
        for m in (s.get("mutations") or []):
            t = m.get("target")
            if t and t not in seen:
                seen.append(t)
    return seen[:30]


# ---------------------------------------------------------------------------
# TB tasks — clone of harbor-framework/terminal-bench-2-1.
# ---------------------------------------------------------------------------

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-")


def _pretty_title(name: str) -> str:
    return name.replace("-", " ").title()


def load_tb_tasks(picks: list[str]) -> None:
    vid = vendor("Terminal-Bench 2.1")
    if not os.path.isdir(TB_TASKS):
        print(f"  ! TB tasks dir missing: {TB_TASKS} — clone the repo first")
        return
    for name in picks:
        tdir = os.path.join(TB_TASKS, name)
        if not os.path.isdir(tdir):
            print(f"  ! task missing on disk: {name}")
            continue
        instr = read_text(os.path.join(tdir, "instruction.md"))
        toml_text = read_text(os.path.join(tdir, "task.toml")) or ""
        meta = task_toml_meta(toml_text)
        title = _pretty_title(name)
        files = collect_files(tdir, tdir)
        tasks.append({
            "id": slug(f"tb-{name}"),
            "vendorId": vid,
            "title": title,
            "source": "harbor",
            "category": meta.get("category", "Terminal-Bench"),
            "difficulty": meta.get("difficulty", "medium"),
            "instruction": instr,
            "files": files,
            "metadata": {
                "tb_task_name": name,
                "tb_version": "2.1",
                "tags": meta.get("tags", []),
            },
        })


# ---------------------------------------------------------------------------
# TB leaderboard trajectories — fetched lazily from HuggingFace, one trial at
# a time. Each agent submission has metadata.yaml + one or more date-stamped
# job folders containing per-trial dirs `<task>__<hash>/{result.json, agent/}`,
# with the trajectory in `agent/trajectory.json` (proper ATIF format).
# ---------------------------------------------------------------------------

def _hf_get(url: str, retries: int = 3, timeout: int = 30) -> bytes:
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json, */*"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"HF fetch failed after {retries} attempts: {url} — {last_err}")


def hf_tree(rel_path: str) -> list[dict]:
    """List a directory on the leaderboard repo via the HF tree API."""
    raw = _hf_get(f"{HF_API}/tree/main/{rel_path}")
    return json.loads(raw.decode("utf-8"))


def hf_file_cached(rel_path: str) -> bytes:
    """Download one file from the leaderboard repo, caching by full path."""
    cache_p = os.path.join(HF_CACHE, rel_path)
    if os.path.isfile(cache_p):
        return open(cache_p, "rb").read()
    os.makedirs(os.path.dirname(cache_p), exist_ok=True)
    raw = _hf_get(f"{HF_FILE}/{rel_path}")
    with open(cache_p, "wb") as f:
        f.write(raw)
    return raw


def _norm_atif_step(s: dict, idx: int) -> dict:
    """Normalize one ATIF step into our Step shape (standard ATIF normalization)."""
    role = {
        "user": "user", "agent": "agent", "assistant": "agent",
        "tool": "tool", "system": "system",
    }.get((s.get("source") or "agent").lower(), "agent")
    raw_tcs = s.get("tool_calls") or []
    tcs: list[dict] = []
    muts: list[dict] = []
    for tc in raw_tcs:
        name = tc.get("function_name") or (tc.get("function") or {}).get("name") or "tool"
        args = tc.get("arguments")
        if args is None and tc.get("function"):
            args = tc["function"].get("arguments")
        if not isinstance(args, str):
            args = json.dumps(args, ensure_ascii=False) if args is not None else None
        tcs.append({"name": name, "args": args})
        m = detect_mutation(name, args)
        if m:
            muts.append(m)
    obs = s.get("observation")
    if isinstance(obs, dict):
        results = obs.get("results")
        if isinstance(results, list):
            obs = "\n\n".join(str(r.get("content", r)) for r in results)
        else:
            obs = json.dumps(obs, ensure_ascii=False)
    elif isinstance(obs, list):
        obs = "\n\n".join(str(x) for x in obs)
    metrics = s.get("metrics") or {}
    return {
        "index": idx, "role": role,
        "text": s.get("message") if role != "tool" else None,
        "reasoning": s.get("reasoning_content"),
        "toolCalls": tcs or None,
        "observation": obs if (role == "tool" or obs) else None,
        "toolName": None,
        "tokens": {"prompt": metrics.get("prompt_tokens"),
                   "completion": metrics.get("completion_tokens")} if metrics else None,
        "timestamp": s.get("timestamp"),
        "mutations": muts or None,
        "edits": None,
    }


def _iso_duration(a: str | None, b: str | None) -> float | None:
    if not a or not b:
        return None
    try:
        return max(0.0, (datetime.fromisoformat(b.replace("Z", "+00:00"))
                          - datetime.fromisoformat(a.replace("Z", "+00:00"))).total_seconds())
    except Exception:
        return None


def _load_one_trial(agent_dir: str, date_dir: str, trial_rel: str,
                    task_name: str, vid: str) -> bool:
    """Fetch + parse one trial. Returns True if a run was added."""
    base = f"submissions/terminal-bench/2.0/{agent_dir}/{date_dir}/{trial_rel}"
    try:
        result = json.loads(hf_file_cached(f"{base}/result.json"))
    except Exception as e:
        print(f"    skip {trial_rel}: result.json fetch failed ({e})")
        return False
    cfg_agent = ((result.get("config") or {}).get("agent")) or {}
    harness = cfg_agent.get("name") or agent_dir.split("__")[0]
    model = cfg_agent.get("model_name") or agent_dir.split("__", 1)[-1]
    aid = agent(harness, model, vid)
    reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward")
    passed = reward is not None and float(reward) >= 0.999
    started = result.get("started_at")
    finished = result.get("finished_at")
    exc = result.get("exception_info")

    try:
        traj = json.loads(hf_file_cached(f"{base}/agent/trajectory.json"))
    except Exception as e:
        print(f"    skip {trial_rel}: trajectory fetch failed ({e})")
        return False
    raw_steps = traj.get("steps") or []
    steps = [_norm_atif_step(s, i) for i, s in enumerate(raw_steps[:MAX_STEPS])]

    tid = slug(f"tb-{task_name}")
    runs.append({
        "id": slug(f"tb-{trial_rel}-{harness}-{model}"),
        "taskId": tid, "agentId": aid, "vendorId": vid, "format": "atif",
        "status": "passed" if passed else ("failed" if reward is not None else "completed"),
        "passed": passed, "reward": reward,
        "steps": steps, "stepCount": len(steps),
        "artifacts": run_artifacts(steps),
        "turns": sum(1 for s in steps if s["role"] == "agent"),
        "durationSec": _iso_duration(started, finished),
        "tokens": None,
        "grade": {
            "score": reward, "maxScore": 1.0, "subscores": [],
            "summary": f"{harness} · {model} · trial {trial_rel}",
            "gate": None, "breakdown": None, "findings": None,
        },
        "failureReason": (str(exc)[:400] if exc else None),
    })
    return True


def load_tb_leaderboard(picks: list[str]) -> None:
    vid = vendor("Terminal-Bench 2.1")
    picked = 0
    for agent_dir in TB_AGENTS:
        try:
            top = hf_tree(f"submissions/terminal-bench/2.0/{agent_dir}")
        except Exception as e:
            print(f"  agent {agent_dir}: tree fetch failed ({e})")
            continue
        date_subdirs = [os.path.basename(e["path"]) for e in top
                        if e["type"] == "directory" and not e["path"].endswith(".DS_Store")]
        if not date_subdirs:
            print(f"  agent {agent_dir}: no date subdirs")
            continue
        date_dir = sorted(date_subdirs)[0]  # take the earliest stamped run
        try:
            trial_entries = hf_tree(f"submissions/terminal-bench/2.0/{agent_dir}/{date_dir}")
        except Exception as e:
            print(f"  agent {agent_dir}: trial listing failed ({e})")
            continue
        trial_names = [os.path.basename(t["path"]) for t in trial_entries if t["type"] == "directory"]
        for task in picks:
            match = next((n for n in trial_names if n.startswith(f"{task}__")), None)
            if not match:
                continue
            if _load_one_trial(agent_dir, date_dir, match, task, vid):
                picked += 1
    print(f"  picked {picked} trajectories across {len(picks)} tasks × {len(TB_AGENTS)} agents")


# ---------------------------------------------------------------------------
# Showcase picks — bake the curated landing list at ingest time, so the
# Showcase page has a "selection-easy" per-vendor grid.
# ---------------------------------------------------------------------------

def build_showcase() -> list[dict]:
    out = []
    by_task: dict[str, list[dict]] = {}
    for r in runs:
        by_task.setdefault(r["taskId"], []).append(r)
    for t in tasks:
        bucket = by_task.get(t["id"], [])
        if not bucket:
            continue
        # Prefer 1 passed + 1 failed
        passed = next((r for r in bucket if r["passed"]), None)
        failed = next((r for r in bucket if not r["passed"]), None)
        for r, label in [(passed, "Solved run — full grader output"),
                         (failed, "Failed run — verifier log + failure analysis")]:
            if not r:
                continue
            out.append({
                "vendorId": t["vendorId"], "taskId": t["id"], "runId": r["id"],
                "taskTitle": t["title"], "passed": r["passed"], "reward": r["reward"],
                "stepCount": r["stepCount"], "source": r["format"], "why": label,
            })
    return out


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main() -> None:
    print("=== Terminal-Bench 2.1 task definitions ===")
    load_tb_tasks(TASK_PICKS)
    print(f"  loaded {len(tasks)} tasks")
    print()
    print("=== Terminal-Bench public trajectories (leaderboard) ===")
    load_tb_leaderboard(TASK_PICKS)
    print(f"  total runs: {len(runs)}")

    for v in vendors.values():
        if v["id"] == "terminal-bench-2-1":
            v["coverage"] = (
                "10 of 89 Terminal-Bench 2.1 task definitions cloned from the canonical "
                "source (harbor-framework/terminal-bench-2-1, Apache-2.0). Each task ships "
                "its full instruction.md, environment/Dockerfile, tests, and oracle "
                "solution. Trajectories are pulled from the official "
                "harborframework/terminal-bench-2-leaderboard dataset on HuggingFace "
                "(Apache-2.0) — one trial per agent harness across four families "
                "(Claude, GPT, Gemini, GLM) for each task. Files are fetched lazily over "
                "HTTP and cached under data/hf-leaderboard-cache/ (gitignored). Note: "
                "leaderboard submissions are against TB 2.0; 26 of 89 tasks were modified "
                "in 2.1, so a small number of runs may reference slightly different task "
                "content than the inlined files."
            )

    showcase = build_showcase()
    dataset = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "vendors": list(vendors.values()),
        "agents": list(agents.values()),
        "tasks": tasks,
        "runs": runs,
        "showcase": showcase,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False)
    size = os.path.getsize(OUT) / 1e6
    print()
    print(f"Wrote {OUT} ({size:.1f} MB)")
    print(f"vendors={len(vendors)} agents={len(agents)} "
          f"tasks={len(tasks)} runs={len(runs)} showcase={len(showcase)}")


if __name__ == "__main__":
    main()
