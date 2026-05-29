import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/Layout'
import { useDatasetStore } from '../lib/dataset'
import { parseUpload, type ParsedUpload } from '../lib/uploadParse'

export default function Upload() {
  const { addUpload, clearUploads, uploadedCount } = useDatasetStore()
  const [result, setResult] = useState<ParsedUpload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File) {
    setErr(null); setResult(null); setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const parsed = parseUpload(buf)
      addUpload({ vendors: parsed.vendors, agents: parsed.agents, tasks: parsed.tasks, runs: parsed.runs })
      setResult(parsed)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Upload Harbor task"
        subtitle="Drop a .zip of a Harbor task + trajectories — parsed in your browser and added to the viewer."
      />
      <div className="max-w-3xl space-y-6 p-8">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
          onClick={() => inputRef.current?.click()}
          className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-ink-700 bg-ink-900/40 px-6 py-12 text-center hover:border-accent/50"
        >
          <div className="text-3xl text-ink-600">⬆</div>
          <div className="mt-2 text-sm text-zinc-300">{busy ? 'Parsing…' : 'Drop a .zip here, or click to choose'}</div>
          <div className="mt-1 text-xs text-zinc-600">parsed locally — nothing is uploaded to a server</div>
          <input ref={inputRef} type="file" accept=".zip" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        </div>

        {err && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{err}</p>}

        {result && (
          <div className="card p-5">
            <h2 className="mb-2 text-sm font-semibold text-white">Added ✓</h2>
            <ul className="space-y-1 text-sm text-zinc-300">
              {result.tasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between">
                  <span>{t.title} <span className="text-zinc-600">· {t.files.length} files</span></span>
                  <span className="text-xs text-zinc-500">{result.runs.filter((r) => r.taskId === t.id).length} runs</span>
                </li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <div className="mt-3 text-xs text-amber-300/80">{result.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
            )}
            <Link to="/tasks" className="btn-primary mt-4 inline-flex">View under Tasks → Uploaded</Link>
          </div>
        )}

        {uploadedCount > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{uploadedCount} uploaded task(s) in this browser.</span>
            <button onClick={() => { clearUploads(); setResult(null) }} className="text-rose-400 hover:underline">Clear uploads</button>
          </div>
        )}

        <section className="card p-5 text-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Expected zip format (Harbor)</h2>
          <p className="mb-2 text-xs text-zinc-500">One zip may contain <strong className="text-zinc-300">multiple tasks</strong>. Each task is a directory with <code className="font-mono">instruction.md</code> (or <code className="font-mono">task.toml</code>) and a <code className="font-mono">jobs/</code> folder holding its trials.</p>
          <pre className="overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-3 text-[12px] leading-relaxed text-zinc-300">{`my-upload.zip
└─ <task-name>/                       # e.g. gpt-ioi-circuit  (repeatable)
   ├─ instruction.md                  # task prompt (first "# heading" → title)
   ├─ task.toml                       # [metadata] difficulty / category
   ├─ environment/Dockerfile          # → Agent-view filesystem + services
   ├─ tests/  solution/  README.md    # optional
   └─ jobs/                           # the trials for this task
      └─ <task>__<trialId>/           # one per run (repeatable)
         ├─ agent/trajectory.json     # the trajectory (ATIF or messages)
         ├─ config.json               # agent.name (harness) + agent.model_name
         ├─ result.json               # verifier_result.rewards, timestamps
         └─ verifier/
            ├─ reward.txt             # numeric reward
            └─ test-stdout.txt        # verifier log (shown in Reward & Verifier log)`}</pre>
          <div className="mt-3 space-y-1 text-xs text-zinc-400">
            <p><strong className="text-zinc-200">trajectory.json</strong> may be <strong>ATIF</strong> (<code className="font-mono">{`{schema_version:"ATIF-v1.x", steps:[…]}`}</code>) or <strong>messages</strong> (<code className="font-mono">{`{transcript:[…]}`}</code>/<code className="font-mono">{`{messages:[…]}`}</code>).</p>
            <p className="text-zinc-500">Reward comes from <code className="font-mono">verifier/reward.txt</code> → <code className="font-mono">result.json</code>; the verifier log from <code className="font-mono">verifier/test-stdout.txt</code>; harness/model from the trial <code className="font-mono">config.json</code>. Dockerfile <code className="font-mono">COPY src dest</code> rules place files at container paths in the Agent view. (Older <code className="font-mono">trajectories/*.json</code> layouts still parse too.) Uploaded data stays only in this browser.</p>
          </div>
        </section>
      </div>
    </>
  )
}
