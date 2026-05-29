import { Container } from 'lucide-react'
import { Pill } from './ui'
import { interpretEnvironment } from '../lib/dockerfile'
import type { Task } from '../lib/types'

/** Interprets a task's Dockerfile / docker-compose to show what the agent's
 *  environment looks like at start. */
export default function EnvironmentPanel({ task }: { task: Task }) {
  const env = interpretEnvironment(task)
  if (!env) return null

  return (
    <section className="card p-5" data-tour="task-env">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        <Container size={15} className="text-sky-300" /> Environment
        <span className="text-[10px] normal-case text-zinc-600">interpreted from Dockerfile / compose</span>
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 text-sm">
          {env.baseImage && (
            <Row label="Base image"><code className="font-mono text-zinc-200">{env.baseImage}</code></Row>
          )}
          {env.workdir && <Row label="Working dir"><code className="font-mono text-zinc-200">{env.workdir}</code></Row>}
          {env.expose.length > 0 && (
            <Row label="Ports">
              <div className="flex flex-wrap gap-1">{env.expose.map((p) => <Pill key={p} className="font-mono">{p}</Pill>)}</div>
            </Row>
          )}
          {env.enabledApps?.length ? (
            <Row label="Enabled apps">
              <div className="flex flex-wrap gap-1">
                {env.enabledApps.map((a) => <Pill key={a} className="bg-emerald-500/15 font-mono text-emerald-300">{a}</Pill>)}
              </div>
            </Row>
          ) : null}
          {env.env.length > 0 && (
            <Row label="Env vars">
              <div className="space-y-0.5">
                {env.env.slice(0, 8).map((e) => (
                  <div key={e.key} className="font-mono text-xs text-zinc-400">
                    <span className="text-zinc-300">{e.key}</span>={e.value}
                  </div>
                ))}
              </div>
            </Row>
          )}
        </div>

        <div className="space-y-3">
          {env.copies.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Files mounted into the container</div>
              <div className="space-y-1">
                {env.copies.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 font-mono text-xs">
                    <span className="text-zinc-500">{c.src}</span>
                    <span className="text-accent">→</span>
                    <span className="text-zinc-200">{c.dest}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {env.services.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">Services the agent can reach</div>
              <div className="space-y-1.5">
                {env.services.map((s) => (
                  <div key={s.name} className="rounded-lg border border-ink-700 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-100">{s.name}</span>
                      {s.image && <code className="font-mono text-[11px] text-zinc-500">{s.image}</code>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                      {s.ports.map((p) => <span key={p} className="rounded bg-ink-800 px-1.5 font-mono text-sky-300">:{p}</span>)}
                      {s.dependsOn.length > 0 && <span className="text-zinc-600">↳ needs {s.dependsOn.join(', ')}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-zinc-500">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
