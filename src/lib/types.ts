// ---------------------------------------------------------------------------
// Normalized domain types. Produced by scripts/ingest.py from real vendor data
// (ATIF trajectories, Harbor task dirs, OpenAI-messages rollouts) into public/dataset.json.
// ---------------------------------------------------------------------------

export type RunFormat = 'atif' | 'snorkel' | 'harbor' | 'fleet'
export type RunStatus = 'passed' | 'failed' | 'partial' | 'error' | 'completed'
export type StepRole = 'user' | 'agent' | 'assistant' | 'system' | 'tool'

export interface Vendor {
  id: string
  name: string
  /** What slices of the vendor's source data are included vs deliberately skipped. */
  coverage?: string
}

export interface Agent {
  id: string
  /** Agent harness / scaffold, e.g. "Claude Code", "Codex CLI", "OpenHands". null if not reported. */
  harness: string | null
  /** Underlying model, e.g. "claude-opus-4-7". null if not reported. */
  model: string | null
  /** Model family: "Anthropic" | "OpenAI" | "Google" | "unknown". */
  family: string
  vendorId: string
}

export type FileKind =
  | 'code' | 'markdown' | 'json' | 'image' | 'html'
  | 'spreadsheet' | 'text' | 'pdf' | 'diff'

export interface TaskFile {
  path: string
  kind: FileKind
  content?: string
  language?: string
  note?: string
}

export interface Task {
  id: string
  vendorId: string
  title: string
  source: RunFormat
  category: string
  difficulty: string
  instruction?: string
  files: TaskFile[]
  metadata?: Record<string, unknown>
  /** Optional access tier — forks that add auth can use this to gate UI;
   *  the public build ignores it and renders everything as 'example'. */
  tier?: 'sample' | 'example'
}

export interface ToolCall {
  name: string
  args?: string
}

/** Structured environment edit used to reconstruct the visual artifact stage. */
export type Edit =
  | { t: 'sheet'; target?: string; sheet: string; anchor: string; cells: string[][] }
  | { t: 'formula'; target?: string; sheet: string; formulas: { c: string; f: string }[] }
  | { t: 'doc'; target?: string; op: 'heading' | 'para'; text: string; level?: number | null }
  | { t: 'web'; url?: string; content?: string | null }
  | { t: 'computer'; action?: string; coord?: [number, number] | null; text?: string | null }
  | { t: 'screenshot'; url: string }
  | { t: 'answer'; content: string }

/** A state-changing action an agent took (file write, commit, sheet edit, …). */
export interface Mutation {
  kind: 'file' | 'spreadsheet' | 'document' | 'git' | 'command' | 'answer' | 'other'
  tool: string
  target?: string
  summary: string
  detail?: string
}

export interface Step {
  index: number
  role: StepRole
  text?: string | null
  reasoning?: string | null
  toolCalls?: ToolCall[] | null
  observation?: string | null
  toolName?: string | null
  tokens?: { prompt?: number; completion?: number } | null
  timestamp?: string | null
  /** Elapsed seconds from the run's first step (when real timestamps exist). */
  tSec?: number | null
  mutations?: Mutation[] | null
  edits?: Edit[] | null
}

export interface GradeSubscore {
  label: string
  score: number
}

export interface GradeFinding {
  category: string
  severity: 'critical' | 'major' | 'minor'
  summary: string
  detail: string
}

export interface Grade {
  score?: number | null
  maxScore?: number | null
  subscores: GradeSubscore[]
  summary?: string | null
  gate?: Record<string, boolean | null>
  breakdown?: Record<string, string> | null
  findings?: GradeFinding[] | null
}

export interface Run {
  id: string
  taskId: string
  agentId: string
  vendorId: string
  format: RunFormat
  status: RunStatus
  passed: boolean
  reward: number | null
  /** Trajectory steps. Empty in the baked dataset for runs whose steps are
   *  externalized to public/runs/<id>.json and lazy-loaded on demand (see
   *  loadRunSteps / useRunSteps); always inline for uploaded & tour runs. */
  steps: Step[]
  /** Step count, even for metric-only runs that ship no trajectory, and for
   *  lazy runs whose `steps` array is empty until fetched. */
  stepCount: number
  /** Precomputed at ingest (steps with role "user" > 1) so listing pages can
   *  flag simulated-user conversations without loading the trajectory. */
  multiUser?: boolean
  /** Whether public/runs/<id>.json carries the verifier log (test-stdout.txt),
   *  lazy-loaded with the trajectory and shown in the Reward & Verifier panel. */
  hasVerifierLog?: boolean
  turns: number
  durationSec: number | null
  /** Distinct artifacts the run touched (derived from step mutations). */
  artifacts?: string[]
  tokens?: {
    prompt?: number
    completion?: number
    cached?: number
    costUsd?: number
  } | null
  grade?: Grade | null
  failureReason?: string | null
}

/** Curated 1–2 entries per vendor, baked at ingest time, so the Showcase page
 *  can act as a selection-easy launcher. `runId` may be null for vendors that
 *  ship task definitions only. */
export interface ShowcasePick {
  vendorId: string
  taskId: string
  runId: string | null
  taskTitle: string
  passed: boolean | null
  reward: number | null
  stepCount: number
  source: RunFormat
  why: string
}

export interface Dataset {
  generatedAt: string
  vendors: Vendor[]
  agents: Agent[]
  tasks: Task[]
  runs: Run[]
  showcase?: ShowcasePick[]
}

// --- aggregate metrics -----------------------------------------------------

export interface Stat {
  avg: number
  min: number
  max: number
  count: number
}

export interface AgentMetrics {
  agent: Agent
  vendor?: Vendor
  runs: number
  scored: number
  passRate: number
  bestReward: number | null
  worstReward: number | null
  reward: Stat
  steps: Stat
  turns: Stat
  durationSec: Stat
}

// --- human review labels (client-side) -------------------------------------

export type LabelDecision = 'correct' | 'incorrect' | 'unsure'

export interface HumanLabel {
  stepIndex: number
  decision: LabelDecision
  note: string
  author: string
  createdAt: string
}
