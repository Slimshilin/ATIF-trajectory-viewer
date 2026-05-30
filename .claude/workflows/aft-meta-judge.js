export const meta = {
  name: 'aft-meta-judge',
  description: 'Meta-judge AFT failure-mode labels for one trial: generate candidate labellings, adversarially verify, converge to a minimal-but-comprehensive final A×B×C×D labelling with kept/dropped rationale.',
  whenToUse: 'When you have a Harbor task + an agent-model trajectory and want a single adjudicated AFT failure-mode verdict (not a naive union of every judge pass). Pass args as a string "<task-name> <model> [trial-uuid]" or {task, model, trial}.',
  phases: [
    { title: 'Locate',     detail: 'resolve task+model→trial, load spec/trajectory/verifier + any pre-baked judge passes' },
    { title: 'Generate',   detail: 'N diverse judge agents each emit an independent AFT labelling' },
    { title: 'Consolidate',detail: 'cluster the candidate-mode pool into distinct canonical modes' },
    { title: 'Verify',     detail: 'one adversarial verifier per distinct mode: groundedness + code-correctness + redundancy' },
    { title: 'Adjudicate', detail: 'meta-judge converges to final labelling sequence with kept/dropped reasons' },
  ],
}

// --------------------------------------------------------------------------
// AFT meta-judge workflow.
//
// Input (`args`): a string "<task-name> <model> [trial-uuid-prefix]" OR an
// object { task, model, trial? }. The trajectory lives on disk under the repo;
// agents read it directly (the script has no filesystem access).
//
// Pipeline: Locate -> Generate (diverse judges) -> Consolidate (cluster) ->
// Verify (adversarial, per mode) -> Adjudicate (meta-judge synthesis).
// --------------------------------------------------------------------------

const REPO = '/home/shilin/Tencent/ATIF-trajectory-viewer'
const DATA = `${REPO}/data/harbor-annotate-bundle`
const AFT_DIR = `${REPO}/public/aft`
const RUBRIC = `${REPO}/public/aft-prompt.md`

const argStr = typeof args === 'string' ? args : ''
const argObj = (args && typeof args === 'object') ? args : {}
const INPUT = argStr || JSON.stringify(argObj)

// Shared taxonomy reminder so judges don't have to re-derive it (the full,
// authoritative rubric is in RUBRIC, which every agent is told to read).
const TAXONOMY = `
AFT v1.0 — one failure = A×B×C×D (emit BARE codes only, e.g. "A":"A3").
A (stage): A1 Understanding&planning, A2 Locating&exploring, A3 Executing&generating,
   A4 Verifying&testing, A5 Iterating&converging, A6 Terminating&delivering.
B (root cause): B1 Reasoning defect, B2 Knowledge gap, B3 Context-management,
   B4 Tool/environment, B5 Spec non-compliance, B6 (MULTI-AGENT — DO NOT USE).
C (behavior, pick MOST SPECIFIC subclass): C1.1/1.2/1.3 spec; C2.1 logical / C2.2
   reasoning-action mismatch / C2.3 hallucination / C2.4 problem misID / C2.5 blind
   switch; C3.1/3.2/3.3 locating; C4.1..C4.8 code/patch (C4.4 incomplete, C4.5 evasive,
   C4.6 overfit, C4.7 perf-regression, C4.8 dep-break); C5.1..5.4 context/state;
   C6.1 loop / C6.2 premature-termination / C6.3 task-drift / C6.4 non-monotonic /
   C6.5 non-convergence; C7.1 validation-missing / C7.2 validation-logic-error /
   C7.3 ignored-validation / C7.4 validation-skipped; C8.1 wrong-tool / C8.2 tool-format /
   C8.3 missing-dep / C8.4 tool-output-misread. C9 (MULTI-AGENT — DO NOT USE).
D (impact): D1 recoverable-mild, D2 recoverable-moderate, D3 unrecoverable(wrong final
   result), D4 cascading, D5 silent(shipped-wrong, no error signal).
Key adjudication rules: prefer ONE primary + at most one secondary (1-2 total); a third
only for a clearly distinct pattern. A6 only when the STOP DECISION is the locus — "declared
done and was wrong" alone is A3(bad gen) or A4(missed by verification), NOT A6. A4 = ran a
check and accepted wrong result; C6.2/C7.1 = didn't check / checked but insufficient. Default
B1 unless the agent demonstrably lacked knowledge (B2). Evidence quotes MUST be verbatim
substrings of the trajectory/verifier/spec. No hedging.`

const MODE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'description', 'evidence_quote', 'step_indices', 'aft', 'counterfactual'],
  properties: {
    name: { type: 'string', description: '2-6 word task-specific behavior label' },
    description: { type: 'string' },
    evidence_quote: { type: 'string', description: 'verbatim substring from trajectory/verifier/spec' },
    step_indices: { type: ['array', 'null'], items: { type: 'integer' } },
    aft: {
      type: 'object', additionalProperties: false, required: ['A', 'B', 'C', 'D'],
      properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
    },
    counterfactual: {
      type: ['object', 'null'], additionalProperties: false, required: ['single_step_fix', 'X', 'Y'],
      properties: { single_step_fix: { type: 'boolean' }, X: { type: 'string' }, Y: { type: 'string' } },
    },
  },
}

// ===========================================================================
phase('Locate')

const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['resolved', 'task_id', 'model', 'trial_uuid', 'job_dir', 'trajectory_path',
             'reward', 'performance', 'n_steps', 'closeness', 'task_summary',
             'what_verifier_checked', 'exact_failure_quote', 'trajectory_digest',
             'prebaked_report_path', 'existing_judgments'],
  properties: {
    resolved: { type: 'boolean', description: 'false if task/model could not be located' },
    task_id: { type: 'string' },
    model: { type: 'string' },
    trial_uuid: { type: 'string' },
    job_dir: { type: 'string', description: 'absolute path to the resolved job dir' },
    trajectory_path: { type: 'string', description: 'absolute path to agent/trajectory.json' },
    reward: { type: 'string' },
    performance: { type: 'integer', description: '1 if passed the leaderboard gate, else 0' },
    n_steps: { type: 'integer' },
    closeness: { type: 'string', enum: ['near-miss', 'partial', 'far', 'success'] },
    task_summary: { type: 'string', description: 'what the task required + how it was scored' },
    what_verifier_checked: { type: 'string' },
    exact_failure_quote: { type: 'string' },
    trajectory_digest: { type: 'string', description: 'step-by-step digest with step indices of the decisive moves' },
    prebaked_report_path: { type: ['string', 'null'] },
    existing_judgments: {
      type: 'array', description: 'candidate failure modes harvested from any pre-baked judge×round passes (empty if none)',
      items: MODE_SCHEMA,
    },
  },
}

const brief = await agent(
`You are the LOCATOR for an AFT meta-judge. Resolve and load one trial, exactly.

INPUT (task name + agent model, optionally a trial uuid prefix): ${JSON.stringify(INPUT)}

Steps:
1. Parse the input into a task name and an agent model (and optional trial uuid prefix).
   The task name matches a directory under ${DATA}/. List that dir's jobs:
   ls ${DATA}/<task>/jobs
2. For each job, the model is in <job>/config.json at agent.model_name. Pick the job whose
   model_name matches the requested model. If several match and a trial uuid prefix was given,
   use it. If several match and NO uuid was given, PREFER the job that has a pre-baked report
   (a file under ${AFT_DIR}/ whose name contains the job's uuid prefix); otherwise pick the
   lexicographically-first uuid and note the choice in task_summary.
3. Read these files for the chosen job:
   - ${DATA}/<task>/instruction.md         (what was required + scoring)
   - <job>/verifier/reward.txt             (reward)
   - <job>/verifier/test-stdout.txt        (the exact verifier failure; may be large — read enough to find the failing assertion)
   - <job>/result.json                     (agent_result / verifier_result / exception_info if present)
   - <job>/agent/trajectory.json           (the trajectory: a dict with a "steps" array). Read it; if huge, read in chunks. Steps are 0-indexed in this viewer.
4. Determine performance: reward>0 (or >= threshold for scored tasks) => 1 else 0. closeness per the rubric at ${RUBRIC} (read it).
5. Pre-baked judge passes (the "agent judgments" to be meta-judged). These are the RAW per-judge×round
   labels — the whole point of the meta-judge is to receive ALL of them, including the redundant and the
   weak, and let later phases prune. So you MUST collect every raw label; DO NOT summarize, dedupe, vote,
   or pick the "top" ones. Prefer the richest raw source available:
   (a) <job>/audits/*.report.json — the RAW per-judge×round audits (composer__r1..r5, gpt__r1..r5,
       opus__r1..r5). ls the dir and read EVERY *.report.json; each has a "failure_modes" array.
   (b) else ${AFT_DIR}/<file containing this uuid prefix> — if it has a "passes" array, flatten the
       failure_modes of EVERY pass (not the aggregated top-level "failure_modes"). Use the raw passes.
   existing_judgments MUST contain one entry per raw failure mode across ALL passes/reports (so if there
   are 15 passes with 2 modes each, that is 30 entries — keep duplicates; consolidation happens later).
   Keep each mode's name/description/evidence_quote/step_indices/aft/counterfactual verbatim; add nothing.
   If neither source exists, existing_judgments = [].
6. Produce trajectory_digest: a concise but faithful step-by-step account keyed by step index — what the agent did, where it went wrong, what it shipped. This is the shared brief other agents rely on, but they will ALSO re-read the trajectory file themselves, so be accurate about step numbers.

Return the structured brief. If you cannot locate the task/model, set resolved=false and explain in task_summary.`,
  { label: 'locate', schema: BRIEF_SCHEMA }
)

if (!brief || !brief.resolved) {
  log(`❌ Could not resolve trial from input ${JSON.stringify(INPUT)}.`)
  return { error: 'unresolved', input: INPUT, detail: brief?.task_summary ?? null }
}
log(`Resolved ${brief.task_id} · ${brief.model} · trial ${brief.trial_uuid.slice(0, 8)} · reward=${brief.reward} · ${brief.n_steps} steps · ${brief.existing_judgments.length} pre-baked candidate modes`)

const CONTEXT = `
TASK: ${brief.task_id}   MODEL: ${brief.model}   TRIAL: ${brief.trial_uuid}
reward=${brief.reward}  performance=${brief.performance}  closeness=${brief.closeness}  n_steps=${brief.n_steps}
TASK SUMMARY: ${brief.task_summary}
WHAT THE VERIFIER CHECKED: ${brief.what_verifier_checked}
EXACT FAILURE: ${brief.exact_failure_quote}
TRAJECTORY DIGEST (step-indexed):
${brief.trajectory_digest}

GROUND-TRUTH FILES (read these yourself to ground every quote):
  spec:        ${DATA}/${brief.task_id}/instruction.md
  trajectory:  ${brief.trajectory_path}
  verifier:    ${brief.job_dir}/verifier/test-stdout.txt   (reward in reward.txt)
  AFT rubric:  ${RUBRIC}
${TAXONOMY}`

// ===========================================================================
phase('Generate')

// Policy: REUSE pre-baked judge passes when they exist; only fall back to
// fresh generation when this trial has no pre-baked bundle (otherwise there
// would be nothing to adjudicate).
const HAS_PREBAKED = brief.existing_judgments.length > 0

// Diverse lenses so the candidate pool surfaces genuinely different modes
// rather than three paraphrases of the same one.
const JUDGES = [
  { key: 'rootcause', lens: 'Focus on the ROOT CAUSE (B) and the single decisive error. What is the one thing that, if fixed, flips the verdict? Be ruthless about identifying the PRIMARY mode and resist padding with secondary noise.' },
  { key: 'stage',     lens: 'Walk the trajectory STAGE by STAGE (A1→A6). Pinpoint the exact stage where the run was lost and whether the failure is at execution (A3), verification (A4), or the stop decision (A6). Apply the A4-vs-A6 rule strictly.' },
  { key: 'spec',      lens: 'Focus on SPEC COMPLIANCE and reward integrity: did the agent solve the asked problem (C2.4 vs C2.1), follow the instruction (C1.x), or evade/overfit/game the verifier (C4.5/C4.6, reward_hacking)? Check task_quality / verifier hackability.' },
  { key: 'codepath',  lens: 'Focus on the concrete ARTIFACT the agent produced vs what the verifier wanted: completeness of the fix (C4.4), error handling (C4.3), validation (C7.x), tool/output misreads (C8.x). Ground every claim in a verbatim diff/output line.' },
]

const JUDGE_REPORT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['closeness', 'headline', 'failure_modes', 'reward_hacking', 'task_quality'],
  properties: {
    closeness: { type: 'string', enum: ['near-miss', 'partial', 'far', 'success'] },
    headline: { type: 'string' },
    failure_modes: { type: 'array', items: MODE_SCHEMA, minItems: 1 },
    reward_hacking: {
      type: 'object', additionalProperties: false, required: ['verdict', 'evidence'],
      properties: { verdict: { type: 'string', enum: ['clean', 'suspicious', 'hack'] }, evidence: { type: 'string' } },
    },
    task_quality: {
      type: 'object', additionalProperties: false, required: ['verdict', 'issues'],
      properties: { verdict: { type: 'string', enum: ['accept', 'accept_with_caveats', 'reject'] }, issues: { type: 'array', items: { type: 'string' } } },
    },
  },
}

let liveJudges = []
if (HAS_PREBAKED) {
  log(`Pre-baked bundle present (${brief.existing_judgments.length} candidate modes) — reusing those passes; skipping fresh generation.`)
} else {
  log('No pre-baked bundle for this trial — falling back to fresh diverse-judge generation.')
  const judgeReports = await parallel(JUDGES.map(j => () =>
    agent(
`You are an independent AFT judge auditing ONE failed trial. ${j.lens}

${CONTEXT}

Read the trajectory, verifier output, spec, and rubric yourself. Then emit an AFT labelling:
identify 1-3 DISTINCT failure modes (prefer 1 primary + at most 1 secondary), each with a bare
A×B×C×D 4-tuple, a verbatim evidence_quote, the implicated step_indices, and a counterfactual on
the mode where a single-step fix applies. Pick the MOST SPECIFIC C-code. Do not invent quotes.
Honour the adjudication rules in the rubric. Your lens is a focus, not a blinder — still report
the true primary mode even if it sits outside your lens.`,
      { label: `judge:${j.key}`, phase: 'Generate', schema: JUDGE_REPORT_SCHEMA }
    ).then(r => r ? { judge: j.key, ...r } : null)
  ))
  liveJudges = judgeReports.filter(Boolean)
}

// Pool every candidate mode: pre-baked passes (preferred) or fresh judges.
const pool = []
for (const m of brief.existing_judgments) pool.push({ source: 'prebaked', ...m })
for (const r of liveJudges) for (const m of r.failure_modes) pool.push({ source: `judge:${r.judge}`, ...m })
log(`${pool.length} candidate failure modes pooled (${brief.existing_judgments.length} pre-baked + ${liveJudges.length} live judges).`)

// ===========================================================================
phase('Consolidate')
// Barrier: clustering genuinely needs the WHOLE pool at once.

const CLUSTER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['distinct_modes'],
  properties: {
    distinct_modes: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'canonical_name', 'description', 'aft', 'evidence_quote', 'step_indices', 'counterfactual', 'support', 'merged_from', 'rejected_variants'],
        properties: {
          id: { type: 'string', description: 'short stable id, e.g. M1' },
          canonical_name: { type: 'string' },
          description: { type: 'string' },
          aft: {
            type: 'object', additionalProperties: false, required: ['A', 'B', 'C', 'D'],
            properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
          },
          evidence_quote: { type: 'string' },
          step_indices: { type: ['array', 'null'], items: { type: 'integer' } },
          counterfactual: {
            type: ['object', 'null'], additionalProperties: false, required: ['single_step_fix', 'X', 'Y'],
            properties: { single_step_fix: { type: 'boolean' }, X: { type: 'string' }, Y: { type: 'string' } },
          },
          support: { type: 'integer', description: 'how many pooled candidates map to this cluster' },
          merged_from: { type: 'array', items: { type: 'string' }, description: 'sources merged, e.g. ["judge:stage","prebaked"]' },
          rejected_variants: {
            type: 'array',
            description: 'OTHER A×B×C×D codings of THIS SAME defect that appeared in the pool but lost to the canonical pick — the "why these labels are worse" record',
            items: {
              type: 'object', additionalProperties: false, required: ['aft', 'count', 'why_worse'],
              properties: {
                aft: { type: 'object', additionalProperties: false, required: ['A', 'B', 'C', 'D'], properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } } },
                count: { type: 'integer', description: 'how many pooled candidates used this losing coding' },
                why_worse: { type: 'string', description: 'e.g. "C2.1 less specific than C2.4", "A1 a stage quibble", "D3 less precise than D5 for a silent ship"' },
              },
            },
          },
        },
      },
    },
  },
}

const clustered = await agent(
`You are CONSOLIDATING a pool of candidate AFT failure modes for one trial into a set of DISTINCT
canonical modes. Two candidates are the SAME mode if they describe the same underlying defect at
the same locus — even if their A×B×C×D codes or wording differ. Merge those; keep genuinely
different defects separate. Do NOT yet decide which are correct or which to keep — just cluster and,
for each cluster, choose the single best (most accurate, most specific, best-grounded) representative
4-tuple, evidence_quote, and step_indices drawn from its members.

${CONTEXT}

CANDIDATE POOL (${pool.length}):
${JSON.stringify(pool, null, 1).slice(0, 24000)}

Return distinct_modes (typically 2-6). Record support (#candidates merged) and merged_from (sources).
CRITICAL: for each distinct mode, populate rejected_variants — every OTHER A×B×C×D coding of THAT SAME
defect that appeared in the pool but lost to your canonical pick, with a count and a crisp why_worse
(less-specific C-code, wrong stage, less-precise impact, etc.). This is the explicit "why the other
labels aren't good enough" record and must not be left empty when the pool contains code-variants.`,
  { label: 'consolidate', schema: CLUSTER_SCHEMA }
)

const modes = (clustered?.distinct_modes ?? []).filter(Boolean)
log(`${modes.length} distinct modes after consolidation: ${modes.map(m => m.id + ' ' + m.aft.A + m.aft.B + m.aft.C + m.aft.D).join(', ')}`)

// ===========================================================================
phase('Verify')
// One adversarial verifier per distinct mode, in parallel. Each tries to REFUTE.

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['mode_id', 'evidence_grounded', 'grounding_note', 'code_assessment', 'reasonable', 'redundant', 'redundant_with', 'severity', 'quality_score', 'keep_recommended', 'reasoning'],
  properties: {
    mode_id: { type: 'string' },
    evidence_grounded: { type: 'boolean', description: 'is evidence_quote a VERBATIM substring of the actual trajectory/verifier/spec?' },
    grounding_note: { type: 'string' },
    code_assessment: {
      type: 'object', additionalProperties: false, required: ['A_ok', 'B_ok', 'C_ok', 'D_ok', 'most_specific_c', 'corrected', 'note'],
      properties: {
        A_ok: { type: 'boolean' }, B_ok: { type: 'boolean' }, C_ok: { type: 'boolean' }, D_ok: { type: 'boolean' },
        most_specific_c: { type: 'boolean' },
        corrected: {
          type: ['object', 'null'], additionalProperties: false, required: ['A', 'B', 'C', 'D'],
          properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
          description: 'the corrected 4-tuple if any facet was wrong, else null',
        },
        note: { type: 'string' },
      },
    },
    reasonable: { type: 'boolean', description: 'is this a real, defensible failure mode (not spurious/hallucinated)?' },
    redundant: { type: 'boolean' },
    redundant_with: { type: ['string', 'null'] },
    severity: { type: 'string', enum: ['primary', 'secondary', 'minor', 'spurious'] },
    quality_score: { type: 'integer', minimum: 0, maximum: 10 },
    keep_recommended: { type: 'boolean' },
    reasoning: { type: 'string' },
  },
}

const verdicts = await parallel(modes.map(m => () =>
  agent(
`You are an ADVERSARIAL VERIFIER for ONE candidate AFT failure mode. Your default stance is
skeptical: try to REFUTE it. Check, by reading the actual ground-truth files yourself:
  1. GROUNDED? Is evidence_quote a verbatim substring of the real trajectory/verifier/spec? If you
     cannot find it, evidence_grounded=false.
  2. CODES CORRECT? Is each of A/B/C/D right per the rubric's adjudication rules, and is C the MOST
     SPECIFIC applicable subclass? If wrong, give the corrected 4-tuple. (Watch A4-vs-A6, B1-vs-B2,
     C6.2-vs-C7.1, C2.4-vs-C2.1, D3-vs-D5.)
  3. REAL? Is this a genuine, decisive failure mode or a spurious/hallucinated/over-specific artifact?
  4. REDUNDANT? Does it duplicate another listed mode (give its id)?
Then rate severity (primary = flips the verdict / secondary = contributes / minor / spurious) and a
0-10 quality_score, and recommend keep or drop with reasoning.

${CONTEXT}

THE MODE UNDER REVIEW (id ${m.id}):
${JSON.stringify(m, null, 1)}

OTHER DISTINCT MODES (for redundancy checks): ${JSON.stringify(modes.map(x => ({ id: x.id, name: x.canonical_name, aft: x.aft })))}`,
    { label: `verify:${m.id}`, phase: 'Verify', schema: VERIFY_SCHEMA }
  ).then(v => v ? v : { mode_id: m.id, keep_recommended: true, severity: 'minor', quality_score: 5, reasoning: 'verifier failed; passed through', evidence_grounded: true, redundant: false, redundant_with: null, reasonable: true, code_assessment: { A_ok: true, B_ok: true, C_ok: true, D_ok: true, most_specific_c: true, corrected: null, note: '' }, grounding_note: '' }
)))

const scored = modes.map(m => ({ mode: m, verdict: verdicts.find(v => v && v.mode_id === m.id) || null }))
log(`Verified ${scored.filter(s => s.verdict?.keep_recommended).length}/${modes.length} modes recommended to keep.`)

// ===========================================================================
phase('Adjudicate')

const FINAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outcome', 'final_modes', 'dropped_modes', 'reward_hacking', 'task_quality', 'meta_rationale', 'confidence'],
  properties: {
    outcome: {
      type: 'object', additionalProperties: false,
      required: ['closeness', 'step_where_lost', 'headline', 'what_verifier_checked', 'what_agent_produced', 'exact_failure_quote'],
      properties: {
        closeness: { type: 'string', enum: ['near-miss', 'partial', 'far', 'success'] },
        step_where_lost: { type: ['integer', 'null'] },
        headline: { type: 'string' },
        what_verifier_checked: { type: 'string' },
        what_agent_produced: { type: 'string' },
        exact_failure_quote: { type: 'string' },
      },
    },
    final_modes: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false,
        required: ['rank', 'name', 'description', 'evidence_quote', 'step_indices', 'aft', 'counterfactual', 'why_kept', 'support'],
        properties: {
          rank: { type: 'string', enum: ['primary', 'secondary', 'supporting'] },
          name: { type: 'string' },
          description: { type: 'string' },
          evidence_quote: { type: 'string' },
          step_indices: { type: ['array', 'null'], items: { type: 'integer' } },
          aft: {
            type: 'object', additionalProperties: false, required: ['A', 'B', 'C', 'D'],
            properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
          },
          counterfactual: {
            type: ['object', 'null'], additionalProperties: false, required: ['single_step_fix', 'X', 'Y'],
            properties: { single_step_fix: { type: 'boolean' }, X: { type: 'string' }, Y: { type: 'string' } },
          },
          why_kept: { type: 'string', description: 'why this label is accurate AND earns its slot' },
          support: { type: 'integer' },
        },
      },
    },
    dropped_modes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'aft', 'why_dropped'],
        properties: {
          name: { type: 'string' },
          aft: {
            type: 'object', additionalProperties: false, required: ['A', 'B', 'C', 'D'],
            properties: { A: { type: 'string' }, B: { type: 'string' }, C: { type: 'string' }, D: { type: 'string' } },
          },
          why_dropped: { type: 'string', description: 'unreasonable / ungrounded / redundant / wrong-code / less-specific / below-the-bar' },
        },
      },
    },
    reward_hacking: {
      type: 'object', additionalProperties: false, required: ['verdict', 'evidence'],
      properties: { verdict: { type: 'string', enum: ['clean', 'suspicious', 'hack'] }, evidence: { type: 'string' } },
    },
    task_quality: {
      type: 'object', additionalProperties: false, required: ['verdict', 'issues'],
      properties: { verdict: { type: 'string', enum: ['accept', 'accept_with_caveats', 'reject'] }, issues: { type: 'array', items: { type: 'string' } } },
    },
    meta_rationale: { type: 'string', description: 'overall account of how the final sequence was chosen and the principle used to drop the rest' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}

const final = await agent(
`You are the META-JUDGE. Converge on the FINAL AFT labelling sequence for this trial. You are given
every distinct candidate mode together with an adversarial verifier's verdict on each. Your job is
NOT to union them — it is to keep the SMALLEST set that is the most ACCURATE yet COMPREHENSIVELY
COVERING of why this trial failed, and to DROP the rest with a reason.

${CONTEXT}

DISTINCT MODES + VERIFIER VERDICTS:
${JSON.stringify(scored, null, 1).slice(0, 28000)}

Decision rules:
- Drop any mode whose evidence is not grounded, that the verifier judged spurious/hallucinated, or
  that is redundant with a kept mode (keep the better-grounded, more-specific representative).
- Correct codes: if the verifier supplied a corrected 4-tuple you find persuasive, use it.
- CONVERGENCE = COMPREHENSIVE: keep up to ~4 distinct modes, but ONLY ones that are well-grounded and
  genuinely distinct. Exactly one is the primary (the mode that, if fixed, flips the verdict); the rest
  are secondary/supporting. This is a CEILING, not a quota — never pad to reach 4; a clean run may keep
  only 1-2. The bar for each kept mode is: grounded + distinct + correctly coded.
- Prefer the most-specific C-code; the primary must be the decisive, verdict-flipping mode.
- For EACH kept mode write why_kept (why it is correct AND earns its slot). For EACH dropped mode write
  why_dropped. In meta_rationale, state the overall principle and call out the closest competitor you
  rejected and why it isn't good enough.
- Set outcome (closeness must equal "success" iff performance==1), reward_hacking, task_quality, and a
  confidence level.

Return the final structured verdict.`,
  { label: 'meta-judge', schema: FINAL_SCHEMA }
)

return {
  task: brief.task_id,
  model: brief.model,
  trial: brief.trial_uuid,
  reward: brief.reward,
  performance: brief.performance,
  n_steps: brief.n_steps,
  prebaked_report_path: brief.prebaked_report_path,
  pool_size: pool.length,
  distinct_modes: modes.length,
  // The consolidation record makes the variant-pruning visible: for each kept
  // mode, which alternative codings of the same defect were rejected and why.
  consolidation: modes.map(m => ({ id: m.id, aft: m.aft, name: m.canonical_name, support: m.support, rejected_variants: m.rejected_variants })),
  verdict: final,
}
