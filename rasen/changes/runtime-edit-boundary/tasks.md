## 1. Base runtime state and path contract

- [x] 1.1 Add `src/core/edit-boundary.ts` with versioned checkout-scoped state paths under `getGlobalDataDir()`, atomic set/status/clear operations, stable result types, and exports.
- [x] 1.2 Implement canonical root/boundary resolution and separator-aware containment using `path`/native realpath, including nearest-existing-ancestor handling for new write targets.
- [x] 1.3 Add unit tests for inactive/active/clear transitions, corrupt or mismatched records, atomic replacement, and concurrent-check read safety.
- [x] 1.4 Add cross-platform path tests for prefix siblings, `..`, symlinks, spaces, Windows drive-case/separators and UNC-shaped paths using `path.join` expectations.

## 2. Runtime classification and agent CLI

- [x] 2.1 Extend `src/core/runtime-adapters.ts` with the `hard|soft|unsupported` edit-boundary classification and a resolver that can only downgrade configured support.
- [x] 2.2 Add `rasen agent edit-boundary set <directory>`, `status`, and `clear` in `src/commands/agent.ts` and `src/cli/index.ts`, with human and stable `--json` output plus validated `--runtime`.
- [x] 2.3 Add the hidden stdin-driven `check` action that parses Claude/Codex hook envelopes, evaluates covered targets, and emits exact host-native allow/deny responses without treating parse failure as hard protection.
- [x] 2.4 Update CLI completions, descriptions, core exports, and focused tests for success, invalid input, unknown runtime, unsupported-no-state, and missing-skill installations.

## 3. Host hook reconciliation

- [x] 3.1 Refactor the Claude settings merge helper to reconcile one named Rasen `PreToolUse` entry for `Edit|Write`, preserving existing settings/hooks and refusing to clobber invalid JSON.
- [x] 3.2 Add Codex project `hooks.json` reconciliation for the exact Rasen apply-patch aliases, preserving unrelated hooks and accounting for project trust while never reporting above `soft`.
- [x] 3.3 Invoke host hook reconciliation from both init and update outside the selected-skill generation loop and before update's up-to-date short circuit.
- [x] 3.4 Add init/update integration tests proving idempotence, missing-skill operation, disabled/invalid/untrusted downgrade, unsupported-host no-op, Windows command form, and no skill-directory reference in hook commands.

## 4. Retire experts and migrate existing installs

- [x] 4.1 Add exact retired-id and retired-directory constants for `freeze`, `guard`, and `unfreeze`; remove their template imports/exports, registry definitions, template files, freeze sidecar tree, and package-source references.
- [x] 4.2 Remove the three experts from English/Japanese/Simplified-Chinese metadata, built-in fixtures, profile picker/catalog tests, parity maps, count assertions, and every direct template/sidecar test; regenerate only affected golden hashes.
- [x] 4.3 Make global/project/named profile selection readers tolerate and normalize the three exact retired ids while preserving existing errors for every unrelated unknown id.
- [x] 4.4 Run exact retired-directory cleanup for every configured tool on init/update before short circuit, preserving similarly named and user-authored directories.
- [x] 4.5 Remove only recognized legacy `freeze-dir.txt` files from canonical old state roots, preserve sibling files/directories, and add idempotent cleanup tests with and without `CLAUDE_PLUGIN_DATA`.

## 5. Workflow guidance and documentation

- [x] 5.1 Add one concise shared edit-boundary introduction covering set/status/clear, checkout scope, hard/soft/unsupported meanings, and the prohibition on overstating host enforcement.
- [x] 5.2 Rewrite investigate to invoke the base runtime and inspect status; remove sibling freeze probing, direct state writes, and `/unfreeze` guidance while retaining its debugging gates.
- [x] 5.3 Rewrite navigator and shared Fix-First/denied-edit guidance to use enforcement-aware runtime terminology and remove all three retired skill names.
- [x] 5.4 Retire current catalog/docs/locale/website references and historical instruction passages that tell users to invoke the three skills, preserving genuine history only when clearly labelled non-current.
- [x] 5.5 Add vocabulary/source guards proving current source, docs, fixtures, and generated skills contain no live `rasen-freeze`, `rasen-guard`, `rasen-unfreeze`, `check-freeze.sh`, or `freeze-dir.txt` dependency outside exact migration constants/tests.

## 6. Verification

- [x] 6.1 Run focused runtime-adapter, edit-boundary, CLI-agent, Claude/Codex hook, init/update, profile, workflow-registry, sidecar, locale, and template-parity suites and fix all failures.
- [ ] 6.2 **N/A — superseded by `retire-runtime-edit-boundary`.** The successor verifies removal and compatibility cleanup instead; do not mark this retired feature check complete.
- [ ] 6.3 **N/A — superseded by `retire-runtime-edit-boundary`.** Cross-platform coverage belongs to the successor's subtractive migration suite.
- [ ] 6.4 **N/A — superseded by `retire-runtime-edit-boundary`.** The removed transition lifecycle must not be smoke-tested or restored.
