# Review remediation — Round 4

Date: 2026-08-03  
Scope: ECP-6 Child 4 only  
Result: implementation and focused verification complete; ready for independent re-review

## Outcome

Round 4 closes the two Round 3 findings in the implementation:

1. executable completion is now authorized by an exact, host-owned Ed25519
   public authority frozen through binding, profile, sealed-plan identity and
   Action; public metadata and caller-computable hashes are not authority;
2. the filesystem EvidenceStore now recovers only the exact two-link
   `final + strict staging companion` topology left by an abrupt post-link
   crash, while every unprovable topology fails closed without deletion.

The repair also closes a gap discovered during remediation: the lowerer had
continued to use the Definition-only digest as `RuntimePlan.planDigest`, and
existing Run entry points re-resolved the mutable current profile. New Runs now
use the complete sealed execution-plan digest, persist the public-only
`RuntimeExecutionProfile`, and every existing-Run entry point (`start` reuse,
`status`, `resume-run`, `cancel`, `complete`, and `control`) reopens and verifies
that frozen plan/profile.

This report does **not** claim ECP-7. The vertical producer remains an explicitly
trusted test host. A real Session/worker Adapter that observes work and invokes
the trusted producer is still the ECP-7 landing gate.

## Threat model and trust boundary

| Threat | Required invariant | Implemented boundary |
|---|---|---|
| Caller copies all public Action/Actor/producer metadata and invents matching bytes, refs and receipt | no EvidenceStore or Record mutation | authenticated EvidenceRef v2 plus an exact canonical actor claim; HostEvidenceWriter verifies the complete set before its first publication |
| Caller generates a new key and substitutes a self-consistent authority | substituted signatures remain invalid | verifier derives the authority only from the admitted Action and requires the proof `authorityDigest` to match it |
| Authored Definition or CLI nominates a trust key | authored/project input cannot become authority | exact trusted Adapter lookup is host-owned; Definition authority data is ignored for resolution; no CLI key/provider/path option exists |
| Current catalog rotates or is substituted after launch | existing Run meaning is unchanged | `plan.json` contains the public-only launch profile; all existing-Run entry points reopen it and skip current authority resolution |
| Signed semantic payload is edited and public receipt recomputed | completion remains invalid | canonical actor claim covers variant, status, result/observation/error, exact evidence digest and complete Action binding |
| Valid submission is replayed across Run, Action or effect | cross-slot replay fails before classification | EvidenceRef bindings and claim bind planning space, Change instance, project, Change, Run, Action, tree and optional effect |
| One valid and one invalid upload arrive together | invalid batch publishes nothing | all uploads, refs, proofs, claim and receipt are checked in memory before publication |
| Host crashes after final hard-link creation and before staging unlink | retry converges without deleting unrelated files | recovery accepts one strict companion only after name, directory, inode, link-count, bytes, canonical envelope and anchor proof |
| External hard link, junction, symlink, wrong inode/envelope, multiple companions or `nlink > 2` is presented | no outside mutation and no guessed cleanup | fail closed; recovery never searches outside the anchored objects directory and never deletes an unproven name |

Private signing material exists only in `TrustedCompletionProducer` input as an
in-memory Node `KeyObject`. Verification, CLI, RuntimeContext, Action/View,
Record, project files and EvidenceStore receive public material only.

## Authority provenance and freezing

1. `trusted-execution-adapters.json` is provisioned in host state and maps the
   exact Adapter `{id, version, contentDigest}` to one canonical public
   `AttestationAuthority`.
2. Resolution requires an unambiguous exact artifact match and validates
   canonical Ed25519 SPKI DER, canonical base64 and the SPKI digest.
3. The public authority is included in the capability binding. It therefore
   participates in `capabilityProfileDigest` and `profileDigest`.
4. `sealRuntimeExecutionPlan(prepared.plan, profile)` includes the complete
   profile. Its digest, with the `sha256:` identity prefix, is now the canonical
   `RuntimePlan.planDigest`; it is no longer the Definition-only plan digest.
5. The public-only profile is persisted in the immutable RuntimePlan. Reopen
   reconstructs the path-based plan through the canonical validator and
   requires exact deep equality, rejecting unknown or non-canonical derived
   fields.
6. The Action freezes the exact authority and all actor/evidence-use metadata.
   Completion verification loads that admitted Action; it never rebuilds trust
   from the current catalog.
7. Rotation changes public key/version, authority digest, capability-profile
   digest, profile digest and sealed-plan digest for a **new** Run only. An old
   Run continues with its stored public authority. If the historical signer is
   unavailable, the producer returns typed
   `attestation_signer_unavailable`; it never falls back to unsigned output.

Legacy Actions remain readable for status but executable completion fails
closed because they have no frozen attestation authority. A persisted existing
Run without a usable RuntimePlan also fails closed instead of being silently
replanned.

## Canonical objects and digests

- Authority digest: domain-separated SHA-256 over canonical JSON of
  `change-run-attestation-authority/1`.
- Evidence proof message: exact bytes
  `rasen/change-run-evidence-proof/1\0 || canonicalJson(unsignedIdentity)`.
- EvidenceRef v2 identity includes authority digest, content digest, media
  type, size, observation kind, producer and full evidence binding.
- EvidenceRef digest: domain-separated SHA-256 over the unsigned identity and
  proof envelope.
- Actor completion claim: exact canonical JSON of
  `change-run-completion-claim/1`; it covers authority, complete Run/Action/tree
  binding, exact actor, variant, status, semantic payload and the labeled
  non-attestation evidence digest.
- Completion receipt is checked only after proof and canonical-claim checks;
  receipt equality is not treated as authority.
- Persistent evidence object: exact canonical JSON
  `change-run-evidence-object/{1|2}`. Semantically equivalent whitespace or key
  order is rejected; canonical base64 and content/ref digests are rechecked.

The same `verifyAttestedCompletion` implementation is used by the host writer
before publication and by the Facade after re-reading immutable store bytes,
before completion-slot classification or Record mutation. All three variants
(`domain-action-result`, `effect-observation`, and
`infrastructure-observation`) use this path.

## Host publication order

`HostEvidenceWriter.publishCompletion` performs this order:

1. load the exact Record and admitted Action;
2. verify the public completion envelope against that Action;
3. canonical-base64 decode every upload and recompute every content digest;
4. reject conflicting duplicates, missing refs and orphan uploads;
5. verify both authenticated refs, both Ed25519 signatures, exact producer/use
   bindings, exact canonical actor claim and variant receipt in memory;
6. only then publish the referenced objects;
7. the Facade re-reads those objects and runs the same verifier before mutation.

Validation is all-or-nothing before publication. A later host crash may leave a
valid unreferenced content-addressed object, but it cannot make an invalid or
unauthenticated submission authoritative and cannot mutate the Record.

## Crash-recovery proof

Publication writes and fsyncs a unique strict staging file, hard-links it to the
no-replace final name, proves the two-link topology, fsyncs the directory,
unlinks staging, fsyncs again, and requires the final object to stabilize at
`nlink === 1`.

The post-link fault injector deliberately skips normal `finally` cleanup, so it
leaves the real poison topology: one final plus one strict staging name, same
`{dev, ino}`, identical canonical envelope, and `nlink === 2` on both names.
Recovery deletes only that companion after proving:

- one and only one strict digest-scoped candidate exists;
- target and candidate are physical regular files under the stable anchor;
- both names refer to the same stable inode with exactly two links;
- both reads are byte-identical and decode to the exact canonical envelope/ref;
- directory and file identities remain stable during proof.

Tests cover same-store retry, fresh-store retry, and a genuinely separate Node
process that imports and executes the production TypeScript store, crashes at
the post-link point, and exits before the parent performs recovery. Before-link
orphans stay invisible; after-unlink retry is ordinary idempotency; EEXIST,
external links, multiple/wrong candidates, wrong envelopes, `nlink > 2`,
junctions and unsafe anchors fail closed with zero outside deletion.

## Discriminating RED -> GREEN evidence

All RED mutations were made with `apply_patch`, tested, and immediately
reverted with `apply_patch`. No mutation marker remains in the tree.

### RED A — sealed plan and existing-Run authority

Before the repair, the new RuntimeContext assertions produced 2/2 failures:

- actual `RuntimePlan.planDigest` was the Definition-only digest
  `sha256:cde6d2...`, not the authority-bound sealed digest
  `sha256:3a8860...`;
- after key rotation, the resumed plan carried the rotated capability/profile
  digests instead of equaling the launch plan.

After the repair, `runtime-context`, `execution-plan`, and native-v2 lowerer
tests passed 18/18. The final built vertical then held the catalog rotated
across fresh `status`, `resume-run`, `control`, and `complete` processes and
completed with the original frozen authority.

### RED B — unsigned metadata, substituted key, invalid batch

Temporary mutation: publish individually valid uploads during decode and omit
the Action-frozen proof/claim verifier.

Command:

```text
pnpm exec vitest run test/core/change-run/attestation.test.ts --reporter=verbose -t "rejects exact public Action metadata|validates the whole upload set|rejects a caller key substitution"
```

RED result: 3/3 failed exactly as intended.

- public-metadata forgery: expected rejection, received no error;
- self-consistent caller-key substitution: expected rejection, received no
  error;
- invalid two-upload batch: inventory was `{ bytes: 11, entries: 1 }` instead
  of `{ bytes: 0, entries: 0 }`.

After restoring complete-set verification-before-publication, the same command
passed 3/3.

### RED C — post-link crash poison

Temporary mutation: make `recoverPublishedCompanion` return without proving or
cleaning the strict companion.

Command:

```text
pnpm exec vitest run test/core/change-run/evidence-store-fs.test.ts --reporter=verbose -t "recovers only the exact strict post-link|recovers an after-link crash in the same store|genuinely separate crashed OS process"
```

RED result: 3/3 failed with
`Evidence object is not a bounded physical regular file` at the two-link final.
After restoring recovery, the same command passed 3/3, including the separate
OS process case.

## Private-key absence scan

The focused scan over Action/View/Record/projector/evidence/CLI surfaces:

```text
rg -n -i "private.?key|pkcs8|begin private|attestation.?signer|signer.?path" \
  src/core/change-run/contracts.ts \
  src/core/change-run/internal/record.ts \
  src/core/change-run/internal/projector.ts \
  src/core/change-run/internal/evidence.ts \
  src/core/change-run/internal/evidence-store-fs.ts \
  src/commands/pipeline.ts src/commands/pipeline-messages.ts
```

Result: `ZERO_MATCHES`.

The repository-wide relevant matches are confined to:

- `trusted-completion-producer.ts`: the in-memory private `KeyObject`, signing
  operation, key/public-authority match check, and typed unavailable/mismatch
  errors;
- `test/fixtures/trusted-completion.ts`: a module-local test keypair whose
  private half remains in the parent test process.

The Action serialization test additionally rejects
`private|pkcs8|BEGIN PRIVATE KEY`. The built vertical provisions only public
descriptors to isolated host state; CLI children never import the test fixture
or receive a key through argv/environment. RuntimeContext wires verifier,
EvidenceStore and HostEvidenceWriter only; it has no signer.

## Verification results

Final focused security/runtime suite:

```text
pnpm exec vitest run \
  test/core/change-run/attestation.test.ts \
  test/core/change-run/evidence-store-fs.test.ts \
  test/core/change-run/runtime-context.test.ts \
  test/core/change-run/execution-plan.test.ts \
  test/core/change-run/lowerer.test.ts \
  test/core/change-run/lowerer-native-v2.test.ts \
  test/core/change-run/facade-settle-completeness.test.ts \
  test/core/change-run/actions.test.ts \
  test/core/change-run/contracts.test.ts \
  test/core/change-run/cli-complete.test.ts \
  test/core/pipeline-registry/profile-resolver.test.ts \
  --reporter=dot --maxWorkers=4
```

Result: **11 files, 121/121 passed**.

Final fresh built product vertical:

```text
pnpm exec vitest run test/core/change-run/canvas-v2-vertical-proof.test.ts \
  --reporter=verbose --maxWorkers=1
```

Outer command timeout was 1,300 seconds. Result: **1/1 passed**, 191.852 seconds
inside the test, **73 fresh CLI processes / 73 transitions**. It covered the
success and required-member-failure Runs, exact replay/conflict/tamper matrix,
process-loss recovery, persisted plan equality, management projection parity,
and catalog rotation spanning existing-Run status/resume/control/complete.

Final gates:

- `pnpm exec tsc --noEmit`: passed;
- `pnpm --dir packages/ui run typecheck`: passed;
- `pnpm run build`: passed;
- `pnpm run lint`: passed, zero errors;
- `node dist/cli/index.js validate ecp-v2-authoring-loop-vertical-proof --type change --strict --json`: 1/1 valid, zero issues;
- `git -c core.safecrlf=false diff --check`: passed;
- `git hash-object pipelines/auto-decompose/pipeline.yaml`:
  `6f306544010a8950508f1223acfca5d62de407f5`, unchanged;
- `git diff --exit-code -- pipelines/auto-decompose/pipeline.yaml`: no diff.

Two exploratory attempts that included the unrelated, very large
`test/commands/pipeline.test.ts` hit their external 180/300 second command
budgets without emitting a test failure. They are not counted as passing or
failing evidence. The scoped command/complete behavior is covered by 21 passing
`cli-complete` tests and the 73-process built vertical.

## Changed implementation and test surfaces

Round 4 implementation surfaces:

- `src/core/pipeline-registry/trusted-execution-adapters.ts`
- `src/core/pipeline-registry/profile-resolver.ts`
- `src/core/pipeline-registry/execution-plan-internal.ts`
- `src/core/change-run/contracts.ts`
- `src/core/change-run/internal/actions.ts`
- `src/core/change-run/internal/attestation.ts`
- `src/core/change-run/internal/trusted-completion-producer.ts`
- `src/core/change-run/internal/host-evidence-writer.ts`
- `src/core/change-run/internal/evidence-store-fs.ts`
- `src/core/change-run/internal/runtime-plan.ts`
- `src/core/change-run/internal/lowerer.ts`
- `src/core/change-run/internal/runtime-context.ts`
- `src/core/change-run/internal/facade-runtime.ts`
- `src/commands/pipeline.ts`

Round 4 test surfaces:

- `test/core/pipeline-registry/profile-resolver.test.ts`
- `test/core/change-run/actions.test.ts`
- `test/core/change-run/contracts.test.ts`
- `test/core/change-run/attestation.test.ts`
- `test/core/change-run/evidence-store-fs.test.ts`
- `test/core/change-run/runtime-context.test.ts`
- `test/core/change-run/facade-settle-completeness.test.ts`
- `test/core/change-run/canvas-v2-vertical-proof.test.ts`
- `test/fixtures/trusted-completion.ts`
- `test/fixtures/typescript-source-loader.mjs`

## Landing gate and remaining boundary

The Round 3 authenticity Blocker and EvidenceStore recovery Major are ready to
be closed by an independent Round 4 reviewer if the reviewer reproduces the
focused gates above and finds no new issue.

ECP-6 may claim a public-only, manually trusted-host vertical proof. The overall
0.2.0 ECP must **not** be called genuinely product-complete at this point:
ECP-7 must connect a real trusted execution Adapter/Session worker that observes
work and effects and invokes `TrustedCompletionProducer` without exposing the
private key to the caller, CLI, Action, Record, project or EvidenceStore. No
Session executor, automatic effect observer, worker scheduler/reuse/handoff,
usage accounting, Issue/ExecutionPlan/portfolio implementation, or
`auto-decompose` migration was added in this remediation.
