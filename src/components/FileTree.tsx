import { useState } from 'react'
import clsx from 'clsx'
import type { FileKind, TaskFile } from '../lib/types'

const KIND_ICON: Record<FileKind, string> = {
  code: '{}',
  markdown: 'M',
  json: '{}',
  image: '◫',
  html: '<>',
  spreadsheet: '▦',
  text: '¶',
  pdf: '▤',
  diff: '±',
}

interface TreeNode {
  name: string
  path: string
  file?: TaskFile
  children: Map<string, TreeNode>
}

function buildTree(files: TaskFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() }
  for (const file of files) {
    const parts = file.path.split('/')
    let node = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path, children: new Map() })
      }
      node = node.children.get(part)!
      if (i === parts.length - 1) node.file = file
    })
  }
  return root
}

function DirRow({
  node, depth, selected, onSelect, statusByPath,
}: {
  node: TreeNode
  depth: number
  selected?: string
  onSelect: (f: TaskFile) => void
  statusByPath?: Record<string, string>
}) {
  // Collapse deep noise (e.g. node_modules, jobs, data, .git) by default.
  const [open, setOpen] = useState(!/^(node_modules|\.git|jobs|data|__pycache__|dist)$/i.test(node.name))
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: 8 + depth * 14 }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm font-medium text-zinc-400 hover:bg-ink-800/60 hover:text-zinc-200"
      >
        <span className="w-3 shrink-0 text-center font-mono text-[10px] text-zinc-500">{open ? '▾' : '▸'}</span>
        <span className="truncate">{node.name}</span>
      </button>
      {open && <Node node={node} depth={depth + 1} selected={selected} onSelect={onSelect} statusByPath={statusByPath} />}
    </li>
  )
}

// GitHub-style status coloring for the agent view. The row carries a tinted
// background, the rightmost badge shows A / M / T / D, and the file name picks
// up the matching foreground colour. `env` is left at the default zinc.
const STATUS_ROW: Record<string, string> = {
  env: '',
  created: 'bg-emerald-500/10 hover:bg-emerald-500/15',
  modified: 'bg-amber-500/10 hover:bg-amber-500/15',
  touched: 'bg-sky-500/10 hover:bg-sky-500/15',
  deleted: 'bg-rose-500/10 hover:bg-rose-500/15 line-through',
}
const STATUS_TEXT: Record<string, string> = {
  env: '',
  created: 'text-emerald-300',
  modified: 'text-amber-300',
  touched: 'text-sky-300',
  deleted: 'text-rose-300',
}
const STATUS_BADGE_LETTER: Record<string, string> = {
  env: '',
  created: 'A',
  modified: 'M',
  touched: 'T',
  deleted: 'D',
}
const STATUS_BADGE_CLS: Record<string, string> = {
  env: '',
  created: 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-500/40',
  modified: 'bg-amber-500/25 text-amber-200 ring-1 ring-amber-500/40',
  touched: 'bg-sky-500/25 text-sky-200 ring-1 ring-sky-500/40',
  deleted: 'bg-rose-500/25 text-rose-200 ring-1 ring-rose-500/40',
}

function Node({
  node,
  depth,
  selected,
  onSelect,
  statusByPath,
}: {
  node: TreeNode
  depth: number
  selected?: string
  onSelect: (f: TaskFile) => void
  statusByPath?: Record<string, string>
}) {
  const entries = [...node.children.values()].sort((a, b) => {
    const aDir = a.children.size > 0 ? 0 : 1
    const bDir = b.children.size > 0 ? 0 : 1
    return aDir - bDir || a.name.localeCompare(b.name)
  })
  return (
    <ul>
      {entries.map((child) =>
        child.children.size > 0 ? (
          <DirRow key={child.path} node={child} depth={depth} selected={selected} onSelect={onSelect} statusByPath={statusByPath} />
        ) : (
          (() => {
            const status = child.file && statusByPath?.[child.file.path]
            const isSelected = child.file && child.file.path === selected
            return (
              <li key={child.path}>
                <button
                  type="button"
                  onClick={() => child.file && onSelect(child.file)}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-ink-800',
                    status ? STATUS_ROW[status] : '',
                    isSelected && 'bg-accent/15 text-white ring-1 ring-accent/40',
                    !isSelected && (status ? STATUS_TEXT[status] : 'text-zinc-300'),
                  )}
                >
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-zinc-500">
                    {child.file ? KIND_ICON[child.file.kind] : ''}
                  </span>
                  <span className="truncate">{child.name}</span>
                  {status && status !== 'env' && (
                    <span className={clsx('ml-auto inline-grid h-4 w-4 shrink-0 place-items-center rounded font-mono text-[10px] font-bold', STATUS_BADGE_CLS[status])}>
                      {STATUS_BADGE_LETTER[status]}
                    </span>
                  )}
                </button>
              </li>
            )
          })()
        ),
      )}
    </ul>
  )
}

export default function FileTree({
  files,
  selected,
  onSelect,
  statusByPath,
}: {
  files: TaskFile[]
  selected?: string
  onSelect: (f: TaskFile) => void
  statusByPath?: Record<string, string>
}) {
  const tree = buildTree(files)
  return (
    <div className="py-1">
      <Node node={tree} depth={0} selected={selected} onSelect={onSelect} statusByPath={statusByPath} />
    </div>
  )
}
