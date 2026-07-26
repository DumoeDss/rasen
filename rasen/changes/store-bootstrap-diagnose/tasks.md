## 1. Confirm the ground truth before building

Design's dependency table was verified at `HEAD=968482cf`. Re-confirm only what a rebase could have moved, then act on the drift it already recorded.

- [x] 1.1 Re-confirm the signatures design.md records, since a rebase can move them: `resolveStoreBinding` (`src/core/store/identity.ts`), `StoreUnavailableReason`, `hasStoreDeclaration` (`src/core/project-config.ts`), `inspectRegisteredStore`, `resolveProjectMembership` / `listProjectStoreCandidates` / `listStoreMembers` (`src/core/store/membership.ts`). If any moved, update design.md's table in the same commit rather than working from a stale one.
- [x] 1.2 Confirm `store-bootstrap` is still absent from `rasen/specs/` and that `rasen/changes/store-bootstrap-and-hydration/` has NOT been archived in the meantime. If it has, stop — the ADDED titles this change carries will collide at merge (design D1) and the plan needs re-cutting.
- [x] 1.3 Read `listProjectStoreCandidates` end to end before writing any classification code. It already unions hints with local records and marks unavailable Stores without dropping them; the goal is to compose it, not to shadow it (design D5).
- [x] 1.4 Note which files this change adds that perform Store lookup, and add each to `PHASE_A_FILES` in `test/core/store/identity-boundaries.test.ts`.

## 2. Report shape and the state machine (pure computation, no I/O beyond reads)

- [x] 2.1 New `src/core/store/bootstrap.ts`. Define the report shape first: the three end states (complete · degraded · blocked), the per-Store entry, and the per-item repair. Everything else in this change produces or consumes this shape, and E2 extends it — get it settled before the logic.
- [x] 2.2 Read the project identity and the planning Store declaration in either form, via `hasStoreDeclaration` — never `pointer.value`.
- [x] 2.3 Resolve the planning declaration through `resolveStoreBinding` and merge it into the expected Store set alongside `listProjectStoreCandidates`, deduplicating on the same identity key the listing uses. The planning pointer is NOT part of that listing; it must be merged in explicitly (design D5, gap 1).
- [x] 2.4 Map the landed `StoreUnavailableReason` vocabulary onto the four report classes: verified · present-unregistered · absent-with-remote · absent-without-remote. **`not-registered` does not tell you which of present-unregistered / absent-* applies** — derive that from the supplied path or parent directory plus the declaration's recorded remote (design D5, gap 2). This is the one place a naive reuse of the tri-state produces a wrong answer.
- [x] 2.5 Compute the end state from the per-Store classes and the membership answers: nothing missing → complete; something missing with a stated repair → degraded; something that cannot be resolved or read at all → blocked.
- [x] 2.6 A declaration that cannot be understood (`pointer-malformed`) reports blocked, naming the declaration and what to correct — it is never skipped or treated as absent.
- [x] 2.7 Keep the classification a pure function over already-read data so every branch is testable without a filesystem fixture.
- [x] 2.8 Tests: every classification branch; each of the three end states; the planning declaration appearing in the report when it is not among the membership hints; a hint and the planning pointer naming the same Store collapsing to one entry.
- [x] 2.9 Tests: an absent-without-remote Store demands a path and infers nothing from a display name, a sibling directory, or any recorded path.

## 3. Membership: confirmed, not-recorded, or unverifiable here

- [x] 3.1 One seam answering `confirmed | not-recorded | unverifiable-here` for "does this Store's own record include this project", backed by `resolveProjectMembership`. Child B HAS landed — the seam exists for the unavailable-Store case, not for an unlanded dependency (design D6). **Widened during review:** `unverifiable-here` covers BOTH causes of the unknown — the Store is not here, and the Store is here with a record that will not parse (design D6 amendment).
- [x] 3.2 A Store that is not available on this machine returns `unverifiable-here` carrying what would make it verifiable. It is NEVER reported as a Store that does not record the project. The same holds for a record that exists and cannot be read, and no state-changing repair is printed on either.
- [x] 3.3 A Store that is available and does not record the project degrades the result and names the repair that would record it.
- [x] 3.4 Tests: a recorded member confirms; a missing record degrades with its repair; **an unavailable Store reports unverifiable and the report contains no claim that the project is absent from it**.

## 4. Store-first listing

- [x] 4.1 Detect that the current checkout is a Store root and verify its identity; a checkout that does not verify as the Store it claims reports blocked, naming the mismatch.
- [x] 4.2 Read the Store's project records through `listStoreMembers` — not a second implementation of the same read.
- [x] 4.3 Report each recorded project as already present on this machine, as obtainable from a recorded remote, or as neither — and, when a registered project's own identity cannot be read, as not determinable rather than as one of those three.
- [x] 4.4 Obtain nothing, register nothing, write nothing — in either mode, however many projects the Store records.
- [x] 4.5 Tests: listing with mixed local/obtainable state; a multi-project fixture proving zero writes and zero obtains; an identity mismatch reports blocked with nothing written.

## 5. Previewed location selection

- [x] 5.1 One selection function, the sole source of a previewed location — priority: explicitly supplied path → supplied parent directory plus a safe derived name → report that a location must be supplied. It never invents a candidate.
- [x] 5.2 Derive the safe basename from the source using the EXISTING filesystem-safety rules (no separator, no traversal, no reserved device name). Do not write a second set of rules.
- [x] 5.3 Report a location that already has contents, or that already holds a checkout, as refused — naming it, rather than presenting it as one that would be used.
- [x] 5.4 Compare locations canonically via `FileSystemUtils.canonicalizeExistingPath` with the established `path.resolve` fallback, so a drive-letter or separator difference is not a different location.
- [x] 5.5 A path recorded by another machine has no influence on the choice.
- [x] 5.6 Tests: each priority branch; neither input supplied demands a location and names none; a non-empty location and an existing checkout each report refused; a legacy recorded path is ignored; derived-name safety including Windows reserved names; a location supplied in a form differing only by drive-letter case or separator still hits the refusal. Expected paths built with `path.join()`.

## 6. Check mode and preview mode as separate guarantees

- [x] 6.1 Check mode: reads local information only. **No network contact at all** — no remote resolution, no clone, no register, no mint, no directory, no write.
- [x] 6.2 Preview mode: additionally resolves remotes and the exact location, and still creates no directory, runs no version-control operation, and writes nothing.
- [x] 6.3 Do NOT collapse these into one shared "safe mode" flag — they are different promises and each carries its own assertion.
- [x] 6.4 Tests: whole-tree snapshot around each mode proving zero writes (snapshot the project, any Store root, and the machine data directory — not just "the writer was not called").
- [x] 6.5 Test: check mode contacts no remote, asserted at the seam rather than by inspection of the output.

## 7. Command surface

- [x] 7.1 New `src/commands/bootstrap.ts`: `rasen bootstrap [--check] [--dry-run] [--json]` plus the two location inputs preview needs (an explicit path and a parent directory).
- [x] 7.2 **Define no flag that would obtain, register, or write** — not even as a stub that errors. A "not available yet" message is itself a promise (design D4).
- [x] 7.3 Invoking `rasen bootstrap` with no mode flag reports which modes are available and does nothing else. **Leave the bare invocation otherwise undefined** so E2 can define it as apply without redefining anything shipped here.
- [x] 7.4 New `src/commands/bootstrap-messages.ts` — every string goes through it, no inline English in the command or the core module.
- [x] 7.5 Add the command and its flags to `src/core/completions/command-registry.ts`.
- [x] 7.6 Tests: flag parsing; `--check` and `--dry-run` together rejected before any work; bare invocation does nothing; JSON shape stable and carrying the same facts as the human output.

## 8. Pasteable hints

- [x] 8.1 Consume `UnavailableStoreBinding.repair` (already ordered, copy-pasteable) rather than inventing a second repair vocabulary. Add only repairs the landed resolver has no reason to produce, such as "supply a path for this Store".
- [x] 8.2 Every printed command names an unambiguous selector — the permanent identity when the display name matches more than one Store on this machine, the display name otherwise. Bootstrap knows the arity at print time because it just resolved every Store.
- [x] 8.3 **No printed repair says "run bootstrap to fix this"** — bootstrap cannot fix anything in this change, and a hint that does not repair is the defect this whole split exists to avoid.
- [x] 8.4 Tests: a hint with two Stores sharing a display name names the identity; every repair string this change can emit is a command that exists today.

## 9. Acceptance tests

- [x] 9.1 Two-machine fixture with an empty machine data directory: a second machine reports the complete gap from a project clone alone.
- [x] 9.2 Cloning only the project yields a complete plan — every declared Store classified, nothing missing from the report.
- [x] 9.3 A missing secondary Store membership hint is diagnosable from the report.
- [x] 9.4 Check mode and preview mode both perform zero writes — whole-tree snapshot, both entry points (project checkout and Store checkout).
- [x] 9.5 Windows: previewed locations, the already-has-contents report under a path differing only by drive-letter case or separator form, and derived-name safety. Expected paths built with `path.join()`.
- [x] 9.6 Confirm no child process is spawned by this change on any path — it runs no version-control operation.
- [ ] 9.7 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`. Run serially, backgrounded with bounded foreground polling; never concurrent vitest batches.
  - **Deliberately left unticked — the gate as literally worded was not met, and the work behind it is complete.** `pnpm lint` and `pnpm build` are genuinely clean. `pnpm test` is **not** green: the full run observed **4949 passed / 6 failed / 31 skipped (4986)** across 286 files. Every one of the six is attributed outside this change, individually, with evidence — three are the known branch baseline (`test/release-contract.test.ts`, a `SyntaxError` at its import; `test/cli-e2e/basic.test.ts > localizes pipeline human output`, an environment-driven skill version-drift warning on stderr, and it fails deterministically in isolation too; `test/commands/handoff.test.ts > … maxRelays`, stale playbook text), and three are Windows CLI-spawn load flakes proven green when run alone (`test/commands/pipeline.test.ts` 82/82, `test/commands/store-add-project.test.ts` 12/12, `test/commands/store-membership-cli.test.ts` 11/11 — the reviewer re-verified all three serially and measured `pipeline.test.ts` at 219.8 s alone and individual CLI tests at 3–6 s against a 10 s cap, which is what a concurrent batch turns into a timeout). None is an assertion mismatch and all six files are unmodified in this working tree.
  - **What the evidence actually settles:** no test failure on this branch is attributable to this change, and lint and build are clean. It does not settle "the suite is green", which is why this box is not ticked.

## 10. Docs and locales

- [x] 10.1 `docs/cli.md`: `rasen bootstrap`, every flag, and the difference between check mode and preview mode stated explicitly.
- [x] 10.2 State plainly in the docs that this command reports and does not repair, and what it will do once the acting half lands — so a reader is not left inferring it from the absence of flags.
- [x] 10.3 JSON examples for a complete, a degraded, and a blocked result.
- [x] 10.4 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, state name, and repair string, with no English fallback for new keys.

## 11. Verification and integration

- [x] 11.1 `node bin/rasen.js validate store-bootstrap-diagnose --changes --strict --json` clean. Read the per-item `valid` for THIS change; the summary totals always carry unrelated failures from delta-less container dirs.
- [x] 11.2 Rehearse the spec merge with `rasen archive --json --yes` in a scratch root (copy `rasen/config.yaml` + `rasen/specs/` + this change dir into a temp dir and run with cwd there) — `validate` does not apply deltas to main specs, so only the archive rehearsal proves the merge.
- [ ] 11.3 **After the real archive, copy the Purpose section back** from the archived delta into `rasen/specs/store-bootstrap/spec.md`. Archiving a NEW capability replaces it with a `TBD - created by archiving` placeholder (design D10). `grep -rl "TBD - created by archiving" rasen/specs/` must come back empty.
  - **Deliberately left unticked — deferred to the archive stage.** The real archive has not run: `archive.timing` is `on-merge` and this branch is unmerged, so there is no archived delta to copy from and `rasen/specs/store-bootstrap/` does not exist yet. Ticking it would assert a repair that has not happened. The trap itself is confirmed, not assumed: the task 11.2 scratch-root rehearsal produced `rasen/specs/store-bootstrap/spec.md` stamped `TBD - created by archiving change store-bootstrap-diagnose`. Whoever runs the real archive must copy the Purpose paragraph back from `rasen/changes/archive/<date>-store-bootstrap-diagnose/specs/store-bootstrap/spec.md` into `rasen/specs/store-bootstrap/spec.md`, then confirm `grep -rl "TBD - created by archiving" rasen/specs/` returns nothing.
- [x] 11.4 Re-run the collision sweep over all active change directories. This change carries zero MODIFIED blocks and claims one capability; confirm that still holds, and confirm the two requirement titles it shares with `store-bootstrap-and-hydration/` are still the only overlap (design D1).
- [x] 11.5 Confirm Windows CI covers this change's path-sensitive test files.
- [x] 11.6 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, and sibling change dirs. Never `git add -A`. Keep `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md` out of every pathspec.
- [x] 11.7 Confirm `rasen/changes/store-bootstrap-and-hydration/` was not modified, moved, or deleted by this work — re-deriving E's remainder is a separate step.
- [x] 11.8 Confirm no version number in `package.json` was changed by this work.
