## Context

Rasen generates two prompt bodies per workflow — a skill and a slash command — from parallel template functions, wired through `src/core/command-generation/` (26 tool adapters + generator/registry). A `delivery` global-config setting (`both` | `skills`, plus retired legacy values) gates whether the command copy is emitted. `rasen init`/`rasen update` branch on `delivery`, and update already contains two cleanup paths (`removeCommandFiles`, `removeUnselectedCommandFiles`) that delete rasen command files when delivery is skills-only.

This change (Phase A of the approved doc `rasen/office-hours/skills-only-delivery-runtime-next-steps.md`) retires the command surface entirely. The authoritative source is that doc; the decisions below are its decisions transcribed with the implementation seams verified against the worktree source. Phase B (CLI runtime nextSteps) and Phase C (skill body cleanup) are separate children and out of scope here.

The central risk is a **silent cleanup regression**: the existing update cleanup resolves command-file paths through the very module being deleted (`CommandAdapterRegistry` / `getCommandFileId` / `getCommandFilePathCandidates` / `getLegacyCommandFilePath`) and through the `command` field of each workflow definition (also being deleted). If cleanup is rewired naively, existing installs' command files would never be found and would silently rot. The doc's remedy — freeze the path knowledge into a static module before deleting the live one — drives the key decisions.

## Goals / Non-Goals

**Goals:**
- Retire the `delivery` config dimension with zero read-path errors for any stored value (current or legacy): detect → one-time notice → strip key → rewrite.
- Delete `src/core/command-generation/` and all `get*CommandTemplate` exports with no dangling imports.
- `rasen init` on a fresh project emits skills only and leaves no rasen command files anywhere.
- `rasen update` unconditionally removes pre-existing rasen command files (all path variants, all tools) while never touching user-authored files, using only static knowledge.
- Keep the spec suite coherent (delta specs for every capability whose requirements the deletion invalidates).
- Three-locale parity for all new/changed user-facing strings; no version bump.

**Non-Goals:**
- Skill template body edits (Phase C) — except deleting the `CommandTemplate` template functions, which is mechanical.
- CLI runtime `nextSteps` (Phase B).
- Any change to the pipeline registry, LEAD orchestration, or expert `_shared.ts` dispatched contract.
- Injecting a skills index into any tool's instructions file (explicit non-goal; native tools auto-discover).
- A migration tool for user-authored workflow packages that carry command content — such content is simply ignored on install.

## Decisions

### D1 — `normalizeDelivery` becomes retirement detection, not value normalization

Delete the `Delivery` type, `DEFAULT_CONFIG.delivery`, `LEGACY_DELIVERY_MAP`, and `isLegacyDelivery`. Replace the read seam (`global-config.ts` merge path around :328/:344) with retirement detection: **if a `delivery` key is present with any value**, emit the one-time `legacyDelivery`-style retirement notice, delete the key from the in-memory config, and rewrite the file. Rationale: the current `normalizeDelivery` short-circuits `'both'`/`'skills'` as live values (:62-63) and returns them; simply extending the legacy map would keep treating current values as live. The whole function must invert to "any presence of the key = retired." Alternative rejected: a "collapse to single value" intermediate state — the doc explicitly forbids the middle ground, and a retired setting is cleaner than a one-value setting.

### D2 — Freeze command-path knowledge into `src/core/shared/retired-command-paths.ts` BEFORE deleting the module

Model on `legacy-cleanup.ts`'s `RETIRED_WORKFLOW_COMMAND_IDS`. The new module holds: (a) the frozen list of the 19 built-in command file IDs (the workflow IDs that had command templates, with the `-command` suffix already stripped per `getCommandFileId`); (b) each tool's command file-path rule, i.e. the `getFilePath` conventions currently living in the 26 adapters (`.claude/commands/rasen/<id>.md`, `.cursor/commands/rasen-<id>.md`, etc.); and (c) the path-candidate expansion logic migrated from `command-file-id.ts` — current path, `-command`-suffixed legacy path, and legacy `opsx`-prefix variants (both the `commands/opsx/<id>.md` subdir form and the `opsx-<id>.md` hyphen form). Cleanup reads only this static data — never the live registry or `definition.command`. Rationale: satisfies the "if we generate it, we track it by name in a constant" and "use existing constants — don't invent detection" rules, and removes the silent-cleanup-regression hazard. Alternative rejected: keeping a trimmed adapter registry alive solely for cleanup — that would preserve the dead architecture the doc wants gone.

The 19 command IDs are frozen (not derived) at planning time; the implementer must confirm the exact set from the 19 `get*CommandTemplate` exports (apply, archive, auto, bulk-archive, continue, explore, goal, handoff, help, new, office-hours, onboard, propose, retro, review-cycle, ship, sync, verify, verify-enhanced) resolved through `getCommandFileId` (strips `-command`).

### D3 — Merge the two update cleanup methods into one unconditional legacy cleanup

`removeCommandFiles` (update.ts:564-590) and `removeUnselectedCommandFiles` (:597-637) collapse into a single method that, for every detected tool, deletes all built-in command files (every path candidate from D2) unconditionally, plus the legacy `-command`-suffix variants. `init.ts` has the same-named cleanup (~:1017) and receives the same treatment; init runs it opportunistically on the target dir even for fresh projects. Preserve the existing safety boundary: only known-id rasen files are deleted, never user-authored files. Output string becomes "Removed: N command files (commands have been consolidated into skills)". Rationale: the doc's A3; one unconditional path replaces two delivery-conditioned ones.

### D4 — `config set delivery` and the registry: retire the key with a graceful notice, not a hard unknown-key error

Remove `delivery` from the `config-key-registry` settable set (so it no longer appears in key listings or the interactive editor). But a bare removal makes `config set delivery X` fail with a raw "unknown key" error, which is a worse experience than today's graceful consolidation. Decision: add `delivery` to a small **retired-keys** set that `config set`/`config unset` recognize — writing it emits the retirement notice and is a no-op (not persisted), rather than erroring. Rationale: honors the doc's "reading a legacy value never errors" spirit at the write seam too, without keeping a live settable key. Alternative rejected: keep `delivery` as a live registry key that swallows values — that contradicts "the setting has been retired" and would keep it in editor listings. [Implementer discretion on the exact retired-key mechanism; the observable contract — friendly notice, no persistence, no crash — is fixed by the cli-config delta spec.]

### D5 — Type deletion is the safety net for hidden consumers

Deleting the `command` field from `workflow-registry/types.ts` and the `CommandContent`/`CommandTemplate` types forces every consumer to surface at compile time. Beyond the doc's named `migration.ts:48` and `profile-sync-drift.ts`, the type deletion will also break `workflow-artifact-ledger.ts` (:138-140/:248-250, resolves command paths via `CommandAdapterRegistry` + `getCommandFileId`) and `profile-editor.ts:200` (`getCommandFileId`). Each is rewired to the static module (for path knowledge) or has its command branch dropped (for ledger/editor logic that only existed to track the command copy). `codex-home.ts` is NOT a consumer — its `command-generation` mention is a stale prose comment; the file is used across the codex module and stays. Rationale: lean on the compiler rather than a hand-maintained consumer list.

### D6 — Spec coherence: 10 delta capabilities, cleanup added to `legacy-cleanup` not a new capability

The command surface is referenced at the requirement level in more specs than the doc enumerated. All are given delta specs so archive can reconcile without leaving false requirements: `command-generation` (whole capability REMOVED), `profiles`, `cli-init`, `cli-update`, `cli-config`, `config-key-registry`, `legacy-cleanup` (cleanup requirement ADDED), `workflow-template-parity`, `workflow-library`, `methodology-expert-fusion`. Scenario renames/removals use REMOVED + ADDED entries (archive enforces this even though validate does not). The retired-command-paths cleanup is an ADDED requirement inside `legacy-cleanup`, matching the `RETIRED_WORKFLOW_COMMAND_IDS` precedent, rather than a new capability.

## Risks / Trade-offs

- **Silent cleanup regression** (existing installs keep stale command files) → D2 freezes path knowledge into a static module before the live one is deleted; D3 makes cleanup unconditional; an update test asserts a seeded command file is removed while a user-authored file survives.
- **Hidden `command-generation` consumer missed** → D5 deletes the types so the compiler enumerates every consumer; a full-repo grep for `command-generation` must return zero imports before the module directory is removed.
- **`config set delivery` regresses from graceful to crash** → D4 routes retired keys through a friendly no-op notice; cli-config delta spec pins the observable contract.
- **Locale drift** (notice added to `en` only) → tasks require en/ja/zh-cn in the same step; existing locale-parity tests guard.
- **Over-reaching into Phase C** (touching skill bodies) → strictly limited to deleting `CommandTemplate` functions and dropping "command template" clauses from parity/fusion scenarios; no skill body prose is edited.
- **Windows path assumptions in the static path module** → all paths built with `path.join`; per-tool rules copied verbatim from adapters (which already use `path.join`).

## Migration Plan

1. Add `retired-command-paths.ts` + `shared/yaml.ts` (`quoteYamlValue`) — additive, nothing deleted yet, compiles green.
2. Rewire `update.ts`/`init.ts` cleanup to the static module (D3), keeping the old module still present; run cleanup tests.
3. Retire `delivery` in `global-config.ts` (D1) + config/registry/UX (D4) + locales.
4. Delete `get*CommandTemplate` exports + `CommandTemplate`/`CommandContent` types; fix every compile break (D5).
5. Delete `src/core/command-generation/`; grep-confirm zero residual imports.
6. Delta specs, tests, docs, CHANGELOG.

Rollback: the command surface is recoverable wholesale from git history (the doc explicitly accepts "restore from history if ever needed"), so no runtime feature flag is warranted.

## Open Questions

- Exact retired-key mechanism for `config set delivery` (D4) — left to implementer; only the observable contract is spec-pinned.
- Whether `docs/how-commands-work.md` is deleted outright or rewritten as "how skills work" — implementer discretion during the docs sweep; not spec-bound.
