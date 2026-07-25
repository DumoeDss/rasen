## 1. Correct the workflow dependency model

- [x] 1.1 Add the exact `ship-command → retain-command` strong workflow dependency in the built-in registry while preserving the existing auto dependency and digest behavior.
- [x] 1.2 Add the temporary retro wrapper's exact retention-runner dependency to the shared effective install-set resolution used by init, update, drift, removal, and execution enablement without persisting `retain-command` in profiles.
- [x] 1.3 Update registry and selection tests to prove ship-only closure includes one retention runner, duplicate auto/ship paths deduplicate, and stored profile normalization still omits the internal runner.
- [x] 1.4 Update dependency-graph tests to prove `goal-command` reaches ship, retain, and archive transitively and that the declared identities remain resolvable.

## 2. Reconcile init and update materialization

- [x] 2.1 Route the compatibility dependency through ordinary skill generation so `rasen-retain` receives `SKILL.md`, `report.md`, and `codify.md` before the retro wrapper is written.
- [x] 2.2 Ensure update cleanup and artifact-ledger/drift paths preserve the one desired `rasen-retain` directory while either ship or the temporary retro wrapper requires it.
- [x] 2.3 Add init tests for a named/custom ship-only profile and a profile containing neither ship nor auto, asserting the runner, sidecars, wrapper, and unchanged profile membership.
- [x] 2.4 Add update regression tests for an existing wrapper-without-runner installation, duplicate dependency paths, deselection cleanup, and platform-native skill paths.

## 3. Insert retention into goal execution

- [x] 3.1 Change `goal-loop-measure` and `goal-loop-evaluate` to use the full-feature retain-stage shape and make archive require retain; leave `goal-loop-research` unchanged.
- [x] 3.2 Make shared orchestration freeze the effective retention mode before dispatching any canonical `retain` stage, with the LEAD as the sole run-state writer and resume preferring the frozen value.
- [x] 3.3 Add bounded migration for pre-upgrade goal run-state: ship-done/archive-pending advances to retain, while archive-done records retain skipped with a legacy-completed reason.
- [x] 3.4 Add goal pipeline and run-state tests for stage order, DAG readiness, `off` no-op readiness, frozen-mode resume, and both legacy migration branches.

## 4. Align skill guidance and published assets

- [x] 4.1 Update `rasen-ship` post-ship guidance so on-merge flows present the installed retention handoff before the later archive action without changing in-ship timing semantics.
- [x] 4.2 Update `rasen-goal` built-in pipeline descriptions, progress examples, and tail guidance to show `ship → retain → archive` for measure/evaluate and report-only for research.
- [x] 4.3 Update `rasen-retain` wording so frozen-mode behavior applies to any canonical retain stage rather than only full-feature.
- [x] 4.4 Regenerate or refresh shipped skill trees, template parity hashes, pipeline fixtures, and package-facing documentation affected by the changed workflow bodies and goal DAGs.

## 5. Add cross-surface regression coverage

- [x] 5.1 Add CLI/profile coverage showing a `pashifika`-shaped named profile (`ship-command`, no `auto-command`, `retention: codify`) installs and enables `rasen-retain` without altering its snapshot.
- [x] 5.2 Add execution-preflight coverage proving goal measure/evaluate accept the installed retain skill and reject a genuinely missing or disabled stage skill through the existing diagnostic path.
- [x] 5.3 Add retro compatibility coverage proving every generated wrapper can resolve the canonical report sidecar and remains `disable-model-invocation: true` under `off`, `report`, and `codify` profiles.
- [x] 5.4 Verify all new filesystem assertions use `path.join`/`path.resolve`, temporary roots, and portable identity comparison; confirm the focused tests pass in the Windows CI environment.
  - Windows CI execution skipped for this change because no Windows environment is available yet; local portability review and macOS focused tests pass.

## 6. Validate the completed change

- [x] 6.1 Run the focused workflow-registry, profile-selection, init/update, goal-pipeline, run-state, and retain/retro template Vitest files.
- [x] 6.2 Run `pnpm run build`, `pnpm exec tsc --noEmit`, and `pnpm lint`.
- [x] 6.3 Run the complete suite with `env -u ZSH pnpm test` and investigate any retention or pipeline regressions introduced by the change.
- [x] 6.4 Run strict change validation and `npm pack --dry-run --json` to confirm the changed skills, sidecars, and pipeline YAML files are included in the publishable package.
