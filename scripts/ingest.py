#!/usr/bin/env python3
"""Ingest Terminal-Bench 2.1 tasks + a curated subset of public agent
trajectories into the viewer's `public/dataset.json`.

Inputs:
  - data/terminal-bench-2-1/tasks/<name>/   — task definitions cloned from
    https://github.com/harbor-framework/terminal-bench-2-1 (Apache-2.0).
  - data/hf-cache/data/train-*.parquet     — trajectories downloaded from
    yoonholee/terminalbench-trajectories on HF (Apache-2.0).

Output:
  - public/dataset.json   normalized to the shapes in src/lib/types.ts.

Curated picks: 10 representative TB tasks (mix of categories / difficulty),
with up to 2 trajectories per task (1 passed + 1 failed) drawn from different
agent/model combos so the leaderboard has comparable rows.

Run from the repo root:
    python3 scripts/ingest.py
"""
from __future__ import annotations
import base64, glob, json, mimetypes, os, re
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
TB_TASKS = os.path.join(ROOT, "data", "terminal-bench-2-1", "tasks")
PARQUETS = sorted(glob.glob(os.path.join(ROOT, "data", "hf-cache", "data", "train-*.parquet")))
OUT = os.path.join(ROOT, "public", "dataset.json")

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
# TB trajectories — yoonholee/terminalbench-trajectories parquet.
# ---------------------------------------------------------------------------

def load_tb_trajectories(picks: list[str]):
    if not PARQUETS:
        print(f"  ! no parquets in data/hf-cache/ — run download step first")
        return
    try:
        import pyarrow.parquet as pq
        import pyarrow as pa
    except ImportError:
        print("  ! pyarrow not installed — pip install pyarrow")
        return
    tables = [pq.read_table(p) for p in PARQUETS]
    table = pa.concat_tables(tables)
    df = table.to_pandas()
    df = df[df["task_name"].isin(picks)]
    # Drop the literal "null" steps rows
    df = df[df["steps"].notna() & df["steps"].str.startswith("[")]
    print(f"  candidate rows after filter: {len(df)}")
    vid = vendor("Terminal-Bench 2.1")
    picked = 0
    for name in picks:
        sub = df[df["task_name"] == name]
        # Sort by reward (passed first) and pick 1 from each side. Prefer rows
        # from distinct agents so the leaderboard shows model spread.
        passed_rows = sub[sub["reward"] == 1].sort_values("duration_seconds")
        failed_rows = sub[sub["reward"] == 0].sort_values("duration_seconds")
        chosen = []
        seen_agents: set[str] = set()
        for _, r in passed_rows.iterrows():
            if r["agent"] not in seen_agents:
                chosen.append(r); seen_agents.add(r["agent"])
            if len(chosen) >= RUNS_PER_TASK_PASS:
                break
        for _, r in failed_rows.iterrows():
            if r["agent"] not in seen_agents and len(chosen) < RUNS_PER_TASK_PASS + RUNS_PER_TASK_FAIL:
                chosen.append(r); seen_agents.add(r["agent"])
        if not chosen and len(sub) > 0:
            chosen = [sub.iloc[0]]
        for r in chosen:
            aid = agent(r["agent"], r["model"], vid)
            tid = slug(f"tb-{name}")
            try:
                step_objs = json.loads(r["steps"])
            except Exception:
                continue
            steps = [step_from_traj_obj(o, i) for i, o in enumerate(step_objs[:MAX_STEPS])]
            reward = float(r["reward"]) if r["reward"] is not None else None
            passed = reward is not None and reward >= 0.999
            tokens = None
            try:
                tokens = {
                    "prompt": int(r["input_tokens"]) if r["input_tokens"] == r["input_tokens"] else None,
                    "completion": int(r["output_tokens"]) if r["output_tokens"] == r["output_tokens"] else None,
                    "cached": int(r["cache_tokens"]) if r["cache_tokens"] == r["cache_tokens"] else None,
                    "costUsd": float(r["cost_cents"]) / 100.0 if r["cost_cents"] == r["cost_cents"] else None,
                }
            except Exception:
                tokens = None
            runs.append({
                "id": slug(f"tb-{name}-{r['trial_name'] or r['trial_id']}"),
                "taskId": tid, "agentId": aid, "vendorId": vid, "format": "atif",
                "status": "passed" if passed else "failed",
                "passed": passed, "reward": reward,
                "steps": steps, "stepCount": len(steps),
                "artifacts": run_artifacts(steps),
                "turns": sum(1 for s in steps if s["role"] == "agent"),
                "durationSec": float(r["duration_seconds"]) if r["duration_seconds"] == r["duration_seconds"] else None,
                "tokens": tokens,
                "grade": {
                    "score": reward, "maxScore": 1.0, "subscores": [],
                    "summary": f"{r['agent']} · {r['model']} · trial {r['trial_name']}",
                    "gate": None, "breakdown": None, "findings": None,
                },
                "failureReason": None,
            })
            picked += 1
    print(f"  picked {picked} trajectories across {len(picks)} tasks")


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
    print("=== Terminal-Bench public trajectories (yoonholee) ===")
    load_tb_trajectories(TASK_PICKS)
    print(f"  total runs: {len(runs)}")

    # Coverage notes — surface what was deliberately included / skipped.
    for v in vendors.values():
        if v["id"] == "terminal-bench-2-1":
            v["coverage"] = (
                f"10 of 89 Terminal-Bench 2.1 task definitions (canonical source: "
                f"harbor-framework/terminal-bench-2-1, Apache-2.0). Each task ships "
                f"its full instruction.md, environment/Dockerfile, tests, and oracle "
                f"solution. Trajectories are drawn from yoonholee/terminalbench-trajectories "
                f"on HuggingFace (Apache-2.0) — 1 passed + 1 failed run per task, "
                f"selected across distinct agent/model combinations so the leaderboard "
                f"has comparable rows. Note: trajectories were originally generated against "
                f"TB 2.0; 26 of 89 tasks were modified in 2.1, so a small number of "
                f"runs may reference slightly different task content than the inlined files."
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
