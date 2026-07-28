# Phase 1 Skill Result

## Status

`partial`

The implementation and local evidence are useful, but the Slice is not
`passed`: independent review, PR, merge, and cross-platform CI evidence are
not yet all available.

## Observed Evidence

### Build

- `pnpm build`
- Result: passed on Windows with TypeScript 5.9.3.

### Focused behavior and integration tests

- Command:
  `pnpm exec vitest run test/core/templates/direction.test.ts test/core/profiles.test.ts test/locales/catalog.test.ts test/core/workflow-registry/builtins.test.ts test/core/workflow-chain.test.ts test/core/direction-generation.test.ts`
- Result: 6 files passed, 89 tests passed.

### Template parity

- Command:
  `pnpm exec vitest run test/core/templates/skill-templates-parity.test.ts`
- Result: 1 file passed, 8 tests passed after computing the Direction hashes
  from the canonical rendered TypeScript template. This observed run included
  six incidental Auto/goal/review-cycle base-golden repairs that were later
  removed by the final scope audit.
- Final scope-audited command:
  `pnpm exec vitest run test/core/templates/skill-templates-parity.test.ts --silent`
- Final scope-audited result: 6 tests passed and the two aggregate hash-map
  assertions failed only on the unchanged Auto, goal, and review-cycle
  templates. A Direction-only calculation matched both pinned hashes exactly:
  function
  `02bf07737760f788d668e29008c1276069eebc364e3b210b259b65e05980867b`
  and generated content
  `5054415a3954571bd711e4ca93d57a14ee5c662ea078c965c9d6216d550f6c2a`.

### Focused changed-surface verification

- Command:
  `pnpm exec vitest run test/core/shared/skill-generation.test.ts test/core/templates/direction.test.ts test/core/workflow-registry/builtins.test.ts test/core/profiles.test.ts test/locales/catalog.test.ts test/core/direction-generation.test.ts test/core/init.test.ts test/core/update.test.ts test/core/workflow-chain.test.ts test/core/templates/skill-templates-parity.test.ts --silent`
- Result: 10 files passed, 239 tests passed in 59.99 seconds before the final
  parity scope audit removed the six unrelated base-golden repairs described
  above.

### Lint

- `pnpm lint`
- Result: passed on Windows.

### Repository test suite

- Command:
  `pnpm exec vitest run --silent --maxWorkers=4 --minWorkers=1`
- Result: completed in about 721.3 seconds with 12 failures. The failures were
  confined to unchanged Windows timing, temporary-directory cleanup, and e2e
  areas: EPERM cleanup, 20-second timeout, retention-codify `ok:false`,
  session tail/idempotence timing, and supervisor no-output watchdog timing.
  No Direction-surface test failed.

### Cross-platform coverage

- Local verification was performed on Windows.
- macOS and Linux path semantics are delegated to CI; no macOS/Linux CI result
  is claimed yet.

### Installed-skill generation

- Built CLI command path: `node bin/rasen.js`.
- Isolated project used a temporary `RASEN_HOME` and an explicit custom
  `direction` selection.
- Result: generated
  `.claude/skills/rasen-direction/SKILL.md`; the Direction skill directory
  contained only `SKILL.md`; no `rasen/work/` was created.
- Inspection found the canonical name, Establish and Reconcile headings,
  `target-state.md` contract, and byte-for-byte North Star protection in the
  installed output.

### Artifact-only discoverability

- A fresh standalone read-only process received only the planning root and
  workstream id.
- It resolved `work.yaml` with Node's platform-native path module and
  identified no North Star, the Target State, Roadmap, sole active Slice,
  Slice Spec/Plan, `partial` Result, unresolved acceptance, and one next action.
- The exact observed summary is preserved in `log.md`; independent review must
  repeat the conclusion rather than treating the log as self-acceptance.

## Unresolved Acceptance

- The complete Windows repository suite still has 12 failures in unchanged
  timing, cleanup, and e2e areas; CI and review must independently classify
  them.
- Independent review has not yet accepted the diff.
- No PR, merge, release, or macOS/Linux CI evidence exists yet.

## One Next Action

Run independent review without changing this status to `passed` before
acceptance and delivery evidence exists.
