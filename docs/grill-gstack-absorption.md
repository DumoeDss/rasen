# The current state of grill and gstack absorption into OpenSpec

> As of 2026-07-07, recording the real landed shape after `unify-expert-template-pipeline` was archived.
> This is a "current-state snapshot + how we got here", not a changelog. For changelogs, see each change's retro in `openspec/changes/archive/`.
> Companion reading: `docs/artifact-workflow-guide.md` (command overview), `docs/review-cycle-workflow-design.md` (review-loop design), `skills/experts/docs/` (expert-skill architecture).
> Terminology note: "OPSX" was the name used for the fusion workflow layer at the time this snapshot was written. The term has since been retired; the same layer is called **the artifact workflow** in current docs (see `docs/artifact-workflow.md`). References to "OPSX" below describe what it was called then, not the current name.

## 0. The one-paragraph current state

Rasen's artifact workflow has **absorbed** both **grill** (Matt Pocock's skill set, MIT) and **gstack** (a parallel methodology/tooling layer) into one system. Twelve capabilities remain standalone experts with TypeScript templates as their source; single-host methodologies now ship as lazy references owned by their host workflow. The original grill/gstack entry points, toolchains, and branding have exited.

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
│  Upper layer: expert skills (12 rasen-<name>, on demand)     │
│  review / cso / benchmark / qa / design-review / ...         │
│  + host references under propose / apply / explore / help    │
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
- **The upper-layer experts** are independently invokable or dispatchable capability plugins. Single-host methods live one layer down as lazy host references instead of adding public expert identities.

### 3.2 The 12 standalone expert skills — inventory and classification

Sources live in `src/core/templates/experts/<name>.ts` (one getter each), sidecars in `skills/experts/<name>/`, and install under the canonical `rasen-<name>` skill identity.

**Review/validation family (the parallel expert group in the `review` stage of the full-feature pipeline, triggered by condition)**
- `review` — two-axis review (Standards + Spec), always triggered. Absorbed from grill's `code-review`.
- `cso` — security audit (condition: security-relevant).
- `benchmark` — performance baseline (condition: performance-sensitive).
- `qa` — browser-first QA. Standalone mode can fix and re-verify; dispatched or explicit report-only/non-UI mode writes `qa-report.md` without edits.
- `design-review` — design audit + fix loop for rendered UI (condition: ui).
- `design-consultation` — builds a complete design system from scratch (standalone expert, not in the pipeline).

**Host-owned methodology references (grill MIT, loaded conditionally)**
- `rasen-propose` owns `references/codebase-design/README.md` for design-intensive changes.
- `rasen-apply-change` owns `references/tdd/README.md` for test-first work.
- `rasen-explore` owns `references/prototype/README.md` for bounded throwaway probes.

**Debugging/diagnosis**
- `investigate` — systematic root-cause debugging, iron rule "build a red-reproducing feedback loop before talking hypotheses". Absorbed from grill's `diagnosing-bugs`.

**Browser tool / second opinion / routing / interview**
- `chrome-use` — drives the user's own Chrome over CDP (navigate, click, capture network/cookies/WASM). Replaced the fork's original vendored `browse` tool (see §5).
- `codex` — hands the task to Codex for an independent second opinion or parallel implementation.
- `rasen-help` owns `references/navigator.md`, the detailed routing map evolved from grill's `ask-matt`.
- `office-hours` — YC-style demand validation, Startup mode (six questions) + Builder mode (design brainstorm). Absorbs grill's `grilling` interview discipline.

**Edit-safety family**
- `careful` — warns before destructive commands (rm -rf / DROP TABLE / force-push). Referenced by `apply`.
- **Historical (retired):** the absorbed upstream catalog once carried three
  separate directory-boundary commands, and Rasen briefly replaced them with
  a runtime edit-boundary command. Both generations are superseded. Current
  workflows declare the evidence-backed affected area and audit the actual
  changed-file set; managed sandbox/workspace policy provides execution
  containment where required.

> The standalone roster went from 30 early on → 20 after parallel-lifecycle removal → 19 after domain-modeling removal → 18 after later catalog changes → **12** after moving five single-host methods into their hosts and merging QA-only into QA.

### 3.3 grill's fate

| grill skill | Destination |
|---|---|
| `code-review` | → `review` (two-axis Standards+Spec) |
| `grilling` (interview discipline) | → the interview phase of `office-hours` |
| `diagnosing-bugs` | → `investigate` (feedback-loop first) |
| `ask-matt` (routing) | → `rasen-help`'s bundled `references/navigator.md` |
| `codebase-design` / `tdd` / `prototype` (methodology) | → bundled references in propose/apply/explore |
| `/to-prd`, `/to-issues`, `/implement`, `/triage`, `/improve-codebase-architecture`, `/research`, `/teach`, `/grill-me`, `/grill-with-docs`, `/setup-matt-pocock-skills` | **Not introduced** (this fork doesn't need them) |

grill's MIT attribution is retained in each adapted source/reference file, including the navigator and the codebase-design/TDD/prototype entry and deeper sidecars.

### 3.4 gstack's fate

| gstack capability | Destination |
|---|---|
| Expert-skill layer (review/cso/qa/chrome-use/...) | → the 12 standalone experts (de-gstacked) |
| `/ship` + `/land-and-deploy` | → `/opsx:ship` (land-and-deploy becomes `--deploy`) |
| `/retro` | → `/opsx:retro` |
| browse browser tool | → initially the vendored `browse` expert; replaced in the fork by the CDP-based `chrome-use` expert (see §5) |
| Orchestration model | → the OPSX LEAD+worker orchestration playbook |
| `/autoplan`, `/plan-*-review`, `/canary`, `/document-release`, `/setup-deploy`, `/setup-browser-cookies`, conductor config, upgrade skill, telemetry | **Deleted** |

The main axis is established: **OPSX workflows consume a pure expert layer; gstack no longer exists as a standalone system.**

### 3.5 How the host-owned methodologies are wired (conditional reference, not inline)

The grill methodology trio does **not** inline its body into workflow instructions. Each host names an installed relative entry and reads it only when the branch applies, then lands durable decisions in the change directory. The routes are:

- `propose.ts` → `references/codebase-design/README.md`; record interface/design decisions under `changeRoot`.
- `apply-change.ts` → `references/tdd/README.md`; `rasen-careful` remains independent for destructive operations.
- `explore.ts` → `references/prototype/README.md`; keep the answer under `changeRoot` and delete the probe.

This "reference rather than inline" is to keep explore/propose/apply's "grab/plan/implement" core job from being diluted by methodology text. `schema.yaml` no longer carries any `enhance` hook (mechanism retained dormant, currently no consumers).

### 3.6 Orchestration model (LEAD + role-isolated workers)

`/opsx:auto` is the driver: the LEAD (orchestrator, does not write artifacts itself) dispatches each stage along the pipeline DAG to a **role-isolated leaf worker** (planner/implementer/reviewer/fixer/shipper), and the worker calls that stage's corresponding OPSX skill. Key invariants:

- **author ≠ verifier**: the reviewer cannot be the author; a fix must be re-checked by a non-author.
- **The change directory is the blackboard**: stages hand off via artifacts in `openspec/changes/<name>/` (proposal/design/tasks/specs/review-report/ship-log), not via shared memory.
- **Gates**: gate stages pause to wait for a human; the review-loop is bounded (default 3 rounds), and at the cap with Blocker/Major findings remaining it does not silently pass — it goes through the LEAD escalation ladder.
- **Tier A/B/C**: with agent-teams (Tier A) `SendMessage` warm-resume is available; spawn-only, no warm-resume (Tier B); single-context fallback (Tier C). The pipeline definition is consistent across the three tiers; only the mechanism differs.

## 4. Source, build, naming

### 4.1 The single source for expert skills

`src/core/templates/experts/<name>.ts` is the authoritative source for each standalone expert's router/body. Shared blocks live in `src/core/templates/experts/_shared.ts`. Expert sidecars live under `skills/experts/<id>/`; host-owned workflow references live under `skills/workflows/<dirName>/`. `rasen init`/`update` generates `SKILL.md` and copies both nested sidecar forms.

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

`test/core/templates/skill-templates-parity.test.ts` pins template content with function and generated-content hashes. Catalog digests additionally cover nested sidecars, and the artifact ledger detects missing or changed installed references. All 12 standalone experts and every workflow router are covered.

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
- **Historical runtime state:** the absorbed upstream boundary commands wrote
  plugin-local state. Current Rasen removes that obsolete state and stores
  checkout-scoped records under its base machine-data directory.
- **The review engine's file-format marker**: `## GSTACK REVIEW REPORT` in `_shared.ts` is the fixed section name the review report writes into the plan file (a stable string identifier). Renaming it is a file-format change.
- **design-sketch temp-file prefix**: `/tmp/gstack-sketch-*.html/png` in `_shared.ts`. Pure temp naming; downstream skills reference screenshots by this path.

### 5.2 Internal naming of vendored tools

- **`browse`** was originally a gstack-vendored headless-browser tool (real Chromium, brought in as a black box under `skills/experts/browse/` with its own `src/`, `test/`, `scripts/build-node-server.sh`). The fork **removed** it and replaced it with **`chrome-use`**, which drives the user's own Chrome over CDP via a vendored Node proxy under `skills/experts/chrome-use/` rather than shipping a compiled browser binary.

### 5.3 Historical comments/prose (clearable but not required)

- `// from gstack` / `// migrated from gstack` comments in `skill-generation.ts:48`, `skill-templates.ts:31` — provenance notes, harmless.
- Historical stale comments from the absorbed command templates were removed
  when those templates were retired.
- "Do NOT persist gstack-style `.context/retros/*.json`" in `retro.ts:80` — this is telling the agent **not** to do the old gstack behavior; "gstack-style" describes the old behavior, so keeping it is reasonable.
- The "OPSX/gstack fusion work" narrative in `docs/` — in `review-cycle-workflow-design.md`, handoff documents — historical narrative, retained.
- gstack mentions in `CHANGELOG.md` — historical release records, **deliberately not changed** (changing them would amount to forging history).

> In one sentence: everything the user sees, invokes, or has installed is openspec; only by digging into the source do you see gstack lingering as "history / runtime path / vendored tool". This is an intentional layering, not a missed spot in cleanup.

## 6. Tests and gates

- **parity golden-master**: `test/core/templates/skill-templates-parity.test.ts` (function hash + generated-content hash for the 12 experts and workflows).
- **profiles**: `test/core/profiles.test.ts` guards the core/expanded skill-set split (review-cycle is opt-in, not in core).
- **skill-generation / sidecar-install**: guards generation and install correctness.
- **pipeline-registry**: guards the pipeline DAG (skill references must actually exist — after the rename, `openspec:review` and friends all have to line up).
- **legacy-cleanup**: guards orphan-cleanup precision and near-miss safety.
- The full `pnpm test` currently shows 2091 passed / 22 skipped (the baseline after `unify-expert-template-pipeline` was archived).

## 7. Known follow-ups (non-blocking)

- **archive zero-requirement spec tool gap** (reproduced twice): the archiver cannot rebuild a spec down to zero requirements; an all-REMOVED spec can only go through `--no-validate` + a manual directory delete. Worth a small change to open up a deletion path.
- **ship evidence gate could add a tree fingerprint**: `git rev-parse HEAD^{tree}` is tighter than "HEAD + dirty state" (F2).
