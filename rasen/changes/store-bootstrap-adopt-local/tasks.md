## 1. Re-verify dependencies against landed code

Design's dependency table was verified at `HEAD=f11daa1d`. Re-confirm only what
a rebase could have moved, then act on the drift it already records.

- [x] 1.1 Re-confirm `writeDurablePointer` (`src/core/store/upgrade-identity.ts`): signature `(configPath, { uid, id, remote? })`, the single durable-declaration writer. E2 routes every declaration through it — confirm the signature has not shifted.
- [x] 1.2 Re-confirm `resolveProjectKnowledgeHome` (`src/core/project-knowledge-home.ts`): synchronous, returns `{ projectId, root, catalogDir }`. E2 creates empty base directories from these — confirm still synchronous and still returns both paths.
- [x] 1.3 Re-confirm `registerProject` (`src/core/project-registry.ts`): takes `{ projectRoot, projectId, mode }`, idempotent on path-exact match. E2 calls it for the current checkout.
- [x] 1.4 Re-confirm `registerExistingStore` (`src/core/store/operations.ts`): the `rasen store register <path>` path. E2 calls it for present-unregistered Stores the user named a location for.
- [x] 1.5 Re-confirm `hasStoreDeclaration` and the alias-vs-durable pointer shape (`src/core/project-config.ts`), so the declaration-upgrade trigger (alias form → durable form) reads the right field.
- [x] 1.6 Confirm the files E2 modifies are listed in `PHASE_A_FILES` (`test/core/store/identity-boundaries.test.ts`): `src/core/store/bootstrap.ts` and `src/commands/bootstrap.ts` are already there (E1 added them). If E2 extracts a new module that resolves a Store, add it; if everything stays in `bootstrap.ts`, no new entry is needed.

## 2. Construction-time `mutates` field (THE binding constraint — design D3)

- [x] 2.1 Change the `BootstrapRepair` command variant to `{ kind: 'command'; command: string; mutates: boolean }`. TypeScript will flag every construction site that omits the field — that is the point.
- [x] 2.2 Update `bootstrapRepairsFrom` (the consumption point for landed strings): set `mutates: true` for every command classified by the existing regex. This is the conservative default — the landed resolver's commands are almost all state-changing.
- [x] 2.3 Update every construction site in `bootstrap.ts` that builds a command repair: `rasen store register <path>` → `mutates: true`; `rasen doctor` → `mutates: false`; repairs from `buildStoreRepairs` carry the value the site knows.
- [x] 2.4 Update `disambiguateRepairs` and `withKnownLocation` to preserve `mutates` when reconstructing a command repair.
- [x] 2.5 Replace `isMutatingRepair` with `repair.kind === 'command' && repair.mutates`. Remove `BOOTSTRAP_MUTATING_COMMANDS`. Confirm no other module imports the removed export.
- [x] 2.6 Tests: a command repair cannot be constructed without `mutates` (the type enforces it); the filter blocks a `mutates: true` repair at an unknown arm and passes the same repair at an established arm; a consumed landed string defaults to `mutates: true`.

## 3. The project-first apply state machine (design D5)

- [x] 3.1 Add `apply` to `BootstrapMode` (`'check' | 'preview' | 'apply'`). The check and preview paths are unchanged — the apply path consumes E1's report shape and acts.
- [x] 3.2 Extend `BootstrapInput` with consent state: whether the run is interactive (ask per action) or blanket (`--yes`). The apply path reads it at every consent-gated step.
- [x] 3.3 Extend `BootstrapStoreEntry` / `BootstrapReport` with apply-path fields: `action` (what was done or would be done), `alreadyRegistered`, `alreadyHydrated`. Additive — check and preview leave them unset.
- [x] 3.4 The apply path, ordered as design D5 states: (1) read and classify via E1's path; (2) register the current checkout; (3) register each present-unregistered Store the user named a location for; (4) re-verify membership for newly-available Stores; (5) prepare the knowledge location; (6) write the durable declaration when the trigger fires. Each step individually idempotent.
- [x] 3.5 An interruption at any step leaves a state a rerun resumes from — assert this by running apply, stopping between steps, and confirming the rerun skips what was already done.
- [x] 3.6 The end state is still one of E1's three. An apply that registered local Stores but left absent Stores unobtained is `degraded`, naming what is still missing. Assert this directly.
- [x] 3.7 `computeBootstrapEndState` still refuses `complete` in the presence of any error-severity diagnostic (design D4 rule 1). An apply that registered a Store whose records then failed to parse MUST NOT report `complete`.

## 4. Registration: current checkout and present-unregistered Stores

- [x] 4.1 Register the current project checkout through `registerProject({ projectRoot, projectId, mode })`. This is the first acting step, always performed in apply mode — no separate consent (invoking apply IS the consent for the project's own checkout).
- [x] 4.2 Register each present-unregistered Store through `registerExistingStore({ path })`, where `path` is the location the user supplied (via `--path <selector>=<dir>`) and the probe confirmed it holds the expected Store.
- [x] 4.3 Consent gating: without `--yes`, each Store registration asks before acting; with `--yes` (project-first), the Stores the project declares are confirmed without asking. A Store NOT declared by the project (e.g., a local record only) is NOT covered by `--yes` and always asks.
- [x] 4.4 A registration that fails (the path no longer holds the expected Store, the registry is locked) is reported and does not abort the whole run — the remaining steps still execute. The failure carries a repair.
- [x] 4.5 Tests: the current checkout is registered; a present-unregistered Store is registered through `registerExistingStore`; consent is required before a non-declared Store is registered; `--yes` covers declared Stores; a failed registration is reported without aborting.

## 5. Membership re-verification after a Store becomes available

- [x] 5.1 After step 3 registers a Store, re-verify its membership through `resolveProjectMembership`. The Store's records are now readable, so the answer moves from `unverifiable-here` to `confirmed` or `not-recorded`.
- [x] 5.2 The re-verified answer replaces the `unverifiable-here` answer in the report. It is NEVER left as unverifiable when the Store is now available — that would freeze a stale unknown over an answer bootstrap just established.
- [x] 5.3 A Store whose membership was already `confirmed` or `not-recorded` (it was available before apply) is not re-verified — the answer E1 established still holds.
- [x] 5.4 Tests: an unavailable Store's membership moves to confirmed/not-recorded after registration; a previously-available Store's membership is unchanged; a Store whose records STILL fail to parse after registration stays unverifiable (the unknown is real, not stale).

## 6. Knowledge location preparation (design D6)

- [x] 6.1 Resolve the knowledge home through `resolveProjectKnowledgeHome(projectId, options)`. Create `home.root` and `home.catalogDir` as empty base directories via `fs.mkdirSync(…, { recursive: true })`.
- [x] 6.2 Invent no content: no placeholder files, no README, no default catalog entries. The directories are empty because the project's knowledge is the project's own.
- [x] 6.3 Plan the portable bundle import as a SEPARATE reported step (F4's territory): the report names it as a step the user can see, and bootstrap does not perform it.
- [x] 6.4 Mark `already_hydrated` in JSON when the directories already exist and are empty — distinguish "did nothing because it was already done" from "did nothing because it failed".
- [x] 6.5 Tests: base directories exist after apply and contain nothing; a rerun marks `already_hydrated` and creates nothing; the seam degrades cleanly when the project has no identity (it cannot name a knowledge home).

## 7. Durable declarations via `writeDurablePointer` (design D7)

- [x] 7.1 During apply, after the planning Store resolves, if the project's `store:` declaration is in the alias form (a bare display name) — or durable but missing the display name the Store now carries — upgrade it through `writeDurablePointer(configPath, { uid, id, remote? })`.
- [x] 7.2 Record the object form: permanent identity (`uid`) AND display name (`id`) together, plus the credential-free `remote` when the Store's metadata carries one. Never write a bare display name.
- [x] 7.3 A Store with no display name at all: report the limitation and its repair (`rasen store upgrade-identity` once the Store has a name) rather than writing a uid-only declaration that silently fails in session launch.
- [x] 7.4 The write is atomic (temp + rename via `writeFileAtomically`), never committed, never pushed. Consent-gated the same way Store registrations are.
- [x] 7.5 **Tests assert what LANDS IN THE FILE, not what the message says** (child A's most expensive defect was a bare string written into a Git-tracked file). Read the file back and confirm it carries the object form with both `uid` and `id`. Plus a test for the nameless-Store limitation path.

## 8. Idempotence on rerun (design D8)

- [x] 8.1 A rerun rewrites no identity: `registerProject` updates in place (path-exact match); the Store registration creates no second entry; the durable declaration is not rewritten when it already carries the identity and display name.
- [x] 8.2 JSON marks `already_registered` and `already_hydrated`, distinguishable from items acted on.
- [x] 8.3 Display-name and remote drift are reported and never corrected automatically. The drift report names `rasen store upgrade-identity` as the command that would refresh the declaration.
- [x] 8.4 Tests: a second run writes nothing (snapshot the registry, the declaration file, and the knowledge directories before and after); exactly one registry entry per Store with an unchanged path; drift reported not fixed; `already_registered` and `already_hydrated` present in JSON.

## 9. Command surface (design D10)

- [x] 9.1 Add `--apply` as a third mode in `src/commands/bootstrap.ts`. `--check` and `--dry-run` keep their meanings. `--apply` with `--check` or `--dry-run` is rejected before any work (the same way `--check --dry-run` already is).
- [x] 9.2 Add `--yes` (blanket confirmation for the project-first apply path). `--yes` without `--apply` is rejected before any work — it confirms nothing when no action is requested.
- [x] 9.3 The bare invocation still reports which modes are available and does nothing else (E1's scenario preserved). It now reports three modes (check, preview, apply) instead of two.
- [x] 9.4 From a Store checkout, `--apply` produces E1's read-only Store-first listing. E2 adds no Store-first acting (group 7 is E3). The listing is identical to what `--check` produces from a Store — documented, not a "not available yet" message.
- [x] 9.5 Extend `src/commands/bootstrap-messages.ts` with apply-mode messages: consent prompts, `already_registered` / `already_hydrated` state names, drift reports, the nameless-Store limitation, the apply-mode heading. No inline English in the command or core module.
- [x] 9.6 Tests: `--apply` parsing; `--apply --check` and `--yes` without `--apply` both rejected before any work; the bare invocation reports three modes; JSON shape stable and carrying the same facts as the human output.

## 10. Acceptance tests (E's group 13, E2 slice)

- [x] 10.1 Two-machine fixture with an empty machine data directory: a second machine bootstraps from a project clone alone, apply registers the current checkout and every present-unregistered Store.
- [x] 10.2 A Store already registered before apply is reported as `already_registered` and its path is unchanged.
- [x] 10.3 `--yes` asymmetry: from a project checkout, `--apply --yes` registers the project's declared present-unregistered Stores without asking; nothing is obtained from a remote.
- [x] 10.4 A present-unregistered Store NOT declared by the project (a local record only) is NOT registered under `--yes` — it asks.
- [x] 10.5 The durable declaration write: assert the file contents (object form with `uid` and `id`), not the message.
- [x] 10.6 A nameless Store's declaration is not written; the limitation is reported.
- [x] 10.7 A rerun is idempotent — whole-tree snapshot proves zero writes on the second run.
- [x] 10.8 Drift (display name or remote no longer matching) is reported and the declaration is not changed.
- [x] 10.9 Membership re-verification: a Store registered during apply has its membership move from `unverifiable-here` to `confirmed` or `not-recorded`.
- [x] 10.10 Windows: the knowledge-location directories resolve through `path.join`; the declaration file path is composed with `path.join`; expected paths in tests built with `path.join()`.
- [x] 10.11 Full suite green: `pnpm lint`, `pnpm build`, `pnpm test`. Run serially, backgrounded with bounded foreground polling; never concurrent vitest batches. Attribute any pre-existing failure individually (known baseline: `test/release-contract.test.ts`, `test/cli-e2e/basic.test.ts`, `test/commands/handoff.test.ts`, `test/commands/workset.test.ts` — all unmodified in this tree).

## 11. Docs and locales

- [x] 11.1 `docs/cli.md`: the `--apply` mode, the `--yes` scope (project-first; does not obtain), and the difference between apply and the two read-only modes stated explicitly.
- [x] 11.2 The apply troubleshooting section: one entry per degraded and blocked state with its repair, including the nameless-Store limitation and the drift report.
- [x] 11.3 JSON examples for an apply result: a complete apply, a degraded apply (absent Stores not obtained), and an idempotent rerun.
- [x] 11.4 CLI locale bundles `src/locales/{en,zh-cn,ja}.json`: every new message, state name, and consent string, with no English fallback for new keys.

## 12. Verification and integration

- [x] 12.1 `node bin/rasen.js validate store-bootstrap-adopt-local --changes --json` clean. Read the per-item `valid` for THIS change; the summary totals carry unrelated failures from delta-less container dirs.
- [x] 12.2 Rehearse the spec merge with `rasen archive --json --yes` in a scratch root (copy `rasen/config.yaml` + `rasen/specs/` + this change dir into a temp dir and run with cwd there). `validate` does not apply deltas to main specs; only the archive rehearsal proves the merge. The MODIFIED block must carry every scenario E1's requirement 3 holds — confirm the rehearsal does not throw `findMissingCurrentScenarios`. **Method:** archive E1 first in the scratch root (creates `rasen/specs/store-bootstrap/`), then archive E2 on top — both succeeded clean.
- [x] 12.3 Re-run the portfolio-wide collision sweep over ALL active change directories. This change carries one MODIFIED block against `store-bootstrap` (requirement 3) and two ADDED blocks (disjoint titles). Confirm no other active change MODIFIEs the same requirement concurrently — E2 archives before E3 begins (the E2→E3 edge is HARD, §6.3 of the decomposition plan).
- [x] 12.4 Confirm `rasen/changes/store-bootstrap-and-hydration/` was not modified, moved, or deleted by this work — it is the source material for E3/E4.
- [x] 12.5 Confirm the concurrent session's files are untouched and unstaged: `packages/ui/**`, `rasen/config.yaml`, `rasen/changes/simplify-pipeline-handoff-ui/`, `docs/handoff/`, `rasen/explorations/*`, and sibling change dirs. Never `git add -A`. Keep `rasen/work/issue-centered-automation-platform/deterministic-pipeline-kernel-research.md` out of every pathspec.
- [x] 12.6 Confirm no version number in `package.json` was changed by this work.
- [x] 12.7 Confirm Windows CI covers this change's path-sensitive test files.
