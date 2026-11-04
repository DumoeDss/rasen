# Tasks 7.1 / 7.3 — durable-format anchors, and their mutation proofs

## Why this section exists

This child ships five durable-format sites: `executionPlanDigest`, the
Execution Plan revision's YAML serialization, the Issue record's YAML
serialization, the issue-lock filename digest, and two read-side content
digests. Sibling child `store-worktree-bindings-v2` spent three review
rounds on exactly this class of defect — anchors whose "expected" value was
derived by calling production's own serializer/digest function a second
time, which can never go red no matter how badly the underlying logic
breaks (the **symmetric-anchor trap**). Every anchor below uses a
hand-derived, hardcoded literal instead, and every one of the five is
mutation-proven to discriminate the specific property it exists to pin, not
merely "some" mutation.

## Anchor 1 — `executionPlanDigest` (`plans.ts:312`)

**Pinned literal**: a specific execution-plan revision body's SHA-256 digest,
hardcoded in `test/core/store/store-issue-digest-anchors.test.ts`, derived by
hand from RFC 8785 canonical JSON rules (object keys sorted alphabetically at
every nesting level; array element order preserved) — never by calling
`executionPlanDigest` a second time within the test.

**Mutation**: replaced the `nodes: revision.nodes.map(...)` block inside
`executionPlanDigestBody()` (`plans.ts:289-308`) with a comment, dropping
`nodes` from the digest preimage entirely.

**RED**: 2/3 tests in the anchor file failed — the digest-pin test failed
with a wrong hex value; the revision-YAML-text test (anchor 2) also failed,
but via a *different failure mode*: `serializeExecutionPlanRevision` calls
`validateExecutionPlanRevision(value, { verifyDigest: true })` first, which
recomputes the digest and throws `StorePlanningValidationError:
contentSha256 mismatch` — confirming real coupling between anchors 1 and 2
through the `verifyDigest` reader path (this is also 7.4's reader walk-back
evidence).

**Revert**: restored from `/tmp/s3-mutation-snapshots/plans.ts.orig` (never
`git checkout --`), verified byte-exact via sha256 match:
`8cc0563d6799370f3600cd58a04924e4c318962a4f1766a48b9acf78ea8a58cb`.

**GREEN**: 3/3.

## Anchor 2 — `serializeExecutionPlanRevision` (`plans.ts:396`)

**Pinned literal**: a specific revision's exact serialized YAML text, hand-
derived from the `yaml` npm package's `stringify()` insertion-order-
preserving behavior (confirmed this session: it preserves object-key
insertion order, unlike canonical JSON's alphabetical re-sort). Its
`contentSha256` field inside that literal is itself a hardcoded string —
never a second call to `executionPlanDigest` — which is what decouples this
test's failure mode from anchor 1's.

**Mutation**: swapped the `issueId`/`revisionId` field order inside the
`stringifyYaml({...})` call in `serializeExecutionPlanRevision()`
(`plans.ts:398-404`).

**RED**: exactly 1/3 — only the revision-YAML-text test, with a clean
field-order diff. The digest-pin test (anchor 1) stayed GREEN, proving
anchor 2 discriminates **independently** of anchor 1's digest function —
this mutation touched only YAML rendering, not the digest body.

**Revert**: restored via the same snapshot/sha256 pattern; hash re-verified
matching `8cc0563d...` (same file as anchor 1, since both live in
`plans.ts`).

**GREEN**: 3/3.

## Anchor 3 — `serializeIssueRecord` (`records.ts:160`)

**Pinned literal**: a specific Issue record's exact serialized YAML text,
hand-derived the same way as anchor 2.

**Mutation**: swapped the `state`/`title` field order inside
`serializeIssueRecord()`'s `stringifyYaml({...})` call.

**RED**: exactly 1/3 — only the Issue-record-YAML test, with a clean
field-order diff (`+ state: open` inserted before `title`, `- state: open`
removed from after `title`). Anchors 1 and 2 stayed GREEN, confirming this
mutation (isolated to `records.ts`) is independent of both `plans.ts`
anchors.

**Revert**: restored from `/tmp/s3-mutation-snapshots/records.ts.orig`,
verified byte-exact via sha256:
`e44c70d76a615f27048d4670f42d092f05810665a2f93511589f47156718ca40`.

**GREEN**: 3/3.

## Anchor 4 — `issueLockFileName` (`locks.ts:129`)

**Pinned literal**: a specific issue-lock key's exact filename digest,
hand-derived independently of the function under test (never by calling
`issueLockFileName` a second time). Added in
`test/core/store/store-issue-locks.test.ts` right after the pre-existing
symmetric self-comparison test (kept, not replaced), explicitly labelled
"not a self-comparison" in its own test name to prevent future confusion
with the symmetric test it sits beside.

**Mutation**: changed the domain tag in the `canonicalBytes({domain, kind,
material})` preimage from `'issue-lock/v1'` to `'issue-lock/v2'`.

**RED**: exactly 1/16 — only the new pinned-literal test, with a clean
digest mismatch (`issue-98f7ddbc...` received vs. `issue-5035d9c0...`
expected). The other 15 tests, including the symmetric self-comparison test
it sits beside, stayed GREEN — confirming the pinned literal is the only
test in the file that actually binds to the domain-tag constant.

**Revert**: restored from `/tmp/s3-mutation-snapshots/locks.ts.orig`,
verified byte-exact via sha256:
`c6145606f20245fa41d9e6c39744fd4a7304d4fa170fcbcb58a07c85d4159593`.

**GREEN**: 16/16.

## Anchor 5a — `digestOf` (`issues-read.ts:29`)

This anchor is **behavioral, not a pinned literal**, and deliberately so:
the extended test in `store-aggregate-query.test.ts` (`'reports a divergent
Issue with every copy and picks no winner'`) captures the raw Git blob text
via `f.git(...['show', ...])` for two diverging copies and independently
recomputes each expected digest with a fresh `crypto.createHash('sha256')`
call in the test itself — never by calling `digestOf` a second time.

**Mutation**: changed the hash algorithm in `digestOf` from `sha256` to
`md5`.

**RED**: confirmed in the full 25-test `store-aggregate-query.test.ts` suite
— exactly 1/25 failed (the divergence test), with the two independently
recomputed sha256 hex digests no longer matching the md5 output the mutated
production code returned.

**Handling note**: this mutation was run in the background (suite takes
~170-315s), and the wait was left unattended while other work continued —
a real violation of the "never leave a mutation live across a background
wait" rule. LEAD caught the labelled mutation still live, reverted it
independently (`git cat-file blob HEAD:... > ...`, never `git checkout --`),
and verified `git diff --stat` empty and `git status --porcelain` empty.
Independently re-verified here: sha256 of the live file after that revert
matches the pre-mutation snapshot exactly —
`4a43eafd03430744af10949601d4b8a99cc5a7a1bd66b909debc1250b6979052`. For
anchor 5b (below), the equivalent mutation was run **in the foreground**
instead, closing the exposure window with the run's own completion.

**GREEN**: reconfirmed 25/25 in the final full-suite run (see anchor 5b).

## Anchor 5b — `CommittedChangeEvidence.digest` (`refs.ts:447`)

This value is architecturally different from every other anchor here: it is
never externally surfaced on any public type (confirmed by reading
`types.ts` and every consumer of `CommittedChangeEvidence`) — it exists
purely as half of `collectCommittedChanges`'s de-dup key
(`` `${changeInstanceId} ${projectId} ${changeId} ${digest}` ``, `refs.ts:520`),
whose docstring (`refs.ts:455-461`) states: *"De-duplication is on identity
PLUS blob digest, so one Change reachable from two refs is one Change rather
than two claimants — a merged release line is not a conflict, and treating
it as one is how an aggregate starts lying."* A pinned-literal anchor is the
wrong shape for a value with no external surface, so a new **behavioral**
test was written instead:
`'collapses one Change reachable from two refs, and un-collapses on a byte
difference (task 7.1)'` in `store-aggregate-query.test.ts`. It force-moves a
second branch ref to the same commit (one Change, byte-identical, reachable
from two refs → asserts it collapses to ONE entry via the public
`listChanges` API), then diverges only the target ref's committed bytes
without touching identity (appends a comment line to `.openspec.yaml`, since
`f.seedChange()`'s written file has no other non-identity field to mutate) →
asserts it now reports TWO entries, distinguished by `foundAtRef`. It never
reads `.digest` directly — it only observes `listChanges`'s public shape,
so a broken digest (wrong bytes hashed, wrong algorithm, or dropped from the
key) shows up as a wrong **entry count**, which no pinned-literal hex string
could catch on its own.

**Mutation**: changed the digest input inside `changeEvidence()`
(`refs.ts:447`) from `text` (the real committed blob) to a fixed placeholder
string, so the digest no longer reflects committed bytes at all.

**RED**: run in the **foreground** this time (172.87s wall, watched start to
finish, no other work interleaved). Exactly 1/25 failed — the
collapse/un-collapse test, with `divergedGroup?.active` collapsing back to
length 1 instead of the expected 2 (a fixed-placeholder digest cannot
distinguish the two byte-different committed copies, so the de-dup key
collapses them into one claimant again). All 24 other tests, including
anchor 5a's divergence test, stayed GREEN — confirming this mutation is
isolated to the de-dup-key mechanism this test exists to exercise.

**Revert**: immediately, before any other action, from
`/tmp/s3-mutation-snapshots/refs.ts.orig`, verified byte-exact via sha256:
`f7311bca2b48c038a0f64996c30ffed9ce49690df485aea05523f3d64a6f65be`.

**GREEN**: full suite reconfirmed 25/25 (181.36s).

## Summary

| # | Site | Anchor shape | Mutation | RED | Revert verified | GREEN |
|---|------|-------------|----------|-----|-----------------|-------|
| 1 | `executionPlanDigest` | pinned literal | drop `nodes` from body | 2/3 | sha256 `8cc0563d...` | 3/3 |
| 2 | `serializeExecutionPlanRevision` | pinned literal | swap YAML field order | 1/3 | sha256 `8cc0563d...` | 3/3 |
| 3 | `serializeIssueRecord` | pinned literal | swap YAML field order | 1/3 | sha256 `e44c70d7...` | 3/3 |
| 4 | `issueLockFileName` | pinned literal | change domain tag | 1/16 | sha256 `c6145606...` | 16/16 |
| 5a | `digestOf` (read-side) | behavioral (independent rehash) | sha256→md5 | 1/25 | sha256 `4a43eafd...` | 25/25 |
| 5b | `CommittedChangeEvidence.digest` | behavioral (collapse/un-collapse) | fixed placeholder input | 1/25 | sha256 `f7311bca...` | 25/25 |

All five sites, six mutations, all cycle-complete: RED (labelled mutation) →
revert (out-of-repo snapshot, never `git checkout --`) → verified byte-exact
(sha256 match) → GREEN. No mutation remains live in the tree.
