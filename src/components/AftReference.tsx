import { useEffect, useState } from 'react'
import clsx from 'clsx'

const HUMAN_URL = 'https://harbor-index.vercel.app/aft/'
const MACHINE_URL = 'https://harbor-index.vercel.app/aft/?view=machine'

/** Slide-over showing where the AFT taxonomy comes from + the full prompt. */
export default function AftReference({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'intro' | 'prompt'>('intro')
  const [prompt, setPrompt] = useState<string>('')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}aft-prompt.md`).then((r) => r.text()).then(setPrompt).catch(() => setPrompt('(failed to load)'))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-ink-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3">
          <h2 className="font-semibold text-white">Agent Failure Taxonomy (AFT v1.0)</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">✕</button>
        </div>
        <div className="flex border-b border-ink-700">
          <Tab active={tab === 'intro'} onClick={() => setTab('intro')}>(Introduction)</Tab>
          <Tab active={tab === 'prompt'} onClick={() => setTab('prompt')}>(AFT prompts)</Tab>
          <a href={tab === 'intro' ? HUMAN_URL : MACHINE_URL} target="_blank" rel="noreferrer" className="ml-auto px-4 py-2.5 text-xs text-accent hover:underline">
            open source page ↗
          </a>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-5 text-sm leading-relaxed text-zinc-300">
          {tab === 'intro' ? (
            <div className="space-y-3">
              <p>
                <strong className="text-white">AFT</strong> describes each agent failure with four
                orthogonal facets — <strong>A</strong> stage (when), <strong>B</strong> root cause (why),
                <strong> C</strong> behavior (what), <strong>D</strong> impact (how bad). One failure ={' '}
                <code className="rounded bg-ink-800 px-1 font-mono text-accent">A × B × C × D</code>.
              </p>
              <ul className="ml-5 list-disc space-y-1 text-zinc-400">
                <li><strong className="text-zinc-200">A1–A6</strong> — understanding → locating → executing → verifying → iterating → terminating.</li>
                <li><strong className="text-zinc-200">B1–B5</strong> — reasoning defect, knowledge gap, context-management, tool/env, spec non-compliance (B6 multi-agent only).</li>
                <li><strong className="text-zinc-200">C1–C8</strong> — 34 concrete behaviors (spec deviation, reasoning errors, locating, code/patch defects, context/state, execution-control, validation, tool/env).</li>
                <li><strong className="text-zinc-200">D1–D5</strong> — recoverable-mild → moderate → unrecoverable → cascading → silent.</li>
              </ul>
              <p className="text-zinc-400">
                "Apply AFT analysis" sends this trajectory plus the taxonomy prompt to your chosen model and
                returns a structured audit: a closeness verdict, the step where the trial was lost, and 1–3
                failure modes — each with an A×B×C×D tuple, a verbatim evidence quote, the implicated steps,
                and a counterfactual fix.
              </p>
              <p className="text-xs text-zinc-500">
                Source: Harbor Index — human view{' '}
                <a href={HUMAN_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">{HUMAN_URL}</a>,
                {' '}machine view{' '}
                <a href={MACHINE_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">{MACHINE_URL}</a>.
              </p>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-[12px] text-zinc-300">{prompt}</pre>
          )}
        </div>
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={clsx('px-4 py-2.5 text-sm font-medium', active ? 'border-b-2 border-accent text-white' : 'text-zinc-500 hover:text-zinc-300')}>
      {children}
    </button>
  )
}
