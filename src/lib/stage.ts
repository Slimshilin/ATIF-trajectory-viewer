import type { Edit, Step, TaskFile } from './types'

// ---------------------------------------------------------------------------
// Reconstruct the agent's environment "stage" up to a given step, so the
// trajectory can be played back like a film with a live artifact view.
// ---------------------------------------------------------------------------

export interface Cell {
  value: string
  formula?: string
  /** step index at which this cell last changed */
  step: number
}

export interface SheetState {
  key: string
  name: string
  target?: string
  cells: Map<string, Cell> // "A1" -> Cell
  maxRow: number
  maxCol: number // 0-based
}

export interface DocState {
  key: string
  name: string
  blocks: { op: 'heading' | 'para'; text: string; level?: number | null; step: number }[]
}

export interface WebState {
  url?: string
  content?: string | null
  step: number
}

export interface ComputerState {
  action?: string
  coord?: [number, number] | null
  text?: string | null
  step: number
  /** recent cursor positions for a motion trail */
  trail: [number, number][]
}

export interface ScreenshotState {
  url: string
  step: number
  count: number
}

export interface AnswerState {
  content: string
  step: number
}

export interface Stage {
  sheets: SheetState[]
  docs: DocState[]
  web?: WebState
  computer?: ComputerState
  screenshot?: ScreenshotState
  answer?: AnswerState
  /** artifact kinds that were touched exactly at the active step */
  changedAt: Set<string>
  hasVisual: boolean
}

// --- workspace (IDE + terminal + conversation) -----------------------------

export interface TermEntry {
  step: number
  tool: string
  isBash: boolean
  command: string // "$ ls" for bash, "tool(args)" otherwise
  output?: string
}

export interface FileEntry {
  path: string
  content?: string
  step: number
  op: string // view | create | edit | touched
}

export interface Msg {
  step: number
  role: string
  content: string
  tool?: string
}

export interface Workspace {
  terminal: TermEntry[]
  files: FileEntry[]
  conversation: Msg[]
  userTurns: number
}

const BASH_RE = /(^|_)(bash|shell|terminal|run_command|run_shell_command|exec|execute)(_|$)/i
// Editing tools — match common harness names across Claude Code, Codex, OpenHands.
// Includes both snake_case (write_file, replace_file) and the capitalized
// single-word forms (Write, Edit, Replace) that Claude Code emits.
const EDIT_RE = /(^|_)(edit|write|replace|str_replace|write_file|create_file|edit_file|replace_file|apply_patch|insert)(_|$)/i

/**
 * Parse a shell command and infer file-system mutations from it.
 *
 * Recognises (best-effort, single-statement-aware):
 *   - heredoc writes:  cat >  path << 'EOF' ... EOF       (also <<EOF, <<"EOF", <<-EOF, with tab dedent)
 *   - heredoc appends: cat >> path << EOF ... EOF
 *   - echo writes:     echo "..."  >  path     (also  >>  for append)
 *   - printf writes:   printf "..." >  path
 *   - tee writes:      ... | tee [-a] path...
 *   - cp / mv / rm / mkdir
 *   - sed -i edits:    sed -i 's/.../.../[g]' path   (modify only — content unknown)
 *
 * Returns a list of {path, op, content?} the caller folds into the agent FS.
 * `op` ∈ 'create' | 'edit' | 'append' | 'delete' | 'mkdir' | 'touched'.
 */
export interface ShellWrite {
  path: string
  op: 'create' | 'edit' | 'append' | 'delete' | 'mkdir' | 'touched'
  content?: string
}

export function parseShellWrites(command: string): ShellWrite[] {
  if (!command) return []
  const out: ShellWrite[] = []
  // Split on common separators that bound statements. This isn't a real shell
  // parser, but it keeps `cat << EOF\n...\nEOF` together (newlines inside the
  // body don't trip a separator unless followed by another statement keyword).
  const stmts = splitShellStatements(command)
  for (const stmt of stmts) {
    const s = stmt.trim()
    if (!s) continue

    // --- heredocs: cat > path << [-]?['"]?TAG['"]? ... TAG ---
    const hd = s.match(/^(?:\w+\s+)*?(?:cat|tee)\s+(>>?)\s*(\S+)\s*<<\s*(-?)\s*(['"]?)(\w+)\4\s*\n([\s\S]*?)\n\5\s*$/)
    if (hd) {
      const append = hd[1] === '>>'
      const path = stripQuotes(hd[2])
      const dedent = hd[3] === '-' // <<- strips leading tabs
      let body = hd[6]
      if (dedent) body = body.split('\n').map((l) => l.replace(/^\t+/, '')).join('\n')
      out.push({ path, op: append ? 'append' : 'create', content: body })
      continue
    }

    // --- echo / printf "…" > path (or >>) ---
    const ep = s.match(/^(echo|printf)(?:\s+-\w+)?\s+(.+?)\s*(>>?)\s*(\S+)\s*$/)
    if (ep) {
      const append = ep[3] === '>>'
      const path = stripQuotes(ep[4])
      let body = stripQuotes(ep[2].trim())
      if (ep[1] === 'echo') body = body + '\n'
      else body = body.replace(/\\n/g, '\n') // printf interprets \n
      out.push({ path, op: append ? 'append' : 'create', content: body })
      continue
    }

    // --- pipeline | tee [-a] path1 path2 (content unknown, mark as touched) ---
    const tee = s.match(/\|\s*tee(\s+-a)?\s+(\S.*)$/)
    if (tee) {
      const append = !!tee[1]
      for (const p of tee[2].split(/\s+/).filter(Boolean)) {
        out.push({ path: stripQuotes(p), op: append ? 'append' : 'create' })
      }
      continue
    }

    // --- cp src dst   /   cp -r src dst ---
    const cp = s.match(/^cp(?:\s+-\w+)*\s+(\S+)\s+(\S+)\s*$/)
    if (cp) {
      out.push({ path: stripQuotes(cp[2]), op: 'create' })
      continue
    }

    // --- mv src dst ---
    const mv = s.match(/^mv(?:\s+-\w+)*\s+(\S+)\s+(\S+)\s*$/)
    if (mv) {
      out.push({ path: stripQuotes(mv[1]), op: 'delete' })
      out.push({ path: stripQuotes(mv[2]), op: 'create' })
      continue
    }

    // --- rm path...  /  rm -rf path... ---
    const rm = s.match(/^rm(?:\s+-\w+)*\s+(\S.*)$/)
    if (rm) {
      for (const p of rm[1].split(/\s+/).filter(Boolean)) {
        out.push({ path: stripQuotes(p), op: 'delete' })
      }
      continue
    }

    // --- mkdir / mkdir -p path... ---
    const mk = s.match(/^mkdir(?:\s+-\w+)*\s+(\S.*)$/)
    if (mk) {
      for (const p of mk[1].split(/\s+/).filter(Boolean)) {
        out.push({ path: stripQuotes(p), op: 'mkdir' })
      }
      continue
    }

    // --- sed -i ... path  (modify) ---
    const sed = s.match(/^sed\s+(-i(?:\.\w+)?)\s+.*?\s+(\S+)\s*$/)
    if (sed) {
      out.push({ path: stripQuotes(sed[2]), op: 'edit' })
      continue
    }

    // --- generic redirect:   <anything> > path  (content unknown) ---
    const redirect = s.match(/(>>?)\s*(\S+)\s*$/)
    if (redirect) {
      out.push({ path: stripQuotes(redirect[2]), op: redirect[1] === '>>' ? 'append' : 'create' })
      continue
    }
  }
  return out
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1)
  }
  return s
}

/**
 * Naively split a shell command into statements while keeping heredoc bodies
 * intact. We delimit on `&&`, `||`, `;`, or a bare newline that is *not* inside
 * a recognised heredoc.
 */
function splitShellStatements(cmd: string): string[] {
  const out: string[] = []
  let i = 0
  const n = cmd.length
  let buf = ''
  while (i < n) {
    // detect heredoc opener: `<< [-]? ['"]? TAG ['"]?`
    const hdMatch = cmd.slice(i).match(/^<<\s*(-?)\s*(['"]?)(\w+)\2/)
    if (hdMatch) {
      const tag = hdMatch[3]
      // consume up to and including the closing tag on its own line
      const re = new RegExp(`\\n${tag}(\\s|$)`)
      buf += cmd.slice(i, i + hdMatch[0].length)
      i += hdMatch[0].length
      const rest = cmd.slice(i)
      const m = rest.match(re)
      if (m) {
        const end = m.index! + m[0].length
        buf += rest.slice(0, end)
        i += end
      } else {
        buf += rest
        i = n
      }
      continue
    }
    const ch = cmd[i]
    if (ch === '\n' || ch === ';') {
      if (buf.trim()) out.push(buf)
      buf = ''
      i++
      continue
    }
    if ((ch === '&' && cmd[i + 1] === '&') || (ch === '|' && cmd[i + 1] === '|')) {
      if (buf.trim()) out.push(buf)
      buf = ''
      i += 2
      continue
    }
    buf += ch
    i++
  }
  if (buf.trim()) out.push(buf)
  return out
}

function cleanOutput(s?: string | null): string | undefined {
  if (!s) return undefined
  const t = s.trim()
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t)
      if (typeof o.output === 'string') return o.output
      if (typeof o.result === 'string') return o.result
    } catch {
      /* ignore */
    }
  }
  return s
}

function shortArgs(args?: string): string {
  if (!args) return ''
  try {
    const o = JSON.parse(args)
    return Object.entries(o)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ')
      .slice(0, 120)
  } catch {
    return args.slice(0, 120)
  }
}

export function reconstructWorkspace(steps: Step[], upto: number, seedFiles: TaskFile[] = []): Workspace {
  const terminal: TermEntry[] = []
  const files = new Map<string, FileEntry>()
  const conversation: Msg[] = []
  let userTurns = 0
  const pending: TermEntry[] = [] // entries awaiting an output (messages format)
  const viewLinks: { path: string; entry: TermEntry; step: number }[] = []

  // Seed the file system with the initial environment files (from the task
  // directory / Dockerfile COPY), so the explorer reflects what the agent sees
  // at step 0. Agent edits below override these.
  for (const f of seedFiles) {
    if (f.kind === 'image' || f.kind === 'pdf' || f.kind === 'spreadsheet') continue
    files.set(f.path, { path: f.path, op: 'env', step: -1, content: f.content })
  }

  const assignContent = (path: string, op: string, content: string | undefined, step: number) => {
    const prev = files.get(path)
    files.set(path, { path, op, step, content: content ?? prev?.content })
  }

  for (let i = 0; i <= upto && i < steps.length; i++) {
    const s = steps[i]

    // conversation
    if (s.role === 'user') userTurns++
    if ((s.role === 'user' || s.role === 'assistant' || s.role === 'agent') && (s.text || s.toolCalls?.length)) {
      conversation.push({
        step: i,
        role: s.role,
        content: s.text || (s.toolCalls?.length ? `→ called ${s.toolCalls.map((t) => t.name).join(', ')}` : ''),
        tool: s.toolCalls?.[0]?.name,
      })
    }

    // tool result step (messages format): fill the oldest pending command
    if (s.role === 'tool' && s.observation) {
      const target = pending.shift()
      if (target) target.output = cleanOutput(s.observation)
    }

    // tool calls in this step
    for (const tc of s.toolCalls ?? []) {
      const isBash = BASH_RE.test(tc.name)
      const argObj = safeParse(tc.args)
      const rawCmd = (argObj?.command ?? argObj?.cmd ?? argObj?.input ?? '') as string
      const entry: TermEntry = {
        step: i,
        tool: tc.name,
        isBash,
        command: isBash ? `$ ${rawCmd || shortArgs(tc.args)}` : `${tc.name}(${shortArgs(tc.args)})`,
        output: cleanOutput(s.observation) || undefined, // ATIF: same-step observation
      }
      terminal.push(entry)
      if (!entry.output) pending.push(entry)

      // file edits — explicit editor tools.
      // Supported shapes across harnesses:
      //   Claude Code `Write`        { file_path, content }                     → create with full content
      //   Claude Code `Edit`         { file_path, old_string, new_string }      → in-place substitution
      //   Codex      `write_file`    { file_path, content }                     → create with full content
      //   Codex      `replace_file`  { file_path, old_content, new_content }    → in-place substitution
      //   Codex      `apply_patch`   { input: "*** Patch …" }                   → unified-diff patch
      //   OpenHands  `str_replace`   { path, new_str, old_str }                 → substitution
      if (EDIT_RE.test(tc.name) && argObj) {
        const path = argObj.path || argObj.filepath || argObj.file_path || argObj.filename
        if (path) {
          // Full-content overwrite (Write / write_file / create_file).
          const fullContent = argObj.file_text ?? argObj.content ?? argObj.text
          // Substitution shape (Edit / replace_file / str_replace).
          const oldStr = argObj.old_string ?? argObj.old_str ?? argObj.old_content ?? argObj.search
          const newStr = argObj.new_string ?? argObj.new_str ?? argObj.new_content ?? argObj.replace
          let content: string | undefined = fullContent ?? undefined
          let op: string = argObj.command || (fullContent ? 'create' : 'edit')
          if (content == null && newStr != null) {
            const prev = files.get(String(path))?.content
            if (prev != null && oldStr != null) {
              content = prev.includes(String(oldStr)) ? prev.replace(String(oldStr), String(newStr)) : prev + '\n' + String(newStr)
            } else {
              // No prior content tracked — render the substitution itself so the
              // user at least sees what the agent wrote. Marked clearly.
              content = oldStr != null
                ? `// […prior content not captured…]\n// substitute: ${oldStr}\n// with:\n${newStr}`
                : String(newStr)
            }
            op = 'edit'
          }
          if (content != null) assignContent(String(path), op, content, i)
          else assignContent(String(path), op, undefined, i)
          // `view` / read tools return content as the tool output — link it
          if (content == null) viewLinks.push({ path: String(path), entry, step: i })
        }
      } else if (isBash && rawCmd) {
        // Shell-based writes: parse the command and apply its filesystem effect.
        // This covers heredocs (cat >> file << EOF), echo / printf redirects,
        // tee, cp / mv / rm / mkdir, sed -i — i.e. how agents actually write
        // files in TB-style terminal-only environments.
        const writes = parseShellWrites(String(rawCmd))
        for (const w of writes) {
          if (w.op === 'delete') {
            files.delete(w.path)
          } else if (w.op === 'append') {
            const prev = files.get(w.path)
            const merged = (prev?.content ?? '') + (w.content ?? '')
            assignContent(w.path, 'edit', w.content !== undefined ? merged : undefined, i)
          } else if (w.op === 'mkdir') {
            // Track the directory placeholder so it appears in the tree.
            const dir = w.path.endsWith('/') ? w.path : w.path + '/'
            if (!files.has(dir)) files.set(dir, { path: dir, op: 'mkdir', step: i })
          } else {
            // 'create' | 'edit' | 'touched'
            assignContent(w.path, w.op, w.content, i)
          }
        }
      } else if (argObj) {
        const path = argObj.path || argObj.filepath || argObj.file_path || argObj.filename
        if (path && /\.\w+$/.test(String(path))) assignContent(String(path), 'touched', undefined, i)
      }
    }
  }

  // fold in file contents returned by `edit view` (output known after pairing)
  for (const v of viewLinks) {
    if (v.entry.output) assignContent(v.path, 'view', stripViewHeader(v.entry.output), v.step)
  }

  return { terminal, files: [...files.values()], conversation, userTurns }
}

function stripViewHeader(s: string): string {
  return s.replace(/^Here's the content of [^\n]+\n/, '')
}

function safeParse(s?: string): any {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// --- A1 helpers ------------------------------------------------------------

export function colToNum(col: string): number {
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1 // 0-based
}

export function numToCol(n: number): string {
  let s = ''
  n += 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  return { col: colToNum(m[1].toUpperCase()), row: parseInt(m[2], 10) - 1 }
}

// --- reconstruction --------------------------------------------------------

export function reconstructStage(steps: Step[], upto: number): Stage {
  const sheets = new Map<string, SheetState>()
  const docs = new Map<string, DocState>()
  let web: WebState | undefined
  let computer: ComputerState | undefined
  let screenshot: ScreenshotState | undefined
  let answer: AnswerState | undefined
  const changedAt = new Set<string>()

  const getSheet = (target: string | undefined, name: string): SheetState => {
    const key = `${target ?? ''}::${name}`
    let s = sheets.get(key)
    if (!s) {
      s = { key, name, target, cells: new Map(), maxRow: 0, maxCol: 0 }
      sheets.set(key, s)
    }
    return s
  }

  for (let i = 0; i <= upto && i < steps.length; i++) {
    const edits = steps[i].edits as Edit[] | undefined | null
    if (!edits) continue
    const isActive = i === upto
    for (const e of edits) {
      if (e.t === 'sheet') {
        const s = getSheet(e.target, e.sheet)
        const start = parseRef(e.anchor) ?? { col: 0, row: 0 }
        e.cells.forEach((row, ri) => {
          row.forEach((val, ci) => {
            const r = start.row + ri
            const c = start.col + ci
            if (val === '' ) return
            const ref = numToCol(c) + (r + 1)
            s.cells.set(ref, { value: val, step: i })
            s.maxRow = Math.max(s.maxRow, r)
            s.maxCol = Math.max(s.maxCol, c)
          })
        })
        if (isActive) changedAt.add('sheet:' + s.key)
      } else if (e.t === 'formula') {
        const s = getSheet(e.target, e.sheet)
        for (const f of e.formulas) {
          const ref = parseRef(f.c || '')
          if (!ref) continue
          const cellRef = numToCol(ref.col) + (ref.row + 1)
          s.cells.set(cellRef, { value: f.f, formula: f.f, step: i })
          s.maxRow = Math.max(s.maxRow, ref.row)
          s.maxCol = Math.max(s.maxCol, ref.col)
        }
        if (isActive) changedAt.add('sheet:' + s.key)
      } else if (e.t === 'doc') {
        const key = e.target ?? 'document'
        let d = docs.get(key)
        if (!d) {
          d = { key, name: (e.target ?? 'document').split('/').pop() ?? 'document', blocks: [] }
          docs.set(key, d)
        }
        d.blocks.push({ op: e.op, text: e.text, level: e.level, step: i })
        if (isActive) changedAt.add('doc:' + key)
      } else if (e.t === 'web') {
        web = { url: e.url, content: e.content, step: i }
        if (isActive) changedAt.add('web')
      } else if (e.t === 'computer') {
        const trail = computer?.trail ? [...computer.trail] : []
        if (e.coord) {
          trail.push(e.coord)
          if (trail.length > 6) trail.shift()
        }
        computer = { action: e.action, coord: e.coord, text: e.text, step: i, trail }
        if (isActive) changedAt.add('computer')
      } else if (e.t === 'screenshot') {
        screenshot = { url: e.url, step: i, count: (screenshot?.count ?? 0) + 1 }
        if (isActive) changedAt.add('computer')
      } else if (e.t === 'answer') {
        answer = { content: e.content, step: i }
        if (isActive) changedAt.add('answer')
      }
    }
  }

  const sheetArr = [...sheets.values()]
  const docArr = [...docs.values()]
  return {
    sheets: sheetArr,
    docs: docArr,
    web,
    computer,
    screenshot,
    answer,
    changedAt,
    hasVisual: sheetArr.length > 0 || docArr.length > 0 || !!web || !!computer || !!screenshot || !!answer,
  }
}
