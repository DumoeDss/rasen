# ECP-6 review remediation, round 2

Recorded on 2026-08-02 in
`wip/ecp-shared-bounded-loop-lifecycle-resume`. This is implementer evidence
for the second bounded review round. It does not close independent-review tasks
9.8-9.10 and does not claim parent delivery, remote CI, merge, or archive.

## Findings addressed

### M1: completion authority and durable evidence

The public effect/infrastructure completion seam no longer accepts a
self-consistent identity bundle supplied solely by the caller.

- Every newly granted agent, command, or host Action freezes a
  `change-run-completion-authority/1` contract derived from the immutable
  capability, policy, runtime profile, Action identity, and expected workspace.
  It binds the exact actor, actor-attestation authority, evidence producer,
  schema, media type, observation kind, and command executable where applicable.
- The canonical Action view projects this non-secret authority and the frozen
  expected workspace so a trusted executor can construct a receipt after a
  fresh-process status read. Legacy records remain decodable, but an observation
  for an Action without frozen authority fails closed.
- Completion verifies the submitted actor and every evidence/attestation
  authority field against the frozen Action contract before any Record mutation.
  Observation binding is also checked against the Run, Action, Effect,
  infrastructure adapter, and frozen tree digest.
- Receipt identity now covers the actor, actor attestation, and evidence
  references as well as the domain result/observation/error.
- Transport bytes are staged into a run-scoped persistent evidence store under
  the same controlled store root. Publication uses a digest-derived filename,
  a sibling staging file, `fsync`, and a no-replace hard link. Reads are physical
  no-follow reads with regular-file, stable-identity, canonical-envelope,
  digest, size, entry-count, and byte-budget checks. Missing, tampered, symlink,
  oversized, or non-canonical content fails closed. No caller pathname is used.
- A newly opened runtime store can read the bytes retained by an earlier CLI
  handler, and a separate OS process retrieves and verifies those same bytes.
  The child-process discriminator and the production reader both reject later
  tampering, proving that validation is not satisfied by command-local memory.

The RED discriminator
`rejects a fully self-valid actor, producer, and schema substitution before mutation`
was accepted before the fix. It is now GREEN and asserts the exact authority
error plus unchanged Record digest/version. The filesystem store suite also
covers fresh-process reopen, missing content, tampering, symlink substitution,
and oversize rejection.

### M2: exact `planning:<PlanningSpaceId>` authority

Runs list, detail, and control now share one exact planning-selector resolver.
It validates a full PlanningSpaceId, derives authoritative identifiers from
registered project names, canonicalizes the associated physical roots, and then:

- resolves one unique registered root and applies normal workspace identity and
  control authorization there;
- returns typed 404 `planning_selector_unavailable` for no usable registered
  root, without falling back to the process cwd;
- returns typed 409 `planning_selector_ambiguous` when duplicate clones map the
  same selector to different physical roots;
- preserves the selected root for control spawning and preserves `other`
  workspace scope for an exact record belonging to another worktree.

The real HTTP RED discriminator previously produced a 200 list/detail response
but a 400 `no_project` control response for the same selector. The four-case
HTTP matrix is now GREEN: current root, other-worktree record, unavailable
selector, and duplicate-clone ambiguity. `project:` ambiguity uses the same
authoritative PlanningSpaceId derivation.

### m1: deterministic workspace candidate races

`deriveRunWorkspaceIds` now accepts a minimal read-only filesystem seam covering
directory enumeration and stat. Candidate checks and the post-candidate archive
recheck all use that seam. Deterministic tests prove:

- an `ENOENT` candidate race continues to a later legal candidate;
- a non-`ENOENT` candidate stat failure returns typed identity unavailability;
- a Change moved into archive between discovery and validation is rejected on
  the second check.

Existing list/detail/control callers retain their typed fail-closed handling.

### Vertical hard-timeout reliability

The vertical proof retains its per-CLI 90 second timeout and bounded-loop limits.
Its outer test timeout is now 900 seconds, reflecting the cost of 73 real Windows
process launches, and teardown awaits all tracked CLI promises before stopping
Management or deleting the sandbox. This prevents a test-runner timeout from
leaving live child processes that race cleanup.

The first post-remediation run failed fast because the canonical Action view did
not yet expose the frozen authority needed by a fresh-process executor. After
adding that projection, a new clean run passed:

- command: `pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`
- result: 1/1 passed; test 435.223 seconds; total 455.28 seconds
- process/transition count: 73 / 73
- success Run: `run:9fa37087e2651ca87fc8057042136f697a71f71742b16303214a966a8dd144ef`
- required-member-failure Run: `run:2013d6a31ea8dd6e488665882c97f7ac72e4e8c87c18abd56d4be790de9ae42f`
- representative first Action: `action:8481e0c30e09fe2a88306b33c5ccd4e76944fdbd5b9b0cb30ba8cb5a3b5328db`
- source digest: `sha256:7c637546b22b91d2a242f01205165c3893aaef9ed2e33130198e9a10a865302d`
- capability digest: `sha256:36d43bb2dabb64819c987ab5af5dc703cd2183ba789bae4de427ea6227dc26f8`
- policy digest: `sha256:a11cd0e1eff98562ad73707155a8fc12ab145b338973195a0ad938f1e4d3b53c`
- plan digest: `sha256:727b593cbc1993ba8ca33bb6d3e8bd6aee441ab9aa816762aac4326aa6e61cd6`
- profile digest: `sha256:51773a842e60b9e80e066061a326a20e13b14bd4be76ba75449a5a49120220d8`

The sandbox was removed successfully with no `EPERM` cleanup failure.

## Changed implementation and tests

Round 2 changes are concentrated in:

- `src/core/change-run/contracts.ts`
- `src/core/change-run/internal/actions.ts`
- `src/core/change-run/internal/completion.ts`
- `src/core/change-run/internal/evidence.ts`
- `src/core/change-run/internal/evidence-store-fs.ts`
- `src/core/change-run/internal/facade-runtime.ts`
- `src/core/change-run/internal/projector.ts`
- `src/core/change-run/internal/runtime-context.ts`
- `src/commands/pipeline.ts`
- `src/core/management-api/router.ts`
- `src/core/management-api/run-workspace-identity.ts`
- `test/core/change-run/evidence-store-fs.test.ts`
- `test/core/change-run/facade-settle-completeness.test.ts`
- `test/core/change-run/cli-complete.test.ts`
- `test/core/change-run/reconciler-fixture.ts`
- `test/core/change-run/canvas-v2-vertical-proof.test.ts`
- `test/core/management-api/run-planning-selector-http.test.ts`
- `test/core/management-api/run-workspace-identity.test.ts`

## Fresh gates

- Focused runtime/Management matrix: 12 files, 140/140 passed.
- Vertical proof: 1 file, 1/1 passed in 455.28 seconds total.
- Operations/UI matrix: 3 files, 24/24 passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed with 0 errors; the previously reported unused
  suppression was removed during this remediation.
- strict Change validation: 1/1 valid, zero issues.
- `git diff --check`: exit 0 (only Git line-ending conversion notices).
- `pipelines/auto-decompose/pipeline.yaml` remains unchanged at
  `6f306544010a8950508f1223acfca5d62de407f5`.

## Remaining boundary

This remediation does not create a Session executor, automatically execute an
Action, or introduce a private completion path. It hardens the public completion
boundary used by the ECP-6 trusted test host. Automatic execution remains ECP-7.
Independent non-author review must now re-evaluate the resolved findings; tasks
9.8, 9.9, and 9.10 intentionally remain open.

## Test-history disclosure

The first final focused rerun exposed four legacy View codec failures because
`expectedBeforeWorkspace` had initially been made mandatory in
`change-run-action-view/1`. The field is now optional for decoding retained
legacy views while every newly projected Action still supplies it. The codec
suite then passed 8/8 and the remaining focused files passed 132/132, for the
definitive 140/140 result above. This compatibility correction does not weaken
new Action authority: observation completion for a legacy Action without frozen
authority still fails closed.
