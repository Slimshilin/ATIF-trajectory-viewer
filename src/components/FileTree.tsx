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

const STATUS_DOT: Record<string, string> = {
  env: 'bg-sky-400',
  created: 'bg-emerald-400',
  modified: 'bg-amber-400',
  touched: 'bg-zinc-500',
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
          <li key={child.path}>
            <button
              type="button"
              onClick={() => child.file && onSelect(child.file)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={clsx(
                'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-zinc-300 hover:bg-ink-800',
                child.file && child.file.path === selected && 'bg-accent/15 text-white ring-1 ring-accent/40',
              )}
            >
              <span className="w-4 shrink-0 text-center font-mono text-xs text-zinc-500">
                {child.file ? KIND_ICON[child.file.kind] : ''}
              </span>
              <span className="truncate">{child.name}</span>
              {child.file && statusByPath?.[child.file.path] && (
                <span className={clsx('ml-auto h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[statusByPath[child.file.path]] ?? 'bg-zinc-600')} />
              )}
            </button>
          </li>
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
