import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import {
  LayoutDashboard, Rocket, FolderTree, Upload as UploadIcon, Sparkles,
  PlayCircle, ScanSearch, MousePointerClick, type LucideIcon,
} from 'lucide-react'
import { PageHeader } from '../components/Layout'
import { useDataset } from '../lib/dataset'
import { startTour, buildTourSteps } from '../lib/tour'

interface Step {
  title: string
  body: string
  highlight: string | null // sidebar key to circle, or null
  Icon: LucideIcon
  to?: string
  toLabel?: string
}

const STEPS: Step[] = [
  {
    title: 'Welcome to the ATIF Trajectory Viewer',
    body: 'Inspect agent task directories and trajectories, compare harnesses & models per vendor, watch a run play back like a film, and diagnose failures with the Agent Failure Taxonomy (AFT). This 6-step tour shows where everything lives — use Next / Back, or skip anytime.',
    highlight: null, Icon: Rocket,
  },
  {
    title: '1 · Overview — per-vendor leaderboards',
    body: 'Each vendor ranks its models (the agent harness — Claude Code / Codex / OpenHands — is shown separately from the model). Pass rate, reward, steps, and duration are reported as average (min–max).',
    highlight: 'overview', Icon: LayoutDashboard, to: '/overview', toLabel: 'Open Overview',
  },
  {
    title: '2 · Tasks — browse by vendor, spot features',
    body: 'Tasks are grouped vendor → environment/category. Every card carries badges for what it supports — spreadsheet, web, screenshots, document, conversation, Dockerfile environment, AFT, verifier log, and more. Open a task to see its directory, environment, and runs.',
    highlight: 'tasks', Icon: FolderTree, to: '/tasks', toLabel: 'Open Tasks',
  },
  {
    title: '3 · Trajectory viewer — play the run',
    body: 'Open any run and press ▶ Play. Watch the step timeline, the live environment stage (spreadsheet grid, web page, computer-use screenshots), and the IDE (terminal + clickable files, with a foldable Human ⇄ Agent filesystem). The left and right panels are resizable and collapsible.',
    highlight: 'showcase', Icon: PlayCircle, to: '/showcase', toLabel: 'Pick an example',
  },
  {
    title: '4 · Reward, Verifier log & AFT analysis',
    body: 'In a run, the right rail has Reward & Verifier log (score + foldable log), Changes (every state-changing step), and AFT — a model-driven failure audit with A×B×C×D codes, clickable failure steps, and your own agree/disagree notes. Many runs are pre-analyzed (✦) so it shows instantly.',
    highlight: 'showcase', Icon: ScanSearch, to: '/showcase', toLabel: 'See an analyzed run',
  },
  {
    title: '5 · Upload your own Harbor tasks',
    body: 'Drag a Harbor zip (multiple tasks, each with a jobs/ folder of trials) and it’s parsed in your browser — task directory, environment, and trajectories. A sample zip is provided on the page.',
    highlight: 'upload', Icon: UploadIcon, to: '/upload', toLabel: 'Open Upload',
  },
  {
    title: '6 · Explore the Feature showcase',
    body: 'A handful of curated examples each demonstrate several features at once — the shortest path to see (or record) everything the platform does.',
    highlight: 'showcase', Icon: Sparkles, to: '/showcase', toLabel: 'Open Feature showcase',
  },
]

export default function QuickStart() {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const last = i === STEPS.length - 1
  const navigate = useNavigate()
  const data = useDataset()
  const launchTour = () => {
    if (!data) return // ensures the dataset (and the synthetic tour task) is loaded
    startTour(buildTourSteps(), navigate)
  }
  // One-time auto-launch on first visit, so reviewers always discover the tour.
  const AUTO_KEY = 'tv-tour-autostarted'
  useEffect(() => {
    if (!data || localStorage.getItem(AUTO_KEY)) return
    localStorage.setItem(AUTO_KEY, '1')
    const t = setTimeout(() => startTour(buildTourSteps(), navigate), 700)
    return () => clearTimeout(t)
  }, [data, navigate])

  return (
    <>
      <PageHeader title="Quick start" subtitle={`Guided tour · step ${i + 1} of ${STEPS.length}`} />
      <div className="p-8">
        <div className="mx-auto mb-6 flex max-w-2xl items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/10 p-5">
          <div className="flex items-center gap-3">
            <MousePointerClick size={26} className="shrink-0 text-accent" />
            <div>
              <div className="text-base font-semibold text-white">Interactive walkthrough</div>
              <div className="text-sm text-zinc-400">Dims the page and circles each component on a real task &amp; trajectory — click Next to step through.</div>
            </div>
          </div>
          <button onClick={launchTour} disabled={!data} className="btn-primary shrink-0 px-4 py-2 text-base disabled:opacity-50">▶ Start tour</button>
        </div>
        <div className="mx-auto max-w-2xl">
          {/* step card */}
          <div className="card flex flex-col p-7">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-accent/15 text-accent"><step.Icon size={22} /></span>
              <h2 className="text-xl font-semibold text-white">{step.title}</h2>
            </div>
            <p className="mt-4 text-base leading-relaxed text-zinc-300">{step.body}</p>
            {step.to && (
              <Link to={step.to} className="btn-primary mt-5 w-fit text-base">{step.toLabel} →</Link>
            )}

            {/* progress dots */}
            <div className="mt-7 flex items-center gap-1.5">
              {STEPS.map((_, k) => (
                <button key={k} onClick={() => setI(k)}
                  className={clsx('h-1.5 rounded-full transition-all', k === i ? 'w-6 bg-accent' : 'w-1.5 bg-ink-700 hover:bg-ink-600')} />
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}
                className="btn-ghost border border-line disabled:opacity-30">← Back</button>
              {last ? (
                <Link to="/showcase" className="btn-primary">Finish — go to showcase →</Link>
              ) : (
                <button onClick={() => setI((x) => Math.min(STEPS.length - 1, x + 1))} className="btn-primary">Next →</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
