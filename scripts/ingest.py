#!/usr/bin/env python3
"""Ingest two complementary task sources into `public/dataset.json` and
promote any shipped audit reports into `public/aft/`.

Source A — Terminal-Bench 2.1 (Apache-2.0)
  • Task definitions cloned from
      data/terminal-bench-2-1/tasks/<name>/
    (the harbor-framework/terminal-bench-2-1 repo).
  • Trajectories fetched LAZILY from the official leaderboard repo
    `harborframework/terminal-bench-2-leaderboard` on HuggingFace,
    one trial at a time, cached under data/hf-leaderboard-cache/.
  • The leaderboard repo ships no audit JSONs, so these runs start
    without a pre-computed AFT report — visitors can generate one
    in-browser or via the bridge.

Source B — Harbor-Index annotate bundle (Apache-2.0)
  • Full Harbor directories + one trial each + pre-computed audits
    under data/harbor-annotate-bundle/<task>/ (gitignored; the
    user's harbor-annotate-bundle.zip extracted at this path).
  • The audit reports are already in AFT v1.0 shape, so we copy
    one per task to public/aft/<runId>.json — these runs show
    "✦ Pre-analyzed" immediately, no key or bridge required.

Output:
  - public/dataset.json
  - public/aft/<runId>.json + public/aft/index.json

Run from the repo root:
    python3 scripts/ingest.py
"""
from __future__ import annotations
import base64, glob, json, mimetypes, os, re, time
import urllib.request, urllib.error
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
TB_TASKS = os.path.join(ROOT, "data", "terminal-bench-2-1", "tasks")
HF_CACHE = os.path.join(ROOT, "data", "hf-leaderboard-cache")
BUNDLE = os.path.join(ROOT, "data", "harbor-annotate-bundle")
OUT = os.path.join(ROOT, "public", "dataset.json")
AFT_DIR = os.path.join(ROOT, "public", "aft")

# --- Source A: TB 2.1 --------------------------------------------------------
TB_API = "https://huggingface.co/api/datasets/harborframework/terminal-bench-2-leaderboard"
TB_FILE = "https://huggingface.co/datasets/harborframework/terminal-bench-2-leaderboard/resolve/main"

# One agent/model pair per major model family — all confirmed to ship full
# `agent/trajectory.json` ATIF logs.
TB_AGENTS = [
    "Judy__Claude-Opus-4.6",                   # Anthropic (Judy harness)
    "CodeBrain-1__GPT-5.3-Codex",              # OpenAI    (CodeBrain harness)
    "Gemini_CLI__Gemini-3.1-Pro-Preview",      # Google    (Gemini CLI harness)
    "ClaudeCode__GLM-4.7",                     # Z-AI GLM  (Claude Code harness)
]

TB_TASK_PICKS = [
    "adaptive-rejection-sampler",
    "break-filter-js-from-html",
    "build-cython-ext",
    "cancel-async-tasks",
    "chess-best-move",
    "configure-git-webserver",
    "count-dataset-tokens",
    "crack-7z-hash",
    "compile-compcert",
    "cobol-modernization",
]

# --- Source B: Harbor-Index annotate bundle ---------------------------------
HI_TASK_PICKS = [
    "spreadsheetbench-sort-spreadsheet-by-helper",   # spreadsheet stage
    "widesearch-list-bri-projects-2025",             # web search + emails
    "gaia-find-chess-winning-move",                  # reasoning + tools
    "arcagi2-grid-transform-de80",                   # visual grid
    "swebenchpro-fix-ansible-invalid-hosts",         # SWE-bench style
    "crustbench-transpile-bostree-to-rust",          # language transpilation
    "labbench-habenula-fluorescence-change",         # biology data analysis
    "algotune-optimize-outer-product",               # algorithm optimization
    "codepde-solve-navier-stokes-1d",                # physics PDE
    "gso-speedup-pandas-period-fmt",                 # python performance
]

# Which audit report to promote per task. "opus__r1" generally has the
# best-articulated AFT codes; we fall back to whatever's available.
PREFERRED_AUDITS = ["opus__r1.report.json", "opus__r2.report.json",
                    "opus__r3.report.json", "gpt__r1.report.json",
                    "composer__r1.report.json"]

MAX_STEPS = 10_000


# ---------------------------------------------------------------------------
# Registries
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
    "claude-code": "Claude Code", "claude": "Claude Code",
    "codex": "Codex CLI", "codex-cli": "Codex CLI",
    "openhands": "OpenHands", "openhands-sdk": "OpenHands",
    "gemini-cli": "Gemini CLI", "gemini": "Gemini CLI",
    "qwen-code": "Qwen Code",
    "terminus-2": "Terminus-2", "terminus-3": "Terminus-3",
    "factory droid": "Factory Droid", "factory-droid": "Factory Droid",
    "judy": "Judy", "forge": "Forge", "tarsier": "Tarsier",
}


def clean_model(raw):
    if not raw:
        return None
    m = str(raw).split("@")[0].split("/")[-1]
    m = m.replace("_", "-").strip().lower()
    m = re.sub(r"^(anthropic|openai|google|openrouter|meta|mistral|tencent|deepseek|moonshotai|qwen|gemini|z-ai|minimax)-", "", m)
    return m or None


def model_family(raw):
    s = str(raw or "").lower()
    if "claude" in s: return "Anthropic"
    if "gemini" in s: return "Google"
    if "gpt" in s or "openai" in s or "codex" in s or re.search(r"\bo[134]\b", s): return "OpenAI"
    if "deepseek" in s: return "DeepSeek"
    if "qwen" in s: return "Qwen"
    if "kimi" in s or "moonshot" in s: return "Moonshot"
    if "glm" in s or "z-ai" in s: return "Z-AI"
    if "minimax" in s: return "MiniMax"
    if "hy3" in s or "tencent" in s: return "Tencent Hunyuan"
    if "mimo" in s: return "MiMo"
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
        ".go": "go", ".rs": "rust", ".sql": "sql", ".toml": "toml", ".json": "json",
        ".yaml": "yaml", ".yml": "yaml", ".rb": "ruby"}


def file_kind(path: str) -> str:
    p = path.lower()
    if p.endswith((".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")):
        return "image"
    if p.endswith((".md", ".markdown")): return "markdown"
    if p.endswith(".json"): return "json"
    if p.endswith((".html", ".htm")): return "html"
    if p.endswith((".csv", ".tsv", ".xlsx")): return "spreadsheet"
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


SHEET_DELIM = "@@SHEET:"  # marker the frontend's SpreadsheetView understands


def xlsx_to_csv(path: str, max_sheets: int = 12, max_rows: int = 500, max_cols: int = 60) -> str | None:
    """Convert an .xlsx workbook to multi-sheet CSV using `@@SHEET:<name>@@`
    separators so the viewer's SpreadsheetView renders one tab per sheet."""
    try:
        import openpyxl  # type: ignore
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception:
        return None
    blocks: list[str] = []
    for ws in wb.worksheets[:max_sheets]:
        rows: list[str] = []
        for r in ws.iter_rows(max_row=max_rows, max_col=max_cols, values_only=True):
            cells = ["" if v is None else str(v).replace("\n", " ")[:120] for v in r]
            while cells and cells[-1] == "":
                cells.pop()
            rows.append(",".join(
                '"%s"' % c.replace('"', '""') if ("," in c or '"' in c) else c for c in cells
            ))
        while rows and not rows[-1]:
            rows.pop()
        blocks.append(f"{SHEET_DELIM}{ws.title}@@\n" + "\n".join(rows))
    wb.close()
    return "\n".join(blocks) if blocks else None


SKIP_DIRS = {"__pycache__", ".git", "node_modules"}


def collect_files(root: str, base: str) -> list[dict]:
    out: list[dict] = []
    for dirpath, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
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
                if uri: rec["content"] = uri
                else: rec["note"] = "image too large to inline"
            elif ext == ".xlsx":
                # Render workbook → CSV-with-sheet-markers so SpreadsheetView
                # shows the grid in the task page.
                content = xlsx_to_csv(full)
                if content:
                    rec["content"] = content
                else:
                    rec["note"] = "xlsx could not be parsed"
            elif ext in (".xls", ".zip", ".tar", ".gz", ".pyc"):
                try: size = os.path.getsize(full)
                except: size = 0
                rec["kind"] = "text"
                rec["note"] = f"{ext[1:]} binary ({size} bytes) — on disk"
            else:
                content = read_text(full)
                if content is None: continue
                rec["content"] = content
                if kind == "code":
                    rec["language"] = LANG.get(ext)
            out.append(rec)
    return out


# ---------------------------------------------------------------------------
# task.toml parsing.
# ---------------------------------------------------------------------------

def task_toml_meta(text: str) -> dict:
    meta: dict = {}
    for key in ("difficulty", "category"):
        m = re.search(rf'{key}\s*=\s*"([^"]+)"', text or "")
        if m: meta[key] = m.group(1)
    m = re.search(r"tags\s*=\s*\[([^\]]+)\]", text or "")
    if m:
        meta["tags"] = [t.strip().strip('"') for t in m.group(1).split(",") if t.strip()]
    return meta


# ---------------------------------------------------------------------------
# ATIF step normalization.
# ---------------------------------------------------------------------------

WRITE_CMD = re.compile(
    r"(>>?|\btee\b|\bcp\b|\bmv\b|\bmkdir\b|\btouch\b|sed -i|"
    r"\bgit (add|commit|checkout|push)\b|\bmake\b|npm (run|install|ci)|"
    r"pip install|\brm\b|cargo build|cargo test|pytest|\bdd\b)"
)


def detect_mutation(name: str, raw_args) -> dict | None:
    if isinstance(raw_args, str):
        try: args = json.loads(raw_args)
        except: args = {"_raw": raw_args}
    elif isinstance(raw_args, dict): args = raw_args
    else: args = {}
    n = (name or "").lower()
    if any(k in n for k in ("write_file", "create_file", "str_replace", "edit_file", "apply_patch", "replace_file")) or n in ("write", "edit", "replace"):
        return {"kind": "file", "tool": name,
                "target": args.get("path") or args.get("filepath") or args.get("file_path"),
                "summary": "file edit",
                "detail": (args.get("content") or args.get("new_str") or args.get("new_content")
                           or args.get("new_string") or "")[:1500]}
    if "git_commit" in n or n.endswith("git_commit"):
        return {"kind": "git", "tool": name, "target": args.get("repo_path"),
                "summary": "commit: " + (args.get("message", "") or "").splitlines()[0][:80]}
    if any(k in n for k in ("git_add", "git_create_branch", "git_checkout", "git_push")):
        return {"kind": "git", "tool": name,
                "target": args.get("repo_path") or args.get("branch_name"),
                "summary": n.replace("git_", "").replace("_", " ")}
    if ("bash" in n or "shell" in n or n in ("run_command", "exec", "execute")
        or n.endswith("_command") or n == "bash_command"):
        cmd = args.get("command") or args.get("cmd") or args.get("_raw") or ""
        if cmd and WRITE_CMD.search(str(cmd)):
            return {"kind": "command", "tool": name, "target": None,
                    "summary": str(cmd).strip()[:200]}
    return None


def _parse_tool_calls(raw):
    if raw is None: return []
    if isinstance(raw, list): return raw
    if isinstance(raw, str):
        # Trajectory files sometimes ship a Python-repr string ("[{'a': 'b'}]")
        try: return json.loads(raw)
        except Exception:
            try: return json.loads(raw.replace("'", '"'))
            except Exception: return []
    return []


def step_from_atif(s: dict, idx: int) -> dict:
    role = {"user": "user", "agent": "agent", "assistant": "agent",
            "tool": "tool", "system": "system"}.get((s.get("source") or "agent").lower(), "agent")
    raw_tcs = _parse_tool_calls(s.get("tool_calls"))
    tcs: list[dict] = []
    muts: list[dict] = []
    for tc in raw_tcs:
        if not isinstance(tc, dict): continue
        name = tc.get("function_name") or (tc.get("function") or {}).get("name") or tc.get("name") or "tool"
        args = tc.get("arguments")
        if args is None and tc.get("function"):
            args = tc["function"].get("arguments")
        if not isinstance(args, str):
            args = json.dumps(args, ensure_ascii=False) if args is not None else None
        tcs.append({"name": name, "args": args})
        m = detect_mutation(name, args)
        if m: muts.append(m)
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


def run_artifacts(steps: list) -> list:
    seen = []
    for s in steps:
        for m in (s.get("mutations") or []):
            t = m.get("target")
            if t and t not in seen:
                seen.append(t)
    return seen[:30]


def iso_duration(a, b):
    if not a or not b: return None
    try:
        return max(0.0, (datetime.fromisoformat(b.replace("Z", "+00:00"))
                          - datetime.fromisoformat(a.replace("Z", "+00:00"))).total_seconds())
    except Exception:
        return None


# ---------------------------------------------------------------------------
# AFT audit promotion.
# ---------------------------------------------------------------------------

def promote_audit(audit_path: str, run_id: str) -> bool:
    """Copy one audit report into public/aft/<run_id>.json. The audit is
    already in AFT v1.0 shape; we just rewrite the trial id."""
    try:
        rep = json.load(open(audit_path, encoding="utf-8"))
    except Exception:
        return False
    if not (isinstance(rep, dict) and "failure_modes" in rep and "outcome" in rep):
        return False
    rep["trial"] = {**(rep.get("trial") or {}), "id": run_id}
    os.makedirs(AFT_DIR, exist_ok=True)
    with open(os.path.join(AFT_DIR, f"{run_id}.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False)
    return True


def pick_audit(audit_dir: str) -> str | None:
    if not os.path.isdir(audit_dir): return None
    files = os.listdir(audit_dir)
    for preferred in PREFERRED_AUDITS:
        if preferred in files:
            return os.path.join(audit_dir, preferred)
    # fallback: first report.json
    for f in sorted(files):
        if f.endswith(".report.json"):
            return os.path.join(audit_dir, f)
    return None


# ---------------------------------------------------------------------------
# Source A: Terminal-Bench 2.1 — task defs from the cloned repo, trajectories
# pulled lazily from the official leaderboard HF dataset.
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
    raw = _hf_get(f"{TB_API}/tree/main/{rel_path}")
    return json.loads(raw.decode("utf-8"))


def hf_file_cached(rel_path: str) -> bytes:
    cache_p = os.path.join(HF_CACHE, rel_path)
    if os.path.isfile(cache_p):
        return open(cache_p, "rb").read()
    os.makedirs(os.path.dirname(cache_p), exist_ok=True)
    raw = _hf_get(f"{TB_FILE}/{rel_path}")
    with open(cache_p, "wb") as f:
        f.write(raw)
    return raw


def _tb_pretty(name: str) -> str:
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
        files = collect_files(tdir, tdir)
        tasks.append({
            "id": slug(f"tb-{name}"),
            "vendorId": vid,
            "title": _tb_pretty(name),
            "source": "harbor",
            "category": meta.get("category", "Terminal-Bench"),
            "difficulty": meta.get("difficulty", "medium"),
            "instruction": instr,
            "files": files,
            "metadata": {"tb_task_name": name, "tb_version": "2.1",
                         "tags": meta.get("tags", [])},
        })


def _tb_load_one_trial(agent_dir: str, date_dir: str, trial_rel: str,
                       task_name: str, vid: str) -> bool:
    base = f"submissions/terminal-bench/2.0/{agent_dir}/{date_dir}/{trial_rel}"
    try:
        result = json.loads(hf_file_cached(f"{base}/result.json"))
    except Exception:
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
    except Exception:
        return False
    raw_steps = traj.get("steps") or []
    steps = [step_from_atif(s, i) for i, s in enumerate(raw_steps[:MAX_STEPS])]
    tid = slug(f"tb-{task_name}")
    runs.append({
        "id": slug(f"tb-{trial_rel}-{harness}-{model}"),
        "taskId": tid, "agentId": aid, "vendorId": vid, "format": "atif",
        "status": "passed" if passed else ("failed" if reward is not None else "completed"),
        "passed": passed, "reward": reward,
        "steps": steps, "stepCount": len(steps),
        "artifacts": run_artifacts(steps),
        "turns": sum(1 for s in steps if s["role"] == "agent"),
        "durationSec": iso_duration(started, finished),
        "tokens": None,
        "grade": {
            "score": reward, "maxScore": 1.0, "subscores": [],
            "summary": f"{harness} · {model} · trial {trial_rel}",
            "gate": None, "breakdown": None, "findings": None,
        },
        "failureReason": (str(exc)[:400] if exc else None),
    })
    return True


def load_tb_leaderboard(picks: list[str]) -> int:
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
            continue
        date_dir = sorted(date_subdirs)[0]
        try:
            trial_entries = hf_tree(f"submissions/terminal-bench/2.0/{agent_dir}/{date_dir}")
        except Exception:
            continue
        trial_names = [os.path.basename(t["path"]) for t in trial_entries if t["type"] == "directory"]
        for task in picks:
            match = next((n for n in trial_names if n.startswith(f"{task}__")), None)
            if not match:
                continue
            if _tb_load_one_trial(agent_dir, date_dir, match, task, vid):
                picked += 1
    return picked


# ---------------------------------------------------------------------------
# Source B: Harbor-Index annotate bundle — full task dirs + 1 trial each +
# pre-computed audit reports.
# ---------------------------------------------------------------------------

def load_hi_task(task_name: str) -> bool:
    tdir = os.path.join(BUNDLE, task_name)
    if not os.path.isdir(tdir):
        print(f"  ! task missing on disk: {task_name}")
        return False
    instr = read_text(os.path.join(tdir, "instruction.md"))
    toml_text = read_text(os.path.join(tdir, "task.toml")) or ""
    meta = task_toml_meta(toml_text)
    # Collect ONLY the public task files (skip jobs/, which holds the
    # trajectory + audits — those become run records, not task files).
    files: list[dict] = []
    for sub in ("environment", "solution", "tests"):
        spath = os.path.join(tdir, sub)
        if os.path.isdir(spath):
            for f in collect_files(spath, tdir):
                files.append(f)

    vid = vendor("Harbor Index")
    tid = slug(f"hi-{task_name}")
    title = task_name.replace("-", " ").title()
    tasks.append({
        "id": tid, "vendorId": vid, "title": title, "source": "harbor",
        "category": meta.get("category", "Harbor task"),
        "difficulty": meta.get("difficulty", "medium"),
        "instruction": instr,
        "files": files,
        "metadata": {
            "harbor_task_name": task_name,
            "tags": meta.get("tags", []),
        },
    })

    # Load the (single) trial.
    jobs_root = os.path.join(tdir, "jobs")
    if not os.path.isdir(jobs_root):
        return True
    job_dirs = sorted(d for d in os.listdir(jobs_root) if os.path.isdir(os.path.join(jobs_root, d)))
    if not job_dirs:
        return True
    job_dir = os.path.join(jobs_root, job_dirs[0])
    result_p = os.path.join(job_dir, "result.json")
    traj_p = os.path.join(job_dir, "agent", "trajectory.json")

    try:
        result = json.load(open(result_p, encoding="utf-8"))
        traj = json.load(open(traj_p, encoding="utf-8"))
    except Exception as e:
        print(f"  ! trial load failed for {task_name}: {e}")
        return True

    cfg_agent = ((result.get("config") or {}).get("agent")) or {}
    harness = cfg_agent.get("name") or (traj.get("agent") or {}).get("name") or "agent"
    model = cfg_agent.get("model_name") or (traj.get("agent") or {}).get("model_name")
    aid = agent(harness, model, vid)
    reward = ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward")
    if reward is None:
        rt = read_text(os.path.join(job_dir, "verifier", "reward.txt"))
        if rt:
            try: reward = float(rt.strip())
            except: pass
    passed = reward is not None and float(reward) >= 0.999
    started = result.get("started_at")
    finished = result.get("finished_at")
    exc = result.get("exception_info")

    raw_steps = traj.get("steps") or []
    steps = [step_from_atif(s, i) for i, s in enumerate(raw_steps[:MAX_STEPS])]

    run_id = slug(f"hi-{task_name}-{os.path.basename(job_dir)}")[:120]
    runs.append({
        "id": run_id,
        "taskId": tid, "agentId": aid, "vendorId": vid, "format": "atif",
        "status": "passed" if passed else ("failed" if reward is not None else "completed"),
        "passed": passed, "reward": reward,
        "steps": steps, "stepCount": len(steps),
        "artifacts": run_artifacts(steps),
        "turns": sum(1 for s in steps if s["role"] == "agent"),
        "durationSec": iso_duration(started, finished),
        "tokens": None,
        "grade": {
            "score": reward, "maxScore": 1.0, "subscores": [],
            "summary": f"{harness} · {model} · {os.path.basename(job_dir)}",
            "gate": None, "breakdown": None, "findings": None,
        },
        "failureReason": (str(exc)[:400] if exc else None),
    })

    # Promote one pre-computed audit report.
    audit_path = pick_audit(os.path.join(job_dir, "audits"))
    if audit_path:
        promote_audit(audit_path, run_id)

    return True


def build_showcase() -> list[dict]:
    out = []
    by_task: dict[str, list[dict]] = {}
    for r in runs:
        by_task.setdefault(r["taskId"], []).append(r)
    for t in tasks:
        bucket = by_task.get(t["id"], [])
        if not bucket:
            continue
        for r in bucket[:1]:
            out.append({
                "vendorId": t["vendorId"], "taskId": t["id"], "runId": r["id"],
                "taskTitle": t["title"], "passed": r["passed"], "reward": r["reward"],
                "stepCount": r["stepCount"], "source": r["format"],
                "why": ("Solved run — full grader output" if r["passed"]
                        else "Failed run — verifier log + AFT failure analysis"),
            })
    return out


def main() -> None:
    # Clean previous AFT promotions (we re-derive every run).
    if os.path.isdir(AFT_DIR):
        for fn in os.listdir(AFT_DIR):
            if fn.endswith(".json"):
                os.remove(os.path.join(AFT_DIR, fn))

    print(f"=== Source A: Terminal-Bench 2.1 ({len(TB_TASK_PICKS)} tasks) ===")
    load_tb_tasks(TB_TASK_PICKS)
    print(f"  tasks loaded: {sum(1 for t in tasks if t['vendorId']=='terminal-bench-2-1')}")
    print(f"  fetching trajectories from the leaderboard (lazy, cached)…")
    tb_runs = load_tb_leaderboard(TB_TASK_PICKS)
    print(f"  TB trajectories: {tb_runs}")

    print()
    print(f"=== Source B: Harbor-Index annotate bundle ({len(HI_TASK_PICKS)} tasks) ===")
    for t in HI_TASK_PICKS:
        load_hi_task(t)
    print(f"  HI tasks: {sum(1 for t in tasks if t['vendorId']=='harbor-index')}")
    print(f"  total runs: {len(runs)}")

    # Rebuild AFT index.
    os.makedirs(AFT_DIR, exist_ok=True)
    aft_ids = sorted(f[:-5] for f in os.listdir(AFT_DIR) if f.endswith(".json") and f != "index.json")
    with open(os.path.join(AFT_DIR, "index.json"), "w") as f:
        json.dump(aft_ids, f)
    print(f"  promoted AFT reports: {len(aft_ids)}")

    for v in vendors.values():
        if v["id"] == "terminal-bench-2-1":
            v["coverage"] = (
                f"{len(TB_TASK_PICKS)} of 89 Terminal-Bench 2.1 task definitions "
                f"cloned from the canonical source (harbor-framework/terminal-bench-2-1, "
                f"Apache-2.0). Each task ships its full instruction.md, "
                f"environment/Dockerfile, tests, and oracle solution. Trajectories "
                f"are pulled from the official harborframework/terminal-bench-2-leaderboard "
                f"dataset on HuggingFace (Apache-2.0) — one trial per agent harness "
                f"across four families (Anthropic, OpenAI, Google, Z-AI). Files are "
                f"fetched lazily over HTTP and cached under data/hf-leaderboard-cache/ "
                f"(gitignored). These runs ship NO pre-computed AFT reports — apply "
                f"AFT in-browser with your own API key, or via the local bridge."
            )
        elif v["id"] == "harbor-index":
            v["coverage"] = (
                f"{len(HI_TASK_PICKS)} curated tasks from the Harbor-Index annotate "
                f"bundle (Apache-2.0) — each ships its full task directory "
                f"(task.toml + instruction.md + environment + tests + solution), one "
                f"trial's ATIF trajectory under jobs/<trial>/agent/trajectory.json, "
                f"and a pre-computed AFT v1.0 audit report (promoted automatically "
                f"to public/aft/<runId>.json at ingest time, so the viewer shows "
                f"'✦ Pre-analyzed' on every run with no key or bridge). Picks span "
                f"spreadsheet manipulation, web search, visual reasoning, SWE bug "
                f"fixes, language transpilation, scientific analysis, and python "
                f"performance — exercising every viewer feature."
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
          f"tasks={len(tasks)} runs={len(runs)} showcase={len(showcase)} aft={len(aft_ids)}")


if __name__ == "__main__":
    main()
