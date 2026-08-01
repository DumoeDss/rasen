## 1. Rehome Single-Host Methodologies and Routers

- [x] 1.1 Create the explicit host sidecar trees for codebase design, TDD, prototype, workflow review, and navigator, moving the former template substance and deeper references without losing MIT notices.
- [x] 1.2 Convert `rasen-propose`, `rasen-apply-change`, and `rasen-explore` into shallow conditional routers that name their installed relative entry references, preserve change-directory capture rules, and load no methodology body when the branch does not apply.
- [x] 1.3 Update `rasen-workflow-author` to load its bundled workflow-review reference after static validation and preserve author-not-verifier behavior through a distinct reviewer or separated read-only pass.
- [x] 1.4 Update `rasen-help` to load its bundled navigator map for broad routing/scope questions, preserve one-next-action routing, and absorb the current Direction, goal, safety, specialist, and chrome-use guidance.
- [x] 1.5 Extend built-in workflow sidecar digest/freshness handling so host references are tracked with their router and missing or changed sidecars trigger regeneration.
- [x] 1.6 Add focused host-router and sidecar tests proving nested references are packaged, copied beside `SKILL.md`, lazily named rather than inlined, attributed, and included in digest/freshness checks.

## 2. Unify QA and Update Verification Consumers

- [x] 2.1 Merge QA-only's no-edit/report behavior into `rasen-qa` as an explicit report-only/non-UI mode while retaining default standalone test/fix/verify behavior and browser-first evidence collection.
- [x] 2.2 Update the shared expert PREAMBLE, QA methodology, severity table, source-reading carve-outs, canonical report wording, and orchestration dispatch instructions to describe one QA expert and its modes.
- [x] 2.3 Change `full-feature`'s non-UI stage to `qa-report-only` with `skill: rasen-qa`, update the review-loop dependency and LEAD mode instruction, and preserve the six-member FanOut and shared `qa-report.md` contract.
- [x] 2.4 Change `rasen-verify-enhanced` standard verification and built-in dependency declarations to invoke `rasen-qa` report-only/non-UI mode once and remove every `rasen-qa-only` dependency.
- [x] 2.5 Update auto output, resume/dogfood member paths, expert dispatch tests, canonical-severity tests, verify-enhanced tests, and full-feature reconciler tests for the unified QA identity and renamed stage.

## 3. Retire Independent Catalog Identities

- [x] 3.1 Remove the six retired expert definitions from `getExpertSkillDefinitions()` and delete their standalone template getters, exports, parity entries, old source sidecar directories, sidecar alias comments, and catalog fixtures.
- [x] 3.2 Reduce `ALL_EXPERTS`-derived assertions to the 12 surviving experts and `QUALITY_FLOOR_EXPERTS` to `review`, `cso`, `qa`, `benchmark`, and `design-review`; update dependency-graph, selection, profile, drift, and install-flip tests accordingly.
- [x] 3.3 Remove the six retired expert metadata entries from English, Japanese, and Simplified Chinese locale catalogs and update locale-key/count tests so all three catalogs match the surviving roster exactly.
- [x] 3.4 Add one explicit constant containing the six retired installed directory names and an exact-name, `path.join`-based cleanup helper that preserves similarly named and unrelated directories.
- [x] 3.5 Invoke retired-directory cleanup from init and update for every configured skill root before all up-to-date short circuits, then add idempotent init/update tests covering all six names and a preserved-neighbor case.
- [x] 3.6 Verify stored custom selections naming retired ids follow the existing unknown-id warning/drop path and are not restored as catalog/profile choices; add or adjust regression coverage without introducing a new config schema.

## 4. Align Documentation and Generated Contracts

- [x] 4.1 Update `skills/experts/docs/AGENTS.md` and live workflow/package documentation to show the 12 standalone experts and route codebase design, TDD, prototype, workflow review, navigator, and report-only QA through their hosts.
- [x] 4.2 Update trust-boundary and authoring documentation to name `rasen-workflow-author`'s bundled independent-review branch instead of a separate workflow-review expert.
- [x] 4.3 Remove live references to the six retired invokable identities from templates, pipelines, locales, fixtures, and non-historical docs while leaving archived changes untouched and leaving `office-hours`/`office-hours-command` unchanged.
- [x] 4.4 Recompute generated-template and function parity hashes only for surviving templates whose output changed, and update generated-skill roster/count assertions.

## 5. Verify the Consolidation

- [x] 5.1 Run `rasen validate consolidate-expert-skills --strict --json` and resolve every delta-spec or artifact diagnostic.
- [x] 5.2 Run focused Vitest files for sidecar generation, workflow-author/help routers, expert catalog/digests, profiles/locales/dependency closure, legacy cleanup/update, QA dispatch, verify-enhanced, and full-feature normalization/dogfood fixtures.
- [x] 5.3 Run `pnpm run build`, `pnpm run lint`, and `pnpm test`; confirm no live-source search result presents a retired identity as invokable and no office-hours snapshot/hash changed.
- [x] 5.4 Run the full-feature dogfood script and inspect the execution plan to confirm six FanOut members, mutually exclusive `qa`/`qa-report-only` conditions, one `rasen-qa` identity, and a clean Join/review-loop path.
- [x] 5.5 Verify package contents include every new host reference and exclude retired source/template directories.
- [x] 5.6 Run the path-sensitive sidecar-copy and retired-directory cleanup coverage on Windows CI (or the repository's Windows validation job), using `path.join`/canonicalized expectations, and confirm the same tests remain portable on the non-Windows CI matrix.
