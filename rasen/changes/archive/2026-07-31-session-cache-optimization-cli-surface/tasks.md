## 1. Durable Coordinator and Reusable Protocol

- [x] 1.1 Implement exact canonical Run resolution and safe public session projection in `src/core/management-api/reusable-session-api.ts`, using the existing RunStore decoder and cross-platform path helpers without accepting a raw run directory.
- [x] 1.2 Extend `durable-session-registry.ts` so initial registration uses the same stable dispatch fence, terminal ledger, tombstone, and `lastWakeAt` semantics as later wakes, then add optional interactive/touch metadata, lease-protected `expectedLastWakeAt` admission, touch ordinal/attempt validation, and crash-safe terminal accounting while preserving schema-v1 backward decoding and digest-only message identity.
- [x] 1.3 Add focused durable coordinator tests for lost initial-registration response and duplicate bootstrap, stale conditional wake, interactive/touch single-flight, completed and uncertain touch accounting, pre-delivery attempts, duplicate reconciliation, bounded ledger behavior, and old schema-v1 records.
- [x] 1.4 Implement the versioned idempotent register-or-wake, list, retire, and touch-policy service operations over the same cached coordinator and resident supervisor, ensuring a bootstrap retry can never become a second ordinary wake and performing no direct registry writes.
- [x] 1.5 Register authenticated `/api/v1/reusable-sessions` routes and strict wire envelopes in the CLI-owned router and wire-type files, including exact-run and all-run listing, without changing existing one-shot session routes.
- [x] 1.6 Replace direct reusable-host server cleanup with a bounded coordinator-aware shutdown hook that drains all cached owners, preserves one-shot supervisor cleanup, and marks owned durable sessions recoverably lost.

## 2. Public Session Commands

- [x] 2.1 Implement strict `change-run-action/1` agent-action input from `--action <file|->`, exact run/session/cwd checks, action-ID default message identity, and authoritative touch-policy option validation in `src/commands/session.ts`.
- [x] 2.2 Implement positive daemon state/probe classification and authenticated resident requests, including foreign/version-mismatch rejection and transport-phase tracking that forbids foreground fallback after possible admission.
- [x] 2.3 Implement foreground-owner execution through the same reusable-session service with explicit `ownerMode: foreground` projection and `ownerShutdown()` cleanup in every success and failure path.
- [x] 2.4 Implement `session list` and `session retire` against one exact canonical run, including safe projections, terminal retired behavior, and typed not-found/stale/unrecoverable outcomes.
- [x] 2.5 Implement the `rasen-session-command/1` JSON envelope, localized human rendering, stable outcome codes, and documented exit classes 0 through 5 without leaking prompts, tokens, raw message IDs, owner secrets, or lock paths.

## 3. Commander, Completion, and Localization

- [x] 3.1 Register `session exec|list|retire` in `src/cli/index.ts` with empty code descriptions and the exact arguments/options from design D1.
- [x] 3.2 Mirror the command shape in `src/core/completions/command-registry.ts`, using `completionValues` for touch modes and deadline actions and never `acceptedValues`.
- [x] 3.3 Add every session command, option, argument, example, static output, validation, and outcome string to `src/locales/en.json`, `src/locales/ja.json`, and `src/locales/zh-cn.json` without editing `src/locales/index.ts`.
- [x] 3.4 Extend CLI-presentation, command-registry, completion-generator, and locale-catalog parity tests so all three locales remain exact and non-empty.

## 4. Behavioral and Cross-Platform Verification

- [x] 4.1 Add command tests for malformed actions/policies, exact Run collisions, immutable-fact mismatch, stable default/explicit message IDs, typed outcomes, exit codes, and secret redaction.
- [x] 4.2 Add management API tests for bearer authentication, strict envelopes, resident coordinator reuse, daemon identity mismatch, foreground cleanup, request-loss uncertainty, concurrency, list, retire, and coordinator-aware server shutdown.
- [x] 4.3 Add CLI end-to-end tests for localized help plus equivalent human and single-document JSON output for exec, list, retire, duplicate, busy, unavailable, foreground, daemon, and uncertain outcomes.
- [x] 4.4 Run the focused CLI/API suite on Windows and its injected POSIX path cases, using `path.join`/`path.resolve` expectations; record the child-local commands and leave the final native CI matrix to `session-cache-optimization-acceptance-evidence`.
- [x] 4.5 Run typecheck and all affected focused suites, confirm no edit under `src/core/session-host/`, `src/core/change-run/**`, `src/core/pipeline-registry/**`, `src/commands/daemon.ts`, package locks, or scheduler-owned files, and strictly validate this change package.

### Child-local verification (Windows, 2026-07-30)

- `pnpm exec vitest run <focused files> --no-file-parallelism --maxWorkers=1`
  covered the session command/e2e, reusable API/routes, durable registry and
  concurrency/recovery, CLI presentation/completion generators, locale parity,
  management router/server/session shutdown, and daemon identity/lifecycle
  suites: 22 files and 307 tests passed.
- Windows-native durability budgets and the registry suite's injected
  `platform: 'linux'` path/replace behavior both passed.
- `pnpm exec eslint <CLI-owned touched TypeScript files>` passed.
- `pnpm build` passed, including TypeScript compilation.
- `pnpm exec rasen validate session-cache-optimization-cli-surface --strict`
  passed.

## 5. Round 1 Review Fixes

- [x] 5.1 Retain the decoded canonical head Record in trusted run resolution; require `record.actions[actionId]` to contain the exact frozen requested agent action, permit new dispatch only for active `granted` actions, preserve same-ID terminal duplicate lookup after closure, and derive/persist/compare complete `space` plus `RuntimeExecutionRef` binding with negative tests for absent, modified, closed/non-deliverable, and execution-drift actions.
- [x] 5.2 Make CLI-owned `daemon-probe.ts` distinguish affirmative `ECONNREFUSED` absence from timeout, non-response, other network ambiguity, and a live recorded owner; allow foreground only after recorded PID staleness is proved, cover all probe classes, set identified-daemon kill grace to 20 seconds, and extend port-free observation to at least 25 seconds without giving the scheduler edit ownership.
- [x] 5.3 Replace shallow daemon-response checks with one strict unknown-key-rejecting runtime union for every `rasen-reusable-session-api/1` success/failure projection; make exactly-2-MiB, overflow, truncated, `aborted`, response-error, and premature-close paths settle exactly once before destruction and prove no forbidden field reaches stdout.
- [x] 5.4 Return a bounded typed aggregate from reusable-service owner shutdown after attempting every cached coordinator; propagate supervisor-reap and registry-settlement failures as `owner_shutdown_failed` through foreground single-document exit-1 output and server shutdown instead of swallowing them.
- [x] 5.5 Add optional `expectedLastWakeAt` to the strict touch-policy wire/service/coordinator request, compare it under the wake lease after reconciliation, return `conditional_wake_stale` before mutation on mismatch, and cover list → interactive wake → stale policy update without changing durable policy.
- [x] 5.6 Route missing `exec`, `list`, and `retire` required-operand failures through the session output adapter so JSON mode always emits one `rasen-session-command/1` document with exit 2, with one missing-option case per subcommand in JSON and human modes.
- [x] 5.7 Distinguish immutable conflict from a raced same-identity bootstrap: same-message overlap returns its terminal duplicate, distinct-message overlap returns contention, and a later request that initially observes the existing session may ordinary-wake; prove all paths with a two-service barrier test.
- [x] 5.8 Bound action ingestion before allocation by stat-rejecting regular files over 1 MiB and reading at most 1 MiB plus one byte from stdin/other streams, with exact-limit and over-limit file/stdin tests.
- [x] 5.9 Complete focused E2E equivalence for foreground and daemon exec/list/retire plus duplicate, busy, unavailable, delivery-uncertain, missing-required, strict/oversized response, and owner-shutdown-failure outcomes; rerun and record exact focused counts without claiming the downstream merged/native acceptance matrix.

### Round 1 serial verification (Windows, 2026-07-30)

- Before every validation command, the target worktree was checked for an
  existing `pnpm`/`node` runner. No conflicting runner was present.
- `pnpm exec vitest run <Round 1 session/API/registry/probe files> --no-file-parallelism --maxWorkers=1`
  passed: 6 files and 59 tests.
- `pnpm exec vitest run <CLI presentation/completion/locale files> --no-file-parallelism --maxWorkers=1`
  passed: 11 files and 189 tests.
- `pnpm exec vitest run <registry/router/server/daemon-state files> --no-file-parallelism --maxWorkers=1`
  passed: 5 files and 77 tests.
- `pnpm exec vitest run test/commands/daemon-lifecycle.test.ts test/commands/ui-launch-stale-replace.test.ts --no-file-parallelism --maxWorkers=1`
  passed: 2 files and 6 tests.
- The exact focused total was 24 unique files and 331 tests, all passed.
- `pnpm exec eslint <16 CLI-owned touched TypeScript/test files>` passed.
- `pnpm exec rasen validate session-cache-optimization-cli-surface --strict`
  passed.
- This serial verification intentionally did not run `pnpm test`, `build`, or
  `prepare`. The downstream merged/native acceptance matrix remains owned by
  `session-cache-optimization-acceptance-evidence`.

## 6. Round 2 Review Fixes

- [x] 6.1 Make the shared strict daemon-response decoder consume the request identity and reject any top-level or nested `runId`/`sessionKey` mismatch before `commandEnvelope()` or presentation; exact-run list responses may contain only that run and only the existing all-scope arm may contain multiple runs. Add independent negative cases for wrong top-level identity, wrong nested wake/retire projection identity, wrong nested failure identity, and a wrong-run list item.
- [x] 6.2 Preserve the bounded public-safe owner-shutdown `failures[]` aggregate through the foreground single-document failure envelope and the server stop error/result surface after every cached owner has been attempted. Prove one redacted diagnostic per failed run and prove that paths, tokens, prompts, owner secrets, and raw message IDs cannot enter it.
- [x] 6.3 Complete paired resident-daemon human/JSON E2E assertions for the exec, list, retire, duplicate, busy, unavailable, uncertain, strict-response, and owner-shutdown outcomes claimed by Tasks 4.3 and 5.9, using the same fixtures for each pair and comparing semantic facts rather than one-sided presentation samples.
- [x] 6.4 Hold the first service's bootstrap before reservation settles, start a distinct-message registration through the second service during that hold, and assert contention plus exactly one host dispatch; keep same-message duplicate overlap and the post-bootstrap ordinary-wake path as separate assertions so Task 5.7 proves each temporal branch.

### Round 2 focused verification (Windows, 2026-07-31)

- Every validation command audited the target worktree for an existing
  `pnpm`/`node` runner before starting; no conflicting runner was present.
- `pnpm exec vitest run test/commands/session.test.ts test/commands/session-e2e.test.ts test/core/management-api/reusable-session-api.test.ts test/core/management-api/reusable-session-routes.test.ts test/core/management-api/session-registry-recovery.test.ts --no-file-parallelism --maxWorkers=1`
  passed: 5 files and 56 tests.
- `pnpm exec eslint <9 Round 2 CLI-owned TypeScript/test files>` passed with
  exit code 0.
- No root `pnpm test`, scheduler suite, 24-file CLI suite, or `prepare` was
  run.
