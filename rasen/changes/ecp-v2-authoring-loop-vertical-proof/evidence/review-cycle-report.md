# ECP-6 Child 4 independent review-cycle report

## Round 1 verdict

**BLOCKED — 0 Blocker, 2 Major, 1 Minor.**

This is a fresh, non-author review of `ecp-v2-authoring-loop-vertical-proof` at
the isolated worktree below. The implementation is not eligible for tasks 9.8
or 9.9: both remain open, and parent-owned delivery task 9.10 remains open.

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- Merge base / `origin/dev/0.2.0`: `a1306828a23b2c4adc0db81f92b09498a5e92710`
- Pre-report tracked patch Git-blob fingerprint: `74a6014ef5dcdb69de6fb163090e72b7ec71c92e`
- Pre-report intended-untracked manifest: 78 files, SHA-256
  `bfe7b9543107225a0cb27a4ff021e943859fc26b48a543059547bf9c9864d5ec`

The untracked fingerprint excludes this report and the protected pre-existing
temporary trees `.tmp-ecp6-defaults/`, `rasen/changes/foo/`, and the migrated
`test-*-tmp/` trees. No source, test, task, run-state, portfolio, ship, archive,
commit, or push action was performed by this review.

## Coverage map

```text
Canvas Definition v2
  -> Management validate/save/detail
  -> canonical preparation + shared profile resolution
  -> immutable lowerer / plan / filesystem Run store
  -> public facade + reconciler
  -> one ChangeRunView projector
       -> CLI status
       -> Management Run detail
       -> Operations UI

Completion authority path (blocked)
  caller bytes/ActorRef/EvidenceRefs
  -> transient CLI in-memory upload store
  -> self-consistency checks only
  -> canonical effect mutation

Management exact-space path (blocked)
  planning:<PlanningSpaceId>
  -> list filters correctly
  -> detail loses root and appears current/editable
  -> control rejects no_project
```

## Major findings

### M1 — Caller-synthesized authority can commit a required effect, and the referenced evidence bytes are not durable

The public observation seam does not validate actor/evidence authority against
the frozen Action, Adapter, or EvidenceContract. It validates only caller-owned
self-consistency:

- `src/core/change-run/internal/facade-runtime.ts:114-163` recomputes the
  caller's ActorRef digest, but it never compares the actor variant, adapter,
  principal, producer, attestation schema, evidence schema, or observation
  contract with the committed Action/plan. At lines 136 and 157 it even takes
  the expected schema from the submitted ref itself.
- `src/core/change-run/internal/actors.ts:116-146` proves only that an ActorRef's
  `identityDigest` matches that same ActorRef's fields. A caller can create a
  new, internally valid identity.
- `src/core/change-run/internal/evidence.ts:109-141` likewise proves only ref
  identity and equality with the expected values supplied by the caller-facing
  verifier. Production code never invokes `verifyEvidenceContent` before the
  Record mutation.
- `src/core/change-run/internal/completion.ts:30-49,58-78` binds the receipt
  digest to the result/observation payload, but not to actor, attestation,
  evidence producer, or evidence bytes.
- `src/commands/pipeline.ts:1813-1858` creates a new bounded in-memory evidence
  store per command. `src/commands/pipeline.ts:1961-1964` discards the returned
  store before calling the facade. The production tree exposes only the
  in-memory constructors at `src/core/change-run/internal/evidence.ts:156` and
  `:201`; there is no filesystem EvidenceStore implementation or fresh-process
  read path.

This contradicts the governing runtime contract:

- `rasen/changes/ecp-run-spine/specs/ecp-change-run-runtime/spec.md:411-427`
  says caller self-report has no authority and the attestation is validated
  against the frozen Adapter/Action.
- The same spec at `:435-446` requires a bounded read of actual stored content,
  validation against the plan-frozen EvidenceContract/trusted producer, and
  explicitly says trusted-host identity does not make its payload or refs
  trustworthy.
- `rasen/changes/ecp-run-spine/design.md:1460-1492` requires a durable,
  no-follow, atomically published EvidenceStore and rejects caller-authored
  binding fields as authority.
- Child 4's own requirement at
  `specs/ecp-change-run-runtime/spec.md:18-35` requires trusted actual evidence
  and actor-attestation/evidence verification before mutation.

The Child 4 design's “trusted test host” at `design.md:68-76` does not lower
this severity. That host is the manual driver allowed in place of an ECP-7
Session executor; it is not permission to replace the frozen authority checks
with caller assertion. Child 4 D3 itself says the new variants must not grant
trust to arbitrary observation payloads beyond the existing attestation and
evidence contracts (`design.md:54-65`).

#### Executed read-only reproduction

An inline ESM script imported the built production modules and created only an
in-memory plan, Run store, and public facade. It admitted a legitimate **agent**
Action, then substituted a completely new, internally self-valid **host** actor,
`adapter:caller-invented`, `caller-invented-producer`, and two caller-invented
schemas. `runtime.complete()` accepted the observation and committed the effect:

```json
{
  "accepted": true,
  "disposition": "advanced",
  "admittedActionKind": "agent",
  "substitutedActorKind": "host",
  "substitutedAdapter": "adapter:caller-invented",
  "substitutedProducer": "caller-invented-producer",
  "substitutedSchemas": [
    "caller-invented-attestation/999",
    "caller-invented-evidence/999"
  ],
  "effectState": "succeeded",
  "recordVersion": 2,
  "retainedEvidenceRefs": 1,
  "freshStoreHas": false,
  "freshStoreReadError": {
    "name": "EvidenceError",
    "code": "evidence_content_mismatch",
    "message": "No staged content matches this evidence ref."
  }
}
```

The reproduction used `node --input-type=module -` from the review worktree and
the exact modules named above; it made no filesystem or repository mutation.
The important discriminator is not a damaged digest or wrong binding: every
submitted identity was freshly recomputed and internally valid, yet it had no
relationship to the frozen admitted Action. The fresh-store read then proves
the retained ref is insufficient to recover bytes after the per-command store
is gone.

The current negative matrix does not cover this case. The vertical helper
creates its own actor and refs at
`test/core/change-run/canvas-v2-vertical-proof.test.ts:120-240`; its negative
matrix at `:858-935` damages action/invocation/effect/ref bindings or digests,
but never substitutes a new self-valid unauthorized actor/producer/schema.
The focused facade matrix has the same limitation at
`test/core/change-run/facade-settle-completeness.test.ts:517-613`.

**Impact:** any caller that can invoke the public completion command can invent
new actor/producer authority, submit matching bytes, and mark a required effect
successful. The Record then retains provenance refs that a fresh process cannot
read or re-verify. That can authorize a later domain success and produce a false
successful Run with non-auditable effect evidence.

**Required remediation:** freeze the exact accepted actor/adapter/producer,
attestation schema, observation schema, and EvidenceContract in the Action/plan;
verify them and bounded-read durable stored bytes before mutation; make the CLI
writer publish into the Run's persistent EvidenceStore instead of discarding a
local Map; and add regressions for a fully self-valid unauthorized substitution
plus fresh-process evidence retrieval/tamper failure.

### M2 — `planning:<full-PlanningSpaceId>` does not resolve the promised exact root, so detail and control disagree about workspace authority

`src/core/management-api/router.ts:551-554` returns
`{ root: undefined, planningSpaceId }` for the exact planning selector. The
collection route uses the ID as a list filter, but exact detail at
`router.ts:1284-1299` calls `handleRunDetail` without a root. Consequently,
`src/core/management-api/runs.ts:492-515` skips workspace identity resolution
and returns the unredacted projector default as `workspace.scope: current`,
including controls/grants. POST reaches
`src/core/management-api/run-control.ts:473-480` and rejects `no_project` before
spawn.

That violates
`rasen/changes/ecp-run-spine/specs/management-http-api/spec.md:28-31,109-116`,
which says `planning:<full-id>` addresses only the chosen clone/root, and
`:147-152`, which requires an exact other-worktree detail to be read-only. The
corresponding design at `rasen/changes/ecp-run-spine/design.md:1799-1806`
requires an exact selected-space token backed by both PlanningSpaceId and root.

#### Executed exact-API reproduction

A one-shot inline ESM fixture wrote one canonical v0 Record only under
`E:\rasen-ecp6-planning-selector-repro\case-icEMjo`, started the real Management
HTTP server with an injected counting spawner, then issued the exact list,
detail, and control requests. It did not touch the repository or a user Run.

```json
{
  "requestSelector": "planning:planning-space:1111111111111111111111111111111111111111111111111111111111111111",
  "list": {
    "status": 200,
    "matchingRunIds": [
      "run:2222222222222222222222222222222222222222222222222222222222222222"
    ]
  },
  "detail": {
    "status": 200,
    "workspaceScope": "current",
    "workspaceInstanceId": "workspace-instance:4444444444444444444444444444444444444444444444444444444444444444",
    "allowedControls": [
      { "kind": "cancel" },
      { "kind": "escalate" }
    ],
    "grantedActions": 0
  },
  "control": {
    "status": 400,
    "error": {
      "code": "no_project",
      "message": "A project root is required to control a Run. Select a space."
    },
    "spawnCount": 0
  }
}
```

**Expected:** the full planning ID resolves one exact clone/root and all three
routes use that root. If the root cannot be resolved, detail must be
other/redacted or return a typed unavailable response; it cannot present the
Run as current with controls.

**Impact:** Operations can show an exact PlanningSpace selection as current and
actionable even though every control from that same selection fails. More
importantly, the detail route bypasses the workspace-authority/redaction logic
that the M1 remediation added for unavailable roots.

**Required remediation:** make the exact selector resolve to a registered root
(or a server-issued opaque PlanningSpaceId+root token), thread the same resolved
authority through list/detail/control, and add HTTP integration tests for
current, other, unavailable, and duplicate-clone cases.

## Minor finding

### m1 — The focused workspace-identity suite does not exercise the candidate-race branches required by the remediation brief

`src/core/management-api/run-workspace-identity.ts:147-175` has distinct logic
for an archive candidate disappearing between enumeration/stat, a non-ENOENT
candidate stat failure, and the archive itself moving during the scan. The new
test file ends at
`test/core/management-api/run-workspace-identity.test.ts:114`; it covers missing
root, absent archive, archive-as-file, normal active/archive transition, and a
suffix-matching non-directory, but it does not force any candidate race or
unreadable-candidate branch.

The implementation is fail-closed for the non-ENOENT and archive-move cases by
inspection, and all callers exhaust the typed result, so this is a regression
coverage gap rather than a demonstrated authorization bypass. Add an injectable
filesystem seam or deterministic `statSync` fault/race test proving the typed
result and list/detail/control behavior.

## Whole-scope assessment

| Area | Result | Evidence |
|---|---|---|
| One connected Canvas Definition oracle; Management save/preparation/lowering/profile | PASS | Proposal/design/spec/tasks and all three handoffs reviewed; shared fixture/digest evidence reviewed; fresh focused profile/reconciler suite passed. |
| Shared declaration/profile dedup | PASS | Resolver rejects divergent duplicate bindings and deduplicates identical shared paths; fresh `shared-declaration-profile` coverage passed. |
| Effect-before-domain and observation-owned mutation | PASS with M1 authority caveat | Facade verifies receipt before slot mutation; effect observation does not synthesize a domain result; premature domain success remains rejected. Authority/evidence authenticity is blocked by M1. |
| Bounded loop, Choice, FanOut, Gate, Join success/failure closure | PASS | Lowerer/reconciler/projector reviewed; required-member suppression and required-member failure close fail-safe; fresh reconciler focused coverage passed. |
| Fresh filesystem recovery | EVIDENCE INCONCLUSIVE THIS ROUND | Retained full and prior vertical evidence are green, but the mandatory fresh vertical test timed out twice in this review; see freshness section. |
| CLI / Management / Operations single projector | PASS with M2 selector caveat | Same `ChangeRunView` projection feeds the three planes; Operations capture uses Management truth. Exact planning selector authority remains inconsistent. |
| Operations 409 behavior | PASS | Fresh 3-file/24-test UI group proves refetch-and-replace on `record_version_conflict`; no local lifecycle merge. |
| M1 root/archive typed fail-closed remediation | PASS for covered paths | Fresh 4-file/60-test group; list excludes unavailable identity, detail redacts, control returns 503 before spawn; active/archive/legacy transitions pass. Candidate race coverage is m1. |
| Authored-v1 compatibility | PASS | Legacy source remains authored v1 with normalized planning view and prompt-owned execution unchanged; relevant preparation/Canvas coverage and artifacts reviewed. |
| `auto-decompose` / 0.3.0 exclusion | PASS | Fresh blob hash `6f306544010a8950508f1223acfca5d62de407f5`; scoped diff empty. No Issue Execution Plan, Dispatch, Acceptance, portfolio, or auto-decompose migration was introduced. |
| ECP-7 exclusion | PASS | No Session executor, agent-process runner, automatic observation, worker reuse/handoff, or usage accounting was added. |

## Test freshness and retained evidence

### Fresh passes on the reviewed tree

- `pnpm exec vitest run test/core/management-api/run-workspace-identity.test.ts test/core/change-run/runs-api.test.ts test/core/management-api/run-control.test.ts test/core/management-api/runs.test.ts --reporter=dot`
  - 4 files, 60/60 tests passed.
- `pnpm exec vitest run test/core/change-run/facade-settle-completeness.test.ts test/core/change-run/cli-complete.test.ts test/core/pipeline-registry/shared-declaration-profile.test.ts test/core/change-run/reconciler-ecp4.test.ts --reporter=dot`
  - 4 files, 50/50 tests passed.
- `pnpm --dir packages/ui exec vitest run test/components/canvas-v2-vertical-proof.test.tsx test/components/operations-section.test.tsx test/components/operations-controls.test.tsx --reporter=dot`
  - 3 files, 24/24 tests passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm --dir packages/ui run typecheck` — passed.
- `pnpm build` — passed.
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json` — 1/1 valid, zero issues.
- `git -c core.safecrlf=false diff --check` — passed.
- `git hash-object pipelines/auto-decompose/pipeline.yaml` —
  `6f306544010a8950508f1223acfca5d62de407f5`; scoped diff empty.

### Repeated fresh vertical acceptance failure

The required high-signal command was run twice without source/test changes:

`pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`

1. Default TEMP/TMP: failed at the test's explicit 480,000 ms timeout after
   482,174 ms; total 501.56 s. The retained sandbox receipts show that the
   success Run, negative matrix, Gate, effect-before-domain, and start of the
   required-member failure Run had executed. Teardown then raised EPERM because
   a child still held the sandbox.
2. Isolated `TEMP`/`TMP=E:\rasen-ecp6-rereview-temp-20260802-170000` and
   `VITEST_MAX_WORKERS=1`: failed at the same explicit timeout after 483,322 ms;
   total 509.04 s, followed by the same derivative EPERM during teardown.

No functional assertion failed before either timeout, but this round did not
produce the requested fresh 1/1. This is recorded as test freshness/reliability,
not promoted into a third product Major without a functional discriminator.
The test's hard timeout is at
`test/core/change-run/canvas-v2-vertical-proof.test.ts:1466`.

### Independently parsed retained full-suite JSON

These are retained implementer artifacts, not substitutes for the failed fresh
vertical rerun and not cryptographically tied to the pre-report worktree
fingerprint:

- Root: `E:\rasen-ecp6-root-temp-20260802-final-serial\root-suite.json`
  - 2,433,683 bytes; SHA-256
    `0fa384e12ed33c780282dfc57a8259965d4ac32e3251d7f12b96751e9b588599`
  - `success=true`; 435 files; 1,793/1,793 suites passed;
    6,855 tests = 6,821 passed + 34 pending + 0 failed.
- UI: `E:\rasen-ecp6-ui-temp-20260802-140000-implementer3-serial\ui-suite.json`
  - 229,931 bytes; SHA-256
    `ca4483229e4fb97fb4638de3b9f5f25b34a18275349a48097bcbd58829c7a804`
  - `success=true`; 59 files; 181/181 suites passed; 651/651 tests passed.

## Review-cycle exit state

- Round 1 is **BLOCKED** by M1 and M2.
- No fix loop was performed by the reviewer.
- Tasks 9.8 and 9.9 remain unchecked.
- Task 9.10 remains unchecked and parent-owned.
- A fresh non-author re-review is required after remediation, including the two
  discriminating reproductions and a successful fresh vertical 1/1.

---

# Round 2 fresh non-author re-review

Recorded on 2026-08-02 against the post-Round-2-remediation worktree. This
section preserves the complete Round 1 review above and records only the fresh
Round 2 independent result.

## Verdict

**BLOCKED — 0 Blocker / 2 Major / 0 Minor.**

The review stopped before the full root, full UI, and vertical gates as soon as
the first Major was confirmed, in accordance with the review stop rule. The
second Major was then confirmed during the bounded static/security pass. Green
implementer-retained gates do not override these product/security findings.

## Major findings

### M1 — Domain completion bypasses the frozen Action authority and stored-evidence verifier

`src/core/change-run/internal/facade-runtime.ts:117-231` defines frozen-authority
and persistent-evidence verification only for `effect-observation` and
`infrastructure-observation`. The dispatch at
`src/core/change-run/internal/facade-runtime.ts:617-625` explicitly skips that
verification for `domain-action-result`; the domain path subsequently commits
the submitted actor, actor attestation, and evidence at
`src/core/change-run/internal/facade-runtime.ts:710-719`.

This is inconsistent with the admitted Action contract: the frozen authority
contains a `domainActionResult` evidence authority at
`src/core/change-run/contracts.ts:160-168`, and the governing runtime contract
requires every completion actor and evidence object to be checked against the
frozen Adapter/Action and actual stored bytes. The focused discriminator also
confirmed that a domain result whose identity/evidence bundle differs from the
Action authority can be accepted once the effect-ordering prerequisite is
satisfied; the relevant fixture paths are
`test/core/change-run/facade-settle-completeness.test.ts:194-247` and
`test/core/change-run/facade-settle-completeness.test.ts:567-589`, compared with
the admitted authority in `test/core/change-run/reconciler-fixture.ts:186-197`
and `test/core/change-run/reconciler-fixture.ts:235-258`.

**Impact:** a completion caller can make a domain result authoritative through
a self-consistent receipt without proving the exact admitted actor,
attestation producer/schema, domain-evidence producer/schema, frozen workspace
tree, or durable evidence bytes. That can falsely close an Action and advance
or terminate a canonical Run.

**Required defensive remediation:** apply one fail-closed completion-authority
verifier to all three completion variants before slot classification or Record
mutation. For domain results, require a non-legacy frozen authority, exact actor
equality, exact attestation and `domainActionResult` producer/schema/media/
observation authority, full PlanningSpace/ChangeInstance/project/Run/Action/
tree binding, and bounded verification of every referenced object from the
Run-scoped persistent EvidenceStore. Add a negative test proving that a fully
self-consistent substituted domain identity/evidence bundle leaves the Record
digest and version unchanged, plus a legacy-Action fail-closed test.

### M2 — Filesystem EvidenceStore does not enforce physical-link safety before use

The production reader at
`src/core/change-run/internal/evidence-store-fs.ts:67-98` checks regular-file,
size, and stable identity, but it does not reject a canonical evidence object
whose physical link count is greater than one. A fresh defensive discriminator
confirmed that such an object remains readable. The existing test named
“linked” at `test/core/change-run/evidence-store-fs.test.ts:123-146` covers a
symbolic link only and therefore does not exercise the hard-link contract.

In addition, `ensureSafeDirectory` at
`src/core/change-run/internal/evidence-store-fs.ts:57-65` performs recursive
directory creation before it validates every existing component. A fresh
defensive discriminator confirmed that a pre-existing directory junction is
eventually rejected, but only after directory creation has already occurred
outside the controlled store root.

These outcomes conflict with the governing safe-path and evidence requirements:
linked evidence must fail closed, and pre-existing link/reparse components must
be rejected before target access or mutation.

**Impact:** the EvidenceStore's claimed immutable physical boundary is weaker
than its contract. Canonical objects can retain an unapproved second filesystem
name, and an unsafe parent can cause an out-of-store filesystem side effect even
when the evidence request ultimately fails. This invalidates the remediation's
no-follow/error-no-mutation security claim and is material on Windows as well as
POSIX filesystems.

**Required defensive remediation:** resolve and validate a physical store
anchor first, then walk/create each descendant one component at a time with
no-follow/reparse checks and containment/parent-identity rechecks before and
after creation. Require canonical evidence files to be physical regular files
with the permitted link topology before reading semantic bytes, and preserve
the same checks around open/read. Add platform-aware hard-link and directory
symlink/junction tests that assert typed failure and zero filesystem mutation
outside the controlled anchor.

## Round 2 gate and task state

- Static and focused security review completed through the two confirmed
  Majors.
- Per the stop rule, no fresh full root suite, full UI suite, or vertical proof
  was run in Round 2.
- Tasks 9.8 and 9.9 remain unchecked; this review is not CLEAN.
- Task 9.10 remains unchecked and parent-owned.
- No product code, tests, delivery state, archive state, run state, or portfolio
  state was changed by this reviewer.

---

# Round 3 fresh non-author security re-review

Recorded on 2026-08-02 by a fresh reviewer who did not implement or fix any
part of this Change and did not participate in Round 1 or Round 2 review.

## Verdict

**BLOCKED — 1 Blocker / 1 Major / 0 Minor / 0 Trivial.**

The Round 3 remediation correctly places one completion-authority check before
slot classification for all three completion variants and closes the reported
hard-link/junction cases. It still does not establish that attestation/evidence
bytes came from the frozen trusted producer, and its no-replace hard-link
publication is not recoverable from a process crash after the final link is
created but before the staging link is removed. Per the stop rule, no fresh
vertical, full root, or full UI gate was started after these findings were
confirmed. Tasks 9.8-9.10 remain open.

Pre-report reviewed-state fingerprint:

- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- tracked patch Git-blob fingerprint: `c4e8a883e6db80765dfa4bc1dc9051a4f50bdd56`
- intended-untracked manifest excluding this report and the protected temp
  trees: 83 files, SHA-256
  `ebf9680644b229b9f8a65fb7bd6da0280b38e43e5755b9ede0d99516ff7acd48`

## Blocker finding

### B1 — Public frozen metadata is treated as producer attestation, so a caller can still forge effect and domain evidence

**Canonical severity: Blocker. Security confidence: 10/10.**

The new verifier proves that caller-supplied metadata equals the metadata
frozen on the Action and that uploaded bytes match caller-computed digests. It
never proves that the bytes were signed, attested, or returned by the frozen
trusted producer:

- `src/core/change-run/internal/facade-runtime.ts:150-222` compares actor,
  producer, schema, media type, observation kind, Run/Action/Effect/tree
  bindings and then calls `verifyEvidenceContent` on stored bytes.
- `src/core/change-run/internal/evidence.ts:87-107` shows that
  `verifyEvidenceContent` validates only byte length and SHA-256. No semantic
  attestation, producer signature, trusted verifier, or fresh query follows.
- `src/core/change-run/internal/actions.ts:190-278` freezes public identity
  metadata, but no verification key or executable verifier contract.
- `src/core/change-run/internal/projector.ts:32-49` projects the exact actor,
  completion authority, and expected workspace into the public Action view.
- `src/commands/pipeline.ts:1811-1857` stages request bytes before facade
  verification; `stageClaimed` checks only ref/content self-consistency.
- A real built-CLI acceptance helper demonstrates the exploit construction:
  `test/core/change-run/canvas-v2-vertical-proof.test.ts:139-216` reads all
  authority from the public view, invents `{"trustedHost":true}` plus arbitrary
  effect/domain JSON, computes the refs and receipt locally, and is accepted.
  The focused legal fixtures repeat the same arbitrary `{"attested":true}`
  construction at
  `test/core/change-run/facade-settle-completeness.test.ts:253-300`.

This violates the governing contract at
`rasen/changes/ecp-run-spine/specs/ecp-change-run-runtime/spec.md:411-446`,
which says caller self-report has no authority, actor attestation must be
validated against the frozen Adapter/Action, and trusted host identity does not
make its payload or refs trustworthy. It also contradicts
`rasen/changes/ecp-run-spine/design.md:1460-1489`, which requires a canonical
attestation verified against a plan-bound trusted producer or a fresh verifier
query and requires `HostEvidenceWriter.stage` itself to validate that authority.

**Concrete exploit path:** a completion caller inspects the granted Action,
copies the projected actor/producer/schema/binding fields, writes arbitrary
`actor-attestation`, effect, and domain bytes, computes their public SHA/ref/
receipt digests, and submits them as uploads. All present checks pass because
the metadata and bytes are internally consistent. The caller can first mark a
required effect succeeded and then submit a successful domain result, advancing
or terminating the canonical Run without evidence from the trusted producer.

**Required remediation:** add a real plan-bound attestation/evidence verifier
(for example a signature over canonical bytes from a frozen producer key, or a
fresh query to a frozen verifier Adapter). The narrow HostEvidenceWriter must
validate that proof against the frozen Action before publication, and the
facade must reverify the stored proof before any slot classification or Record
mutation. Add a public-boundary negative discriminator that uses the exact
projected actor/authority and fully self-consistent stored bytes but lacks the
trusted producer proof; it must leave both EvidenceStore and Record unchanged.

## Major finding

### M1 — A crash in the hard-link publication window permanently poisons an otherwise legal evidence object

`src/core/change-run/internal/evidence-store-fs.ts:382-415` creates the final
canonical name with `linkSync(staging, target)` and removes the staging name
only in `finally`. Between those operations the legal publication topology has
two links. A process crash or power loss bypasses `finally` and leaves that
exact two-link topology on disk.

Recovery is impossible through the public store contract:

1. A retry sees the final target at
   `src/core/change-run/internal/evidence-store-fs.ts:325-329` and immediately
   attempts `read(ref)`.
2. `readPhysicalFile` rejects every canonical object with `nlink !== 1` at
   `src/core/change-run/internal/evidence-store-fs.ts:153-164`.
3. No recovery path recognizes and safely removes an exact same-inode staging
   companion produced by this publication attempt.

The existing hard-link test is useful but proves only rejection of an external
second link. It does not distinguish that attack from the store's own
after-publish crash residue. This conflicts with the governing evidence design
at `rasen/changes/ecp-run-spine/design.md:1482-1489`, which requires named
before/after-publish fault points and idempotent post-publish retry.

**Impact:** one ordinary CLI/process crash after the no-replace link succeeds
can make the Action's legal evidence permanently unreadable and prevent every
subsequent completion retry. This is a plausible durability failure, not a
generic resource-exhaustion concern.

**Required remediation:** define a recoverable crash topology. A retry may
remove only an exhaustively proven, strictly named staging companion whose
physical identity and canonical envelope match the final object, then recheck
`nlink === 1`; otherwise it must remain fail-closed. Add fault injection exactly
after final-link creation and before staging unlink, plus same-process and fresh-
process retry assertions. Preserve no-replace `EEXIST` handling, file and
directory durability on supported platforms, strict cleanup, and rejection of
unprovable external hard links.

## Bounded static and focused evidence

Fresh passes on the reviewed tree:

- EvidenceStore + planning selector + workspace-race group:
  `test/core/change-run/evidence-store-fs.test.ts`,
  `test/core/management-api/run-planning-selector-http.test.ts`, and
  `test/core/management-api/run-workspace-identity.test.ts` — 3 files, 15/15
  passed. This confirms the Round 2 selector/race fixes and existing physical-
  link tests remain green; neither finding above has a discriminator.
- Operations server-truth/control group — 3 files, 24/24 passed.
- Root TypeScript check, UI typecheck, production build, and lint — passed;
  lint emitted zero errors and zero warnings.
- Strict Change validation — 1/1 valid, zero issues.
- `git -c core.safecrlf=false diff --check` — passed.
- `pipelines/auto-decompose/pipeline.yaml` — scoped diff empty and blob hash
  `6f306544010a8950508f1223acfca5d62de407f5`.
- Focused temporary evidence root retained at
  `E:\rasen-ecp6-r3-review-blocked-focused-20260802`.

Stopped because of B1/M1:

- no fresh 18-file/194-test completion matrix;
- no fresh vertical 1/1;
- no fresh full root JSON;
- no fresh full UI JSON.

Retained implementer evidence is not substituted for these skipped fresh
gates. The two new findings are structural and are not overturned by the
retained green runs.

## Whole-scope and task state

- Round 2 planning-selector and candidate-race fixes remain correct by static
  inspection and fresh 15/15 focused coverage.
- Connected Canvas, lowering, bounded-loop/FanOut/Join closure, fresh-process
  product path, and single `ChangeRunView` ownership show no additional
  Blocker/Major in the bounded review performed before the stop.
- No Round 3 production file adds a Session executor, worker dispatch,
  automatic observation, handoff/usage accounting, Issue Execution Plan,
  portfolio behavior, or `auto-decompose` migration. ECP-7 and 0.3.0 scope
  exclusions remain intact.
- Authored-v1 code paths and the v1 `auto-decompose` source are unchanged by
  Round 3. The retained authored-v1 audit remains 133/133; it was not rerun
  after the stop.
- Tasks remain **66/69 checked**. Tasks 9.8 and 9.9 are not eligible for
  completion; parent-owned task 9.10 remains open.

This AI-assisted security review is not a substitute for a professional
security audit.

---

# Round 6 fresh non-author clean re-review

Recorded on 2026-08-04 against the bounded cleanup-lifecycle remediation in
`review-remediation-round-6.md`. This reviewer did not author or remediate the
Change and changed no production or test source. The only edits made after all
gates passed are this verdict append and task-state accounting for 9.8/9.9.

## Verdict

**CLEAN — 0 Blocker / 0 Major / 0 Minor / 0 Trivial.**

Round 5 M1 is independently closed. The five-process Store doctor parity case
now reaches its existing child-close boundary before teardown, the cleanup
helper remains finite and fail-loud, every required focused gate is green, and
one fresh full-root plus one fresh full-UI run both have zero failures. No open
Blocker/Major remains from Rounds 1-5.

| Round | Findings (B/Ma/Mi/T) | Triage | Fixed by | Confirmed by (non-author) | Resolved |
| --- | --- | --- | --- | --- | --- |
| 6 | 0/0/0/0 | Round 5 cleanup-budget Major independently re-reviewed | Round 6 fixer (prior worker) | fresh Round 6 reviewer + exact diff + fresh gates | 1/1 |

## Reviewed state and fingerprint

The fingerprint was captured before this report/task append, then recomputed
after every test gate and found byte-for-byte unchanged:

- worktree:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`;
- branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`;
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`;
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`;
- tracked patch Git-blob fingerprint:
  `d0edf45371ea1448231eeecb8e69904cb48aaca9`;
- intended-untracked manifest: 96 files, SHA-256
  `7D2BA9AB0F9F9C3D785B0B6C45E1CFB33864D7EFC2DE9627479252DB796759A8`;
- retained manifest:
  `E:\rasen-ecp6-r6-review-20260804-042034\reviewed-untracked-manifest.txt`.

The manifest excludes this report and protected/generated temporary trees:
`.tmp-*`, `.rasen-pipeline-command-*`, `test-*-tmp/`, and
`rasen/changes/foo/`. None was inspected as source, deleted, or included in
task accounting. No scoped Node/pnpm/cmd process remained after the full-root
or full-UI gate.

## Round 6 exact-diff assessment

Static inspection confirmed the Round 5 failure's primary and secondary
lifecycle causes are repaired without changing product semantics:

- only `reports the same membership findings from store doctor`, which awaits
  five sequential fresh CLI invocations, receives a 120-second Vitest budget;
  every underlying `runCLI` retains its independent 30-second timeout;
- each invocation is awaited and `runCLI` resolves only on the direct child's
  `close` event, so the successful path closes every resource-owning CLI before
  `afterEach` calls `cleanupTempPathAsync`; the Store add/doctor and top-level
  doctor handlers used by this case contain no descendant-process launch path;
- the helper default remains exactly 15 retries x 200 ms. Both budget fields
  must be finite, non-negative safe integers, so `Infinity`, `NaN`, and negative
  values fail before a remove attempt;
- retries cover only Node recursive-rm transient conditions (`EPERM`, `EBUSY`,
  `ENOTEMPTY`, `EMFILE`, `ENFILE`), receive the exact original target, and
  never derive a parent, sibling, glob, or fallback deletion path;
- a non-transient error surfaces on attempt one; a permanent transient lock
  surfaces after exactly `maxRetries + 1` remove attempts. No assertion is
  retried and no final cleanup error is swallowed;
- injected `removePath` and `wait` seams make release ordering, target identity,
  attempt count, and descriptor-pressure behavior deterministic without
  changing the default cross-platform implementation.

The fixer's eight-case RED discriminator was not self-certification: this
reviewer independently inspected every assertion and reran the restored source
to 8/8 green, then reproduced the affected consumer under repeated fresh
processes and the complete repository gate.

One abandoned daemon from a pre-review, interrupted run was found during the
full-root preflight (PID 37536, parent already absent, created at 01:16). It
predated this review by more than three hours and was stopped by exact PID and
command-line match. The fresh full-root reproduced no daemon/process leak, and
the post-root scoped-process audit was empty; it is not counted as a Round 6
source finding.

## Fresh focused and regression evidence

All commands used isolated external `TEMP`/`TMP`, `VITEST_MAX_WORKERS=1`, and
`--maxWorkers=1` where Vitest was involved.

The helper discriminator passed **1 file / 8/8**:

```text
pnpm exec vitest run test/helpers/temp-cleanup.test.ts \
  --reporter=json --outputFile=<review-root>/helper-green.json --maxWorkers=1
```

Artifact:
`E:\rasen-ecp6-r6-review-20260804-042034\helper-green.json`, SHA-256
`B42271A1906E289FD6E8B3FC55B17B839387530E9F6952AA9F1F26E33EA67FBC`.

Three independent helper + complete Store-membership processes each passed
**19/19** (**57/57 total**, zero failures), in 62.282, 65.006, and 60.519
seconds. Their retained JSON SHA-256 values are:

- round 1: `E9E3C535D244E8B54E0DBA1D09B374BD85F1D4C58FA8E475E941A6C1C0E4B1B8`;
- round 2: `E718003B4BA9DDD26D9B599D8B2AC0595E95DDF3E41D7DE0F0975AD82B040C4D`;
- round 3: `EB9A1A98C407513B64C75F627161AB23E8EEBDFCF159496B64280A43C7F58D50`.

The ten-file shared-helper consumer aggregate passed **43 suites / 223 tests =
222 passed + 1 pending**, zero failures, in 911.725 seconds. It covered CLI E2E,
daemon lifecycle, pipeline commands, Store membership/remote, archive recovery,
execution-binding temp state, token-audit Management, local-version runtime,
and the helper itself. Artifact:
`E:\rasen-ecp6-r6-review-20260804-042034\cleanup-consumers\cleanup-consumers.json`,
SHA-256
`AFE4529E7EBFB87DF02399E299AFF248402E28FFE3255BA38BCDB178C0C20104`.

The Round 5 deterministic authority/signature aggregate passed **7 files /
33/33** in 191.845 seconds. Artifact:
`E:\rasen-ecp6-r6-review-20260804-042034\deterministic-33\deterministic-33.json`,
SHA-256
`5C1417757744548CD51DDD7FDE566C06E52B69101C569B01F19F06F7B8B030D9`.

The Round 4/5 security-runtime aggregate passed **11 files / 121/121** in
44.601 seconds. It re-covered Ed25519 attestation, canonical evidence and
complete-set publication, plan-bound authority, persisted runtime plans,
public completion, and strict crash recovery. Artifact:
`E:\rasen-ecp6-r6-review-20260804-042034\security-121\security-121.json`,
SHA-256
`A5AA28E7B178D968968CDA195BA537CE3B7C7DA26C5E165B4670C414D6BF232E`.

## Fresh vertical, complete suites, and static gates

After a fresh production build, the Canvas-authored vertical passed **1/1**.
The machine JSON run completed in 212.636 seconds:

- JSON:
  `E:\rasen-ecp6-r6-review-20260804-042034\vertical\vertical.json`;
- SHA-256:
  `DE88ED56D1D8E591FDEE85A59241D3E5828A5B820D1A7AAC769EF25D7F928660`;
- Management capture SHA-256:
  `05F9EF305F3DDB933476FFEC4791CD40BB7A574B5FE2AA2D2323745721C0F716`.

Because Vitest's JSON reporter suppresses the journey's final diagnostic line,
a second fresh isolated dot-reporter run captured and confirmed **73 fresh CLI
processes / 73 transitions**, success and required-member failure Runs, process
loss, catalog rotation, tamper/replay/conflict rejection, and Management
parity. It passed 1/1 in 261.52 seconds. Retained log:
`E:\rasen-ecp6-r6-review-20260804-042034\vertical-73-confirm\vertical-dot.log`,
SHA-256
`CC1DF8437B72A847B544B59BE3F28D1DD03C2A4A742CFADA8D81D0433C5EFCF5`.

The mandatory single full-root run was:

```text
pnpm exec vitest run --reporter=json \
  --outputFile=<fresh-root>/root-vitest.json --maxWorkers=1
```

Result: **CLEAN**, `success=true`; **440 files / 1,803 suites**, all suites
passed; **6,911 tests = 6,877 passed + 34 pending + 0 failed**; 4,526.433
seconds (75.44 minutes). Artifact:
`E:\rasen-ecp6-r6-review-root-full-20260804-045841\root-vitest.json`, size
2,455,102 bytes, SHA-256
`FDDFD28BB1E5486AFCCDF6B5A534BBE16095DE7379920CF08F32E5021C2EDC00`.

The mandatory single full-UI run was:

```text
pnpm --dir packages/ui exec vitest run --reporter=json \
  --outputFile=<fresh-ui-root>/ui-vitest.json --maxWorkers=1
```

Result: **CLEAN**, `success=true`; **59 files / 181 suites / 651/651 tests**,
zero pending/failures; 106.712 seconds. Artifact:
`E:\rasen-ecp6-r6-review-ui-full-20260804-061459\ui-vitest.json`, size 230,007
bytes, SHA-256
`44AF06349E7EDD780AE90F709BA6CB2783D27F95ACC9B21C9481BCBC43D23B71`.

Static and contract gates passed on the same fingerprint:

```text
pnpm exec tsc --noEmit --pretty false
pnpm --dir packages/ui run typecheck
pnpm run build
pnpm run lint
pnpm exec rasen validate ecp-v2-authoring-loop-vertical-proof --strict --json
git -c core.safecrlf=false diff --check
git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml
```

Strict validation was 1/1 valid with zero issues. Lint had zero errors. The v1
`auto-decompose` source remains unchanged with blob hash
`6f306544010a8950508f1223acfca5d62de407f5`.

## Scope and task closure

Round 6 changes only test lifecycle/budget infrastructure and its evidence; it
does not weaken trust, receipt, evidence, plan, Record, projection, or authored
v1 behavior. No Session executor, worker dispatch, automatic observation,
Issue/portfolio behavior, or `auto-decompose` migration is introduced. ECP-7
still owns the real trusted Adapter/Session producer, and Issue/portfolio scope
remains 0.3.0.

Tasks 9.8 and 9.9 are now complete: **68/69 checked**. Parent-owned task 9.10
remains deliberately open for the single portfolio PR, remote matrix CI,
merge, and archive. This reviewer performed no commit, push, ship, archive,
machine run-state, or portfolio update.

This AI-assisted security review is not a substitute for a professional
security audit.

---

# Round 5 fresh non-author re-review

Chronology note: this Round 5 section follows the Round 4 result recorded
below; it was inserted at the prior report terminus so the immutable Round 4
text itself remains untouched.

Recorded on 2026-08-04 against the Round 5 full-root regression remediation.
The reviewer did not author or remediate this Change and changed no production
or test source. This is an in-progress review-loop result, not a terminal
blocked state for the Change.

## Verdict

**REMEDIATION REQUIRED — 0 Blocker / 1 Major / 0 Minor / 0 Trivial.**

The deterministic ECP fixture migration, exact test-owned public catalog,
Ed25519-signed v2 CLI completions, vocabulary entry, and Round 4 trust/recovery
boundaries are correct by static inspection and fresh focused coverage. The
mandatory single full-root run is still red, however: the same Store-membership
cleanup case identified among Round 4's thirteen environmental candidates
exhausted the Round 5 retry helper during the 84-minute serial run. Per the
stop rule, full UI was not started, no CLEAN claim is made, and tasks 9.8,
9.9, and 9.10 remain open.

Reviewed-state fingerprint before this report append:

- worktree:
  `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`;
- branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`;
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`;
- tracked patch Git-blob fingerprint:
  `e27c8ec8f73b1b4f42f1fdabff16b6bad8d3675c`;
- intended-untracked manifest excluding this report and protected/generated
  temporary trees: 94 files, SHA-256
  `ca39f0275f80178879391443e13aa351431009074078b958bfb3e0843547872e`.

The excluded temporary trees include `.tmp-ecp6-defaults/`,
`rasen/changes/foo/`, `test-*-tmp/`, and reviewer-created
`.rasen-pipeline-command-*` residue. No temporary tree was included in the
reviewed source set or task accounting. This reviewer performed no commit,
push, ship, archive, machine run-state, or portfolio action.

## Major finding

### M1 — The Round 5 Store-membership cleanup remediation still fails the mandatory full-root gate

Round 5 changed Store-membership teardown from a one-shot recursive removal to
the shared asynchronous retry helper:

- `test/commands/store-membership-cli.test.ts:53-55` awaits
  `cleanupTempPathAsync(tempDir)` after every test;
- `test/helpers/temp-cleanup.ts:38-49` defaults to only 15 retries at 200 ms,
  and rethrows `EPERM`, `EBUSY`, or `ENOTEMPTY` after that roughly three-second
  window.

The exact Round 4 candidate test passed in a short isolated targeted rerun, but
failed again inside the required single serial root run:

```text
test/commands/store-membership-cli.test.ts:367
store membership CLI surface doctor reports membership read-only, with human/JSON parity
reports the same membership findings from store doctor
```

The semantic assertions completed; its `afterEach` failed at
`test/commands/store-membership-cli.test.ts:54`, with the helper rethrowing at
`test/helpers/temp-cleanup.ts:43`:

```text
Error: EPERM, Permission denied:
\\?\E:\rasen-ecp6-r5-review-root-full-20260804-022035\rasen-membership-cli-6BSPiR
```

Vitest reports this as `STACK_TRACE_ERROR` rooted at the test declaration on
line 367 and the failed cleanup hook. After the runner exited, no live process
whose command line referenced the exact temporary root was found, while the
directory still existed. This is consistent with the current retry window
being shorter than a transient Windows handle/antivirus release under the
long serial workload; it does not demonstrate a Store-membership semantic
failure.

**Impact:** the required repository acceptance gate remains non-reproducible
as a single zero-failure run. The same case that Round 5 claimed to repair can
still turn a fully passing assertion body into a red suite and leave temporary
state behind. Tasks 9.8/9.9 cannot close and a later reviewer cannot truthfully
substitute the short targeted pass for the failed mandatory run.

**Required remediation:** keep cleanup bounded and keep assertion failures
visible, but make teardown wait for the actual child/descendant handle boundary
or give this known Windows cleanup path a bounded slow-host window comparable
to the daemon cleanup (`60 x 250 ms`). Do not retry test assertions, swallow a
final cleanup error, weaken evidence/attestation validation, or treat the
isolated targeted pass as a replacement. Re-run the exact target and then one
new full-root JSON run with zero failures before full UI.

## Round 5 static and security assessment

- Canonical fixture profiles use `createRuntimeExecutionProfile(...)`; the
  four migrated composite/session builders attach only the shared public test
  authority through `withTestAttestationAuthority(...)`. Production still
  rejects an executable Action without a host-frozen authority in
  `actions.ts`, and profile decoding still requires the canonical
  `change-run-execution-profile/1` shape.
- The bug-fix and complex fresh-process journeys provision exact public
  descriptors into isolated host state, retain the module-local private
  `KeyObject` only in the parent test process, construct the completion from
  the exact persisted Action, and submit signed v2 actor/evidence objects
  through fresh `pipeline complete` processes. No `{"signed":true}` marker,
  CLI private-key option, project key, or private-key environment value remains
  in those completion bodies.
- `workspace_identity_unavailable` is a deliberate fail-closed Management
  authority error and is narrowly documented in the vocabulary exception
  ledger; it does not revive the retired workspace command surface.
- Daemon readiness is still bounded at 60 x 250 ms. Test timeouts and cleanup
  retries remain finite and do not retry semantic assertions.
- Round 4 remains intact: exact Adapter identity selects the host-owned public
  Ed25519 authority; capability/profile/sealed-plan/Action bind it; existing
  Runs reopen the persisted public execution profile; HostEvidenceWriter
  verifies the complete set before publication; the Facade re-reads and
  re-verifies before mutation; and EvidenceStore recovery accepts only the
  exact canonical two-link strict companion topology.

No new Blocker or product/security Major was found in the Round 5 source diff.
M1 is the remaining release-gate/reliability Major.

## Fresh gate evidence

Passed on the reviewed tree:

- deterministic Round 5 regression aggregate: 7 files, 33/33 tests,
  155.21 seconds;
- original thirteen environmental candidates: all passed in isolated targeted
  runs (daemon file 4/4 including both candidates; pipeline target 1/1; the
  remaining five files 10/10 targeted cases);
- Round 4 security/runtime aggregate: 11 files, 121/121 tests, 33.93 seconds;
- root TypeScript check, UI typecheck, production build, and lint;
- strict Change validation: 1/1 valid, zero issues;
- `git -c core.safecrlf=false diff --check`;
- `pipelines/auto-decompose/pipeline.yaml`: empty scoped diff and unchanged
  blob hash `6f306544010a8950508f1223acfca5d62de407f5`;
- fresh built Canvas vertical: 1/1 in 354.791 seconds (365.92 seconds total),
  73 fresh CLI processes / 73 transitions. It covered success, required-member
  failure, process-loss recovery, catalog rotation, tamper/replay/conflict, and
  Management parity.

An additional exploratory seven-file all-test environmental aggregate was not
used as acceptance evidence: it produced seven unrelated 30-second CLI timeout
failures in `pipeline.test.ts` plus derivative cleanup pressure, while 167
tests passed. The Round 4 candidate selected from that file passed 1/1 in its
required isolated rerun. The mandatory full-root result below remains the
authoritative gate.

Failed mandatory single full-root JSON:

- command:
  `pnpm exec vitest run --reporter=json --outputFile=<fresh-root>/root-vitest.json --maxWorkers=1`
  with isolated `TEMP`/`TMP`, `VITEST_MAX_WORKERS=1`, and a greater-than-two-hour
  outer budget;
- duration: 5,064.9 seconds (84.415 minutes);
- result: `success=false`; 439 files; 1,801 suites = 1,798 passed + 3 failed;
  6,903 tests = 6,868 passed + 1 failed + 34 pending;
- artifact:
  `E:\rasen-ecp6-r5-review-root-full-20260804-022035\root-vitest.json`;
- size: 2,456,435 bytes;
- SHA-256:
  `A77CEDC89627CE3290D9B84AEAD62D38967AF87D220E6B4D5D307053CA6847C7`.

There is one failed assertion entry/file; the three failed-suite count is the
nested Vitest suite accounting around that same test/hook failure. No product
assertion failure was hidden or reclassified as a pass.

## Review-cycle and task state

- Review loop remains **in progress**.
- Tasks remain **66/69 checked**. Tasks 9.8 and 9.9 remain open because the
  mandatory root gate is red.
- Parent-owned task 9.10 remains open.
- Full UI was not started after M1 was confirmed.
- A fresh Round 6 fixer must address the bounded teardown race; a new non-author
  reviewer must then reproduce focused security, vertical 1/1, one single
  full-root JSON with zero failures, and one single full-UI JSON with zero
  failures before writing a CLEAN verdict.

This AI-assisted security review is not a substitute for a professional
security audit.

---

# Round 4 fresh non-author security re-review

Recorded on 2026-08-04 against the Round 4 trust-root and publication-recovery
remediation. The reviewer did not author or remediate this Change. This is an
in-progress review-loop result, not a terminal blocked state for the Change.

## Verdict

**REMEDIATION REQUIRED — 0 Blocker / 1 Major / 0 Minor / 0 Trivial.**

The Round 3 authenticity Blocker and post-link recovery Major are closed by
static inspection, focused security coverage, and a fresh 73-process vertical.
The mandatory single full-root run is nevertheless red because the new
fail-closed authority/profile contract was not propagated across the complete
repository test and legacy E2E fixture surface. Per the stop rule, the full UI
suite was not started, no CLEAN claim was written, and tasks 9.8, 9.9, and 9.10
remain open.

Reviewed-state fingerprint before this report append:

- Worktree: `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-ecp-shared-bounded-loop-lifecycle`
- Branch: `wip/ecp-shared-bounded-loop-lifecycle-resume`
- HEAD: `050fc84332b26a75a07f441efd6b235842f89e1e`
- HEAD tree: `58489c46633a209d2c1761c2a4b684ad8b95cb48`
- tracked patch Git-blob fingerprint: `dca6d79bb72a2661c2924ed8b2f384abfbb41f9f`
- intended-untracked manifest excluding this report and protected temporary
  trees: 92 files, SHA-256
  `1276e5b1261a4328c46eca4d66154dbd422d491a312d79d500d26d6dff38d96a`

The excluded protected trees are `.tmp-ecp6-defaults/`,
`rasen/changes/foo/`, and `test-*-tmp/`. This reviewer changed no production
or test file and performed no commit, push, ship, archive, run-state, or
portfolio action.

## Major finding

### M1 — The repository-wide ECP fixture and legacy E2E surface was not migrated to the new mandatory trust contract

Round 4 correctly makes executable authority fail closed:

- `src/core/change-run/internal/actions.ts:194-203` rejects every executable
  Action whose capability Adapter lacks a host-frozen attestation authority;
- `src/core/pipeline-registry/execution-plan-internal.ts:405-447` reopens and
  validates the complete `change-run-execution-profile/1`, including each
  Adapter authority, before sealing a plan.

However, existing composite and session fixtures still hand-construct the old
profile/binding shape without the required profile format or authority:

- `test/core/change-run/ecp-composite-dogfood.test.ts:79-108` builds three
  authority-free Adapter bindings and casts an unversioned profile;
- `test/core/change-run/ecp-composite-parity.test.ts:60-101` repeats the old
  binding/profile shape;
- `test/core/change-run/lowerer-composite.test.ts:185-195,436-446` passes the
  same incomplete shape into the production lowerer;
- `test/core/pipeline-registry/session-contract-fidelity.test.ts:132-139`
  builds executable Actions from an authority-free capability.

These are deterministic contract failures in the fresh full-root JSON:

- composite dogfood: 2/2 failed;
- composite parity: 2/5 failed;
- composite lowerer: 2/9 failed;
- session-contract fidelity: 5/10 failed;
- errors are `PlanIntegrityError` at
  `src/core/pipeline-registry/execution-plan-internal.ts:341,410,447` and
  `ActionBuildError` at `src/core/change-run/internal/actions.ts:201`.

The two fresh-process legacy command journeys also still manufacture unsigned
v1 EvidenceRefs and a public `{"signed":true}` marker at
`test/commands/pipeline-bugfix-e2e.test.ts:156-243` and
`test/commands/pipeline-complex-e2e.test.ts:157-245`. The bug-fix completion
therefore exits 1 at `pipeline-bugfix-e2e.test.ts:399`; the complex helper does
not advance and all three cases dereference an absent wait at
`pipeline-complex-e2e.test.ts:352`.

Finally, the deliberate new error token `workspace_identity_unavailable` is
not recorded in the vocabulary ledger at
`test/vocabulary-sweep.test.ts:115-132`, producing one deterministic failure.

**Impact:** the focused Round 4 proof is green, but the repository's prior ECP
composite/session contracts and old public CLI journeys no longer pass their
authoritative regression suite. Shipping this tree would either normalize a
red root gate or tempt a later fix to weaken the new fail-closed production
boundary. Both are unacceptable for ECP-6 completion.

**Required remediation:** preserve the production fail-closed checks. Migrate
the shared composite/session fixture builders to canonical
`change-run-execution-profile/1` values carrying the public test authority;
migrate the legacy CLI journeys to provision the public catalog and submit
real test-signed v2 completion evidence through the trusted test producer; add
the deliberate error token to the vocabulary ledger. Re-run the exact failed
groups, then one new full-root JSON run with zero failures before running full
UI.

## Round 4 trust/security closure

Static review found no remaining Blocker or Major in the Round 4 repair:

- authored/project input cannot nominate the authority used for execution;
  exact host Adapter identity selects Ed25519 SPKI authority, which is frozen
  through capability/profile/sealed-plan/Action and reopened from the
  persisted plan for existing Runs;
- signed EvidenceRef v2 and the canonical actor claim bind all completion
  variants, semantic payload, actor, Run/Action/effect/tree, and exact evidence
  digest; HostEvidenceWriter validates the complete in-memory set before first
  publication and the Facade re-reads and re-verifies before slot
  classification or Record mutation;
- private signing material is confined to the trusted producer input and test
  fixture; the Action/View/Record/projector/evidence/CLI scan returned zero
  private-key, PKCS8, signer-path, or equivalent matches;
- EvidenceStore recovery accepts only one exact digest-scoped staging
  companion with identical canonical bytes, inode and `nlink === 2`, and
  rejects external/multiple/wrong-inode/wrong-envelope/linked path topologies
  without guessed cleanup.

The fresh built vertical passed 1/1 in 431.385 seconds with 73 fresh CLI
processes and 73 transitions. It covered signed success, required-member
failure, process-loss recovery, catalog rotation across existing-Run entry
points, tamper/replay/conflict rejection, and CLI/Management projection parity.

## Fresh gate evidence

Passed:

- Action attestation: 1 file, 11/11;
- filesystem EvidenceStore: 1 file, 15/15;
- CLI complete: 1 file, 21/21;
- Operations server-truth/control group: 3 files, 24/24;
- Round 4 focused aggregate: all 121 assertions passed across the aggregate
  run plus isolated reruns. The aggregate attempts reported only Windows
  `afterEach rmSync` EPERM cleanup failures (119/121 then 120/121); both
  affected files passed independently as 15/15 and 21/21;
- root TypeScript, UI typecheck, production build, lint, strict Change
  validation (1/1), and `git -c core.safecrlf=false diff --check`;
- `pipelines/auto-decompose/pipeline.yaml` remained byte-identical with blob
  hash `6f306544010a8950508f1223acfca5d62de407f5` and an empty scoped diff;
- fresh built vertical: 1/1, 73 processes / 73 transitions.

Failed mandatory single full-root JSON:

- command: `pnpm exec vitest run --reporter=json --outputFile=<fresh-root>/root-vitest.json --maxWorkers=1` with `VITEST_MAX_WORKERS=1`, isolated
  `TEMP`/`TMP`, and a two-hour outer budget;
- result: `success=false`; 1,801 total suites, 1,766 passed, 35 failed; 6,903
  total tests, 6,840 passed, 29 failed, 34 skipped;
- artifact:
  `E:\rasen-ecp6-r4-rereview-root-full-20260803\root-vitest.json`;
- size: 2,537,578 bytes;
- SHA-256:
  `AC4A13AD45525B16C2EFA28640EA7F5885CC630988A71885CFC8D9504F92852E`.

Sixteen failures are the deterministic M1 group above. The remaining thirteen
are separated as environmental/noise candidates, not silently counted as
passes: daemon lifecycle (2), pipeline command cleanup (1), store membership
(2), store remote (4), archive recovery (2), local-version runtime (1), and
token-audit management (1). They reported Vitest `STACK_TRACE_ERROR` collection
failures or Windows `EBUSY`/locked temporary-directory cleanup after the
116-minute serial run. A fresh fixer must rerun these files independently and
must treat any reproduced assertion failure as an additional finding.

## Task state and next review step

- Review loop remains **in progress**; this section does not mark the Change
  terminally blocked.
- Tasks remain **66/69 checked**. Tasks 9.8 and 9.9 remain open because the
  mandatory root gate is red; parent-owned task 9.10 remains open.
- Full UI was not started after M1 was confirmed.
- After remediation, use a new non-author reviewer and require a clean focused
  security rerun, vertical 1/1, single full-root JSON with zero failures, and
  single full-UI JSON with zero failures before writing
  `Round 4 CLEAN (0/0/0/0)`.

This AI-assisted security review is not a substitute for a professional
security audit.
