## 1. Re-verify dependencies

- [ ] 1.1 Re-verify child A's final exported surface (signatures, not names): `resolveStoreBinding` and its tri-state, `requireConfigStoreLayer` vs `resolveConfigStoreLayer`, `hasStoreDeclaration`, `inspectRegisteredStore`, `identity-diagnostics.ts`, and especially `writeDurablePointer` from `upgrade-identity.ts`.
- [ ] 1.2 Re-verify child B's FINAL state — proposed only when this was planned. Confirm `src/core/store/membership.ts` and `resolveProjectMembership`. If absent, the group-3 seam reports "cannot verify here" rather than failing.
- [ ] 1.3 Re-verify child D2's FINAL state — proposed only when this was planned. Confirm `src/core/project-knowledge-home.ts`. If absent, the group-6 seam reports rather than failing.
- [ ] 1.4 Confirm `store-bootstrap` is still unclaimed by any other active change directory.
- [ ] 1.5 Note which files this change migrates off by-id Store lookup and add each to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`.

## 2. State machine and report shape (pure computation, no I/O beyond reads)

- [ ] 2.1 New `src/core/store/bootstrap.ts`: read the project identity, the planning Store declaration in either form (via `hasStoreDeclaration`, never `pointer.value`), and the membership hints.
- [ ] 2.2 Build the expected Store set and classify each into exactly one state: verified · present-unregistered · absent-with-remote · absent-without-remote.
- [ ] 2.3 Report shape with the three end states — complete, degraded, blocked — and per-item missing/repair detail.
- [ ] 2.4 Resolve every Store through `resolveStoreBinding` / the tri-state, never `listRegisteredStores().find(id)`.
- [ ] 2.5 Tests: every classification branch; the three end states; an absent-without-remote Store demands a path and infers nothing from a display name, a sibling directory, or a recorded path.

## 3. Membership verification seam

- [ ] 3.1 One seam for "does this Store's own record include this project", backed by child B's `resolveProjectMembership` when present.
- [ ] 3.2 When child B has not landed, the seam reports "cannot verify here" and the result degrades — it never fails and never guesses.
- [ ] 3.3 Tests: a recorded member verifies; a missing record degrades with its repair; the unlanded-dependency path degrades rather than failing.

## 4. Check mode and preview mode as separate guarantees

- [ ] 4.1 Check mode: reads only. **No network contact at all** — no remote resolution, no clone, no register, no mint, no directory, no write.
- [ ] 4.2 Preview mode: additionally resolves remotes and the exact target path, and still creates no directory, runs no version-control operation, and writes nothing.
- [ ] 4.3 Do NOT collapse these into one shared "safe mode" flag — they are different promises and each has its own assertion.
- [ ] 4.4 Tests: whole-tree snapshot around each mode proving zero writes; a check-mode test asserting no remote was contacted; a preview-mode test asserting the reported target path matches what apply then uses.

## 5. Project-first apply

- [ ] 5.1 Register the current project checkout.
- [ ] 5.2 Per-Store actions behind explicit consent: register a present-unregistered Store; obtain and register an absent-with-remote Store.
- [ ] 5.3 Verify each Store's record of this project after the Store is available.
- [ ] 5.4 Order the steps as the state machine states, so an interruption leaves a state a rerun can resume.
- [ ] 5.5 Tests: end-to-end from a clean machine fixture; a partial run resumes; consent is required before anything is obtained.

## 6. Knowledge location preparation

- [ ] 6.1 One seam for preparing the project's local knowledge location, backed by child D2's knowledge home when present.
- [ ] 6.2 Create empty base directories only — invent no content and import nothing.
- [ ] 6.3 Plan an explicit portable bundle import as a SEPARATE reported step; do not perform it (that is the following change).
- [ ] 6.4 Tests: base directories exist after apply and contain nothing; the seam degrades cleanly when D2 has not landed.

## 7. Store-first flow

- [ ] 7.1 Verify the Store's identity, register the checkout, read its project records.
- [ ] 7.2 List each recorded project as already present on this machine or obtainable.
- [ ] 7.3 Obtain and register a project ONLY on explicit selection or an explicit path.
- [ ] 7.4 **Never obtain every project the Store records** — assert this directly with a multi-project fixture.
- [ ] 7.5 **`--yes` is NOT selection in the Store-first flow** (LEAD adjudication): it covers registering the Store's own checkout and other non-expanding confirmations only. A Store's roster is authored by other people and can grow without the local user knowing, so `--yes` must never turn "I trust my own config" into "obtain whatever this Store now lists".
- [ ] 7.6 Tests: listing with mixed local/obtainable state; selecting none obtains nothing; selecting one obtains exactly that one; `--yes` with no selection registers the Store checkout and obtains no project.

## 8. Clone target selection and safety

- [ ] 8.1 Priority: explicit path → parent directory plus safe derived name → interactive.
- [ ] 8.2 Refuse a target directory that already has contents, naming it.
- [ ] 8.3 Never overwrite an existing checkout.
- [ ] 8.4 Never take a location from a legacy recorded source path.
- [ ] 8.5 Pass the remote as an ARGUMENT to the version-control operation with `windowsHide`; never assemble a shell command line.
- [ ] 8.6 Derived name safety: no separator, no traversal, no Windows reserved device name — reuse the existing safe-name rules rather than writing a second set.
- [ ] 8.7 Remove a failed retrieval's directory only when this run provably created it and removal is safe; otherwise leave it and report what to inspect.
- [ ] 8.8 Tests: each priority branch; each forbidden case; a pre-existing directory survives a failed retrieval.

## 9. Idempotence

- [ ] 9.1 A rerun rewrites no identity, creates no duplicate registration, changes no recorded path, repeats no import.
- [ ] 9.2 JSON marks `already_registered` and `already_hydrated`, distinguishable from items acted on.
- [ ] 9.3 Display-name and remote drift are reported and never corrected automatically.
- [ ] 9.4 Tests: second run writes nothing; exactly one registry entry per Store with an unchanged path; drift reported not fixed.

## 10. Durable declarations and pasteable hints (design D7)

- [ ] 10.1 Every declaration bootstrap writes goes through `writeDurablePointer` — the single durable-declaration writer.
- [ ] 10.2 Record the object form with the permanent identity AND the display name whenever the Store has one, so surfaces that still compare on the name keep working. Never write a bare display name.
- [ ] 10.3 A Store with no display name: report the limitation and its repair rather than writing a declaration that silently fails elsewhere.
- [ ] 10.4 Every printed follow-up command names an unambiguous selector — the permanent identity when the display name matches more than one Store on this machine, the display name otherwise.
- [ ] 10.5 Tests assert what LANDS IN THE FILE, not what the message says (child A's most expensive defect was a bare string written into a Git-tracked file); plus a hint test with two Stores sharing a display name.

## 11. Ordinary-command repair text and doctor

- [ ] 11.1 An unavailable declared Store names bootstrap as the repair; an unlocatable one states a path or remote is required; a mismatched checkout fails with zero writes.
- [ ] 11.2 A unique legacy display name still works and prompts to upgrade; an ambiguous one fails.
- [ ] 11.3 An unregistered membership Store leaves learned knowledge degraded with cleanup deferred — report only; do not implement the deferral, which belongs to the learned-knowledge change.
- [ ] 11.4 `src/commands/doctor.ts` and `src/core/relationship-health.ts`: report bootstrap readiness across the full check list, read-only, with copy-pasteable repairs and human/JSON parity.
- [ ] 11.5 Tests: each row of the ordinary-command table; doctor writes nothing while reporting every unmet requirement.

## 12. Command surface

- [ ] 12.1 New `src/commands/bootstrap.ts`: `rasen bootstrap [--store-path] [--project-path] [--clone-root] [--check] [--dry-run] [--json] [--yes]`.
- [ ] 12.2 `--yes` scope is ADJUDICATED, not open: it confirms actions the user's own committed configuration already implies, and never expands scope to what only the remote side knows. **Project-first: `--yes` MAY obtain** the Stores the project itself declares. **Store-first: `--yes` MUST NOT obtain projects** — see 7.5. Do not unify the two behind one predicate.
- [ ] 12.3 Add the command and its flags to `src/core/completions/command-registry.ts`.
- [ ] 12.4 Tests: flag parsing, mutually incompatible combinations rejected before any work, JSON shape stable.

## 13. Acceptance tests (plan §26 Phase E)

- [ ] 13.1 Two-machine fixture with an empty machine data directory: a second machine bootstraps from a project clone alone.
- [ ] 13.2 Cloning only the project yields a complete plan.
- [ ] 13.3 A Store is obtained and registered only after explicit consent.
- [ ] 13.4 `--yes` asymmetry proven both ways: from a project checkout it obtains the project's declared Stores; from a Store it registers the checkout and obtains zero projects.
- [ ] 13.5 An identity mismatch performs zero registry writes — asserted by snapshotting the registry bytes around the failing call.
- [ ] 13.6 Check mode and preview mode both perform zero writes — whole-tree snapshot.
- [ ] 13.7 A rerun is idempotent.
- [ ] 13.8 A missing secondary Store membership hint is diagnosable.
- [ ] 13.9 Ordinary commands fail closed before bootstrap has run.
- [ ] 13.10 Windows: clone targets, the non-empty-directory guard under a path differing only by drive-letter case or separator form, derived-name safety, and git invoked with an argument vector and `windowsHide`. Expected paths built with `path.join()`.
- [ ] 13.11 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`.

## 14. Docs and locales

- [ ] 14.1 `docs/cli.md`: `rasen bootstrap`, every flag, and the difference between check mode and preview mode stated explicitly.
- [ ] 14.2 A bootstrap troubleshooting section: one entry per blocked and degraded state with its repair.
- [ ] 14.3 Migration guide: what a user on a fresh machine runs, and what bootstrap will and will not do on their behalf.
- [ ] 14.4 JSON examples for a complete, a degraded, and a blocked result.
- [ ] 14.5 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, state name, and repair string, no English fallback for new keys.

## 15. Verification and integration

- [ ] 15.1 Confirm Windows CI covers this change's path-sensitive test files.
- [ ] 15.2 Diff scenario SETS, not just requirement titles, for anything that becomes a MODIFIED block during implementation.
- [ ] 15.3 Re-run the portfolio-wide collision sweep over ALL active change directories, reporting both shared capabilities and any requirement with more than one MODIFIED owner. This change carries zero MODIFIED blocks and claims one capability; confirm that still holds.
- [ ] 15.4 `node bin/rasen.js validate store-bootstrap-and-hydration --changes --strict --json` clean.
- [ ] 15.5 Rehearse the spec merge (`rasen archive --json --yes`) before ship.
- [ ] 15.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, sibling change dirs.
- [ ] 15.7 Confirm no version number in `package.json` was changed by this work.
