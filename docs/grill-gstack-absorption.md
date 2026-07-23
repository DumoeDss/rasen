# The current state of grill and gstack absorption into OpenSpec

> As of 2026-07-07, recording the real landed shape after `unify-expert-template-pipeline` was archived.
> This is a "current-state snapshot + how we got here", not a changelog. For changelogs, see each change's retro in `openspec/changes/archive/`.
> Companion reading: `docs/artifact-workflow-guide.md` (command overview), `docs/review-cycle-workflow-design.md` (review-loop design), `skills/experts/docs/` (expert-skill architecture).
> Terminology note: "OPSX" was the name used for the fusion workflow layer at the time this snapshot was written. The term has since been retired; the same layer is called **the artifact workflow** in current docs (see `docs/artifact-workflow.md`). References to "OPSX" below describe what it was called then, not the current name.

## 0. The one-paragraph current state

OPSX (OpenSpec's fusion workflow layer) has **absorbed** both **grill** (Matt Pocock's skill set, MIT) and **gstack** (a parallel methodology/tooling layer) **into a single system**: 19 expert skills with TypeScript templates as the single source, unified `openspec` naming, orchestrated by OPSX workflow commands. The original grill / gstack entry points, toolchains, and branding have all exited; only the absorbed capabilities remain inside OpenSpec.

One nuance to note: **the "skill-identity layer" (how the user invokes them, what they are named, where they install) is 100% de-gstacked; the "internal-code layer" (runtime paths, file-format markers, vendored tools) still retains a number of gstack strings** — part of which would change behavior if touched (so left alone), part of which is historical commentary (clearable but not required). Section 5 has the honest inventory.

## 1. Background: what each of these three terms is

| Term | Essence | Role in this repo |
|---|---|---|
| **OpenSpec** | The core of spec-driven development: `propose → apply → archive` + CLI + change/spec artifact system | The host/substrate |
| **OPSX** (retired name; now "the artifact workflow") | The "fusion workflow layer" on top of OpenSpec: `/opsx:auto` orchestrator, pipeline registry, ship/verify-enhanced/office-hours/retro commands, LEAD+worker orchestration model | The workflow layer that grew out of absorbing grill/gstack |
| **grill** | Matt Pocock's skill set (MIT-licensed): code review, grilling interview discipline, bug diagnosis, routing, methodology design primitives | Source of capabilities — "absorbed" into expert skills and workflow commands |
| **gstack** | A parallel methodology + tooling layer (expert skills, ship/retro, browse browser tool, orchestration) | Source of tooling — "folded in" to OPSX, exiting as a standalone system |

In one sentence: grill provides "method and discipline", gstack provides "experts and tooling", and both were digested by OPSX, leaving only OpenSpec as the single system.

## 2. Fusion timeline (in archive order)

Each step is an archived OpenSpec change; commits are in each change's retro.

1. **`gstack-skills-integration`** — first wired gstack expert skills into OpenSpec (template source + sidecar + registration + `openspec init` install).
2. **`add-grill-expert-skills`** — introduced grill's methodology experts (`codebase-design` / `tdd` / `prototype`, MIT), filling the "method-level design primitive" gap.
3. **`review-two-axis-absorption`** — folded grill's `code-review` into the P0 `review`, making it a two-axis (Standards + Spec) parallel review.
4. **`office-hours-grilling-absorption`** — folded grill's `grilling` interview discipline into `office-hours` (ask one question at a time, give a recommended answer, don't ask what can be looked up in code).
5. **`investigate-diagnosing-absorption`** — folded grill's `diagnosing-bugs` into `investigate` (build a red-reproducing feedback loop before talking hypotheses).
6. **`navigator-router-skill`** — grill's `ask-matt` evolved into the `navigator` routing skill, sketching the OPSX main flow + expert map.
7. **A batch of `remove-*` / cleanup changes** (`remove-gstack-features`, `remove-conductor-config`, `remove-gstack-upgrade-skill`, `remove-setup-browser-cookies-skill`, `dead-stub-removal`, `eureka-telemetry-removal`, `preamble-migration`, `browse-skill-ethos-cleanup`, `legacy-cleanup`, etc.) — incrementally removing unneeded gstack features/telemetry/stubs.
8. **`remove-parallel-lifecycle-skills`** — removed 10 parallel lifecycle experts (`/autoplan`, `/plan-*-review`, `/canary`, `/document-release`, `/setup-deploy`, etc.), and absorbed the `ship`/`retro` contracts into the self-contained `/opsx:ship`, `/opsx:retro` workflows. Expert roster 30→20.
9. **`fuse-methodology-into-opsx`** — wired grill's four teaching-level methodologies into `propose`/`apply`/`explore`; fixed a live bug in `schema.yaml`'s `enhance` hook; cleaned stale examples from the main spec.
10. **`reconcile-fusion-seams`** — fixed the three seams found by the fusion-matrix review + **wholesale removal of the `domain-modeling` expert** (its CONTEXT.md/ADR working style structurally conflicted with the change-directory flow), roster 20→19.
11. **`ship-delivery-modes`** — restructured the ship contract (see §4.3): the "blind merge main + unconditional full test" lifted verbatim from gstack `/ship` was replaced by three delivery modes + an evidence gate.
12. **`unify-expert-template-pipeline`** — inlined the 19 expert sources from `.tmpl` to TS templates, deleted the bun/gen-skill-docs/skill-check toolchain, unified the freshness gate on a parity hash, **removed the gstack branding** (dirName `openspec-<name>`, skill id `openspec:<name>`, source dir `skills/experts/`).

## 3. Current architecture (the post-fusion landed shape)

### 3.1 Three-layer structure

```
┌─────────────────────────────────────────────────────────────┐
│  Upper layer: expert skills (19 openspec:<name>, on demand)  │
│  review / cso / benchmark / qa / design-review / ...         │
│  + methodology trio: codebase-design / tdd / prototype       │
├─────────────────────────────────────────────────────────────┤
│  Middle layer: OPSX workflow commands (/opsx:*)              │
│  explore → propose → apply → verify/review-cycle             │
│  → ship → archive → retro    driver: /opsx:auto              │
├─────────────────────────────────────────────────────────────┤
│  Lower layer: openspec CLI (deterministic state base:        │
│  read/write/validate/archive)                                │
│  propose/apply/archive + pipeline/validate/status/...        │
└─────────────────────────────────────────────────────────────┘
```

- **The lower-layer CLI** is the core of spec-driven development; all slash commands ultimately land on it.
- **The middle-layer OPSX** strings the scattered CLIs into workflows with gates, loops, and orchestration, and provides the LEAD+worker multi-agent orchestration.
- **The upper-layer experts** are "capability plugins" — standalone skills, conditionally referenced by workflow commands at the right moment, and also directly invocable by the user via `/review` and the like.

### 3.2 The 19 expert skills — inventory and classification

Sources live in `src/core/templates/experts/<name>.ts` (one getter each), sidecars in `skills/experts/<name>/`, registered name `openspec:<name>`, install dir `openspec-<name>`.

**Review/validation family (the parallel expert group in the `review` stage of the full-feature pipeline, triggered by condition)**
- `review` — two-axis review (Standards + Spec), always triggered. Absorbed from grill's `code-review`.
- `cso` — security audit (condition: security-relevant).
- `benchmark` — performance baseline (condition: performance-sensitive).
- `qa` — finds and fixes bugs in a real browser (condition: ui).
- `qa-only` — like qa but report-only, no changes (condition: non-ui).
- `design-review` — design audit + fix loop for rendered UI (condition: ui).
- `design-consultation` — builds a complete design system from scratch (standalone expert, not in the pipeline).

**Methodology trio (grill MIT, conditionally referenced by workflows, not enforced)**
- `codebase-design` — deep-module design vocabulary (module/interface/depth/seam/adapter/leverage/locality). Referenced by `propose` for design-intensive changes.
- `tdd` — one test worth keeping, red→green. Referenced by `apply` for test-first work.
- `prototype` — a throwaway probe that answers one design question; keep the answer, delete the code. Referenced by `explore` for design questions where "stuck, only hands-on makes it clear".

**Debugging/diagnosis**
- `investigate` — systematic root-cause debugging, iron rule "build a red-reproducing feedback loop before talking hypotheses". Absorbed from grill's `diagnosing-bugs`.

**Browser tool / second opinion / routing / interview**
- `chrome-use` — drives the user's own Chrome over CDP (navigate, click, capture network/cookies/WASM). Replaced the fork's original vendored `browse` tool (see §5).
- `codex` — hands the task to Codex for an independent second opinion or parallel implementation.
- `navigator` — routing skill, sketches this repo's skill map (evolved from grill's `ask-matt`).
- `office-hours` — YC-style demand validation, Startup mode (six questions) + Builder mode (design brainstorm). Absorbs grill's `grilling` interview discipline.

**Edit-safety family**
- `careful` — warns before destructive commands (rm -rf / DROP TABLE / force-push). Referenced by `apply`.
- `guard` — careful + freeze turned on together.
- `freeze` — hard-locks edits to one directory.
- `unfreeze` — releases the directory lock.

> The roster went from 30 early on (including parallel lifecycle experts) → 20 (parallel lifecycle removed) → **19** (domain-modeling removed). Currently stable at 19.

### 3.3 grill's fate

| grill skill | Destination |
|---|---|
| `code-review` | → `review` (two-axis Standards+Spec) |
| `grilling` (interview discipline) | → the interview phase of `office-hours` |
| `diagnosing-bugs` | → `investigate` (feedback-loop first) |
| `ask-matt` (routing) | → `navigator` |
| `codebase-design` / `tdd` / `prototype` (methodology) | → standalone expert skills + conditional wiring into propose/apply/explore |
| `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, `/setup-matt-pocock-skills` | **Not introduced** (this fork doesn't need them) |

grill's MIT attribution is retained in the header of each skill source file that absorbs it (e.g. the `<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->` in `review.ts`, `navigator.ts`, `codebase-design.ts`, etc.).

### 3.4 gstack's fate

| gstack capability | Destination |
|---|---|
| Expert-skill layer (review/cso/qa/chrome-use/...) | → the 19 experts (de-gstacked) |
| `/ship` + `/land-and-deploy` | → `/opsx:ship` (land-and-deploy becomes `--deploy`) |
| `/retro` | → `/opsx:retro` |
| browse browser tool | → initially the vendored `browse` expert; replaced in the fork by the CDP-based `chrome-use` expert (see §5) |
| Orchestration model | → the OPSX LEAD+worker orchestration playbook |
| `/autoplan`, `/plan-*-review`, `/canary`, `/document-release`, `/setup-deploy`, `/setup-browser-cookies`, conductor config, upgrade skill, telemetry | **Deleted** |

The main axis is established: **OPSX workflows consume a pure expert layer; gstack no longer exists as a standalone system.**

### 3.5 How the methodology experts are wired (conditional reference, not inline)

The grill methodology trio (`codebase-design`/`tdd`/`prototype`) does **not** inline the expert body into the workflow instructions; instead it uses a sentence or two of "conditional reference" telling the agent when to call that standalone skill, and lands the artifacts in the change directory (not the skill's own path). The landing points:

- `propose.ts` — "Design-intensive change (new module / non-trivial interface) → first consult `/codebase-design`, record the interface/design decisions in `design.md`'s Decisions."
- `apply-change.ts` — "Test-first work → consult `/tdd`; touching destructive operations → consult `/careful`."
- `explore.ts` — "Design question stuck, only hands-on makes it clear → use the `/prototype` probe, keep the answer, delete the code."

This "reference rather than inline" is to keep explore/propose/apply's "grab/plan/implement" core job from being diluted by methodology text. `schema.yaml` no longer carries any `enhance` hook (mechanism retained dormant, currently no consumers).

### 3.6 Orchestration model (LEAD + role-isolated workers)

`/opsx:auto` is the driver: the LEAD (orchestrator, does not write artifacts itself) dispatches each stage along the pipeline DAG to a **role-isolated leaf worker** (planner/implementer/reviewer/fixer/shipper), and the worker calls that stage's corresponding OPSX skill. Key invariants:

- **author ≠ verifier**: the reviewer cannot be the author; a fix must be re-checked by a non-author.
- **The change directory is the blackboard**: stages hand off via artifacts in `openspec/changes/<name>/` (proposal/design/tasks/specs/review-report/ship-log), not via shared memory.
- **Gates**: gate stages pause to wait for a human; the review-loop is bounded (default 3 rounds), and at the cap with Blocker/Major findings remaining it does not silently pass — it goes through the LEAD escalation ladder.
- **Tier A/B/C**: with agent-teams (Tier A) `SendMessage` warm-resume is available; spawn-only, no warm-resume (Tier B); single-context fallback (Tier C). The pipeline definition is consistent across the three tiers; only the mechanism differs.

## 4. Source, build, naming

### 4.1 The single source for expert skills

`src/core/templates/experts/<name>.ts` is the **single authoritative source** for expert skills — each getter returns a `SkillTemplate`, and the instruction body is a TS template string. Shared blocks (PREAMBLE, BROWSE_SETUP, SPEC_REVIEW_LOOP, ... — 14 in total) are extracted into constants in `src/core/templates/experts/_shared.ts`. `openspec init`/`update` generates the install-side `SKILL.md` + sidecar from these templates.

> This is the core outcome of `unify-expert-template-pipeline`: previously the source was `skills/gstack/<name>/SKILL.md.tmpl`, generated by bun + `gen-skill-docs`. Now unified to TS templates + a parity-hash freshness gate, with the toolchain deleted.

### 4.2 Naming rules (after de-gstacking)

| Dimension | Old | New |
|---|---|---|
| Skill invocation id | `gstack:<name>` | `openspec:<name>` |
| Install directory name | `openspec-gstack-<name>` | `openspec-<name>` |
| Source directory | `skills/gstack/` | `skills/experts/` (sidecars only) |
| Workflow commands | `/ship`, `/retro` | `/opsx:ship`, `/opsx:retro` |

The `openspec-`-prefixed workflow skills (explore/propose/apply/...) and the `openspec-`-prefixed expert skills now share the same namespace, unambiguously (`openspec-review` the expert vs `openspec-review-cycle` the workflow — different names).

### 4.3 Freshness gate: parity golden-master

`test/core/templates/skill-templates-parity.test.ts` pins template content with two sets of hashes: `EXPECTED_FUNCTION_HASHES` (a structural hash per getter) and `EXPECTED_GENERATED_SKILL_CONTENT_HASHES` (a generated-content hash). Change a template and you must recompute the hashes in lockstep or the test goes red — this is the "freshness gate", replacing the old gen-skill-docs consistency check. All 19 experts are now covered.

### 4.4 The ship contract (restructured after dropping gstack assumptions)

gstack's `/ship` assumed "feature branch forks from main, PRs back to main", so it unconditionally merged base + ran a full test. That is a **correctness error** for direct-push-to-working-branch, decompose-subtask shared-worktree, and similar scenarios. After the `ship-delivery-modes` restructure:

- **Three delivery modes**: `pr` (open a PR) / `push` (push the current branch directly) / `local` (commit only, for decompose subtasks). Resolution order: explicit parameter > existing PR > repo convention > ask the user, **never defaulting to the repo's default branch**.
- **Commit is a first-class step of ship** (hook-failure fixups retry, never `--no-verify`).
- **Test changed to an evidence gate**: if there is green-test evidence (the code covered by the passing tests recorded in the review/verify report is unchanged), skip; otherwise run.
- **After all decompose subtasks in a chain are done**, a single unified push/PR is done at the composition layer.

## 5. Residual gstack strings (honest inventory)

De-branding targets the **skill-identity layer**. The internal-code layer still has gstack strings, classified into three kinds by nature — **most of these are "changing it would change behavior" or "historical record", deliberately retained**:

### 5.1 Deliberately retained (functional)

- **Orphan-cleanup prefix constant**: `RETIRED_EXPERT_SKILL_PREFIX = 'openspec-gstack-'` in `src/core/legacy-cleanup.ts`. `init`/`update` uses it to exact-match and delete the old install directories left behind by the rename (`openspec-gstack-*`), with a near-miss test to avoid collateral damage to `openspec-*`. Change it and the orphans won't be cleaned up.
- **Runtime state directory for the freeze family**: `freeze`/`guard`/`investigate`/`unfreeze` write lock state to `${CLAUDE_PLUGIN_DATA:-$HOME/.gstack}`. Changing the path would invalidate freeze locks already on users' machines. This is a runtime state directory, out of scope for de-branding.
- **The review engine's file-format marker**: `## GSTACK REVIEW REPORT` in `_shared.ts` is the fixed section name the review report writes into the plan file (a stable string identifier). Renaming it is a file-format change.
- **design-sketch temp-file prefix**: `/tmp/gstack-sketch-*.html/png` in `_shared.ts`. Pure temp naming; downstream skills reference screenshots by this path.

### 5.2 Internal naming of vendored tools

- **`browse`** was originally a gstack-vendored headless-browser tool (real Chromium, brought in as a black box under `skills/experts/browse/` with its own `src/`, `test/`, `scripts/build-node-server.sh`). The fork **removed** it and replaced it with **`chrome-use`**, which drives the user's own Chrome over CDP via a vendored Node proxy under `skills/experts/chrome-use/` rather than shipping a compiled browser binary.

### 5.3 Historical comments/prose (clearable but not required)

- `// from gstack` / `// migrated from gstack` comments in `skill-generation.ts:48`, `skill-templates.ts:31` — provenance notes, harmless.
- "by the gstack setup script" in `guard.ts:12`, "with gstack expert reviews" in `verify-enhanced.ts:5` — stale comments.
- "Do NOT persist gstack-style `.context/retros/*.json`" in `retro.ts:80` — this is telling the agent **not** to do the old gstack behavior; "gstack-style" describes the old behavior, so keeping it is reasonable.
- The "OPSX/gstack fusion work" narrative in `docs/` — in `review-cycle-workflow-design.md`, handoff documents — historical narrative, retained.
- gstack mentions in `CHANGELOG.md` — historical release records, **deliberately not changed** (changing them would amount to forging history).

> In one sentence: everything the user sees, invokes, or has installed is openspec; only by digging into the source do you see gstack lingering as "history / runtime path / vendored tool". This is an intentional layering, not a missed spot in cleanup.

## 6. Tests and gates

- **parity golden-master**: `test/core/templates/skill-templates-parity.test.ts` (function hash + generated-content hash, all 19 experts + workflows listed).
- **profiles**: `test/core/profiles.test.ts` guards the core/expanded skill-set split (review-cycle is opt-in, not in core).
- **skill-generation / sidecar-install**: guards generation and install correctness.
- **pipeline-registry**: guards the pipeline DAG (skill references must actually exist — after the rename, `openspec:review` and friends all have to line up).
- **legacy-cleanup**: guards orphan-cleanup precision and near-miss safety.
- The full `pnpm test` currently shows 2091 passed / 22 skipped (the baseline after `unify-expert-template-pipeline` was archived).

## 7. Known follow-ups (non-blocking)

- **archive zero-requirement spec tool gap** (reproduced twice): the archiver cannot rebuild a spec down to zero requirements; an all-REMOVED spec can only go through `--no-validate` + a manual directory delete. Worth a small change to open up a deletion path.
- **navigator's `/opsx:ship` blurb doesn't mention the three modes**: `navigator.ts:22` still says "test, push, open the PR", not reflecting the three delivery modes + evidence gate from §4.3. A one-line fix (leftover F3 from the `ship-delivery-modes` review).
- **ship evidence gate could add a tree fingerprint**: `git rev-parse HEAD^{tree}` is tighter than "HEAD + dirty state" (F2).
- **The `description: '|'` empty-description malaise in expert getters**: every getter except navigator hardcodes an empty YAML block scalar; it is a pre-existing bug, retained per the "behavior unchanged" principle, not fixed on this line.
