# Review Report — phase0d-sidecar-install

**Reviewer:** reviewer-0d-sidecar (isolated from implementer)
**Repo:** OpenSpec-code @ `dev-harness` (HEAD `6014d33`)
**Scope:** working-tree diff for `phase0d-sidecar-install` (uncommitted) vs artifacts.
**Verdict:** SHIP-READY for the change itself. All four in-scope gates green; no Blocker/Major in the sidecar diff. One Major is a **pre-existing portfolio debt** surfaced by the full suite (not sidecar-introduced, not in the sidecar diff's scope). See §5.

---

## Findings by severity

| Severity | Count | Items |
|----------|-------|-------|
| Blocker  | 0     | — |
| Major    | 1     | M1 (portfolio debt: `add-grill-expert-skills` spec placeholder — outside sidecar diff) |
| Minor    | 2     | m1 (design understates browse skip), m2 (no explicit uninstall-removes-sidecars test) |
| Nit      | 1     | n1 (redundant per-file `mkdirSync`) |

The sidecar change (`skill-generation.ts` helper + `init.ts`/`update.ts` wiring + tests) is **correct and complete**. The Major and the five full-suite failures are all **independent of this change** (the sidecar working tree touches only `src/core/shared/{skill-generation,index}.ts`, `src/core/{init,update}.ts`, and its own two test files — it does not touch `openspec/specs/`, profiles, or config).

---

## 1. Helper correctness (`copySkillSidecars` / `copySidecarTree` / `isSidecarFile`)

Verified against the allowlist spec, line by line — **all correct**:

- `.md` except `SKILL.md`, plus `.sh`; `*.tmpl` excluded — `isSidecarFile` implements exactly this. Confirmed non-vacuous: `skills/gstack/review/SKILL.md.tmpl` really exists, so the `.tmpl`-exclusion assertion tests something real.
- Subdirectory structure preserved via recursion; target subdirs created lazily so all-filtered subtrees (browse `src/` `.ts`) leave no empty dir — matches the code comment and the spec's "no `.ts` copied" scenario.
- `browse` whole-dir skip via early `return` — **load-bearing, not belt-and-suspenders** (see m1): `skills/gstack/browse/scripts/build-node-server.sh` matches the `.sh` allowlist and *would* be copied without the early return. The extension allowlist alone only stops the `.ts` trees.
- Source-absent → graceful no-op (`existsSync` guard), mirroring the expert-template `readFileSync` try/catch.

**`import.meta.url` relative depth — correct.** Expert `review.ts` at `src/core/templates/experts/` uses **4** `..` to reach repo root; the helper at `src/core/shared/` uses **3** `..`. The off-by-one exactly matches the shallower location — both resolve to `<root>/skills/gstack/<id>`. Confirmed under the real runtime layout: `bin/openspec.js` loads `../dist/cli/index.js`, and `tsconfig` (`rootDir: ./src` → `outDir: ./dist`) strips the `src` segment, so `dist/core/shared` keeps the same 3-segment depth as `src/core/shared`. Resolution lands at `<root>/skills/gstack` from both src and dist.

**Windows:** all path ops via `path.join`/`resolve`; sync `fs` APIs are cross-platform. Suites ran green on win32. `workflowId` is registry-sourced (trusted), so no traversal concern.

## 2. Wiring completeness

- `init.ts` (~L553): loop destructures `workflowId`; calls `copySkillSidecars(workflowId, skillDir)` after `writeFile(SKILL.md)`. ✓
- `update.ts` — **two** loops, both wired identically: L201 (`// Generate skill files`) and L705 (`// Create skill files … effective profile+delivery`). The implementer's self-discovered second site (L705, the effective-profile path in a separate `run` branch) is **structurally equivalent** to the first — same `for (const { template, dirName, workflowId } …)`, same write-then-copy order. Correct to wire both. ✓
- `shared/index.ts` re-exports `copySkillSidecars`. ✓
- `removeSkillDirs`/`removeUnselectedSkillDirs` delete the whole skill dir (task 2.3 verify-only) — sidecars removed with it. ✓ (see m2 for the test-coverage nuance.)

## 3. Test quality

7 unit tests (`skill-sidecar-install` scenarios inside `skill-generation.test.ts`) + 1 real-run integration test (`skill-sidecar-install.test.ts`) cover every spec scenario: root `.md`, nested `references/`+`templates/` `.md`, `scripts/*.sh`, hook `bin/*.sh`, `SKILL.md`/`.tmpl` exclusion, browse skip (0 files), absent-source no-op, idempotency, and a full `init`→`update` real run asserting `investigate/scripts/hitl-loop.template.sh` + `review/checklist.md` land and `browse/src/` does not.

**Brittleness: acceptable.** Unit tests use real skill dirs as fixtures but assert with `toContain`/specific-file `existsSync` — **not** a written-down full-file-set (`toEqual`). Adding a new `.md`/`.sh` sidecar to `review/`/`qa/` will **not** false-red them. The only coupling is that the named fixture files must keep existing — which is desirable (a disappearing sidecar *should* red). The idempotency `toEqual(first, second)` compares two runs of the same source, so it is stable.

## 4. Self-run gates — all green

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | exit 0 |
| `vitest run skill-generation.test.ts skill-sidecar-install.test.ts` | 38 passed (37+1) |
| `vitest run test/core/init.test.ts` | 42 passed |
| `bun run skill:check` | FRESH (all skills) |
| `openspec validate phase0d-sidecar-install --strict` | valid |

## 5. Attribution of the five full-suite pre-existing failures (ship gate)

**All five are pre-existing at HEAD and independent of the sidecar working-tree diff** (which never touches `specs/`, `profiles.ts`, or config). Reproduced them in isolation; per-item ownership:

### 5a. `test/specs/source-specs-normalization.test.ts` ×1 → **M1 (Major, OUR portfolio debt)**
- **What fails:** `openspec/specs/add-grill-expert-skills/spec.md` still has the archive placeholder in `## Purpose`: `TBD - created by archiving change phase0c-grill-add. Update Purpose after archive.` — the test bans `PURPOSE_PLACEHOLDER_PATTERN`.
- **Origin:** `git log` shows the spec file was created by **`b041df0` "feat(gstack): phase0c — add four grill-derived methodology experts"** — a commit the task lists as **ours**. The phase0c archive merged a canonical spec with the placeholder Purpose left unfilled.
- **Verdict:** This is **our portfolio's debt** (the "11 new specs" concern). It is **not** caused or touched by `phase0d-sidecar-install` (sidecar doesn't touch `specs/`), but the phase0 portfolio owes the fix before it ships.
- **Fix:** Replace the placeholder in `openspec/specs/add-grill-expert-skills/spec.md` `## Purpose` with a real one-line purpose (e.g. *"Add four grill-derived methodology expert skills (domain-modeling, codebase-design, tdd, prototype) as source templates with MIT-attributed sidecars, registered through the full expert wiring chain."*). Re-run the normalization suite. Then audit the other 10 merged specs for the same placeholder.

### 5b. `test/commands/config.test.ts` ×1 + `test/commands/config-profile.test.ts` ×3 → **pre-existing / sibling (NOT ours, NOT sidecar)**
All four share one root cause: the **core workflow set grew** but these test fixtures still assume the old 4-workflow core `['propose','explore','apply','archive']`.
- Three failures show the delta directly: expected `[…,'archive']` (4) vs received `[…,'archive','auto-command']` (5); and `deriveProfileFromWorkflowSelection(['archive','apply','explore','propose'])` returns `'custom'` instead of `'core'` because `CORE_WORKFLOWS` now = `['propose','explore','apply','archive','auto-command']`.
- **Origin:** `auto-command` was added to `CORE_WORKFLOWS` by **`686ba8e` "feat: include auto-command in CORE_WORKFLOWS for default installation"**. `git merge-base --is-ancestor 686ba8e 0deed40` → **true**: `686ba8e` **predates the entire phase0 portfolio** (0deed40 is phase0a, our first commit). The test files were last touched by `2d4c98e` (PR #736, upstream) and never updated for auto-command.
- The 4th failure (`keep action should not warn when project files are already synced`) is the same family: the fixture saves `workflows: ['propose','explore','apply','archive']` and expects no drift, but the sync check now derives from a larger workflow→artifact map (auto-command from `686ba8e`, plus `handoff` added to the map by the **add-context-handoff sibling** `e860a3d`/`3a70bd4`), so it warns.
- **Verdict:** Pre-existing drift owned by `686ba8e` (pre-portfolio) and compounded by the add-context-handoff **sibling** change. **Neither is `phase0d-sidecar-install`.** Not this change's debt, not this portfolio's regression to fix — flag to LEAD as pre-existing test/code drift (fix = update the config/config-profile fixtures to the current core set).

## 6. Behavior-change documentation
`proposal.md` ("Behavior change (document for users)", L31-33) and `design.md` D4/D5 clearly state that `init`/`update` now write extra sidecar files under each installed skill dir and that existing installs gain them on next update. Adequate. The npm-distribution gap (`skills/` not in `files`) is explicitly flagged out-of-scope in both docs — appropriate.

---

## Minor / Nit

- **m1 (Minor, doc):** `proposal.md` L11 and `design.md` D1 call the browse skip "belt-and-suspenders." It is actually **load-bearing** — `browse/scripts/build-node-server.sh` matches the `.sh` allowlist and would be copied without the early return. Implementation is correct; only the characterization understates it. Consider a one-word doc tweak.
- **m2 (Minor, coverage):** No explicit test asserts a sidecar is removed by `removeUnselectedSkillDirs`/`removeSkillDirs` (spec scenario "Uninstall removes sidecars"). Inherent since the whole dir is deleted, and task 2.3 was verify-only — low risk, but an explicit assertion would close the last spec scenario.
- **n1 (Nit):** `copySidecarTree` calls `mkdirSync(targetDir, { recursive: true })` per file. Correct (idempotent) but redundant; hoisting once per dir with ≥1 sidecar is cosmetic.

---

## Bottom line
The `phase0d-sidecar-install` change is **correct, complete, and green on all in-scope gates**. Ship the change. The single Major (M1) is **the phase0 portfolio's own archive debt** (grill spec placeholder from `b041df0`), fixable in one edit but **outside the sidecar diff** — hand to whoever owns the portfolio's spec cleanup. The four config/profile failures are **pre-existing/sibling drift** (`686ba8e` predates phase0; handoff via the add-context-handoff sibling) and are **not** this change's responsibility.
