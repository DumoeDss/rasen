## 1. Re-verify dependencies before writing anything

- [x] 1.1 Re-read child A's exported surface in `src/core/store/index.ts` and confirm SIGNATURES (not just names) of `resolveStoreBinding`, `hasStoreDeclaration`, `inspectRegisteredStore`, and `identity-types.ts` — especially `ResolvedProjectCheckoutRef`, whose first real consumer this change is.
- [x] 1.2 Re-verify child B's FINAL state. B was proposed, not implemented, when this was planned. Confirm whether `src/core/store/membership.ts` exists and what `resolveProjectMembership` actually returns; if it does not exist, keep today's pointer check behind the D6 seam and do not block.
- [x] 1.3 Confirm `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts` and note that `session-launch-context.ts` joins it in this change.
- [x] 1.4 Confirm `packages/ui/src/components/LaunchSessionDialog.tsx` and `packages/ui/src/api/types.ts` are still clear of the concurrent session's edits before touching either; if not, stop and report rather than merging over them.

## 2. Runtime context shape and reader (no writer yet)

- [x] 2.1 Add the `RuntimeContext` types (design D2): `RuntimePlanningRef`, `RuntimeExecutionRef`, `RuntimeContext` with `version`, reusing child A's `ResolvedProjectCheckoutRef` rather than redeclaring it. `uid` optional on the Store arm only, for a Store with legacy metadata.
- [x] 2.2 Add the context-file path resolver under the machine data directory, composed with `path.join()`.
- [x] 2.3 Add the reader: parse, validate against the schema, and confirm the file's session id matches the session asking. A missing, unparseable, or mismatched file is reported — never a silent fallback to cwd derivation.
- [x] 2.4 Unit tests for 2.1–2.3, including the three broken-context branches and a file whose version is unknown.

## 3. Session record carries planning and execution

- [x] 3.1 Extend `SessionRecord` (`src/core/management-api/session-registry.ts`) with the execution identity and checkout binding alongside the existing `space`, keeping the registry dependency-light and its copy-on-read discipline.
- [x] 3.2 Fix the drop at `src/core/management-api/sessions.ts:146-154`: pass `resolved.executionProject` into the session record instead of discarding it. This is the core gap the change exists to close.
- [x] 3.3 Represent planning-only explicitly (`kind: 'planning-only'`), not as an absent field.
- [x] 3.4 Tests: every launch shape from `resolveSessionLaunchContext` produces a record carrying planning, execution, and the exact checkout; planning-only records its kind.

## 4. Supervisor writes the context and hands over its location

- [x] 4.1 Write the context file atomically (temp + rename) BEFORE spawn, so the agent never observes a partial file.
- [x] 4.2 Set `RASEN_SESSION_CONTEXT=<absolute path>` in the child environment at `supervisor.ts` (today `env: process.env`). Pass the PATH — never the JSON (process table, `ps`, log leakage, Windows quoting and length).
- [x] 4.3 Remove the context file when the session finalizes, with the registry's existing exited-record prune as the backstop.
- [x] 4.4 Tests: file complete before spawn; env carries a path and no context contents; file removed on normal exit and on kill; a leftover file from a crashed session affects no later session.

## 5. Resolution precedence

- [x] 5.1 Implement the first-command order (design D4): explicit selector → session context → cwd/pointer fallback, with no step skipped and none consulted after an earlier one answers.
- [x] 5.2 Route the "is planning externalized" checks in the touched files through `hasStoreDeclaration(pointer)`, never `pointer.value !== undefined` — a durable declaration carries no alias.
- [x] 5.3 Make `src/core/learned-skills/context.ts` read the session context instead of re-deriving from cwd. Change WHERE it gets its context, not WHAT it then decides — the effective algorithm is child D's.
- [x] 5.4 Make `src/core/pipeline-registry/run-state.ts` resume through the session context.
- [x] 5.5 Tests: a subprocess in a Store-B session does not revert to the checkout's own Store A; explicit selector beats session context; cwd is used only when neither applies.

## 6. Frozen-run authority and fail-closed

- [x] 6.1 Extend the frozen run-state record with the execution identity alongside the planning root and owner it already carries, under a bumped version; read the old shape as "no execution binding recorded", never as an error.
- [x] 6.2 Implement the frozen-resume rule: frozen identity is authority, session context / current checkout is the locator, explicit selector only cross-checks and can never retarget.
- [x] 6.3 Fail closed on a frozen/checkout identity mismatch, naming both identities and the checkout. Never fall back to another clone.
- [x] 6.4 No-context ladder: matching cwd → single registered checkout → `project_binding_ambiguous` listing candidates.
- [x] 6.5 Canonical comparison via `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a path-form difference never produces a spurious fail-closed.
- [x] 6.6 Tests: each branch of 6.2–6.4; an explicit selector cannot retarget; the ambiguity error lists every candidate.

## 7. ActionContext v2 and the narrowing projection

- [x] 7.1 Add `ActionContextV2` (`src/core/change-status-policy.ts`): `version`, `planningWriteRoots`, `codeWriteRoots`, `readRoots`, `requiresAffectedAreaSelection`, `constraints`.
- [x] 7.2 Compose it per design D5's table for all three session shapes; planning-only gets `codeWriteRoots: []`.
- [x] 7.3 Narrow planning writes to the root's `rasen/specs` and `rasen/changes` rather than granting the repository root.
- [x] 7.4 Security guards, each asserted rather than assumed: no other member checkout in `codeWriteRoots`; no home directory in any list; visibility (`--add-dir`) is not authorization.
- [x] 7.5 Implement the v1 projection so it can only narrow: report v1 only when the union is a subset of what v1 would previously have granted for that same session; otherwise report the newer version.
- [x] 7.6 Make `src/core/artifact-graph/instruction-loader.ts` consume the structured capability so agent instructions state it.
- [x] 7.7 Tests: a test enumerates every session shape and asserts the projected v1 root set is a SUBSET of what v1 previously produced — the one property that must never regress.

## 8. Membership validation seam

- [x] 8.1 Replace the pointer-equality member check at `session-launch-context.ts:174` with a single call behind one seam (design D6).
- [x] 8.2 Back that seam with child B's `resolveProjectMembership` when it exists, and with today's durable-comparison pointer check when it does not.
- [x] 8.3 Keep a project whose primary pointer names a different Store a VALID choice — the session pins planning explicitly.
- [x] 8.4 Add `session-launch-context.ts` to `PHASE_A_FILES` so the by-id-lookup ban keeps covering it.
- [x] 8.5 Tests: valid choice starts; identity mismatch rejected; non-member rejected; plans-elsewhere accepted; unavailable Store stops the launch with a repair command.

## 9. Wire types and UI

- [x] 9.1 Extend `src/core/management-api/wire-types.ts` with the session's execution fields.
- [x] 9.2 Update the hand-maintained mirror in `packages/ui/src/api/types.ts` in the SAME change — an additive server change drifts the mirror silently and nothing fails when it does.
- [x] 9.3 `packages/ui/src/components/LaunchSessionDialog.tsx`: state which project a run will modify, and for planning-only that it will modify none.
- [x] 9.4 (BLOCKED — reported to the LEAD) **SEQUENCING — confirm with the LEAD before starting.** New UI strings need `packages/ui/src/i18n/locales/{en,ja,zh-cn}.json`, which a concurrent session currently owns. Do not edit them opportunistically; if they are still occupied, implement 9.3 against existing keys or stop and report. The CLI-side `src/locales/*.json` work in group 11 is unaffected. — Unblocked and **landed in `stabilize-store-context-foundation` group 4**, not here: three keys (`dialog.launch.member_no_checkout`, `dialog.launch.members_no_checkout`, `dialog.launch.planning_no_code`) added to all three locale files by narrow additive edit, key parity verified programmatically (381/381/381), rendered in `LaunchSessionDialog.tsx`, and covered by five new cases in `packages/ui/test/components/launch-session-dialog.test.tsx` (20/20 green).

## 10. Tests

- [x] 10.1 End-to-end: Store S planning + project P checkout B — a subcommand inside the session still resolves S, P, and B.
- [x] 10.2 Two clones of one project both registered: resume is unambiguous with session context and reports ambiguity without it.
- [x] 10.3 A linked worktree keeps its exact root through launch, freeze, and resume.
- [x] 10.4 A secondary Store membership works without the project's primary pointer naming that Store.
- [x] 10.5 Planning-only has no code write root anywhere in the pipeline: capability, instructions, and status JSON.
- [x] 10.6 Session context reaches no Git-tracked file — assert over the project and Store working trees around a full session.
- [x] 10.7 Malformed and stale context files fail closed at every reader.
- [x] 10.8 Windows scenarios: a worktree root, two clones differing only by separator form, and the environment variable surviving the Windows shim. Expected paths built with `path.join()`.
- [x] 10.9 **Restated** by `stabilize-store-context-foundation` (design D6). Original wording, kept visible: "(LEAD runs the full suite before ship; targeted files all green) Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`." That gate could never be honestly ticked — this repository carries failures that pre-date this child, so the condition depends on work outside what is being gated. The gate this child was actually responsible for: **`pnpm lint` and `pnpm build` green, and one combined verification run carried to completion in which every failure is individually attributed to a cause outside A–D2 — proven by byte-identity to the branch base or by tracing to a non-A–D2 commit.** The run that settles it is the LEAD's, as the original line already said. Settled only against that recorded run. — **Settled** by the combined verification result committed with the change at `stabilize-store-context-foundation/combined-verification-A-D2.md` (task 6.6), which archives alongside these files and can be opened by any later reader. Result: `pnpm lint` exit 0, `pnpm build` exit 0, and one `pnpm test` run carried to completion (284 files, 4931 tests, 4897 passed, 3 failed, 31 skipped). Every failing file is attributed outside A–D2, and the evidence is one command each against branch base `d73c1da2`: `git diff d73c1da2..HEAD -- test/release-contract.test.ts scripts/release-contract.mjs`, `… -- test/cli-e2e/basic.test.ts`, `… -- test/commands/handoff.test.ts src/core/templates/workflows/_orchestration.ts`, and `… -- test/commands/workset.test.ts src/commands/workset.ts` are **all empty** — every failing file is byte-identical to the branch base, so none can have been caused by A–D2 or by this change. The `handoff` assertion went stale at `58faffad` (`git merge-base --is-ancestor 58faffad d73c1da2` → true, i.e. an ancestor of the base); the `workset` case is the known Windows temp-cleanup flake and passes 41/41 in isolation. No failure counts against this child.

## 11. Docs and locales

- [x] 11.1 `docs/cli.md`: the resolution order, the frozen-resume rule, and what a planning-only session cannot do.
- [x] 11.2 Agent contract: agents consume the structured action context; visibility is not authorization; planning-only has no code write root.
- [x] 11.3 Session troubleshooting: broken session context, frozen/checkout mismatch, and ambiguous project binding — each with its repair command.
- [x] 11.4 JSON examples for the session context file and for `ActionContextV2` as reported by `rasen status --json`.
- [x] 11.5 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, diagnostic, and repair string, with no English fallback for the new keys.

## 12. Verification and integration

- [x] 12.1 (verified: `.github/workflows/ci.yml` already runs the whole suite on `windows-latest` / pwsh, so every new path-sensitive file is covered with no matrix entry to add; all of them also pass natively on Windows here) Confirm Windows CI covers this change's path-sensitive test files; add the matrix entry if not.
- [x] 12.2 Diff scenario SETS (not just requirement titles) for every MODIFIED requirement against `rasen/specs/*/spec.md`.
- [x] 12.3 Re-run the cross-change collision check over ALL active change directories — not just portfolio siblings. This change deliberately avoids `session-supervision` and `task-detail-ui` (owned by the unarchived `separate-session-planning-and-execution-context`), `planning-space-addressing` and `store-project-membership` (child B), and `learned-skill-knowledge-context` (child D's sources). Confirm that still holds.
- [x] 12.4 `node bin/rasen.js validate unified-session-runtime-context --changes --strict --json` clean.
- [x] 12.5 **Restated** by `stabilize-store-context-foundation` (design D6, review round 1). Original wording, kept visible: "(deferred to the ship/archive stage — `rasen archive` has no dry run and would archive the change) Rehearse the spec merge (`rasen archive --json --yes`) before ship." **The rehearsal this gate names was never performed**, so it cannot be ticked as written. The gate this child was actually responsible for: **the spec merge for this change is proven to succeed.** Settled by the archive that actually ran — `d258bcca` ("archive unified-session-runtime-context and sync session context into main specs") — which performed the very merge the rehearsal was a proxy for, and succeeded. A completed merge is strictly stronger evidence than a rehearsal of it; recording the substitution here rather than ticking silently is the point.
- [x] 12.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/src/i18n/locales/*`, the other occupied `packages/ui` files, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, and sibling change directories.
- [x] 12.7 Confirm no version number in `package.json` was changed by this work.
