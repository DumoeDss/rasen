# OPSX Workflow Guide: One-Command End-to-End + Per-Stage Commands

> Date: 2026-06-01 · Applies to: OpenSpec (OPSX workflow, including orchestration-based autopilot + data-driven pipeline registry)
> Related references: [`commands.md`](./commands.md) (detailed reference for each command), [`workflows.md`](./workflows.md) (modes and timing), [`cli.md`](./cli.md) (terminal CLI), [`review-cycle-workflow-design.md`](./review-cycle-workflow-design.md) (review-cycle design).
>
> This article explains the current OPSX workflow from the perspective of "the whole pipeline": first it gives **one command that runs end-to-end**, then **the command for each individual stage**, and finally the **CLI commands**, profile switches, and complete examples that underlie them.

---

## 1. Workflow Overview

OPSX breaks "a requirement → implemented, reviewed, verified, shipped, archived" into several stages. Each stage can be automatically chained by autopilot, or manually invoked on its own.

```
 explore ─▶ office-hours ─▶ propose ─▶ apply ─▶ verify ─▶ review-cycle ─▶ ship ─▶ archive ─▶ retro
 (think)    (validate need)  (plan)    (implement)  (expert review)  (loop: fix→re-review Δ)  (deliver)  (archive+merge)  (retro)
   │            │             │          │        │            │           │         │
 optional    optional     produces    check off  experts/    iterate     PR/deploy  merge    learnings
                          contract      tasks    security/QA  until clean            spec     distilled
```

> Note: In the autopilot pipeline, `verify` (expert review; can run review/cso/benchmark/design-review/qa in parallel) produces findings first, and then `review-cycle` (the `review-loop` stage) drives "triage → fix → re-review Δ" until clean. Bug-fix goes through adaptive verify, without a review-loop.

- **Where the contract lives**: `propose` produces `proposal.md` / `design.md` / `specs/<cap>/spec.md` / `tasks.md` in `openspec/changes/<id>/`. This is the "truth" handed off between stages.
- **Definition of done**: every `### Requirement` must have at least one `#### Scenario` (enforced by `openspec validate`). The verify/review stages check the implementation against the scenarios.
- **Dependencies are "enablement", not "gates"**: artifacts have dependencies (`requires`), but you can advance in any reasonable order as long as the dependencies are ready.

---

## 2. Run the entire workflow with one command: `/opsx:auto`

`/opsx:auto` (Autopilot) is the **single-command end-to-end** entry point. It turns the executor into a **LEAD**: the LEAD only orchestrates and does not do the stage work itself — it **classifies the task → picks a pipeline → dispatches each stage to a role-isolated sub-agent → pauses at gates for confirmation**. You can interrupt and switch to manual at any time.

> Trigger words: `auto` / `autopilot` / `end to end` / `do it all` / `one shot`.

### 2.1 Orchestration model: LEAD + role-isolated sub-agents (with capability tiers)

- **The LEAD is the sole orchestrator; sub-agents are leaves**: all loops / dispatching / triage happen in the LEAD; each worker invokes that stage's existing OPSX skill, does its job, and returns. **Workers never spawn child agents** (flat hierarchy).
- **Cross-task isolation, same-task continuity**: different changes each get their own worker team and don't interfere with each other; within a task the LEAD can use `SendMessage` to wake a worker for continuation (e.g., have the original reviewer re-review only the delta). When a task is **fanned out by decompose** into multiple sub-changes, this "each change has its own worker team" truly takes effect — each sub-change runs its own pipeline with its own independent worker team (see §2.7).
- **Persistent planner (propose-only reuse — the sole exception to the isolation rule above)**: a single run has **only one planner**. Before the first propose, the LEAD seeds it by writing known context (user intent, its own research, decomposition rationale) into `planning-context.md`; afterward, each sub-change's propose continues the **same** planner via `SendMessage` — the codebase is researched once and sibling specs stay naturally consistent; each round the planner appends new conclusions back to the digest. The planner pointer is recorded at the top level of `portfolio-run.json` (`planner` field); after a restart it resumes via warm seeding; when its context bloats it is retired and replaced. **All other stages (apply/verify/review/ship…) stay cold-isolated and are not reused** (playbook Step B.1).
- **Structured author ≠ verifier**: the review worker ≠ the implementation worker; the design-level fixer ≠ the original author; the re-review worker ≠ the fixer — guaranteed by the LEAD dispatching different workers (no longer a verbal promise within the same context).
- **Capability tiers (auto-detected; the pipeline definition does not change, only the execution mechanism)**:
  - **Tier A**: Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` → spawn role workers + `SendMessage` warm continuation (full form; `SendMessage` is **session-only**, cross-restart goes through the transcript warm seeding in §2.5). **`openspec init` / `update` installs Claude Code and automatically merges this flag into the project's `.claude/settings.json`** (preserving existing keys, idempotent, does not overwrite bad JSON), so Tier A is the default.
  - **Tier B**: has spawn, no agent-teams → each stage is a fresh spawn, rebuilding context from the change directory + run-state.
  - **Tier C**: no sub-agent capability → single-context sequential execution (explicit fallback, **not** the main path).
- **State lives on disk**: the change directory is the persistent blackboard (artifacts are handed off between stages); the LEAD records progress in `openspec/changes/<id>/auto-run.json` (run-state), supporting resume-after-interrupt and observability.

### 2.2 The pipeline is data: pick by task, fetch from the registry

Both classification and pipeline definition come from a **data-driven pipeline registry** (no longer hardcoded in auto). Adding a task type = adding one YAML, zero code changes.

```bash
openspec pipeline classify "<task description>" --json   # → { suggested, matched, available }
openspec pipeline show <name> --json             # → { name, description, buildOrder, stages }
openspec pipeline list --json                     # list all pipelines from package/user/project
```

Built-in pipelines (can be overridden or augmented by user/project; resolution priority project > user > package):

| Pipeline | Stages (buildOrder summary) |
|---|---|
| **full-feature** | office-hours → propose (optional direction review) → apply → parallel expert review (review / cso / benchmark / design-review / qa\|qa-only) → review-loop → ship → archive → retro |
| **small-feature** _(default)_ | propose → apply → verify → review-loop → ship → archive |
| **bug-fix** | propose → apply → adaptive verify → ship → archive |
| **auto-decompose** | **decompose** (conditional first step, LEAD self-review, not a human gate) → propose → apply → verify → review-loop → ship → archive; taking decompose fans out into multiple sub-changes, each running `childPipeline` (default small-feature, see §2.7) |

> All built-in pipelines **explicitly specify `model: sonnet` for the ship and archive stages** — these two stages are mechanical execution (run tests / push / create PR, archive / merge specs) and don't need a large-model reasoning; when `model` is not specified, the worker inherits the main agent's model, needlessly spending more. Custom pipelines are also encouraged to set `model: sonnet` for ship/archive.

**How to pick a pipeline** (explicit takes priority, otherwise the default is `small-feature`):
- **Explicit**: `/opsx:auto --pipeline <name> <task>`, or **put the pipeline name at the very front** — `/opsx:auto full-feature refactor the auth subsystem` (if the first token is a known pipeline name, it's used directly).
- **Default**: `/opsx:auto <task>` (without an explicit choice) → use **`small-feature`** directly, no auto-upgrade to full-feature/bug-fix.

Optional: `openspec pipeline classify "<task>"` for a suggestion, or `openspec pipeline list` to pick another — but explicit choice always overrides; without an explicit choice it goes to the `small-feature` default.

Each stage carries metadata the LEAD uses to execute: **kind** (`standard` default / `decompose` fan-out point, §2.7), **skill** (the OPSX skill the worker invokes; the decompose stage has no such field), **childPipeline** (decompose only — the pipeline each sub-change runs, default `small-feature`), **role** (isolation), **gate** (human pause), **loop** (review loop), **parallelGroup** (concurrent fan-out, e.g. verify's expert group), **condition** (runs only when satisfied; mutually exclusive conditions like ui / non-ui pick one), **leadReview** (LEAD checks for direction drift, §2.3), **verifyPolicy** (adaptive / standard / light, §2.3), **model** (the model override for that stage's worker; if omitted it inherits the main agent's model — built-in pipelines set `model: sonnet` for ship/archive).

### 2.3 Two task-related enhancements

- **Propose direction-review gate**: triggered when the propose stage's `leadReview` is ON — **two ways to enable**: ① pass the argument at invocation `/opsx:auto --review-plan <task description>` (force on for this run, regardless of pipeline; note that `/opsx:auto` is a skill not a CLI binary and has no flag parser — arguments are recognized and honored by the LEAD per this section); ② write `leadReview: true` on the propose stage in pipeline.yaml (permanently on for that pipeline). Built-in **full-feature has it by default** (propose.leadReview: true), **small-feature / bug-fix do not** (use `--review-plan` to enable temporarily). When triggered: after the propose worker returns and before apply, the LEAD reviews the proposal/design/specs/tasks against the **original intent** for drift (the LEAD did not write the artifacts, so this is a legitimate non-author review) → if aligned, continue; if drifted, send back to a new planner worker or escalate to you; if not enabled, propose goes directly to the next stage. Under Tier C the LEAD is the author, degrading to an explicit human-confirmation gate, **not** counting as a non-author review.
- **Bug-Fix adaptive verify**: simple changes (single file / non-core path / well-tested) pass when unit tests are green and skip the review loop; complex changes dispatch an additional testing worker for deeper checks and enter the review loop.

### 2.4 review-cycle is exactly auto's review loop

`/opsx:review-cycle` (§3.5) is no longer a detached manual stage — it **is the `review-loop` stage** in full-feature / small-feature, sharing the same orchestration playbook as auto (same tiers / role isolation / run-state / escalation). Run it manually on its own to drive "review → fix → re-review only the delta" on an existing change until clean.

### 2.5 Pause points and resume

- After stages marked `gate`, the LEAD pauses: showing what's done + the next step, waiting for you to **Continue / Stop (saves for resumption) / switch to manual**.
- Resume: `openspec pipeline resume <change> --json` infers the next incomplete stage from run-state + artifacts (the per-stage state in run-state is authoritative; artifact existence is heuristic / cross-check). The run-state is written to `auto-run.json`, where each stage records the worker's `role` / `agentId` / `transcript` pointers.
- **Cross-session (after restart) warm seeding**: in a new session the previous session's workers no longer exist and `SendMessage` cannot reach them (`agentId` is a dead handle). To reuse a role (e.g. have the "original reviewer" re-review only the delta), the LEAD reads its persistent transcript (`agent-<agentId>.jsonl`) back and **warm-seeds** a new worker of the same role — new `agentId`, carrying the predecessor's full context. The `workers` field of `resume --json` lists the warm-seedable pointers; if the transcript is no longer valid it degrades to cold-rebuilding from the change directory. This is the closest form to "truly reviving an old subagent session" that the platform allows (Claude Code does not support reviving the same subagent across processes).

### 2.6 Adding custom pipelines (assembled from existing steps)

Three steps, zero code — re-orchestrate existing stage skills into a new pipeline:

1. **Create the file** (resolution priority project > user > package; **a same-named file overrides the built-in**, useful for customizing built-in pipelines without touching source):
   - Project level: `openspec/pipelines/<name>/pipeline.yaml`
   - User level: `<XDG_DATA_HOME or ~/.local/share>/openspec/pipelines/<name>/pipeline.yaml`
2. **Write stages, picking `skill` from the existing ones** (this is "choosing from existing steps"):
   ```yaml
   name: hotfix
   description: Fast-track — propose, apply, review loop, ship.
   stages:
     - { id: propose,     skill: openspec-propose,      role: planner,     gate: true }
     - { id: apply,       skill: openspec-apply-change, role: implementer, requires: [propose], gate: true }
     - { id: review-loop, skill: openspec-review-cycle, role: fixer,       requires: [apply],
         loop: { kind: review-cycle, maxRounds: 2 } }
     - { id: ship,        skill: openspec-opsx-ship,    role: shipper,     requires: [review-loop], model: sonnet }
   ```
   Ready-to-pick skills: `openspec-propose` / `openspec-apply-change` / `openspec-review-cycle` / `openspec-opsx-office-hours` / `openspec-opsx-ship` / `openspec-archive-change` / `openspec-opsx-retro`, experts `openspec:review` / `openspec:cso` / `openspec:benchmark` / `openspec:design-review` / `openspec:qa` / `openspec:qa-only`. Stage fields are as in §2.2; to crib an existing example use `openspec pipeline show full-feature`.
3. **Validate + use**:
   ```bash
   openspec validate <name> --type pipeline   # unique id / requires resolvable / acyclic / skill exists / parallelGroup independent / decompose (at most one · first position · childPipeline resolvable and contains no recursion)
   openspec pipeline show <name>              # view the buildOrder
   ```
   After that, `/opsx:auto` lists it under `available`, and you can **override** and select it after classification.

> Two real constraints: ① **skill names must be exact** — experts are `openspec:xxx` (not `openspec-xxx`), apply is `openspec-apply-change` (not `openspec-apply`); getting it wrong makes `validate` report the skill as not existing; ② **classify will not auto-recommend custom pipelines** (it's a built-in keyword heuristic that only suggests among the three built-ins) — custom pipelines are always in `available`, but you/the user must **manually override** the selection after classification. To make a keyword automatically hit a custom pipeline you currently have to edit the keyword table in `src/commands/pipeline.ts` (a possible follow-up enhancement).

### 2.7 decompose fan-out (split into multiple independently-deliverable changes at once)

Forcing a large task into one change yields a giant diff that can't be reviewed or merged. The `decompose` stage lets the LEAD **fan out** the task at runtime into multiple cohesive, independently-deliverable sub-changes, then drive each one's pipeline in turn — this is exactly where §2.1's "each change has its own worker team" lands.

- **It's a stage type (`kind: decompose`) and the pipeline's conditional first step.** The built-in `auto-decompose` pipeline places it at the front. Triggered by `/opsx:auto auto-decompose <task>`; the LEAD **decides on its own whether to execute or skip** based on the task: a single cohesive, one-pass-reviewable slice → skip, and the remaining stages run on one change as usual; multiple mutually independent deliverables / multiple different capabilities / too large to review as a single diff → execute and fan out.
- **LEAD self-review, no human gate by default (`gate: false`).** After taking decompose, the LEAD self-reviews the split plan (slice cohesion, independence rationale for parallel batches, correctness of the dependency DAG) and **continues automatically**; it only escalates to you when no safe plan can be formed. You can still interrupt at any time.
- **The parent change becomes a planning container.** Its own remaining stages are marked delegated (not run at the parent level); each sub-change is created with `openspec new change <child-id>`, running the resolved `childPipeline` (default `small-feature`, never contains decompose). **Per-sub-change pipeline override is allowed** — one sub can be `bug-fix` while a sibling is `full-feature`.
- **Conservative serial/parallel strategy (the safety core):**
  - **Dependency edge → strictly serial**, in topological order. A dependent waits until **every** predecessor is implemented and review-clean before starting, never running concurrently with a predecessor. **Shared working tree + review-clean is enough** for a dependent to consume a predecessor's code, with no need to ship/archive the predecessor first; it only escalates when what's depended on is a landed/merged artifact.
  - **Parallel only when all hold**: ① no dependency edge in either direction, ② no overlap in touched capabilities / specs directories / files, ③ the host is **Tier A**. Sub-changes meeting these conditions each spin up independent worker teams concurrently, **with no fixed concurrency cap**; Tier B/C is always serial.
  - **Independence uncertain → serial** ("better serial than chaotically parallel": parallel requires *positive* proof of independence, not "no conflict found").
- **Single-level fan-out (recursion guard).** `childPipeline` must resolve to a pipeline **without decompose** (enforced by `validate`); child pipelines never decompose again.
- **Observable + resumable.** The parent directory has a `portfolio-run.json` (split plan, child list, dependency DAG, each child's execution mode / batch / pipeline / status, runnable frontier, top-level `planner` pointer — the persistent planner reused across children, see §2.1), and each child still has its own `auto-run.json`. `openspec pipeline resume <parent>` computes the next runnable child (`runnableChildren`) from the combined state, and separately reports `interruptedChildren` (children that stopped at `in_progress` on interrupt — **warm-seeded to resume** after restart, not left dead) and `escalatedChildren` (failed / escalated, need human attention); when a child fails/escalates, its dependency chain is stopped, the completed independent children are preserved, and reported along with the frontier.

> Note: the cross-change dependency DAG is recorded in `portfolio-run.json`, not relying on `dependsOn` / `parent` metadata; once `add-change-stacking-awareness` lands, decompose will additionally write this metadata and reuse `openspec change graph`.

---

## 3. Per-stage standalone commands

For fine-grained control, invoke them manually one at a time. The table below is a quick reference; for details see [`commands.md`](./commands.md).

| Stage | Command | Use | Main artifacts |
|---|---|---|---|
| Explore | `/opsx:explore [topic]` | Think things through unstructured, browse code, compare options | (none; can transition to propose/new) |
| Need validation | `/opsx:office-hours` | YC-style need validation (Startup six questions / Builder brainstorm) | `office-hours-design.md` |
| Kickoff | `/opsx:propose [name-or-desc]` | Create a change in one step + generate all planning artifacts | proposal/design/specs/tasks |
| Kickoff (fine-grained) | `/opsx:new` → `/opsx:continue` → `/opsx:ff` | One artifact at a time / generate the next by dependency / generate all at once | Same as above, in steps |
| Implement | `/opsx:apply` | Implement per `tasks.md`, checking off items | Code + checked-off tasks |
| Verify | `/opsx:verify` | Check that the implementation matches the artifacts (spec scenarios) | Verification conclusion |
| Deep verify | `/opsx:verify-enhanced` | Artifact checks + code review + security audit + browser QA + visual audit (auto-scales by change size) | Various reports |
| **Iterative review loop** | `/opsx:review-cycle` | review→triage→fix→re-review(Δ)→{pass\|loop\|escalate}; also auto's `review-loop` stage | `review-cycle-report.md` |
| Deliver | `/opsx:ship` | Test, push, create PR, optional merge & deploy; PR body from proposal (always run with `model: sonnet` in the pipeline) | `ship-log.md` |
| Archive | `/opsx:archive` / `/opsx:bulk-archive` | Archive the change, merging delta specs into canonical specs (always run with `model: sonnet` in the pipeline) | Archive directory + updated specs |
| Merge spec | `/opsx:sync` | Merge delta specs into main specs | Updated specs |
| Retrospective | `/opsx:retro [change]` | Engineering retrospective: analyze what shipped, patterns, learnings (change/general/global modes) | `retro.md` |
| **Handoff** | `/opsx:handoff` | Probe context usage and write a handoff doc for a new session / successor worker to continue (opt-in) | `handoff/lead-<n>.md` + run-state pointer |
| Onboard | `/opsx:onboard` | Walk through a complete workflow cycle as a tutorial | (tutorial) |

### 3.1 `/opsx:explore` — think it through first
An unstructured exploration conversation: browse code, compare options, sketch diagrams. Once an idea takes shape you can transition to `/opsx:propose` (default) or `/opsx:new` (expanded).

### 3.2 `/opsx:office-hours` — validate whether the need is worth doing first
Two modes: **Startup** (six forcing questions interrogating the real need) / **Builder** (design brainstorm). The output document has two landing spots:
- **Existing active change**: written to `openspec/changes/<id>/office-hours-design.md` (fixed name within the task directory, same as `proposal.md`; auto-consumed by propose).
- **Not kicked off yet**: derive a kebab-case slug from the topic and write `openspec/office-hours/<topic-slug>.md` — **one file per topic**, so multiple validations of different ideas don't overwrite each other (do not use a single fixed name).

### 3.3 `/opsx:propose` — kickoff + generate planning artifacts in one step
Create `openspec/changes/<id>/` and generate all the artifacts needed before implementation (spec-driven: proposal → specs → design → tasks), stopping at the "ready to apply" state. For stepwise control use expanded `/opsx:new` + `/opsx:continue`.

### 3.4 `/opsx:apply` — implement
Implement item by item per `tasks.md`, checking off the checkboxes. You can go back and change any artifact at any time during implementation (no phase gate).

### 3.5 `/opsx:review-cycle` — iterative review loop (also `/opsx:auto`'s review-loop stage)
The **iterative** loop after implementation: call `openspec-review` to do the review → triage by fix size (trivial / non-trivial / design-level) → fix → **re-review only the delta** → until no Blocker/Major or hit the cap and escalate to a human.

Key points (see the [design document](./review-cycle-workflow-design.md) for details):
- **Author ≠ verifier**: a fix only counts as resolved once a "non-fix-author" confirms it against the original issue; an inline trivial fix uses "independent re-run of the gate + reading the diff" as the equivalent non-author review and records it.
- **Multi-agent is the primary path**: review / fix / re-review are different roles of isolated workers; under Tier A (Claude Code + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) the lead uses `SendMessage` to revive the original reviewer to audit only the delta. Only when there's no sub-agent capability does it **degrade** to single-context "fresh review against the delta + shared findings file" (explicit fallback, not the baseline). Shares the same orchestration playbook as `/opsx:auto`.
- **Termination**: max rounds (default 3); if there are still unresolved issues at the cap → stop and escalate to a human, never quietly passing.
- **Profile**: opt-in (in `ALL_WORKFLOWS`, not in `core`).

### 3.6 `/opsx:verify` / `/opsx:verify-enhanced` — verify
`verify` checks that the implementation matches the artifacts; `verify-enhanced` is multi-stage deep verification (artifact checks + code review + security audit + browser QA + visual audit), auto-scaled by change size, invoking the relevant expert skills internally.

### 3.7 Context awareness and handoff (`openspec agent context` + `/opsx:handoff`)

An agent can't perceive its own context usage — it can only **measure** it. `openspec agent context` reads the precise usage from the API usage recorded in the transcript (`--latest` measures the main session itself, `--transcript <path>` measures a specific worker, `--json` outputs `{ model, contextTokens, limit, pct }`). The whole handoff mechanism is built on this probe + the principle of "discrete checkpoints, never injecting a persistent countdown":

- **Session level (manual)**: `/opsx:handoff` is available anytime — probes, writes `openspec/changes/<id>/handoff/lead-<n>.md` (original intent / key decisions / dead ends / next step), and records the `sessionHandoff` pointer in `auto-run.json`. The `/opsx:auto` entry does a non-blocking pre-check (≥ threshold only reminds once, the user decides). Not handing off is fine — the harness's auto-compact is the fallback.
- **Worker level (automatic)**: every dispatch prompt carries a handoff clause — when the worker notices being compacted / hitting a soft budget, it writes `handoff/<role>-<n>.md` (fixer / debugger must include an "eliminated hypotheses and evidence" section), returns a structured `HANDOFF {path, reason, completed, remaining}`; the LEAD accounts for it (the stage's `handoffs[]`, single-writer invariant) and dispatches a successor to continue within the same session, without interrupting the pipeline. Before each `SendMessage` continuation (re-review / planner reuse) the LEAD also probes that worker first, and if over threshold "writes a handoff doc → retires and replaces".
- **Relay cap and escalation ladder (LEAD-first, minimizing human interruption)**: `maxRelays` (default 3, the 4th triggers LEAD review) + `stallLimit` (2 consecutive no-progress triggers early; eliminating one hypothesis counts as progress). LEAD review picks a strategy by cost: change approach / adjust seeding → send back to planner for a higher-dimensional redo → decompose and isolate, all recorded in `strategyAttempts`; only when the strategy budget (default 3) is exhausted is the stage marked `escalated` and **suspended** — the rest of the work continues, and it's reported centrally at the next gate or run end. Never quietly passing, and never interrupting the whole run because of a single stuck stage. review-loop rounds exhausted also go through this ladder, instead of immediately interrupting to call a human.
- **Config** (pipeline.yaml, resolution order stage > `roles[role]` (thresholds only) > pipeline > built-in default `{threshold: 0.5, maxRelays: 3, stallLimit: 2}`):

  ```yaml
  handoff:
    threshold: 0.5
    roles: { reviewer: 0.65, fixer: 0.65 }   # expensive-to-load roles get more headroom
    maxRelays: 3
    stallLimit: 2
  stages:
    - id: review-loop
      handoff: { threshold: 0.7, maxRelays: 5 }   # relax the capacity dimension for hard problems; the quality dimension (maxRounds) is not relaxed
  ```

- **Resume consumption**: `openspec pipeline resume --json` outputs `sessionHandoff` / each stage's latest handoff-doc pointer / each worker's `contextEstimate`; a new session **reads the handoff doc first** (the distillate), with raw-transcript warm seeding degrading to fallback.

### 3.8 Expert skills (always installed, invoked on demand)

Regardless of profile, `openspec init` installs a set of expert skills (generated as `openspec-*`) that can be invoked individually during verification / planning:

`/review` (code review), `/qa` `/qa-only` (QA), `/cso` (security), `/benchmark` (performance), `/design-review` `/design-consultation` (design / visual), `/investigate` `/careful` `/guard` (investigation / careful / guardrails), `/freeze` `/unfreeze`, `/codex`, `/setup-browser-cookies`, etc.

---

## 4. Underlying CLI commands (the deterministic base that slash commands depend on)

Slash commands are the "conductors"; the `openspec` CLI is what actually reads / writes state and does validation / archiving (and can be used manually directly). See [`cli.md`](./cli.md) for details.

| Command | Use |
|---|---|
| `openspec init [path] --tools <list>` | Initialize; generate skills/commands per AI tool |
| `openspec update` | Refresh generated instruction files after a CLI upgrade |
| `openspec new change <name> [--schema <s>]` | Create a change directory + `.openspec.yaml` |
| `openspec status --change <id> [--json]` | Show an artifact-completion status for a change (done/total/blocked) |
| `openspec instructions [artifact] --change <id> [--json]` | Output the generation instructions for an artifact (this is how slash commands work) |
| `openspec list [--specs] [--json]` | List changes or specs |
| `openspec show [item] [--json] [--deltas-only]` | Show a change/spec |
| `openspec validate [item] [--all\|--changes\|--specs\|--pipelines] [--strict] [--json]` | Validate structure / scenarios / archive-safety (including pipeline definitions) |
| `openspec pipeline <list\|show <name>\|classify "<task>"\|resume <change>> [--json]` | Data-driven pipeline registry: list / view DAG / classify task / resume (`auto` fetches the pipeline from this) |
| `openspec archive <change> [--skip-specs] [--no-validate]` | Archive + merge deltas into canonical specs |
| `openspec templates / schemas [--json]` | View artifact-template paths / available schemas |
| `openspec config <list\|profile\|edit>` | View / switch profile and delivery |
| `openspec schema <init\|fork\|validate\|which>` | Manage custom workflow schemas |

**AI-friendly**: `list/show/validate/status/instructions/templates/schemas/pipeline` all support `--json`, for programmatic consumption by commands / scripts.

---

## 5. Profile and delivery (decide which commands are available and how they're generated)

- **Profile = which workflow commands to install**:
  - `core` (default) = `propose` / `explore` / `apply` / `archive`.
  - `custom` (expanded) = a set you select, which can include `new` `continue` `ff` `verify` `sync` `bulk-archive` `onboard` `review-cycle` `handoff` plus the fusion commands `auto` `ship` `verify-enhanced` `office-hours` `retro`.
  - **Expert skills are profile-independent and always installed**.
- **Enable expanded / fusion commands**:
  ```bash
  openspec config profile      # interactively select profile + workflows
  openspec update              # regenerate the corresponding skills/commands in the project
  ```
- **Delivery = generate a skill, a command, or both**: `both` (default) / `skills` / `commands` / `skills-first` / `commands-first`. Set in the global config (`openspec config`).
  - ⚠️ **Orchestration relies on skills**: `/opsx:auto` and `/opsx:review-cycle` have the model **invoke other skills** at runtime (workers invoke stage skills; review-loop invokes `openspec-review`). The model can invoke skills, **not** commands — so `commands` / `commands-first` (which drop skills that have a command counterpart) will **break orchestration**. To keep orchestration working, keep the skills: use `both` (default) or `skills` / `skills-first`.
  - ⚠️ Note: if the global config sets `delivery: commands-first`, `openspec init` generates commands and removes the corresponding workflow skill directories — this will also make "asserts a skill file was generated" tests fail on that machine (a known spot; the test side needs to isolate the global config).

### Upgrading an already-installed project (to get this release's orchestration + pipeline)

For projects that have already run an older `openspec init`, **don't** rerun init — use **`openspec update`**:

1. **Upgrade the CLI package itself first** (`update` does not upgrade itself):
   - Global: `npm install -g @fission-ai/openspec@latest` (same for pnpm/yarn/bun, see [`installation.md`](./installation.md))
   - Local devDep: bump the version and reinstall (see [`local-install.md`](./local-install.md))
2. **Refresh the generated artifacts in the project**:
   ```bash
   openspec update          # regenerate .claude/skills + commands per the configured tools/profile/delivery; includes legacy migration
   ```
   This gets you this release's `auto` / `review-cycle` instructions (orchestration + tiers + run-state). Your `openspec/` (changes / specs) contents are unaffected.
3. **The new `openspec pipeline` CLI and built-in pipelines ship with the package** — they're **immediately available** in the upgraded binary, with nothing to generate into the project.
4. If you were previously on `core` profile and want to enable this release's opt-in workflows (`review-cycle` / fusion `auto`, etc.): first `openspec config profile` to re-select, then `openspec update`.

> `init` vs `update`: `init` is the **first-time** setup (creates the `openspec/` scaffold + selects the tool); **for already-installed projects use `update`** to upgrade. Both detect and guide cleanup of legacy files (see [`migration-guide.md`](./migration-guide.md)).

---

## 6. Complete examples

### 6.1 One-shot (autopilot, orchestration-style)
```text
You: /opsx:auto Add an "export all data" feature to the settings page

AI:  Default pipeline small-feature (not explicitly specified; can be overridden; Enter to confirm)
     Detect tier: Tier A (agent-teams on) → LEAD orchestrates role-isolated sub-agents
     Fetch the DAG from the registry: propose → apply → verify → review-loop → ship → archive
     ▸ planner worker → generate proposal/specs/tasks
     ⏸ gate: plan done, take a look before implementing? → You: continue
     ▸ implementer worker (≠planner) → implement + check off tasks
     ⏸ gate: implementation done, proceed to verify? → You: continue
     ▸ reviewer worker (≠implementer) → /review finds 1 Major
     ▸ review-loop: dispatch fixer to fix → SendMessage wakes the original reviewer to re-review only the delta → clean
     ⏸ gate: proceed to deliver? → You: don't ship yet (run-state saved, can `pipeline resume` to continue)
```

### 6.2 Manual per-stage (fine-grained control)
```bash
# 1) Think it through (optional)
/opsx:explore How to do mobile auth

# 2) Kickoff (generate proposal/design/specs/tasks)
/opsx:propose add-jwt-auth
openspec status --change add-jwt-auth        # check artifact completion

# 3) Implement
/opsx:apply

# 4) Iterative review loop: review → fix → re-review only the delta (= auto's review-loop, run manually on its own)
/opsx:review-cycle

# 5) Deep verify (auto-scaled by size)
/opsx:verify-enhanced

# 6) Deliver
/opsx:ship

# 7) Archive (merge delta spec into canonical specs)
openspec validate add-jwt-auth --strict
openspec archive add-jwt-auth

# 8) Retrospective (optional)
/opsx:retro add-jwt-auth
```

---

## 7. Quick reference

| I want to… | Use |
|---|---|
| Run end-to-end with one command | `/opsx:auto <task>` (default small-feature pipeline) |
| Specify a particular pipeline | `/opsx:auto --pipeline <name> <task>` or `/opsx:auto <name> <task>` |
| See which pipelines exist | `openspec pipeline list` |
| Think it through before acting | `/opsx:explore` |
| Validate whether the need is worth doing | `/opsx:office-hours` |
| Kickoff + generate a plan | `/opsx:propose` (fine-grained: `/opsx:new` + `/opsx:continue` + `/opsx:ff`) |
| Implement | `/opsx:apply` |
| Review → fix → re-review (until clean) | `/opsx:review-cycle` |
| Deep verify (code / security / QA / visual) | `/opsx:verify-enhanced` (or `/opsx:verify`) |
| Run a single expert on its own | `/review` `/cso` `/qa` `/benchmark` `/design-review` … |
| Deliver (tests / PR / deploy) | `/opsx:ship` |
| Archive and merge spec | `/opsx:archive` (or CLI `openspec archive`) |
| Retrospective | `/opsx:retro` |
| Measure context usage / hand off | `openspec agent context --latest`; `/opsx:handoff` |
| View change completion | `openspec status --change <id>` |
| Validate | `openspec validate <id> --strict` |
| Enable more commands | `openspec config profile` → `openspec update` |
---

## 8. Claude / Codex agent runtime switching

The OPSX pipeline now supports switching each role individually to `claude` or `codex`. The switchable roles are:

- `planner`
- `implementer`
- `reviewer`
- `fixer`
- `shipper`

Temporary switch for a single `/opsx:auto` invocation:

```text
/opsx:auto --planner codex --reviewer codex --fixer claude <task>
```

To pin to a pipeline, use the CLI to write a project-local override:

```bash
openspec pipeline agents small-feature --planner codex --reviewer codex
openspec pipeline agents small-feature --json
openspec pipeline show small-feature --json
```

This creates or updates:

```text
openspec/pipelines/small-feature/pipeline.yaml
```

The resolution priority is still `project > user > package`, so built-in pipelines are not modified; the current project will prefer the local override. To switch back to Claude:

```bash
openspec pipeline agents small-feature --planner claude --reviewer claude
```

You can also write role defaults directly in `pipeline.yaml`:

```yaml
agents:
  planner:
    runtime: codex
    sessionReuse: run-planner
    sandbox: workspace-write
  reviewer:
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
  fixer: claude
```

The stage level can still override role defaults:

```yaml
stages:
  - id: verify
    skill: openspec:review
    role: reviewer
    runtime: codex
    sessionReuse: review-thread
    sandbox: read-only
```

Session-resume semantics differ:

- A Claude worker records `agentId` / `transcript`, and after a restart warm-seeds a new worker from the transcript.
- A Codex worker records `threadId` / `turnId`, and after a restart prefers `thread/resume(threadId)` to continue the same Codex thread.

`openspec pipeline resume <change> --json` puts both kinds of resume handles in `workers`, distinguished by `runtime`.
