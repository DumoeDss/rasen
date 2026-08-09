# Strategy implementer 1 handoff

Date: 2026-08-04

## Scope completed

Implemented strategy attempt 1 for the two Round 3 Major findings in the
isolated worktree/branch:

- worktree:
  `OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- starting HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`

No commit, push, ship, archive, task 9.8-10.x checkbox, child-2 work, or
ephemera mutation was performed by this implementation pass.

## Product changes

- Added opaque `ProcessScope`/`ProcessRef` contracts and a deterministic test
  adapter.
- Added a source-owned Rust `ProcessCapsule` with native Windows, Linux, and
  macOS branches plus a bounded framed Node client.
- Windows now has one external native controller uniquely owning an unnamed,
  non-inherited kill-on-close Job. It creates the supervisor suspended with
  Job-at-create membership and resumes only after durable activation.
- Linux uses boot/start identity, pidfd signalling, and process-group empty
  observation. macOS uses native kernel process-birth identity and fails closed
  without an exact source.
- Added adjacent manifest resolution with exact closed-schema protocol,
  platform, architecture, capability, length, hash, path, and symlink checks.
- Added pinned Rust build/package/release wiring. There is no runtime download,
  compilation, PATH helper, shell, PowerShell, or weak fallback.
- Migrated registry authority to schema v2 opaque refs. Owner-free v1 state may
  migrate on mutation; live/uncertain v1 PID facts and unknown rollback schemas
  preserve bytes and fail closed.
- Reworked backend/host flow to prepare -> durable CAS -> activate and routed
  reconcile/cancel/restart/retire/shutdown through ProcessScope. Prepared
  authority is retained when abort/close is not observed.
- Removed old durable-host PID admission, Job-controller PowerShell, host PID
  signalling, and generic POSIX `ps lstart` authority. Legacy one-shot
  Management Session behavior remains outside this scope.

Primary implementation files:

- `src/core/session-host/process-scope.ts`
- `src/core/session-host/process-capsule/resolver.ts`
- `src/core/session-host/process-capsule/native-process-scope.ts`
- `native/process-capsule/Cargo.toml`
- `native/process-capsule/Cargo.lock`
- `native/process-capsule/src/main.rs`
- `src/core/session-host/{backend,claude-backend,contracts,host,ownership,registry}.ts`
- `src/core/agent-cli-process.ts`
- `src/core/claude/session-state.ts`
- `src/core/management-api/router.ts`
- `scripts/build-process-capsule.mjs`
- `build.js`, `rust-toolchain.toml`, `flake.nix`
- `.github/workflows/release.yml`
- `docs/session-host.md`

## Tests and fixes discovered during implementation

New contract/package/migration/native tests cover inert prepare, CAS-loss
abort, retained unobserved close, resolver rejection, v1 migration, Windows
controller death, duplicate-Job-handle mutation, and early-activation mutation.

The first complete focused rerun failed 2/136 because the production backend
environment allowlist correctly stopped forwarding test-only replay fixture
variables. The fix stayed in test infrastructure: the CLI E2E writes
`.rasen-session-fixture.json` in its isolated cwd and the no-network replay
fixture reads it. Production environment forwarding was not widened.

A host unit regression also exposed an authority-loss edge during the strategy
work: when aborting a prepared scope did not prove closure, the previous code
released the claim. The host now retains that prepared ref and retries during
shutdown; publication happens before shutdown abort and abort is not invoked
twice.

## Fresh gate evidence

| Gate | Result |
| --- | --- |
| ProcessScope/package/migration/native suite | 4 files, 17/17 pass |
| Windows controller death | controller-only death closes root + detached descendant |
| Duplicate Job handle mutation | discriminator catches mutation |
| Early activation mutation | discriminator catches mutation |
| Full focused host/Management/daemon/CLI set | 20 files, 136/136 pass, 158.54s |
| CLI E2E | 3/3 pass |
| `pnpm exec tsc --noEmit` | pass |
| `pnpm run lint` | pass |
| stable `cargo fmt --check` + `cargo clippy --all-targets -- -D warnings` | pass |
| strict Change validation | valid |
| `npm pack --dry-run --json` | pass; native manifest/helper included |
| Packaged win32-x64 helper SHA-256 | `e762d0ce60b8ebe4370d202f536527b842a16b12f25b4f8405ebc1854e6472cb` |
| Linux target `cargo check` | pass |
| macOS target `cargo check` | pass |
| Helper residue audit | none |

## Reviewer focus and remaining limits

This author did not close the historical Round 3 verdict. Fresh non-author
security and code/spec reviewers must inspect and rerun the native authority
discriminators before tasks 9.8 and 9.9 can complete. Recommended focus:

1. Windows Job handle uniqueness, creation attribute setup, controller-death
   cleanup, and mutation effectiveness.
2. Linux pidfd + boot/start comparison and process-group empty observation.
3. macOS kernel birth-identity comparison and check/signal uncertainty paths.
4. Framed helper-client bounds, close/error races, and retained prepared/live
   authority.
5. Package manifest traversal/symlink/provenance checks and release artifact
   merge behavior.
6. Registry v1/v2 migration and rollback byte preservation.

Only Windows runtime behavior executed locally. Linux/macOS `cargo check`
passed, but actual runtime evidence remains the ECP-8 three-OS CI/delivery
gate. Tasks 9.8, 9.9, 9.10 and all local ship/archive work remain pending.
