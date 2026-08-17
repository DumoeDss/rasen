## 1. Acceptance content contracts

- [x] 1.1 Create `src/core/store/issues/acceptance.ts`: conditions-revision schema (version, issueId, ordinal revisionId, supersedes, createdAt, contentSha256, ≥1 condition of `{id, requirement, verification?}`) and acceptance-record schema (acceptedAt, conditionsRevisionId + conditionsSha256, gate snapshot `{completed, total, health, problemsStanding}`, note, contentSha256) — Zod-strict, `assertPortableIssueText` on every text field, digest over the canonical body mirroring `executionPlanDigest`, deterministic serialization mirroring `serializeExecutionPlanRevision`; duplicate condition ids within a revision refused.
- [x] 1.2 Extend `src/core/store/planning-layout-v2.ts` with the three new Store-level address kinds (`acceptance-conditions` dir, `acceptance-condition` revision file, `issue-accepted-record`) — pure computation, containment-proven, no project/target-line input; thread them through `src/core/store/issues/scope.ts`'s address bundle. Update the layout suite's address expectations.
- [x] 1.3 Unit tests: revision ordinal/digest/anti-rewrite discipline, tamper-refusal on read, portable-text refusals (path + credential), deterministic bytes, Windows/POSIX address parity for the new kinds.

## 2. Mutations

- [x] 2.1 Add `publishAcceptance` to `StoreIssuesModuleInstance` (`acceptance <issue-id> --from-file` wiring later): normalize + validate conditions, `allocateOrdinal` on the conditions directory, write under `withWriteLock`, refuse existing ordinal; returns the revision + commit suggestions like every Issue write.
- [x] 2.2 Add `accept` to `StoreIssuesModuleInstance`: takes the evaluated portable gate snapshot + note, enforces the D5 state matrix (open → record + `resolved` transition through the existing transition check; resolved-without-record → record only; resolved-with-record and dropped → typed refusals), writes `accepted.yaml` under the lock, refuses an existing record's overwrite; commit suggestions for record (+ record + state when both move).
- [x] 2.3 Unit tests (real-Git fixture): both mutations' happy paths and every refusal row of the D5 matrix, lock serialization (concurrent accept leaves one record), failed-mutation lock release, state-transition refusal surfaces unchanged.

## 3. Gate and projection extension

- [x] 3.1 Create `src/core/issue-acceptance/` (`types.ts` + `gate.ts` + `index.ts`): `evaluateIssueAcceptanceGate(status, acceptanceFacts)` with the D3 rule and the closed blocker taxonomy (un-terminal nodes named with observations, failing nodes named, problems named — all together); structural refusals (`requires_plan`, `conditions_required`, `already_accepted`, `dropped`) as distinct codes; `acceptIssue` orchestration (read status via the one seam → evaluate → call the mutation with the snapshot).
- [x] 3.2 Extend `src/core/issue-status/` in place: `ProjectIssueStatusInput` gains optional acceptance facts (latest conditions revision summary + accepted record read); `derivePhase` done rule replaced per D4 (resolved ∧ verified record → done; resolved-without-record → review); unreadable/tampered acceptance content surfaces as status problems (`unreadable-acceptance`) and never as done; `IssueStatus` gains the `acceptance` block; omitted inputs reproduce C2 behavior byte-for-byte.
- [x] 3.3 Unit tests: gate table (eligible; un-terminal named; failed-health named — real-shaped run-state fixtures, labeled as fixtures; problems named; together-naming), done-rule replacement (bare flip → review; record → done; tampered record → review + problem), C1/C2 regression suites still green (with the C1 done-rule test updated to the new spec contract).

## 4. CLI surface

- [x] 4.1 Add `rasen store issue acceptance <issue-id> --from-file` and `rasen store issue accept <issue-id> [--note]` to `src/commands/store-issue.ts` (`--store`, `--json`): read conditions YAML, call the module mutations, render human/JSON forms in the file's existing conventions.
- [x] 4.2 Enrich `store issue show` with the acceptance section (latest conditions with per-item requirement + verification note, the gate line — eligible or every named blocker — and the accepted record when present); `--json` carries the same facts via the `status.acceptance` block.
- [x] 4.3 Three-way surface sync per C2 finding 3: commander tree + locale entries in en/ja/zh-cn + completions `COMMAND_REGISTRY`; rebuild `dist/` before running CLI tests (stale dist masquerades as code bugs).
- [x] 4.4 CLI tests (real `runCLI` + fixture): acceptance publish (human/JSON parity, refusal paths), accept refusals with named blockers (un-terminal, dropped, already-accepted, no-conditions, no-plan), accept success closing the Issue, legacy-resolved upgrade path, show's acceptance block in both forms, exit codes.

## 5. Guards and cross-platform

- [x] 5.1 Extend the read-only-guard family: status reads over acceptance content leave every file byte-identical; the projection's acceptance block performs no writes (the accept mutation's writes are covered by task 2.3, not by the read guard).
- [x] 5.2 Cross-platform verification: `path.join`-built expectations for the new addresses, Windows/POSIX parity assertions, existing Windows CI leg green (config rule: file-path changes need Windows verification).

## 6. Dogfood — HOLD, then CLOSE (design D9)

- [x] 6.1 Phase A: rebuild the dogfood store per the full trap list (OS temp; `layoutVersion: 2` hand-declared; **store branch renamed master→main before any publish**; `add-project` with expected config double-write; explicit-list seeding with quoted scalars; positional `validate`), capturing setup receipts.
- [x] 6.2 Phase B (conditions receipt): `store issue acceptance issue-layer-phase1 --from-file` with real portfolio conditions; verify `store issue show` displays them and the gate.
- [x] 6.3 Phase C (HOLD receipt): from the worktree cwd, `store issue accept issue-layer-phase1` → refused naming the live un-terminal node(s) (g-003 in flight); capture command + output.
- [x] 6.4 Phase D (CLOSE receipts): seed the three children as archived entries and publish plan revision 2 naming them → gate eligible → `accept` writes the record and resolves → `show` reads done + acceptance block, `list` shows done, second `accept` refuses already-accepted.
- [x] 6.5 Phase E: trap-list teardown; receipts preserved under `evidence/`; verify zero branch footprint beyond the change's own files.

## 7. Bookkeeping

- [x] 7.1 Update the `architecture-index` skill: `src/core/issue-acceptance/` module map + quick-locate rows (module, the `acceptance`/`accept` subcommands, the new Issue content addresses) + the store-engine domain detail.
- [x] 7.2 Run `node bin/rasen.js validate issue-acceptance-close` (positional) and the full affected set green (acceptance + issue-acceptance + issue-status + store-issue CLI + layout suites); confirm `git diff` over `src/core/pipeline-registry/`, `packages/ui/`, and both `package.json` files is empty.
