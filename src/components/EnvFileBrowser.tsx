import { useMemo, useState } from 'react'
import clsx from 'clsx'
import FileTree from './FileTree'
import FileRenderer from './FileRenderer'
import { Pill } from './ui'
import { buildAgentFs, fsToTaskFiles, type FsNode, type FsStatus } from '../lib/agentfs'
import type { Task, TaskFile } from '../lib/types'

const STATUS_BADGE: Record<FsStatus, string> = {
  env: 'bg-sky-500/15 text-sky-300',
  created: 'bg-emerald-500/15 text-emerald-300',
  modified: 'bg-amber-500/15 text-amber-300',
  touched: 'bg-zinc-500/15 text-zinc-400',
}

/** Human view = raw task directory. Agent view = reconstructed container FS
 *  (Dockerfile COPY + agent edits) with service bubbles. */
export default function EnvFileBrowser({
  task,
  agentFiles,
}: {
  task: Task
  agentFiles?: FsNode[]
}) {
  const agentFs = useMemo(() => buildAgentFs(task, agentFiles ?? []), [task, agentFiles])
  const hasEnv = !!agentFs.env
  const [view, setView] = useState<'human' | 'agent'>(hasEnv ? 'agent' : 'human')
  const [sel, setSel] = useState<TaskFile | undefined>()

  const agentFiles2 = useMemo(() => fsToTaskFiles(agentFs.nodes), [agentFs])
  const statusByPath = useMemo(() => {
    const m: Record<string, FsStatus> = {}
    for (const n of agentFs.nodes) m[n.path] = n.status
    return m
  }, [agentFs])

  const files = view === 'agent' ? agentFiles2 : task.files
  const current = sel && files.some((f) => f.path === sel.path) ? sel : files[0]
  const curStatus = current ? statusByPath[current.path] : undefined

  return (
    <section data-tour="task-files">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">File system</h2>
        <div className="flex rounded-lg bg-ink-800 p-0.5 text-xs">
          <Toggle dataTour="task-view-human" active={view === 'human'} onClick={() => { setView('human'); setSel(undefined) }}>👤 Human view</Toggle>
          <Toggle dataTour="task-view-agent" active={view === 'agent'} onClick={() => { setView('agent'); setSel(undefined) }} disabled={!hasEnv && !agentFiles?.length}>
            🤖 Agent view
          </Toggle>
        </div>
        <span className="text-xs text-zinc-600">
          {view === 'human' ? 'raw task directory as provided' : 'container filesystem the agent sees'}
        </span>
      </div>

      {view === 'agent' && (
        <div className="mb-3 space-y-2">
          {(agentFs.baseImage || agentFs.workdir) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {agentFs.baseImage && <span>image <code className="font-mono text-zinc-300">{agentFs.baseImage}</code></span>}
              {agentFs.workdir && <span>· workdir <code className="font-mono text-zinc-300">{agentFs.workdir}</code></span>}
            </div>
          )}
          {agentFs.services.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">other worlds running:</span>
              {agentFs.services.map((s) => (
                <span key={s.name} className="flex items-center gap-1 rounded-full border border-ink-600 bg-ink-800 px-2.5 py-1 text-xs">
                  <span>🫧</span>
                  <span className="font-medium text-zinc-200">{s.name}</span>
                  {s.detail && <span className="font-mono text-[10px] text-zinc-500">{s.detail}</span>}
                </span>
              ))}
            </div>
          )}
          {agentFs.notes.map((n, i) => (
            <p key={i} className="text-[11px] text-zinc-600">ℹ {n}</p>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <div className="card px-4 py-6 text-center text-sm text-zinc-600">
          {view === 'agent' ? 'No reconstructable agent filesystem (no COPY rules or captured files).' : 'No task directory files provided.'}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className="card h-fit max-h-[32rem] overflow-auto p-2">
            <FileTree files={files} selected={current?.path} onSelect={setSel} statusByPath={view === 'agent' ? statusByPath : undefined} />
          </div>
          <div className="card min-w-0 p-4">
            {current ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <code className="truncate font-mono text-xs text-zinc-400">{current.path}</code>
                  <div className="flex items-center gap-1.5">
                    {view === 'agent' && curStatus && <Pill className={STATUS_BADGE[curStatus]}>{curStatus}</Pill>}
                    <Pill>{current.kind}</Pill>
                  </div>
                </div>
                <FileRenderer file={current} />
              </>
            ) : (
              <p className="text-sm text-zinc-500">Select a file.</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Toggle({ active, onClick, disabled, children, dataTour }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; dataTour?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-tour={dataTour}
      className={clsx(
        'rounded-md px-3 py-1 font-medium transition-colors disabled:opacity-30',
        active ? 'bg-accent text-white' : 'text-zinc-400 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  )
}
