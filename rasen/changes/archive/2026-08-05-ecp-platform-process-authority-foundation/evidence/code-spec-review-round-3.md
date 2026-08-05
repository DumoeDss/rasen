# Code/spec fresh re-review round 3

Date: 2026-08-05

Verdict: **PASS - 0 Blocker, 0 Major, 0 Minor, 0 Trivial.**

Scope Check: **MATCHES**

This was a fresh, report-only review of the latest foundation product, all 12
focused tests, the three shared/test helpers, design, delta spec, round-2
code/spec report, round-2 CSO report, and round-2 fix receipt. The fix receipt
was treated only as a list of claims to re-prove. Its conclusions were not used
as acceptance evidence.

No product, test, spec, task, runstate, Direction, portfolio, OS-provider
Change, commit, ship, or archive state was changed by this review.

| Severity | Count |
| --- | ---: |
| Blocker | 0 |
| Major | 0 |
| Minor | 0 |
| Trivial | 0 |
| Total | 0 |

## Findings

No Blocker, Major, Minor, or Trivial finding remains in the reviewed foundation
scope. The nine round-2 findings were independently re-exercised through public
runtime seams or the unchanged public conformance seam and are closed below.

## Round-2 finding closure

| Finding | Fresh code/spec proof | Fresh public discriminator | Result |
| --- | --- | --- | --- |
| B-001 - forgeable registry selection | `registry.ts:17`, `:190-193`, and `:225-254` brand only post-validation instances, require the exact base prototype, and call the captured base selector. Coordinator selection uses that operational selector at `coordinator.ts:969` and `:1266`. | Subclass, proxy, and lookalike registries all returned `authority-unavailable`; neither the forged selector nor provider dispatched. The focused test at `process-authority-public-surface.test.ts:81-145` exercises the same shapes. | **CLOSED** |
| B-002 - recovered references omitted from lifecycle ledger | `coordinator.ts:706-708`, `:752-788`, and `:1187-1261` place valid recovered references in the same active/retired ledger before inspect or terminate dispatch. Local preparation checks the same ledger at `:984-1059`. | A replacement-style first inspect registered recovered generation A; a later prepare returning provider generation A failed unavailable, with exactly one recovery dispatch. Focused recovery, in-flight collision, stale-receipt, and full-ledger cases are at `process-authority-outcomes.test.ts:230-279` and `process-authority-deadlines.test.ts:924-947`. | **CLOSED** |
| B-004 - abort-incapable provider could pass conformance | The unchanged suite now requires authentic exact-empty receipts for prepared and published abort at `process-authority-provider-conformance.ts:237-285`. Both facts are part of the measured snapshot at `:405-440` and `:443-600`; the deterministic `broken-abort` mutation is implemented at `deterministic-process-authority-provider.ts:104-107`. | The exact focused mutation loop made the broken snapshot RED internally and the default fixture GREEN. Positive prepared and published abort both produced authentic coordinator receipts. | **CLOSED** |
| B-005 - mutable prepared reference redirected control and release | `coordinator.ts:246-341` fingerprints provider settlements opaquely. `:465-491` captures `reference` and `activate` once, and `:1027-1059`, `:1068-1090`, and `:1151-1155` use only that captured capability. | Alternating reference/activation accessors were each read once. Envelope identity and abort both used the first captured provider reference; the resulting exact-empty receipt was authentic. The focused case is at `process-authority-lifecycle.test.ts:218-263`. | **CLOSED** |
| M-002 - statusless root exit accepted | `types.ts` and `coordinator.ts:493-522` represent root exit as a closed union and reject the null/null case before attachment or release. | Null/null observation and control results both became retained `control-loss`; adapter projection remained uncertain. Focused cases are at `process-authority-outcomes.test.ts:189-228`, `process-authority-process-scope-adapter.test.ts:170-192`, and `process-authority-provider-conformance.ts:153-174`. | **CLOSED** |
| M-005 - validated inputs were reread for identity/dispatch | `coordinator.ts:365-450` captures bounded prepare arrays, environment entries, and termination intent once into frozen snapshots. `:999-1013` and `:1247-1251` use those exact snapshots for identity and dispatch. | A public prepare probe combined alternating top-level fields, proxied array length/index, and an alternating environment entry. Every field/entry was read exactly once and the provider received only the frozen safe snapshot. Focused top-level and termination cases are at `process-authority-lifecycle.test.ts:154-216` and `process-authority-outcomes.test.ts:383-440`. | **CLOSED** |
| M-006 - post-deadline rejection became control loss | `coordinator.ts:890-960` routes fulfillment and rejection through one monotonic settlement guard and classifies either route at/after the deadline as timeout. | A withheld-timer rejection after advancing the monotonic clock returned `timeout`. The focused seven-phase fulfillment/rejection matrix is at `process-authority-deadlines.test.ts:321-502`. | **CLOSED** |
| M-007 - concurrent preparation oversubscribed tombstones | `coordinator.ts:706-708`, `:766-788`, and `:984-1059` reserve a reference slot synchronously before dispatch, count recovery in the same 1,024 bound, and release a reservation only when no reference is admitted. | The exact focused public test admitted one of two concurrent final-slot prepares, dispatched once, released failure/timeout/collision reservations, and refused recovery dispatch at a full ledger (`process-authority-deadlines.test.ts:826-947`). | **CLOSED** |
| M-008 - publication failure allowed a second publisher call | `coordinator.ts:1112-1176` moves to `publishing` before the callback, retains `publication-uncertain` after timeout/loss/mismatch, forbids another publication, keeps activation unavailable, and permits bounded abort. | A throwing publisher was called once; the retry returned `ordering-conflict` without callback invocation; `currentState()` remained `publication-uncertain`; abort returned an authentic exact-empty receipt. Mismatch coverage is at `process-authority-lifecycle.test.ts:297-326`. | **CLOSED** |

## Affected-delta audit

The latest changes around the nine findings were reviewed as one interacting
authority path, not as isolated patches.

- Registry provenance cannot be manufactured by inheriting, proxying,
  structurally imitating, or overriding the exported registry. Base selection
  remains exact-tuple-only and manifest validation still precedes branding.
- Recovery registration, local reference admission, retirement, exact-receipt
  caching, and synchronous reservations share one non-evicting 1,024-generation
  lifecycle ledger. Collision and exhaustion refuse work before publication or
  activation, and full-ledger recovery refuses provider dispatch.
- Prepare inputs, termination intents, and prepared provider capabilities have
  one validated/captured representation. Diagnostic processing no longer walks
  the opaque prepared value, so it cannot trigger a second accessor read.
- Root-exit normalization admits only the closed code/signal union. No
  statusless value becomes a root-exit fact or an exact-empty receipt.
- Fulfillment and rejection share the same monotonic guard. Late settlements
  are diagnostic-only and cannot mutate lifecycle or receipt state.
- Publication has one callback attempt. `publication-uncertain` is retained,
  non-activatable, non-retryable, and still reconcilable by bounded abort or the
  exact-reference coordinator operations.
- Positive abort is now a measured provider capability, while unavailable,
  uncertain, drift, gap, timeout, control-loss, and malformed outcomes remain
  non-release facts.

No new Blocker or Major interaction was found in this delta.

## Eight-requirement / latest-scenario audit

The latest delta spec contains **8 requirements and 52 scenarios**. All were
reviewed against current code and tests.

| Requirement | Scenarios | Result | Evidence summary |
| --- | ---: | --- | --- |
| 1. Exact process-authority provider selection | 5/5 | **PASS** | Closed descriptor/manifest validation, exact tuple lookup, unforgeable operational registry selection, and zero fallback/forged dispatch. |
| 2. Versioned opaque authority-reference envelope | 6/6 | **PASS** | Canonical bounded codec, corruption detection without signer claims, unknown-version byte retention, native-field exclusion, and redacted non-replayable view. |
| 3. Bounded prepare, publish, and activate ordering | 7/7 | **PASS** | Inert prepare, exact durable acknowledgment, bounded single-attempt publication, bridge-before-activation adapter order, and exactly-once activation. |
| 4. Exact lifecycle observations remain distinct | 11/11 | **PASS** | Root-exit retention, authentic exact empty, local/recovered non-reuse, shared capacity, inert recovery, non-empty status, and distinct unavailable/uncertain/drift/gap outcomes. |
| 5. Bounded control retains authority after ambiguity | 8/8 | **PASS** | All seven phases bounded, both settlement routes monotonic, recursive immutable inputs, captured prepared capability, late quarantine, single settlement, and non-release ambiguity. |
| 6. Closed capability, protocol, and manifest negotiation | 6/6 | **PASS** | Exact closed manifest/tuple/version checks, non-empty registry manifest requirement, and newer-reference preservation without downgrade. |
| 7. Reusable deterministic provider conformance harness | 5/5 | **PASS** | One public suite, positive abort/replay matrix, import-only platform consumer contract, complete named mutation sensitivity, and no actual-platform claim. |
| 8. Additive migration without platform or release claims | 4/4 | **PASS** | Empty production foundation registry, legacy bytes not promoted, rollback preservation, opt-in compatibility adapter, and no foundation-owned OS/default/release wiring. |

Coverage inventory:

```text
CODE/SPEC COVERAGE
==================
[reviewed] 8/8 requirements
[reviewed] 52/52 latest scenarios
[reviewed] 8/8 process-authority product modules
[reviewed] 12/12 exact focused test files
[reviewed] 3/3 shared/test helpers
[closed]   B-001, B-002, B-004, B-005
[closed]   M-002, M-005, M-006, M-007, M-008
[open]     0 Blocker, 0 Major
```

## Fresh verification evidence

- Exact task-9.1 12-file focused command with `--maxWorkers=1
  --minWorkers=1 --reporter=dot`: exit 0; **12 files, 186 tests passed**.
- One no-file built-module public-seam probe independently combined registry
  forgery, recovered-generation reuse, recursive alternating getters, mutable
  prepared capability, null/null root status, late rejection, and
  publication-uncertain retry/abort. Exit 0. It recorded zero forged selector
  calls, zero forged provider dispatches, one recovery dispatch, one publisher
  call, and exactly one read for every probed field/entry/capability. No probe
  output was retained in the worktree.
- M-007 was additionally re-proved by the exact focused public test at the real
  exported limit: one final-slot dispatch, no oversubscription, reservation
  release on all three no-reference paths, and no recovered dispatch at full
  capacity.
- B-004 was additionally re-proved by the unchanged public conformance suite:
  both positive abort facts are mandatory and the named broken-abort mutation
  makes its measured snapshot fail.
- `pnpm exec tsc --noEmit`: exit 0.
- `node bin/rasen.js validate ecp-platform-process-authority-foundation
  --strict`: exit 0; Change valid.

## Boundary and exclusion result

- The production foundation registry remains empty. The reviewed foundation
  does not register Linux, Windows, macOS, ProcessCapsule, PID-tree, PGID,
  broker, installer, signer, entitlement, VM, Action, or Run authority.
- The deterministic provider and manifest builders remain test/support-only.
- Legacy `rasen-process-scope/1` bytes are preserved as legacy facts and are not
  promoted into `rasen-process-authority/1` authority.
- The passing package/migration focused tests do not convert this foundation
  review into an actual-platform, packaging, signing, or release-support claim.
- macOS/MAC/MMAC remains decision-deferred; this review selects no platform
  approach and unblocks no provider Change by itself.

## Gate result

The code/spec review gate is **PASS** at **0 Blocker / 0 Major**. This evidence
is sufficient for the parent workflow to continue its own bounded review and
verification sequence. This reviewer did not mark tasks complete and did not
commit, ship, archive, or change any run/portfolio state.
