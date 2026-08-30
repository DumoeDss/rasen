# Pre-Landing Review: Project-to-Store Membership API

- Mode: dispatched / report-only
- Branch: `feat/project-issue-onboarding`
- Base: `origin/dev/0.2.0`
- Reviewed HEAD: `8f6266525b3b32940780a94f0f3565aaeeaf06d1`
- Result: **REVIEW-CLEAN — 0 Blocker, 0 Major, 0 Minor, 0 Trivial**
- Incremental re-review: Round 2 of the latest uncommitted `space-creation-wire-mirror.test.ts` fix, following the protocol-coverage re-review

## Scope Check

**CLEAN**

- Intent: expose the existing idempotent `store add-project` mutation through authenticated `POST /api/v1/spaces`, with explicit Project and Store ids, a fresh Store result, and a typed UI client seam.
- Delivered: one bounded membership operation, root/UI wire members, client wrapper, fake/real CLI coverage, router admission coverage, and the corresponding Rasen change artifacts.
- The branch also carries the parent portfolio and dependent UI planning/run artifacts; those are expected orchestration state and do not broaden this API child's product behavior.

## Findings

### [Resolved in Round 2] The wire-mirror probe now enforces exact normalized structural equality

Resolved by `test/core/management-api/space-creation-wire-mirror.test.ts:68-104` and `:109-130`. The generic-function `Equal` distinguishes optional/key drift rather than accepting mutual assignability. `NormalizeResponse` maps every `keyof Response` and transforms only `space`; `NormalizeSpaceRoot` in turn preserves every space key except the one deliberate `root?: string` to `root: string` boundary. The negative probe injects one optional top-level UI field into each of the two response mirrors and requires the two corresponding TS2344 false-constraint diagnostics. That count is semantic rather than incidental: the clean probe requires zero diagnostics, the injected source contains exactly two separately targeted response assertions, and the code/message checks reject unrelated compiler errors. The former same-literal runtime pseudo-assertion is gone.

### [Resolved] Fail-closed protocol branches and slot recovery are now exercised

Resolved by `test/core/management-api/create-space.test.ts:279-316`, `:404-453`, and `:495-534`. The tests now prove pre-read rejection causes no spawn and releases the slot, separately exercise Project-root and Store-root mismatch with no post-read, exercise post-read rejection, and prove a subsequent request succeeds after every failure. The added fake CLI is temp-local and changes no product semantics.

## Standards Axis

No Blocker or Major standards violations found.

- Fresh typed lookup: membership takes the shared slot before awaiting `listSpaces()`, then requires exactly one live Project and Store (`create-space.ts:381-428`, `486-514`).
- Exact bounded argv: the only admitted vector is `store add-project <resolved-root> --to <storeId> --json` (`create-space.ts:427`); there is no path for `--set-primary`, `--as`, `--dry-run`, or `adopt`.
- Shared cap-one: validation/admission precede `inFlight`, while pre-read, child lifetime, and post-read remain inside the same slot (`create-space.ts:466-517`, `551-562`, `626-680`).
- Fail-closed correlation and postcondition: CLI identity/roots are checked before a fresh target-root lookup, and exactly one normalized member identity is required (`create-space.ts:98-116`, `437-446`, `604-639`).
- Error posture: CLI refusal preserves exit/stderr under 422; timeout remains 504; catalog/protocol contradictions remain 500 (`create-space.ts:555-562`, `586-619`, `664-676`).
- Windows/path posture: the resolved Project root remains one argv token and root comparisons canonicalize with Windows case folding (`create-space.ts:427`, `430-435`).
- Latest token-free browser-session baseline remains integrated: the new UI method uses the existing `request()` seam (`packages/ui/src/api/client.ts:492-498`), while the server's generic cookie-to-Bearer translation still occurs before management dispatch (`src/core/management-api/server.ts:213-217`, `262-264`).

Standards count: **0 findings**.

## Spec Axis

No missing or wrongly implemented behavioral requirement found against `proposal.md`, `design.md`, `specs/management-http-api/spec.md`, `specs/space-creation/spec.md`, and `tasks.md`.

- Explicit `projectId + storeId`, no client path, no implicit Store choice: implemented.
- Existing CLI/core mutation remains the only membership authority; no map, cache, secondary membership record, adoption, or planning rebind was added.
- Success is HTTP 200 with a freshly observed `StoreSpaceEntry`; create/register/setup remain HTTP 201.
- Initial membership and replay are covered through the real CLI, including one normalized member and unchanged planning pointer (`test/core/management-api/create-space.integration.test.ts:85-133`).
- Canonical/single-trailing-slash admission, bearer rejection, and PUT/DELETE 405 behavior are covered (`test/core/management-api/router.test.ts:375-437`).

Spec count: **0 findings**.

## Coverage Map

```text
CODE PATH COVERAGE
==================
[+] Request/field validation
    └── [★★★ TESTED] malformed, cross-operation, control, length, no-spawn
[+] Fresh typed catalog resolution
    ├── [★★★ TESTED] missing/wrong-type/ambiguous Project and Store
    └── [★★★ TESTED] pre-read rejection and subsequent slot recovery
[+] CLI execution
    ├── [★★★ TESTED] exact argv, inert metacharacter path, prohibited-option absence
    ├── [★★★ TESTED] CLI refusal, timeout, shared busy response
    └── [★★★ TESTED] Project-root and Store-root mismatch + slot recovery
[+] Fresh postcondition
    ├── [★★★ TESTED] success, normalized identity, zero/duplicate membership
    └── [★★★ TESTED] post-read rejection and subsequent slot recovery
[+] Wire/client seam
    ├── [★★★ TESTED] exact client JSON and precise Store response fixture
    └── [★★★ TESTED] strict normalized mirror equality + optional top-level drift rejection

USER FLOW COVERAGE
==================
[+] [★★★ TESTED] First add -> fresh Store membership -> HTTP 200 contract
[+] [★★★ TESTED] Replay -> one member -> planning Store unchanged
[+] [★★★ TESTED] Missing/wrong/ambiguous selection -> pre-spawn client error
[+] [★★★ TESTED] Unauthorized/canonical/trailing-slash/unsupported-method routing
[+] [★★  VERIFIED] Token-free cookie baseline composes generically with the unchanged request/server seams

COVERAGE: all identified membership behavior and wire-mirror verification paths
are covered.
```

## Review Evidence

- Read the full API-child implementation, tests, CLI output producer, Store membership authority, router composition, and originating change artifacts.
- `git diff --check origin/dev/0.2.0`: pass.
- Strict UTF-8 decode, BOM, replacement-character, and common mojibake scan for all changed files: pass.
- Incremental `git diff --check` and strict UTF-8 checks for both re-review files: pass.
- Round 2 statically traced the generated TypeScript probe, strict equality, normalization, and negative-drift diagnostics; per dispatched constraints, tests were not executed.
- No PR exists yet, so there were no Greptile comments to triage.
- Per dispatched reviewer rules, no product/spec/task/run-state edits, test execution, commits, or subagent dispatches were performed. This report is the only review write.

## Verdict

**REVIEW-CLEAN for the review-cycle gate:** 0 Blocker, 0 Major, 0 Minor, 0 Trivial. The protocol-coverage and strict wire-mirror findings are both resolved.
