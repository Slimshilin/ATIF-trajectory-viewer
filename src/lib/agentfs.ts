import type { FileKind, Task, TaskFile } from './types'
import { interpretEnvironment, type EnvInfo } from './dockerfile'

// ---------------------------------------------------------------------------
// Reconstruct the "agent view": the container filesystem the agent actually
// sees, by applying the Dockerfile's COPY/WORKDIR rules to the task directory,
// then overlaying the files the agent created/modified during the run.
// ---------------------------------------------------------------------------

export type FsStatus = 'env' | 'created' | 'modified' | 'touched'

export interface FsNode {
  path: string // container path, e.g. /app/src/index.ts
  content?: string
  status: FsStatus
  origin?: string // source task-file path it came from
}

export interface Service {
  name: string
  detail?: string
}

export interface AgentFs {
  nodes: FsNode[]
  services: Service[]
  baseImage?: string
  workdir?: string
  /** human-readable notes (e.g. base image provides rest of tree) */
  notes: string[]
  env: EnvInfo | null
}

function joinContainer(dest: string, rel: string, workdir?: string): string {
  let base = dest
  if (!base.startsWith('/')) base = (workdir ? workdir.replace(/\/$/, '') : '/app') + '/' + base
  base = base.replace(/\/$/, '')
  return rel ? `${base}/${rel}` : base
}

/** Build context for a Harbor task is the directory holding the Dockerfile. */
function contextPrefix(task: Task): string {
  const df = task.files.find((f) => /dockerfile$/i.test(f.path))
  if (!df) return ''
  const dir = df.path.split('/').slice(0, -1).join('/') // e.g. "environment"
  return dir ? dir + '/' : ''
}

export function buildAgentFs(task: Task, agentFiles: FsNode[] = []): AgentFs {
  const env = interpretEnvironment(task)
  const ctx = contextPrefix(task)
  const nodes = new Map<string, FsNode>()
  const notes: string[] = []

  if (env?.copies?.length) {
    for (const cp of env.copies) {
      if (cp.src === '.' || cp.src === './') {
        // copy whole context
        for (const f of task.files) {
          if (ctx && !f.path.startsWith(ctx)) continue
          const rel = ctx ? f.path.slice(ctx.length) : f.path
          if (!rel || /dockerfile$/i.test(rel)) continue
          nodes.set(joinContainer(cp.dest, rel, env.workdir), { path: joinContainer(cp.dest, rel, env.workdir), content: f.content, status: 'env', origin: f.path })
        }
        continue
      }
      const srcPrefix = ctx + cp.src.replace(/^\.\//, '')
      const matches = task.files.filter((f) => f.path === srcPrefix || f.path.startsWith(srcPrefix.replace(/\/$/, '') + '/'))
      if (matches.length === 0) {
        // src not in the task dir (e.g. a tarball or base-image artifact)
        notes.push(`COPY ${cp.src} → ${cp.dest} (not in task dir; provided at build time)`)
        continue
      }
      for (const f of matches) {
        const rel = f.path === srcPrefix ? '' : f.path.slice(srcPrefix.replace(/\/$/, '').length + 1)
        const dest = rel ? joinContainer(cp.dest, rel, env.workdir) : joinContainer(cp.dest, '', env.workdir)
        nodes.set(dest, { path: dest, content: f.content, status: 'env', origin: f.path })
      }
    }
  } else if (env) {
    // No COPY: base image provides the tree; agent works under WORKDIR.
    notes.push(`Base image ${env.baseImage ?? ''} provides the working tree${env.workdir ? ` under ${env.workdir}` : ''}.`)
  }

  // overlay what the agent created/modified
  for (const af of agentFiles) {
    const existing = nodes.get(af.path)
    nodes.set(af.path, {
      path: af.path,
      content: af.content ?? existing?.content,
      status: existing ? 'modified' : af.status,
      origin: existing?.origin,
    })
  }

  // services / other "worlds"
  const services: Service[] = []
  for (const s of env?.services ?? []) {
    services.push({ name: s.name, detail: [s.image, s.ports.map((p) => ':' + p).join(' ')].filter(Boolean).join(' ') })
  }
  for (const a of env?.enabledApps ?? []) services.push({ name: a, detail: 'enabled app' })

  return { nodes: [...nodes.values()], services, baseImage: env?.baseImage, workdir: env?.workdir, notes, env }
}

/** Convert FsNodes to TaskFiles for the generic FileTree. */
export function fsToTaskFiles(nodes: FsNode[]): TaskFile[] {
  return nodes.map((n) => ({
    path: n.path,
    kind: kindFromPath(n.path),
    content: n.content,
    note: n.content ? undefined : 'provided by environment (contents not captured)',
  }))
}

export function kindFromPath(path: string): FileKind {
  const p = path.toLowerCase()
  if (/\.(png|jpe?g|gif|svg|webp)$/.test(p)) return 'image'
  if (/\.(md|markdown)$/.test(p)) return 'markdown'
  if (/\.json$/.test(p)) return 'json'
  if (/\.(html?|vue)$/.test(p)) return 'html'
  if (/\.(diff|patch)$/.test(p)) return 'diff'
  if (/\.(csv|tsv|xlsx|xls)$/.test(p)) return 'spreadsheet'
  if (/\.(toml|txt|ini|cfg|lock|md|env)$/.test(p)) return 'text'
  return 'code'
}
