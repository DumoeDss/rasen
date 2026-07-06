## Why

After phase0a–0d-absorb the fork has 29 gstack expert skills plus the OPSX workflow commands. That is more than a human can hold in their head, which is exactly the cognitive-load problem `docs/skill-authoring.md` names and prescribes a cure for: *"When user-invoked skills multiply past what you can remember, cure that piled-up cognitive load with a **router skill**: one user-invoked skill that names the others and when to reach for each."*

This change adds that router — a single user-invoked navigation skill (modelled on grill `ask-matt`, MIT) that draws the OPSX main flow plus the 29 experts as a map: main flow, on-ramps, a vocabulary layer, and standalone specialists, each with a one-line "when to reach for it". It gives both a human and the `/opsx:auto` LEAD a place to choose a path. The map reflects the **post-absorb** reality: `/investigate` is the feedback-loop-first debugger (diagnosing-bugs merged), `/review` is the two-axis (Standards + Spec) review.

## Proposed skill name

**`navigator`** — generated as `openspec-gstack-navigator`, invoked `/navigator`. Verified no collision with the 29 experts, the OPSX `/opsx:*` commands, or the CLI subcommands (`init`, `update`, `config`, `list`, `show`, `spec`, `validate`, `view`, `archive`, `change`, `completion`, `feedback`, `agent`, `pipeline`). Alternatives if preferred: `guide`, `atlas`.

## What Changes

### 1. New user-invoked router skill

Create `skills/gstack/navigator/SKILL.md.tmpl` (adapted from `ask-matt`, MIT) whose body is a four-part map:

- **Main flow (idea → ship)** — `/opsx:explore` (or `/opsx:office-hours` to validate demand first) → `/opsx:propose` → `/opsx:apply` → `/opsx:review-cycle` (or `/opsx:verify` / `/opsx:verify-enhanced`) → `/opsx:ship` → `/opsx:archive` → `/opsx:retro`; `/opsx:auto` drives the whole thing.
- **On-ramps** — "something's broken" → `/investigate` (refuses to theorise until it has a red-capable feedback loop); "is this worth building" → `/opsx:office-hours`.
- **Vocabulary layer** (runs underneath) — `/domain-modeling`, `/codebase-design`.
- **Standalone** — `/tdd`, `/prototype`, `/review`, `/qa`, `/qa-only`, `/design-review`, `/design-consultation`, `/benchmark`, `/cso`, `/codex`, `/browse`, `/document-release`, `/retro`; deploy family (`/land-and-deploy`, `/setup-deploy`, `/canary`); plan family (`/autoplan`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`); security family (`/careful`, `/freeze`, `/guard`, `/unfreeze`).

### 2. Make it genuinely user-invoked (mechanism extension — see reconciliation)

Per `docs/skill-authoring.md`, a router must be user-invoked: `disable-model-invocation: true`, with the `description` reduced to a human-facing one-line summary with trigger lists stripped, so it carries **zero context load** and never auto-fires. The current install path cannot express this (`generateSkillContent` emits a fixed frontmatter and the expert `.ts` strips the source frontmatter), so this change adds minimal support: a `disableModelInvocation?: boolean` field on `SkillTemplate`, emitted as `disable-model-invocation: true` by `generateSkillContent` when set, and set by the navigator template.

### 3. Register the skill (mirror of the established expert chain) + count +1

Create `src/core/templates/experts/navigator.ts` (mirrors `investigate.ts`, additionally setting `disableModelInvocation: true` and the router description), add the export to `experts/index.ts`, the re-export to `skill-templates.ts`, the import + `getSkillTemplates()` entry (`dirName: 'openspec-gstack-navigator'`, `workflowId: 'navigator'`) to `skill-generation.ts`, and an AGENTS.md row. Bump the **expert** count by 1 in the four `skill-generation.test.ts` assertions (see sibling-conflict guidance).

### 4. MIT attribution

The navigator tmpl carries an `adapted from mattpocock/skills (MIT, Copyright Matt Pocock)` NOTICE after the frontmatter (ask-matt pattern), same convention as 0c/0d-absorb.

## Scope reconciliation (flagged for review)

**The router needs a small mechanism extension to be user-invoked.** The LEAD framed this change as content + registration, but `generateSkillContent` regenerates a fixed frontmatter that has no `disable-model-invocation` and no source-frontmatter passthrough — so without the item-2 extension, a `disable-model-invocation` in the tmpl is silently dropped at install and the router would be model-invocable (carrying context load and able to auto-fire). Item 2 is the faithful way to honor "router 本身是 user-invoked … 防 model 常驻误触发" and `docs/skill-authoring.md`.

- **Chosen path (this proposal):** add the minimal `disableModelInvocation` support. Cost: a small `.ts` change (SkillTemplate type + generateSkillContent + one test assertion) and a TypeScript build gate.
- **Fallback (if a zero-mechanism change is preferred):** make navigator an ordinary model-invocable expert with a narrow description ("use only when the user explicitly asks which skill/workflow fits, or for a skill map/overview"). Weaker — it still carries context load and can auto-fire — and diverges from the fork's own skill-authoring standard. Flagged for the LEAD to confirm; the map content is identical either way.

## Sibling conflict guidance (add-context-handoff, shared working tree)

The sibling change `add-context-handoff` adds a **workflow** (`handoff`), bumping the workflow count (17→18) and the total, and edits `skill-templates.ts` and `skill-generation.ts` (`getSkillTemplates` workflow array) and `profiles.ts`. `workflows/handoff.ts` is already present in the shared tree. To avoid clobbering:

- **skill-templates.ts / experts/index.ts:** add only the navigator re-export/export line; never touch the sibling's `handoff` line. Distinct lines merge cleanly.
- **skill-generation.ts:** the navigator entry goes in the **expertSkills** array; the sibling's `handoff` goes in the **workflowSkills** array — different arrays. The item-2 `generateSkillContent` edit is a different function than the sibling's `getSkillTemplates` edit — coexists.
- **skill-generation.test.ts count assertions:** express this change as **+1 to the expert component**, applied to whatever value is committed at implementation time. `add-context-handoff` changes the workflow count, so the shared total assertion (L13) may already read one higher when this change is applied. Concretely: L13 total +1, L70 (`4 workflow + N expert`) +1, L89 (`0 workflow + N expert`) +1, L95 (`1 workflow + N expert`) +1, and update the "29 expert" comments to "30 expert". Do **not** hardcode 47/34/30/31 assuming base 46 — apply the delta on the current values. L89/L95/L70 track the expert count and are this change's alone; only L13 (total) is co-edited with the sibling.
- **profiles.ts / profiles.test.ts:** untouched here (navigator is an expert, not a workflow) — that file is the sibling's.

## Capabilities

### New Capabilities

- `navigator-router-skill`: The user-invoked navigator router skill — source template, registration, count, MIT attribution.
- `skill-user-invocation-support`: `disableModelInvocation` support in `SkillTemplate` + `generateSkillContent` so a skill can be installed user-invoked.

## Impact

New:
- `skills/gstack/navigator/SKILL.md.tmpl`
- `src/core/templates/experts/navigator.ts`

Edited:
- `src/core/templates/types.ts` — `disableModelInvocation?: boolean` on `SkillTemplate`
- `src/core/shared/skill-generation.ts` — `generateSkillContent` emits `disable-model-invocation`; navigator entry in `getSkillTemplates` expertSkills
- `src/core/templates/experts/index.ts` — navigator export
- `src/core/templates/skill-templates.ts` — navigator re-export
- `test/core/shared/skill-generation.test.ts` — four count assertions +1 expert; one assertion for the emitted `disable-model-invocation`
- `skills/gstack/docs/AGENTS.md` — navigator row

Generated: `skills/gstack/navigator/SKILL.md`

Verification: `bun run gen:skill-docs` (30 experts), TypeScript build, `bun run skill:check` FRESH, the bumped count assertions + the new frontmatter assertion green, `openspec validate --strict`.
