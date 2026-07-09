## Context

When goal-loop shipped, its four templates were wired into the generation pipeline (`getSkillTemplates()` / `getCommandTemplates()` in `src/core/shared/skill-generation.ts:180-183`) and pinned by parity tests. The profile system, however, has a separate set of registries that gate which workflows a profile actually installs, and the goal IDs were never added to them:

- `ALL_WORKFLOWS` (`src/core/profiles.ts:19-39`) — the `full` profile's workflow set.
- `WORKFLOW_TO_SKILL_DIR` — **two** copies: the exported typed one in `src/core/profile-sync-drift.ts:19-41` (consumed by migration/update) and a local `Record<string, string>` copy in `src/core/init.ts:77-97`.
- `COMMAND_IDS` (`src/core/shared/tool-detection.ts:33-55`).

Propagation of the bug: `update.ts` resolves the `full` profile to `getProfileWorkflows('full')` = `ALL_WORKFLOWS`, passes it as the `workflowFilter` to `getSkillTemplates`/`getCommandTemplates`, and the filter (`skill-generation.ts:209-214`) keeps only entries whose `workflowId` is in the set. Goal entries are absent from the set, so they are dropped. Expert skills bypass the filter (always installed), which is why only the goal family goes missing. `init.ts` is affected the same way.

Consistency cross-check: the parity test already pins all four goal templates, and `validate.ts` calls `getSkillTemplates()` with no filter (so it "knows" goal). The registries are the sole point of contradiction; filling them removes it.

## Goals / Non-Goals

**Goals:**
- `rasen update`/`init` under the `full` profile emit the four `rasen-goal*` skill directories and the `/rasen:goal` command payload.
- The goal family becomes a first-class registered workflow across all profile-system registries so drift detection, the `custom` picker, and unselected-dir removal all recognize it.

**Non-Goals:**
- Adding goal to `CORE_WORKFLOWS`. Goal is an opt-in advanced feature; the `core` profile stays lean (decision below).
- De-duplicating the two `WORKFLOW_TO_SKILL_DIR` copies. That structural duplication predates this change; consolidating it is a separate refactor (follow-up below), out of scope here.
- Any edit to template source files. This is a pure registry-fill in `src/core`.

## Decisions

**Decision: registry-fill only, four entries per registry, no refactor.** Add `goal-plan`, `goal-iterate`, `goal-report`, `goal-command` to `ALL_WORKFLOWS`; add the four skill-dir mappings to both `WORKFLOW_TO_SKILL_DIR` copies; add `goal-command` to `COMMAND_IDS`. The directory names come verbatim from `skill-generation.ts:180-183` (`rasen-goal-plan`, `rasen-goal-iterate`, `rasen-goal-report`, and `rasen-goal` for the command — note the command's dir has no `-command` suffix). Alternative considered: refactor the two `WORKFLOW_TO_SKILL_DIR` copies into a single source of truth so this class of drift cannot recur — rejected for this change because it widens blast radius beyond the fix; recorded as a follow-up.

**Decision: goal stays out of `CORE_WORKFLOWS`.** Adding it to `ALL_WORKFLOWS` only makes it a `full`-profile / opt-in `custom` selection. This matches `auto-command`'s placement (in core) being deliberate while the goal family, being a heavier advanced surface, is not. Presented to the user, who did not object.

**Decision: extend tests to assert deployment behavior.** Profile/registry tests may assert `ALL_WORKFLOWS` membership or length; update/init e2e tests may assert emitted directory counts. These get updated, and a positive assertion is added that after `update` the four `rasen-goal*` dirs plus the goal command payload exist. Test path values use `path.join()` per repo convention.

## Risks / Trade-offs

- **Parity-hash drift** → No template source is edited, so the parity test must not move. If a parity hash moves, that signals an accidental template edit — stop and investigate before pasting any new hash. (Mitigation: verify diff touches only `src/core/profiles.ts`, `profile-sync-drift.ts`, `init.ts`, `tool-detection.ts`, and tests.)
- **The two `WORKFLOW_TO_SKILL_DIR` copies drift again** → Both are edited in this change; the follow-up refactor is the durable fix. Left as accepted debt for now.
- **Shared working tree** → Another session is editing `docs/` and template workflow files concurrently. Ship must use explicit pathspec and `git show --stat` review to avoid staging non-change files. This is an operational (ship-time) risk, not a code risk.

## Migration Plan

No data or config migration. Behavior change is additive: existing projects that run `rasen update` after this ships will gain the goal directories and command; nothing is removed. `full`-profile projects gain the goal family; `custom`-profile projects gain the ability to select it. Rollback is reverting the registry edits.

## Open Questions

None. Diagnosis and decisions are settled per planning-context.md.

## Follow-up

- Consolidate the duplicated `WORKFLOW_TO_SKILL_DIR` (`profile-sync-drift.ts` and `init.ts`) into a single exported source of truth to prevent recurrence of this drift class. Separate refactor change.
