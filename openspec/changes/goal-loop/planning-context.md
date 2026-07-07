# Planning Context — goal-loop feature

This is the single source of truth bridging the LEAD's design intent to every
worker (planner/implementer/reviewer) across the decomposed children. Read this
FIRST. It supersedes the older `openspec/office-hours/goal-loop-primitive.md`
(which is a v3 single-pipeline draft; the design below is the converged v4).

## What we are building (one paragraph)

A **goal-driven iteration loop** for `opsx:auto`, so it can drive tasks whose
"done" is a *condition* (a measurable threshold or a quality judgment), not a
code-change document. Today's pipelines (full/small/bug-fix) all assume the
product is a code change (propose→apply→verify→ship→archive). goal-loop adds a
harness loop: the agent repeats modify→judge until a stop condition is met or a
round cap is hit. It covers perf optimization (Lighthouse→90), code-quality work
against a rubric, and autoresearch-style research/writing.

## Converged architecture (v4) — read carefully, this differs from the office-hours doc

**Single user-facing entry, LEAD-classified backend family.** The user sees ONE
command, `/opsx:goal <task>`. The LEAD classifies the task and selects ONE backend
pipeline. Explicit override allowed: `/opsx:goal measure|evaluate|research <task>`
or `--pipeline goal-loop-<variant>`. This mirrors how `/opsx:auto` classifies
among full/small/bug-fix today.

**Why a family, not one pipeline:** an earlier single-pipeline design forced
heterogeneous tasks (measure vs evaluate gates; code vs prose work product) into
one shape via runtime conditions + one generic skill. Adversarial review found
three load-bearing defects in that approach (AND-semantics stall hole,
unenforced conditional-tail exclusivity, hand-waved generic prose skill). A
**family of homogeneous pipelines** dissolves all three: each pipeline has ONE
gate type, ONE iterate skill flavor, ONE tail — no conditions, no combination.

### The three backend pipelines (each registered, homogeneous)

| pipeline | gate (examiner) | iterate skill flavor | tail | covers |
|---|---|---|---|---|
| `goal-loop-measure` | measure (deterministic command → `{score,passed}`) | code-edit | ship → archive | perf, score-chasing, latency/memory tuning |
| `goal-loop-evaluate` | evaluate (fresh reviewer worker → `{satisfied,gaps}`) | code-edit | ship → archive | code-quality against a rubric |
| `goal-loop-research` | evaluate (fresh reviewer worker) | research+prose (web tools) | report | autoresearch |

Student = `implementer`; examiner = a deterministic command (measure) or a fresh
`reviewer` worker (evaluate). **No new role** — the reviewer role already exists.

## The shared primitive: `kind: goal` on StageLoopSchema

A new loop kind (alongside `review-cycle`) in
`src/core/pipeline-registry/types.ts`. Convert `StageLoopSchema` from
`z.object({kind: z.literal('review-cycle')...})` to a `z.discriminatedUnion('kind', [...])`.

```ts
export const StageLoopSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('review-cycle'), maxRounds: z.number().int().positive().default(3) }),
  z.object({
    kind: z.literal('goal'),
    // Exactly ONE gate per pipeline (measure XOR evaluate). No combination in v1.
    gate: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('measure'),
        command: z.string().min(1),                       // stdout JSON: { score: number, passed?: number, detail?: string }
        threshold: z.number().optional(),                 // score stop threshold
        target: z.number().optional(),                    // passed-count target
        direction: z.enum(['gte', 'lte']).default('gte'), // lte = smaller is better (latency/memory)
        timeoutSec: z.number().int().positive().default(120),
      }),
      z.object({
        kind: z.literal('evaluate'),
        goal: z.string().min(1),                          // NL success criterion
        rubric: z.string().optional(),
      }),
    ]),
    maxRounds: z.number().int().positive().default(5),
    loopStallLimit: z.number().int().positive().default(2), // gate-neutral; avoids HandoffConfigSchema.stallLimit collision
    runArtifact: z.string().default('goal-run.json'),
  }).superRefine((s, ctx) => {
    if (s.gate.kind === 'measure' && s.gate.threshold === undefined && s.gate.target === undefined) {
      ctx.addIssue({ code: 'custom', path: ['gate'], message: 'measure gate needs threshold or target' });
    }
  }),
]);
```

Notes:
- `gate` is a required discriminated union — each pipeline declares exactly one
  gate type. This dissolves AND/OR-combination complexity entirely.
- The `command`/`threshold` specifics for measure are still per-task, so the
  pipeline YAML registers the gate *type* (measure) and the LEAD injects the
  concrete `command`/`threshold` from `goal-plan.md` at run start into
  `iterate.loopConfig` (see "injection" below). The registry pipeline validates
  with the gate type present; only the measure *command string* is run-time.
  Simplest correct approach: the measure gate's `command` is OPTIONAL in the
  registry schema but REQUIRED at run-time (LEAD asserts it before round 1,
  reading it from goal-plan.md). Evaluate gate is fully static (goal+rubric come
  from goal-plan.md too, injected the same way).
- `loopStallLimit` (NOT `measureStallLimit`, NOT `stallLimit`) — gate-neutral,
  no collision with `HandoffConfigSchema.stallLimit`.

## The three new skills (template files under src/core/templates/workflows or experts)

1. **`openspec-goal-plan`** (planner role, the `define-goal` stage): input = task
   description; output = `goal-plan.md` containing: `goal` (NL), `gate`
   (`{kind: measure, command, threshold/target, direction}` OR `{kind: evaluate,
   goal, rubric}`), `workProduct` (`code` | `prose`), `maxRounds`. The planner
   chooses gate type by task nature (quantifiable → measure; quality standard →
   evaluate). `gate: true` on the stage lets the user confirm the measure
   command (also the safety valve for "measure.command is arbitrary shell").
   Does NOT produce proposal/design/specs.

2. **`openspec-goal-iterate`** (implementer role, the `iterate` loop stage): the
   student. Work-product-aware dispatch instructions: for `code` work product,
   edit code toward the goal + self-run the measure command informally during the
   dispatch; for `prose` (research pipeline), research (web search/fetch) +
   write/refine the document. **MUST NOT spawn child subagents** (flat hierarchy
   invariant — the LEAD is sole orchestrator). Does its own research inline;
   when context fills, follows the standard Step H.3 worker self-handoff (write
   handoff doc, return HANDOFF) — the research pipeline relies on this
   (implementer inline + relay, NOT research-sibling).

3. **`openspec-goal-report`** (shipper role, the `report` stage, research pipeline
   ONLY): summarizes `goal-run.json` (rounds, scores/satisfaction, outcome) into
   a final report artifact. No code to ship.

## The `/opsx:goal` entry + LEAD classification

A new command/workflow template (mirror `auto.ts`'s structure) named
`openspec-opsx-goal` + an `OPSX: Goal` command template. Its instructions: run
the LEAD pre-flight + classification, pick the backend pipeline, then drive it
via the SAME orchestration playbook (it embeds `ORCHESTRATION_PLAYBOOK`). Classification
keywords (suggestion only; explicit wins): `score|latency|optimize|lighthouse|
benchmark|p99|memory|throughput` → measure; `rubric|quality|clean|standard|
refactor-quality` → evaluate; `research|investigate|write.*(report|brief)|
autoresearch|literature` → research.

## Step L — Goal-loop (new section in _orchestration.ts playbook)

The LEAD interprets a `kind: goal` loop stage. **Single dispatch per round**
(isomorphic to review-cycle's shape):

- **Inject** (once, before round 1): read `goal-plan.md`, merge the concrete gate
  config into `iterate.loopConfig` in run-state; assert a measure gate has its
  `command`.
- **Each round**:
  - Dispatch the `implementer` worker (**warm-reused across all rounds** — same
    worker, like review-cycle reuses the fixer thread; rounds do NOT each cost a
    fresh relay). Seed: round 1 = goal-plan.md (no prior score); round N>1 =
    goal-plan + prior round's `{score/gaps, measurePassed/evaluateSatisfied}`.
    The implementer MAY self-run the measure command / self-check informally
    during its dispatch; the **formal recorded score** is the post-dispatch gate.
  - **Gate** (one type, per the pipeline):
    - measure: run `gate.command`, parse `{score, passed, detail}`. **Failure
      branch**: non-zero exit / timeout / unparseable JSON → record
      `{round, error}`, treat round as not-passed, feed stderr/parse-error as
      the gap. No deadlock.
    - evaluate: dispatch a **FRESH reviewer worker** (≠ implementer — author≠
      verifier). Hand it goal+rubric+artifact; it MUST return structured
      `{satisfied: boolean, gaps: string[]}` (no free text, for reproducibility).
  - Record `{round, score?, measurePassed?, evaluateSatisfied?, detail?, gaps?,
    error?, gitTreeFingerprint}` appended to `goal-run.json`.
- **Stop**: gate satisfied → proceed to tail. `maxRounds` exhausted → proceed to
  tail but mark `outcome: maxRounds-exhausted` in ship-log/report — **never lie
  about success**.
- **Stall** (gate-neutral): a round "progresses" if (measure: score moved
  favorably vs prior — gte increased / lte decreased) or (evaluate: gap-set
  shrank or newly satisfied). Round 1 counts as progress. `loopStallLimit`
  consecutive non-progressing rounds → LEAD strategy review (warm-seed a fresh
  implementer with a different approach, or escalate). Never silently burn rounds.
- **Resume** (authoritative = `goal-run.json` last record):
  - last record satisfied → go to tail (do NOT re-run).
  - last record not-passed (round complete, has a record) → resume at
    **lastRound + 1** (fresh dispatch, seed with prior gap). NOT "re-run N" — N
    already has its recorded judgment.
  - no record (define-goal done, iterate died before first gate) → dispatch round 1.
  - before resuming a round, MAY re-run the gate once on the current tree (catch
    flaky command / externally-fixed state); `gitTreeFingerprint` detects tree
    changes under us.
- **Context / handoff**: the implementer is warm-reused; when its context fills it
  follows standard Step H.3 (write handoff doc, return HANDOFF); the LEAD
  warm-seeds a successor and the loop continues — `goal-run.json` is the spine
  that survives the relay. The **research pipeline** sets a lower
  `handoff.roles.implementer.threshold` so relay happens earlier (research is
  context-heavy). This is the "implementer inline + relay" decision — confirmed
  by the user; do NOT use a research-sibling pattern.

## run-state additions (run-state.ts, additive)

```ts
// injected effective loop config — runtime authoritative
loopConfig?: {
  kind: 'goal';
  gate: { kind: 'measure'; command: string; threshold?: number; target?: number; direction: 'gte'|'lte' }
       | { kind: 'evaluate'; goal: string; rubric?: string };
  maxRounds: number;
  loopStallLimit: number;
  workProduct: 'code' | 'prose';
};
// best-effort derived cache; authoritative position is goal-run.json
loopProgress?: {
  kind: 'goal';
  round: number;
  lastScore?: number;
  measurePassed?: boolean;      // present when gate=measure
  evaluateSatisfied?: boolean;  // present when gate=evaluate
  stallStreak: number;
  historyRef: string;           // -> goal-run.json
};
```

## discriminated-union migration — REAL consumers (grep-verified)

src/ has NO `.loop?.kind === 'review-cycle'` narrowing expression. `loop` is
consumed only via `if (stage.loop)` + playbook prose. Edit sites:
- `src/core/pipeline-registry/types.ts` — schema (the union itself).
- `src/core/templates/workflows/_orchestration.ts` — existing "When a stage is a
  loop" prose (Step E) + NEW Step L. Step E currently assumes review-cycle;
  make it dispatch on `loop.kind`.
- `src/commands/pipeline.ts:641` — `if (stage.loop) meta.push(\`loop=${stage.loop.kind}(max ${stage.loop.maxRounds})\`)`;
  generalize to render goal-loop gate info.
- `src/core/pipeline-registry/run-state.ts` — add `loopConfig`/`loopProgress`
  (additive; no existing field breaks).
- `test/core/pipeline-registry/pipeline.test.ts:74` — asserts
  `loop: { kind: 'review-cycle', maxRounds: 3 }`; backward-compatible under the
  union, but audit it + add goal-loop cases.
- `test/core/pipeline-registry/builtins.test.ts` — builtin pipeline load/validate;
  register the 3 new goal-loop pipelines here.
NOT consumers (verified): `resolver.ts`, `auto.ts`, `portfolio-state.ts`.

## The three pipeline YAMLs (pipelines/goal-loop-*/pipeline.yaml)

Each is a decompose-free registered pipeline. Shape (measure example):

```yaml
name: goal-loop-measure
description: Goal-driven iteration for measurable code targets (perf, scores, latency). define-goal -> iterate(measure gate) -> ship -> archive.
stages:
  - id: define-goal
    skill: openspec-goal-plan
    role: planner
    requires: []
    gate: true
  - id: iterate
    skill: openspec-goal-iterate
    role: implementer
    requires: [define-goal]
    loop:
      kind: goal
      gate: { kind: measure }     # command/threshold injected at runtime from goal-plan.md
      runArtifact: goal-run.json
  - id: ship
    skill: openspec-opsx-ship
    role: shipper
    requires: [iterate]
    gate: true
    model: sonnet
  - id: archive
    skill: openspec-archive-change
    role: shipper
    requires: [ship]
    model: sonnet
```

`goal-loop-evaluate`: same but `gate: { kind: evaluate }` (goal/rubric injected).
`goal-loop-research`: `gate: { kind: evaluate }`, iterate is prose-flavored, tail
is a `report` stage (`openspec-goal-report`) instead of ship/archive, and the
pipeline sets `handoff: { roles: { implementer: { threshold: 0.35 } } }` (lower,
for earlier relay). Register all three in the builtins set wherever
small/bug-fix/full-feature are registered.

## Constraints (non-negotiable)

- Existing `full-feature`/`small-feature`/`bug-fix` pipelines: ZERO behavior
  change. `review-cycle` loop: ZERO regression (the union must keep its shape valid).
- Data-driven registry: goal-loop is registered pipelines + a loop kind, NOT
  hard-coded branches in auto.ts.
- Bounded: every loop has `maxRounds` + `loopStallLimit`.
- author ≠ verifier: measure = neutral command; evaluate = fresh reviewer ≠ implementer.
- Flat hierarchy: workers (including the goal-iterate implementer) NEVER spawn
  child subagents. Research is done inline by the implementer + H.3 relay.

## Success criteria (the verifier checks these)

- `openspec pipeline list --json` lists the 3 goal-loop pipelines;
  `openspec pipeline show goal-loop-measure --json` returns a valid DAG.
- A measure task runs define-goal → iterate (multi-round, goal-run.json records
  each round) → ship → archive.
- measure command failure (non-zero / bad JSON) does NOT deadlock: records error,
  continues not-passed.
- maxRounds exhaustion marks `outcome: maxRounds-exhausted`, never lies success.
- `loopStallLimit` consecutive no-progress rounds triggers LEAD strategy review.
- kill + `openspec pipeline resume <change>` resumes correctly (satisfied→tail;
  not-passed→lastRound+1; no-record→round 1).
- Existing 3 pipelines' tests: zero regression.

## Open questions (decide during implementation, low-risk)

- OQ1: measure.command sandbox �� v1 relies on the define-goal gate for human
  confirmation of the command (no extra sandbox enforcement).
- OQ2: implementer self-measure tooling — v1 lets the implementer run the measure
  command directly via Bash during its dispatch (informed in the prompt); no
  dedicated named tool.
- OQ3: per-pipeline maxRounds default — research/evaluate MAY set a lower default
  (e.g. 3) via the pipeline YAML's loop.maxRounds; schema default stays 5.

## Decomposition (this portfolio)

- **`goal-loop-core`** (no deps): the ENTIRE mechanism — StageLoopSchema `kind:
  goal` + gate union + run-state additions + discriminated-union migration +
  Step L playbook + the 3 pipeline YAMLs + the 3 skills + `/opsx:goal` entry +
  builtins registration + unit tests for the schema/registry. One coherent
  mechanism, one implementer, consistent contract.
- **`goal-loop-validation`** (deps: goal-loop-core): end-to-end tests (measure /
  evaluate / research paths, measure-failure injection, maxRounds exhaustion,
  kill-resume) + docs (opsx-workflow-guide.md goal-loop chapter + update
  openspec/office-hours/goal-loop-primitive.md to this v4 design).

Serial: core → validation (shared files _orchestration.ts/types.ts/auto.ts;
no parallel).
