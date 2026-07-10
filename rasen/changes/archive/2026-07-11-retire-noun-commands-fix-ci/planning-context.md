# Planning Context — retire-noun-commands-fix-ci

## User intent (verbatim)
"弃用的话是不是直接去掉比较好？" → 确认直接移除弃用的 noun 命令组；随后 `/rasen:auto small-feature --no-gate 开始吧，在worktree工作，最终提pr到main。另外就是现在ci一直出错，也一起修复了。"

Two work items in ONE change:
1. **Retire the deprecated noun command groups** `rasen change ...` and `rasen spec ...` (remove, not just mark deprecated).
2. **Fix the CI failures currently red on main** (run 29086744907, commit 486daf0).

## LEAD findings so far (verified, 2026-07-10)

### Item 1 — noun command removal
- Both groups live in `src/cli/index.ts` (change group ~line 333, spec group ~line 425). They are thin wrappers over the same `ChangeCommand`/`SpecCommand` classes the verb-first commands use — remove the wrappers, keep the classes as used by verb-first paths.
- Both already print runtime deprecation warnings (`preAction` hooks) steering to verb-first: `rasen list`, `rasen show`, `rasen validate --changes/--specs`.
- **Parity check required before removal**: noun commands have interactive flows (tests `test/commands/change.interactive-show.test.ts`, `change.interactive-validate.test.ts`, `spec.interactive-show.test.ts`, `spec.interactive-validate.test.ts`). Verify verb-first `show`/`validate` offer equivalent interactive selection; if a capability exists ONLY under the noun path, port it, don't drop it.
- Specs impact: `rasen/specs/cli-change/spec.md` and `rasen/specs/cli-spec/spec.md` cover the noun commands — this change must carry delta specs REMOVING those requirements (REMOVED sections). `cli-list`/`cli-show`/`cli-validate` specs cover verb-first and stay. Check `openspec-conventions` spec for references.
- Tests to remove/migrate: the 4 interactive tests above + `test/commands/spec.test.ts` (noun `spec show/list/validate`) + check `change-initiative-link.test.ts` for noun usage. If any test covers logic that survives (the underlying command classes), migrate to verb-first invocation instead of deleting coverage.
- Also update: shell completions (check `src/core/completions/` for noun command entries), docs mentions (`docs/cli.md` etc. — grep `rasen change `/`rasen spec `), telemetry command-name allowlists if any.
- Upstream keeps these groups (upstream-main has them) — divergence accepted, precedent: browse→chrome-use.

### Item 2 — CI failures (main run 29086744907, all 4 test legs red, different failures per OS)
- **POSIX legs (linux-bash, linux-bash-node24, macos-bash)**: 3 failures in `test/commands/doctor.test.ts` → "machine-root relocation (relocate-machine-home D4)": (a) "notes a lingering old-scheme directory after a successful startup adoption" — expected output to contain 'left behind', got ''; (b) "warns loudly when relocation failed and the old-scheme directory still exists" — expected 'Relocation pending' in doctor output; (c) "keeps startup adoption skip notes on stderr, never corrupting --json stdout" — expected false to be true.
- **Windows leg (windows-pwsh)**: 2 failures in `test/commands/artifact-workflow.test.ts` → "archive.timing exposure": "status --json exposes the configured archive.timing" and "on-merge default". These PASS on the local Windows box — CI-env-specific (clean home dir → different adoption/startup-note behavior?).
- **Local-only (not CI)**: `test/commands/spec.test.ts` "spec show should display spec in text format" fails locally — telemetry first-run notice printed to stdout ahead of command output (CI sets CI=1 → telemetry+notice suppressed → passes there). Reproduced on clean HEAD. NOTE: if item 1 deletes spec.test.ts wholesale this failure vanishes, but the ROOT CAUSE (first-run notices polluting stdout) likely also underlies the doctor/artifact-workflow CI failures — fix the cause, don't just delete the witness.
- **Root-cause hypothesis to verify**: startup adoption notes / first-run notices are written to stdout (or not written at all where expected) in ways that depend on home-dir state; the doctor D4 tests assert stderr discipline + specific note texts. Recent relocate-machine-home / harden-adoption commits (cba4073, 1c1735d) introduced these paths; the tests may have env assumptions (XDG vs APPDATA) that CI POSIX exposes. Investigate `src/commands/doctor.ts`, the adoption chain in `src/core/global-config.ts` / relocation module, and where "left behind"/"Relocation pending" strings live.
- Timeline check: these doctor tests presumably passed when 1c1735d landed (local Windows). First red main run to check: the failures may predate today's pushes — git log vs CI history will tell which commit broke POSIX.

## Constraints / decisions already made
- Version stays 0.1.1 — NEVER bump major/minor; release-type changes read package.json (user standing order).
- Brand guard: generated output must not carry `opsx`/`openspec-`/`openspec:`/`openspec/` tokens.
- Specs are the verify contract — noun-command removal goes through this change's delta specs (REMOVED), then sync/archive per pipeline.
- Delivery: work happens on this worktree branch (`worktree-retire-noun-commands-fix-ci`); ship stage delivers as **PR to main** (delivery mode pr). No direct push to main.
- CHANGELOG: do NOT create new version headings; if noting the removal, put it under the existing 0.1.1 heading only if asked — default leave CHANGELOG alone (entry bookkeeping is the user's call).
- `pnpm` works in this repo now; `npm install` + `node build.js` is the reliable build path; full suite ~2548 tests, `npx vitest run`.
- Windows EBUSY flake is cured (batch1); local full-suite baseline: only the spec.test telemetry-notice failure.

## Planner durable findings (2026-07-10, verified in worktree)
- **Parity confirmed**: verb-first `rasen show`/`rasen validate` interactive selection is a SUPERSET of the noun paths (show prompts type→item, delegating to ChangeCommand.show/SpecCommand.show; validate has its own all/changes/specs/item picker). Already spec-covered by cli-show "Top-level show command" + cli-validate "Top-level validate command". The ONLY noun-only capability is `--long` on change/spec list → ported to `rasen list`/ListCommand.
- **Surviving vs dead classes**: `ChangeCommand.show` + `SpecCommand.show` survive (used by ShowCommand). `ChangeCommand.list/.validate` + `SpecCommand.list/.validate` become orphaned dead code after wrapper removal (ValidateCommand has its OWN logic, does not call ChangeCommand.validate). Remove after tsc + reference sweep; watch buildValidationBullets (change.ts:259) if shared.
- **Dead-command strings to sweep** (emitted by surviving code): change.ts:56,192,259; show.ts:174,198-199; validate.ts:259; core/validation/constants.ts:41 — all reference removed `rasen change/spec show|list|validate`.
- **CI root causes (all pre-existing, NOT caused by item 1; runCLI sets RASEN_TELEMETRY=0 so telemetry is NOT the doctor/artifact cause)**:
  - doctor D4 POSIX fail = test hardcodes win32 old-scheme path `AppData/Local/rasen` (doctor.test.ts oldDataDir()); prod oldSchemeDataDir resolves `.local/share/rasen` on POSIX (global-config.ts:271-279). Fix = platform-aware fixture path. Broke since cba4073.
  - artifact-workflow Windows-CI fail = archive.timing tests compare archiveDir to RAW tempDir; CLI canonicalizes root.path (root-selection.ts canonicalizeExistingPath) expanding 8.3 `RUNNER~1`. Fix = wrap expected in canonical() helper (test:12). Missed by f529b25 sweep; added by a93ccf9.
  - spec.test local-only fail = maybeShowTelemetryNotice uses console.log→stdout (telemetry/index.ts:170-191); spec.test spawns via bare execSync w/o RASEN_TELEMETRY=0. Real product bug. Fix = notice→stderr (console.error). Kept even though spec.test is deleted, since any bare-spawn text-cmd test would recur.
- **Spec strategy**: cli-change fully retired (all 4 reqs REMOVED → capability deleted at archive per zero-req-spec precedent). cli-spec keeps ONLY "JSON Schema Definition" (Zod modeling, capability-independent); command-surface reqs REMOVED. cli-list ADDED --long. cli-show/cli-validate MODIFIED to drop dead noun suggestions. telemetry MODIFIED +stderr scenario.

## LEAD note (2026-07-10, post-propose)
- origin/main was FORCE-PUSH REWRITTEN by another session (telemetry-backend extraction; new main = 523c9be+; old SHAs incl. 486daf0 invalid upstream). This worktree is based on pre-rewrite history. At ship: fetch origin, rebase (or cherry-pick) this branch onto the new origin/main, THEN open the PR. Never push the pre-rewrite history back.
