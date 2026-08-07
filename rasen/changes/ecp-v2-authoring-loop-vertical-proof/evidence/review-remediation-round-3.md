# ECP-6 review remediation, round 3

Recorded on 2026-08-02 in
`wip/ecp-shared-bounded-loop-lifecycle-resume`. This is implementer evidence
for the third bounded review round. It addresses the two Round 2 Major
findings, but it does not close independent-review tasks 9.8-9.10 and does not
claim parent delivery, remote CI, merge, or archive.

## RED discriminators

The two findings were reproduced before production changes.

### M1: domain completion authority bypass

Two public-facade tests were added to
`test/core/change-run/facade-settle-completeness.test.ts`:

- a fully self-consistent substituted domain actor, attestation, and evidence
  bundle submitted after the effect prerequisite was satisfied;
- a domain completion for a retained legacy Action with no frozen
  `completionAuthority`.

Both tests were RED: Vitest reported 2/2 failures because each expected throw
did not occur. The tests also preserve the pre-completion Record digest and
version and require both to remain unchanged after rejection.

### M2: physical-link and pre-mutation path safety

Three filesystem discriminators were added to
`test/core/change-run/evidence-store-fs.test.ts`:

- a canonical evidence object with a second hard link remained readable;
- a pre-existing `evidence` directory junction was rejected only after an
  external `objects` directory had been created;
- a store-anchor junction was rejected only after an external Run tree had
  been created.

All three tests were RED. The junction cases run as real Windows junction tests
on this host without a skip and assert an empty outside directory after both
read and stage attempts.

## M1 remediation: one frozen completion authority

`createChangePipelineRuntime.complete` now applies one fail-closed authority
verifier to `domain-action-result`, `effect-observation`, and
`infrastructure-observation`. Verification occurs after structural completion
decoding and before slot classification, receipt acceptance, or Record
mutation.

For every completion, the verifier requires:

- the admitted Action's non-legacy `change-run-completion-authority/1`;
- exact actor equality, including kind, identity, principal, session, adapter,
  and actor-specific authority fields;
- exact actor-attestation producer, schema, media type, observation kind, and
  complete PlanningSpace/ChangeInstance/project/Run/Action/tree binding;
- the variant's exact evidence authority: `domainActionResult` for domain,
  `effectObservation` for effect, or `infrastructureObservation` for
  infrastructure;
- exact producer, schema, media type, observation kind, complete binding, and
  effect identity only for effect observations;
- the frozen infrastructure adapter digest for infrastructure observations;
- non-empty evidence sets whose attestation and evidence bytes can be read and
  reverified from the Run-scoped persistent `EvidenceStore`.

A domain result can therefore no longer become authoritative merely by making
its caller-supplied receipt internally self-consistent. A legacy Action remains
decodable, but all three completion variants fail closed when its frozen
authority is absent.

Legal domain-completion fixtures across the public CLI, goal cycle, review
cycle, bounded-loop lifecycle, evaluator validation, and facade completeness
suites now derive the actor and evidence references from the admitted Action
authority and stage the exact bytes in a bounded EvidenceStore. This preserves
the production contract in tests instead of bypassing it with fixture-local
identities.

## M2 remediation: physical EvidenceStore boundary

The filesystem EvidenceStore now validates the physical store anchor before
touching any descendant. It then walks the fixed Run/`evidence`/`objects`
components one at a time:

- every existing component is inspected with `lstat` and must be a physical
  directory, not a symlink or junction;
- missing components are created with one-component, non-recursive `mkdir`;
- parent identity and real-path containment are checked before and after each
  creation;
- anchor and directory identities are rechecked across use and directory
  enumeration.

Canonical evidence reads require a physical regular file with `nlink === 1`
before open, on the opened descriptor, and after read. Device, inode, link
count, size, and modification time are bound across the before/open/after
observations, and the open uses `O_NOFOLLOW` where the platform exposes it.
Only after those physical checks do envelope, reference identity, size, and
content-digest verification run.

Publication retains staging-file `fsync` and no-replace hard-link publication.
It additionally binds the written descriptor to the closed staging pathname,
revalidates the controlled directory tree before linking, requires the expected
temporary 1-to-2 hard-link transition, unlinks the staging name, and requires
the published canonical object to return to one physical link before semantic
readback. Filesystem inspection/open/publication failures are mapped to typed
fail-closed EvidenceStore errors.

The real hard-link and Windows junction discriminators are now GREEN: the
linked canonical object is rejected, and both unsafe parent and unsafe anchor
cases leave their outside directories empty after read and stage attempts.

## Changed implementation and tests

Round 3 production changes are concentrated in:

- `src/core/change-run/contracts.ts`
- `src/core/change-run/internal/facade-runtime.ts`
- `src/core/change-run/internal/evidence-store-fs.ts`

Authority-correct fixtures and discriminators changed in:

- `test/core/change-run/facade-settle-completeness.test.ts`
- `test/core/change-run/evidence-store-fs.test.ts`
- `test/core/change-run/cli-complete.test.ts`
- `test/core/change-run/facade-evaluator-validation.test.ts`
- `test/core/change-run/goal-cycle-canonical.test.ts`
- `test/core/change-run/review-cycle-runtime.test.ts`
- `test/core/change-run/bounded-loop-lifecycle.test.ts`

## Fresh GREEN evidence

- M2 filesystem suite: 1 file, 6/6 passed, including the hard-link and two
  zero-outside-mutation junction discriminators.
- Updated CLI/review/bounded-loop rerun: 3 files, 67/67 passed.
- Definitive focused completion-authority, EvidenceStore, CLI, goal/review,
  bounded-loop, parity, dogfood, archive/recreate, and facade matrix: 18 files,
  194/194 passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm --dir packages/ui run typecheck`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed with zero errors.
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`:
  1/1 valid, zero issues.
- `git -c core.safecrlf=false diff --check`: exit 0.
- `git hash-object pipelines/auto-decompose/pipeline.yaml`:
  `6f306544010a8950508f1223acfca5d62de407f5`, unchanged from the baseline.

Per the review instruction, the approximately 87-minute full root suite was
not run by this fixer. A fresh non-author reviewer owns the full-root decision
after static review is clean.

## Fresh vertical proof

Command:
`pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts --reporter=verbose`

- result: 1 file, 1/1 passed;
- test duration: 312.410 seconds; total duration: 330.44 seconds;
- process/transition count: 73 / 73;
- success Run:
  `run:2f045cf25100349e2245da7c536268a2c1ff3296ff32cc51c2c43458fccd0a7f`;
- required-member-failure Run:
  `run:f88c344ec3926738941d796e6239e6919e4fdd5cb0731d7d1e6366be9438b6c8`;
- first Action:
  `action:0739479d6da7d54d31523479c746704263c55be01bfaac2780116e9e919d3ec0`;
- source digest:
  `sha256:7c637546b22b91d2a242f01205165c3893aaef9ed2e33130198e9a10a865302d`;
- capability digest:
  `sha256:36d43bb2dabb64819c987ab5af5dc703cd2183ba789bae4de427ea6227dc26f8`;
- policy digest:
  `sha256:a11cd0e1eff98562ad73707155a8fc12ab145b338973195a0ad938f1e4d3b53c`;
- plan digest:
  `sha256:727b593cbc1993ba8ca33bb6d3e8bd6aee441ab9aa816762aac4326aa6e61cd6`;
- profile digest:
  `sha256:51773a842e60b9e80e066061a326a20e13b14bd4be76ba75449a5a49120220d8`.

The journey again proved Management-saved Canvas v2 loop-plus-parallel
execution, required-member failure closure, persistent plan/Record/evidence,
and recovery across process loss.

## Remaining boundary

This remediation does not create a Session executor, worker, automatic Action
observer, or private completion path. It hardens the existing public completion
boundary used by the ECP-6 trusted test host. Automatic execution remains
ECP-7. Tasks 9.8, 9.9, and 9.10 intentionally remain unchecked pending fresh
non-author review and parent delivery.

## Test-history disclosure

After the unified verifier was first enabled, a broad compatibility run exposed
57 authority-invalid legacy fixtures among 111 tests (54 passed). Those tests
had been constructing legal domain completions from fixture-local actors and
unstaged evidence rather than from the admitted Action contract. The affected
helpers were corrected as described above; no production authority check was
weakened. The definitive focused rerun then passed 194/194, and the fresh
vertical passed 1/1. A final static pass then distinguished a link created by
this publication attempt from the benign concurrent-`EEXIST` path and made an
invalid observed 1-to-2 topology fail closed. After that final production
change, the EvidenceStore suite passed 6/6, root typecheck/build/lint/diff were
green, and a second fresh final-code vertical passed 1/1 with the Run evidence
recorded above.
