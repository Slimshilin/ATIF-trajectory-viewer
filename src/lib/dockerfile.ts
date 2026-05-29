import type { Task, TaskFile } from './types'

// ---------------------------------------------------------------------------
// Lightweight Dockerfile / docker-compose interpretation so we can show what
// the agent's environment actually looks like (base image, copied files,
// services, ports) and seed the file system from COPY instructions.
// ---------------------------------------------------------------------------

export interface CopyOp {
  src: string
  dest: string
}

export interface Service {
  name: string
  image?: string
  ports: string[]
  dependsOn: string[]
}

export interface EnvInfo {
  baseImage?: string
  workdir?: string
  env: { key: string; value: string }[]
  expose: string[]
  copies: CopyOp[]
  runs: string[]
  services: Service[]
  enabledApps?: string[]
  raw: { dockerfile?: string; compose?: string }
}

export function parseDockerfile(text: string): Partial<EnvInfo> {
  const info: Partial<EnvInfo> = { env: [], expose: [], copies: [], runs: [] }
  // join line continuations
  const lines = text.replace(/\\\n/g, ' ').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(\w+)\s+(.*)$/.exec(line)
    if (!m) continue
    const instr = m[1].toUpperCase()
    const rest = m[2].trim()
    if (instr === 'FROM') info.baseImage = rest.split(/\s+as\s+/i)[0].trim()
    else if (instr === 'WORKDIR') info.workdir = rest
    else if (instr === 'EXPOSE') info.expose!.push(...rest.split(/\s+/))
    else if (instr === 'ENV') {
      const em = /^(\S+)[=\s]+(.*)$/.exec(rest)
      if (em) info.env!.push({ key: em[1], value: em[2].replace(/^["']|["']$/g, '') })
    } else if (instr === 'COPY' || instr === 'ADD') {
      const parts = rest.replace(/--\S+/g, '').trim().split(/\s+/)
      if (parts.length >= 2) {
        const dest = parts[parts.length - 1]
        for (const src of parts.slice(0, -1)) info.copies!.push({ src, dest })
      }
    } else if (instr === 'RUN') {
      info.runs!.push(rest)
    }
  }
  return info
}

export function parseCompose(text: string): Service[] {
  // tiny YAML-ish parser for the `services:` block (indentation-based)
  const lines = text.split('\n')
  const services: Service[] = []
  let inServices = false
  let cur: Service | null = null
  let section: 'ports' | 'depends' | null = null
  for (const raw of lines) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (/^services:\s*$/.test(line)) { inServices = true; continue }
    if (!inServices) continue
    if (indent === 0 && !/^services:/.test(line)) break // left services block

    if (indent === 2 && line.endsWith(':')) {
      cur = { name: line.slice(0, -1).trim(), ports: [], dependsOn: [] }
      services.push(cur)
      section = null
    } else if (cur && indent >= 4) {
      if (/^image:\s*/.test(line)) cur.image = line.replace(/^image:\s*/, '').replace(/^["']|["']$/g, '')
      else if (/^ports:\s*$/.test(line)) section = 'ports'
      else if (/^depends_on:\s*$/.test(line)) section = 'depends'
      else if (/^\w+:/.test(line) && indent === 4) section = null
      else if (section === 'ports' && line.startsWith('-')) cur.ports.push(line.replace(/^-\s*/, '').replace(/["']/g, ''))
      else if (section === 'depends') {
        const dm = /^-?\s*([\w-]+):?\s*$/.exec(line)
        if (dm && dm[1] !== 'condition') cur.dependsOn.push(dm[1])
      }
    }
  }
  return services
}

export function interpretEnvironment(task: Task): EnvInfo | null {
  const find = (pred: (f: TaskFile) => boolean) => task.files.find(pred)
  const dockerfile = find((f) => /dockerfile$/i.test(f.path))
  const compose = find((f) => /docker-compose\.ya?ml$/i.test(f.path))
  if (!dockerfile && !compose) return null

  const base: EnvInfo = { env: [], expose: [], copies: [], runs: [], services: [], raw: {} }
  if (dockerfile?.content) {
    Object.assign(base, { ...base, ...parseDockerfile(dockerfile.content) })
    base.raw.dockerfile = dockerfile.content
    const apps = base.env.find((e) => e.key === 'ENABLED_APPS')
    if (apps) base.enabledApps = apps.value.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (compose?.content) {
    base.services = parseCompose(compose.content)
    base.raw.compose = compose.content
  }
  return base
}
