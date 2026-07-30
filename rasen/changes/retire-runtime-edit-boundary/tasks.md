## 1. Compatibility cleanup foundation

- [x] 1.1 Extract the frozen Claude and Codex generated hook shapes plus the
  version-1 runtime-state identity/schema into a retirement-only cleanup
  helper that has no set/status/check enforcement API.
- [x] 1.2 Implement subtractive hook cleanup for
  `.claude/settings.json` and `.codex/hooks.json`, removing only complete
  frozen handler matches while preserving mixed groups, metadata, root keys,
  unrelated handlers, invalid files, and user-modified near matches.
- [x] 1.3 Implement direct-child cleanup for recognized version-1
  checkout-digest records and frozen temporary-file names under the exact
  machine-data state directory, preserving malformed, future-version,
  unexpected, unreadable, and nested entries and removing directories only
  when non-recursively empty.
- [x] 1.4 Extend cleanup tests for idempotence, invalid JSON, mixed hook
  groups, partial identity matches, Windows command/path/case behavior, POSIX
  paths, unknown state preservation, and the existing
  `freeze`/`guard`/`unfreeze` generation.
- [x] 1.5 Invoke retired hook/state cleanup from init and update before their
  relevant short circuits, remove live hook reconciliation calls, and update
  lifecycle tests to prove one upgrade heals both generations without
  recreating a hook.

## 2. Remove the live runtime capability

- [x] 2.1 Remove the public and hidden `rasen agent edit-boundary` Commander
  subtree and AgentCommand methods/types, including stdin checker handling and
  human/JSON output.
- [x] 2.2 Remove the edit-boundary command-completion subtree and its localized
  CLI descriptions, keeping the remaining `rasen agent` help and completions
  intact.
- [x] 2.3 Remove edit-boundary enforcement types, metadata, strength ordering,
  and resolver behavior from the runtime-adapter registry and update its
  focused type/runtime tests without changing probe, audit, dispatch, or host
  detection capabilities.
- [x] 2.4 Delete the live state/evaluation and hook-reconciliation modules
  after all compatibility identities are owned by the retirement helper;
  remove their public core exports and feature-only tests.
- [x] 2.5 Add a source/package vocabulary guard proving current CLI,
  completions, exports, adapters, and generated package payload contain no live
  edit-boundary command or hook checker outside frozen migration identities and
  historical/superseded change artifacts.

## 3. Replace workflow guidance

- [x] 3.1 Remove `EDIT_BOUNDARY_GUIDANCE` from the shared expert templates and
  rewrite Fix-First honesty to verify the actual write result and current diff,
  including unresolved reporting for unexplained changed files outside the
  declared task scope.
- [x] 3.2 Rewrite investigate's scope-lock phase to record the evidence-backed
  affected area, record justified scope expansion before additional edits, and
  audit the final changed-file set while retaining its feedback-loop,
  root-cause, regression, and risk-proportional verification gates.
- [x] 3.3 Rewrite navigator safety routing to use `rasen-careful`,
  `rasen-investigate`, and review/verification workflows without advertising
  freeze/unfreeze/edit-boundary or claiming mechanical denial.
- [x] 3.4 Update focused template tests and regenerate only the affected
  function/generated-content parity hashes and installed fixtures.
- [x] 3.5 Remove current English, Simplified-Chinese, Japanese, catalog, and
  website/documentation references that instruct users to invoke the runtime
  boundary; preserve genuine historical text only when clearly marked
  superseded.

## 4. Supersession and independent execution controls

- [x] 4.1 Add a committed supersession notice to the active
  `runtime-edit-boundary` change that points to
  `retire-runtime-edit-boundary`, marks its unchecked verification work not
  applicable rather than complete, and prevents its delta specs from being
  promoted as current product direction.
- [x] 4.2 Add or retain regression assertions showing that ECP
  `workspace.access`, pipeline/runtime sandbox values, workspace reservations,
  and isolated-worktree delivery contracts do not import or depend on the
  removed edit-boundary modules.
- [x] 4.3 Document the artifact-type migration matrix: predecessor
  `freeze`/`guard`/`unfreeze` ids, directories, and `freeze-dir.txt` cleanup
  remains additive, while the byte-identical runtime hooks and version-1 state
  shipped independently on both the 0.1.6 and 0.2.0 lines gain the same exact
  cleanup; any 0.1.6 maintenance backport reuses those frozen identities
  without daemon-specific changes.

## 5. Verification

- [x] 5.1 Run focused legacy-cleanup, hook migration, init/update,
  AgentCommand/CLI, completion, runtime-adapter, locale, generated-skill,
  vocabulary, and template-parity suites and resolve all failures.
- [x] 5.2 Run `pnpm lint`, `pnpm test`, `pnpm build`, and package/release
  contract checks, confirming the package contains the compatibility cleanup
  but no live boundary state/checker/reconciliation code.
- [x] 5.3 Run the same focused path/config migration suite against the exact
  retirement source state under actual Windows and POSIX Node runtimes, using
  `path.join`/platform path APIs for expected values and covering unrelated
  user hooks and unknown state; verify that committed-ref CI is configured to
  run the relevant tests on Windows and at least one POSIX host.
- [x] 5.4 Smoke-test init/update against Claude-only, Codex-only, and combined
  project configuration containing exact retired hooks plus unrelated hooks;
  confirm the Rasen entries and startup trust burden disappear, a second
  update is a no-op, and generic daemon/ECP execution controls still pass their
  focused tests.

## Post-ship delivery obligation

- **PENDING — ship-owned hosted CI check (not an apply task):** after ship
  creates the exact retirement commit/ref, record a passing Windows shard and
  at least one passing POSIX shard from the configured hosted CI matrix. Ship
  and subsequent review must report this check as pending or failed until both
  results exist; this obligation is intentionally not an apply checkbox,
  because apply cannot produce the ref that hosted CI requires.
