# Design — standalone-retention-context-freeze

## Context

Source report: `local_docs/rasen-retention-standalone-run-state/report.md` (CLI `0.1.6`, generated `rasen-retain` skill `1.0`, observed 2026-08-03). Its eight acceptance criteria and regression matrix are the contract for this change.

Investigation confirmed the report and found the mechanism to be narrower than "a missing feature": the primitives all exist and are simply not wired together.

## Evidence

| Finding | Evidence | In report |
|---|---|---|
| The absent-run-state payload discards a value already in scope | `pipeline.ts:621` computes `stateLocations.ephemeraDir`; the payload at `:825-833` omits it. The invalid-file branch at `:800` already carries `runStatePath` alongside `hasRunState: false`, so the payload can hold a location without a valid state | symptom only |
| No pipeline-less run-state can exist | `RunStateSchema.pipeline` is a required `z.string()` (`run-state.ts:193`); resume treats an empty one as no-run-state (`pipeline.ts:795`) | no |
| Initialization is not repeatable | `initializeRunState` throws when the file exists (`run-state.ts:603-605`), contradicting acceptance criterion 4 | no |
| Writes are not crash-safe | `writeRunState` is a plain `fs.writeFileSync` (`run-state.ts:582-586`) while `writeFileAtomically` (`file-state.ts:101`) is already used by four other subsystems | requirement only |
| The freeze primitive has no production caller | `freezeKnowledgeContext` (`context.ts:1005-1039`) emits v3 when both refs carry durable identity, degrades to v1/v2 otherwise, and fails `knowledge_owner_unknown` without a typed planning root. Referenced only from `test/core/learned-skills/context.test.ts` | no |
| The documented mode lookup disagrees with the gate | `config get` reads the raw stored value and exits 1 with no output when unset (`config.ts:557-566`); the project-scope apply gate reads the effective value (`knowledge.ts:504` → `profile-editor.ts:106-121`). `config list` already prints the effective value (`config.ts:537-541`) | no |
| Rasen is not the sole run-state writer | `writeRunState` ← `initializeRunState` ← `new-change.ts:186` only. All later mutation is LEAD hand-writing, as instructed by `_orchestration.ts:218` and `handoff.ts:29`. `run-state.ts:733-737` carries a duplicate-key scanner written specifically because "a hand-edited `auto-run.json` … is otherwise invisible" | no |

The circular dependency the report names, quoted from the shipped templates: `retain.ts:22` resolves a missing `knowledgeContext` by calling `rasen knowledge list --run-state-dir "<runStateDir>"`, which needs the very directory that does not exist; `codify.md:30` delegates the no-field case back to the parent skill.

## Decisions

### D1 — `pipeline` becomes optional; resume distinguishes three states

A run may carry frozen knowledge identity without a pipeline. `RunStateSchema.pipeline` becomes optional, and resume's `!runState || runState.pipeline.length === 0` guard (`pipeline.ts:795`) splits into "no state file" and "state without a pipeline". `loadPipelineByName` (`pipeline.ts:840`) runs only when a pipeline is present.

This is a relaxation: every run-state file valid today parses unchanged, satisfying acceptance criterion 6.

Rejected — a sentinel pipeline name (e.g. `standalone-retain`): `loadPipelineByName` throws on an unknown name, and the report explicitly warns against freezing a pipeline that was not active during the original run.

Rejected — a separate state file: `knowledge.ts:127-133` requires `auto-run.json` in the directory named by `--run-state-dir`, so a second filename would fork the frozen-identity contract.

### D2 — Report the deterministic location even with no state

The absent-run-state payload gains the `ephemeraDir` already computed at `pipeline.ts:621`, implementing the report's resolution option 1. Precedent: the invalid-file branch already reports a path with `hasRunState: false`.

Note the trap this does **not** remove: `loadFrozenKnowledgeContext` fails closed on a directory holding no `auto-run.json` (`knowledge.ts:127-133`). Reporting the location is therefore necessary but not sufficient — a caller still needs D3 to create the record.

### D3 — One preparation command, resolution option 2

A single Rasen-owned operation that:

1. resolves the **effective** retention mode via `resolveCurrentProfileState` (`profile-editor.ts:127-133`) — the same resolution the apply gate uses at `knowledge.ts:504`;
2. resolves live identity via `resolveLearnedSkillExecutionContext` (`context.ts:774`), reusing the call shape at `knowledge.ts:99-112`;
3. freezes it via `freezeKnowledgeContext` (`context.ts:1005`), connecting the unused primitive rather than writing new logic;
4. writes atomically and idempotently;
5. returns the run-state directory, the frozen context, and the effective mode.

Returning the effective mode dissolves the `config get` divergence structurally: the retention templates stop calling `config get retention` altogether rather than the raw/effective mismatch being patched in two places. This is why the mode belongs in this change and not in a separate one.

### D4 — Idempotence by reuse, not by overwrite

`initializeRunState` throws on an existing file (`run-state.ts:603-605`). Preparation instead reuses what is already recorded: an existing `knowledgeContext` of **any** version is authoritative and left byte-identical (criteria 4 and 6), and only an absent context is minted. Preparation never upgrades v1 or v2 to v3 in place (criterion 6).

### D5 — Atomicity lives here, not in a separate change

`writeRunState` swaps `fs.writeFileSync` for `writeFileAtomically` (`file-state.ts:101`).

Considered and rejected as a standalone change: the only production write today is the single creation write from `new-change.ts:186`, which is small and happens once, so atomicity there has little independent value. It matters for preparation, which updates a file that may already exist and that a LEAD may also be hand-writing. Splitting it out would have produced a change with no consumer and no meaningful test.

### D6 — Concurrency boundary is stated, not solved

Per the evidence table, the LEAD hand-writes `auto-run.json` throughout a run. Atomic writing prevents a torn file from preparation itself; it cannot prevent a concurrent hand-write from clobbering the frozen context. `withOwnerAwareFileLock` / `machineLockPath` (`file-state.ts`) are available if a lock is judged necessary.

Standalone retention runs after a change is complete, so overlap with an active LEAD is not the expected case. Making Rasen the genuine sole writer of run-state is a much larger architectural change and is explicitly out of scope, matching the report's own scope note.

### D7 — Fail closed before any candidate exists

Ambiguous, missing, renamed, or stale ownership fails during preparation, before candidate creation (criterion 5). `freezeKnowledgeContext` already fails `knowledge_owner_unknown` without a typed planning root (`context.ts:1011-1012`), and the frozen branch already rejects a conflicting explicit selector as `knowledge_selector_conflict` (`context.ts:845-863`).

### D8 — Durable identity only

The frozen record stores `{type:'project', projectId, id?}` or `{type:'store', uid, id?}` (`schema.ts:79-93`) and an execution ref carrying at most a `projectId` (`schema.ts:113-116`) — never an absolute root (criterion 7). Rationale already recorded at `context.ts:1000-1003`: run-state is Git-tracked, so an absolute root would misroute across machines. Legacy v1/v2 display-name resolution stays fail-closed, which is what makes criterion 8's two-stores-same-name case resolvable.

## Deviations proven during implementation

Three decisions above were overturned by evidence while building. Recorded here because each one changes a stated mechanism, not just its wording.

### ADR-1 — `writeRunState` stays synchronous; atomicity is temp-write + `renameSync`

D5 says `writeRunState` swaps `fs.writeFileSync` for `writeFileAtomically` (`file-state.ts:101`). It cannot: `writeFileAtomically` is **async**, while `writeRunState` is synchronous and reached synchronously from `initializeRunState` ← `new-change.ts:186`, plus ~30 synchronous test call sites. Making it async would cascade a signature change through the whole run-state surface for no behavioral gain.

Implemented instead as a synchronous temp-write-plus-`renameSync` in the destination directory, which is the established pattern in this repo (`session-runtime-context.ts:332-350`, `global-learned-skill-ledger.ts:218`, `project-learned-skill-ledger.ts:300-325`). The observable contract D5 asked for — an interrupted write leaves the previous complete content or the new complete content, never a torn file — is unchanged.

### ADR-2 — Preparation carries two selector pairs, not one

The original plan threaded `--store`/`--project` as BOTH the planning-root selector and the knowledge-owner selector, on the theory that the two coincide in every supported configuration. Implementation disproved it: `--project <id>` in root selection means *a project registered via `store add-project`* (`root-selection.ts:705-707` → `resolveStoreRoot(…, 'project')`) and rejects any other id with `no_registered_stores`, while `--project <id>` on a knowledge command addresses **any** project identity. They are different namespaces, which is exactly what the knowledge option copy already says ("independently from the planning root"). Conflating them made the spec's "an explicit owner selector that disagrees with recorded identity is refused" scenario unreachable for an ordinary project.

`rasen retain prepare` therefore takes `--store`/`--project` for the planning root (identical to `pipeline resume`, so the shipped store-threading guidance works verbatim) and `--owner-store`/`--owner-project` for the knowledge owner. Each pair is mutually exclusive within itself.

### ADR-3 — Identity resolves from the working directory, guarded by a root-agreement check

D3 step 2 reuses `resolveLearnedSkillExecutionContext` "at the call shape of `knowledge.ts:99-112`". The first implementation passed the *resolved planning root* as `launchDirectory`, to guarantee the identity and the change came from one place. That breaks store-planned changes: with no session context the resolver derives BOTH questions from that one directory (`context.ts:799-804`), so handing it a store root answers "whose knowledge is this" with `knowledge_owner_ambiguous` — "launched directly from store X, which does not identify one member project" — for a case that resolves correctly from the member's own checkout.

`launchDirectory` is `process.cwd()`, exactly as every knowledge command does it. The "one place" guarantee moves to an explicit gate: when the change's planning root and the resolved `planningRoot.root` differ, preparation refuses with `retention_planning_root_mismatch` naming both. That makes the invariant a reported refusal instead of a silent preference, which is the same fail-closed posture as D7.

### Also decided

- **`pipeline resume`'s pipeline-less branch reports, it does not gate.** It skips `resolveResumeExecution`. That gate exists to stop *dispatching stages* into the wrong checkout, and a pipeline-less run-state has no stages; the frozen identity is re-resolved and revalidated by every knowledge command through `--run-state-dir`, which is the real safety boundary. The spec enumerates what this branch reports and gives it no failure arm.
- **Preparation never writes the `retention` field.** The LEAD stays its sole writer (`retain.ts:27`). Preparation reports the effective mode as `retention` and surfaces a recorded one separately as `frozenRetention`, so a pipeline `retain` stage still reads the frozen value while a standalone run gets the value the gate uses.
- **An existing record is updated by raw JSON merge, not a validated round trip.** `parseRunState` normalizes at the read boundary (a non-enum `runtime` moves to `runtimeRaw`, `null` optional fields are dropped) and nested schema defaults apply. Writing that projection back would rewrite records the LEAD hand-wrote, which criterion 6 forbids, so `updateRunStateKnowledgeContext` injects `knowledgeContext` into the parsed raw object, validates the merge, and writes the raw merge.

## Regression matrix

From the report, plus the mode-resolution row this change adds.

| Invocation | Initial state | Expected result |
|---|---|---|
| Standalone `codify` | No run-state, unique project owner | Context frozen; accepted candidate applies |
| Standalone `codify` | No run-state, zero accepted candidates | Successful no-op; no learned skill written |
| Standalone `codify` | No run-state, ambiguous owner | Fails before candidate creation |
| Pipeline `retain` | Existing v3 context | Reused unchanged |
| Pipeline `retain` | Existing v1 or v2 context | Reused unchanged; not upgraded in place |
| Repeated standalone run | Context already initialized | Idempotent reuse, no duplicate record |
| Standalone, `full` profile, no stored `retention` key | — | Reports the effective mode the apply gate uses |
| Store ownership | Two stores sharing a display name | Resolves through durable identity |

## Out of scope

- Making Rasen the sole writer of run-state (report scope note).
- The archive transaction, which completed correctly in the observed run.
- Any change to store-scope or global-scope knowledge authorization, which use explicit approval rather than the retention mode (`knowledge.ts:487-499`, `:539-556`).
