# Review remediation 1: archive transaction contract

Status: implementation-ready blueprint for the 14 findings in
`evidence/review-report.md`.

This handoff refines the child change; it does not relax the approved parent
design. The archive remains in the planning root, probes remain in the
execution root, the engine remains the sole owner of spec mutation, absent
handoff judgment still means preserve-all, and no implementation may delete a
machine root recursively.

## 1. Locked design

The archive operation is one durable transaction with three entry points:

```ts
interface ArchiveTransaction {
  plan(input: ArchivePlanningInput): Promise<ArchivePlanV2>;
  persist(plan: ArchivePlanV2): Promise<ArchivePlanToken>;
  apply(planOrToken: ArchivePlanV2 | ArchivePlanToken): Promise<ArchiveApplyResultV2>;
}
```

`apply(token)` is also resume. There is no second recovery algorithm and no
replanning during recovery. Filesystem claims, stable fingerprinting, spec
publication, cleaner journaling, and commit-marker publication are internal
parts of this deep module. Their adapters are injectable test seams, not
additional user-facing workflows.

Two rejected designs are important:

1. A process lock plus check-then-rename is not sufficient. A stale lock does
   not bind the object that was checked, and POSIX rename may replace an empty
   destination directory.
2. A collection of new public commands for plan/apply/recover/spec sync is too
   broad. Narrow, backward-compatible flags on `rasen archive` preserve one
   authority boundary and make all consumers exercise the same implementation.

The implementation must upgrade new plans and journals to version 2. A v1
journal may be inspected and reported, but must not be guessed forward once a
destructive phase might have begun. Fail closed with a manual-recovery
diagnostic naming the journal and retained paths.

## 2. Durable plan and CLI contract

### 2.1 Plan identity and storage

`planHash` is:

```text
sha256(canonical-json(plan with planHash omitted))
```

Canonical JSON means sorted object keys, array order preserved, UTF-8, and no
insignificant whitespace. Every field that authorizes a mutation is therefore
bound by the hash, including planning `treeState`, roots, decisions, source
identity, spec actions, intent, evidence inputs, and transformed fingerprints.

An explicit saved preview writes this envelope:

```ts
interface StoredArchivePlanV1 {
  schemaVersion: 1;
  kind: 'rasen.archive-plan';
  transactionId: string;
  planHash: string;
  createdAt: string;
  plan: ArchivePlanV2;
}
```

Store it at:

```text
<Rasen global data dir>/archive-transactions/<transactionId>/plan.json
```

This is CLI-owned transaction state and is permitted in the machine root. It
must never be written into the active change because that would change the
source fingerprint. Reserve the transaction directory with an exclusive
`mkdir`, write the envelope through a temporary file, flush the file, rename
within that exclusively owned directory, and flush the directory where the
platform permits it. Return a token only after the envelope is durable.

The opaque token is `archive-v1:<transactionId>:<planHash>`. On load, validate
the strict envelope schema, token transaction id, canonical plan hash, and all
contained-path invariants before using any plan path. A token is a
content-addressed capability, not authentication. Normal filesystem
permissions on the global data directory remain the security boundary.

Do not garbage-collect plan envelopes in this change. A completed transaction
may add a receipt beside the plan, but retaining the plan is required for
diagnosis.

### 2.2 Backward-compatible flags

Keep all existing forms and add:

```text
rasen archive <change> --intent-template --json
rasen archive <change> --dry-run [--save-plan] [--intent-file <path>] --json
rasen archive --apply-plan <token> [--yes] [--json]
```

Rules:

- Existing `rasen archive <change> [existing options]` remains a one-shot
  operation. It builds one plan and passes that exact object to apply; it never
  calls the planner a second time.
- `--save-plan` is valid only with `--dry-run`. A plain dry-run remains
  mutation-free. A saved dry-run has one documented write exception: its
  immutable envelope in the global transaction store.
- `--apply-plan` is mutually exclusive with `<change>`, `--dry-run`,
  `--save-plan`, `--intent-file`, `--intent-template`, and every
  planning-affecting selector/decision flag (`--skip-specs`, `--no-validate`,
  `--store`, `--project`, `--store-path`, `--keep-ephemera`). `--yes` is
  accepted for generated-workflow compatibility but cannot change the plan.
- Applying a token loads once and invokes the engine directly. Do not rerun
  change discovery, target-absence checks, prompts, validation, spec
  preparation, root resolution, or timing gates outside the engine.
- The exact recovery command is another
  `rasen archive --apply-plan <same-token> --yes [--json]`. A recoverable
  result must print this command.
- A token for an incomplete/blocked plan is loadable for reporting but cannot
  mutate.

`--intent-template` is a mutation-free inventory mode. It returns the existing
strict sidecar schema, including `handoff.complete: true`, one
default-`preserved` decision for every inventoried regular handoff file, and
an independently present `probes: []`. The agent may change a decision to
`absorbed`. An empty handoff inventory is still a complete intent.

`--intent-file` accepts the same strict schema as
`.rasen-archive-input.json`. The planner reads and validates it once and
embeds its normalized projection and SHA-256 in the plan; apply never rereads
it. The old in-change sidecar remains supported. If both are present, they must
be byte-identical after canonicalization or planning blocks as ambiguous.
Absent intent retains the approved preserve-all default and an empty probe
list.

### 2.3 Blockers and result shape

Every fact that can prevent archival after CLI parsing is represented by a
typed `ArchiveBlocker` in the plan: source/target state, merge timing,
validation, incomplete tasks, Git facts, planning `treeState`, intent,
handoffs, probes, quality/evidence reads, cleaner classification, and spec
preparation.

A blocked preview still emits the complete plan, but exits nonzero in both
human and JSON modes. A failed or recoverable apply emits its structured
result; it must not collapse to `archive: null`.

The stable JSON concept is:

```ts
type ArchiveCliPayload =
  | { archive: { mode: 'intent-template'; intent: ArchiveIntentV1 } }
  | { archive: { mode: 'plan'; plan: ArchivePlanV2; planToken?: string } }
  | { archive: { mode: 'apply'; result: ArchiveApplyResultV2 } };
```

Exit zero is reserved for a complete preview or successful apply. Blocked,
conflict, recoverable, and failed are nonzero. The engine result remains
available on every nonzero apply path.

## 3. Portable fingerprint and deletion authority

The current content fingerprint is doing two incompatible jobs. Split it.

```ts
interface ArchivePayloadEntry {
  path: string;                 // normalized relative path
  kind: 'directory' | 'file' | 'symlink';
  size?: number;                // files only
  sha256?: string;              // files only
  executable?: boolean;         // files only; POSIX executable semantics
  target?: string;              // symlinks only
}

interface ArchivePayloadFingerprint {
  algorithm: 'sha256';
  entries: ArchivePayloadEntry[];
  digest: string;
}

interface ArchiveObjectIdentity {
  platform: 'posix' | 'win32';
  kind: 'directory' | 'file' | 'symlink';
  dev: string;                  // bigint serialized in decimal
  ino: string;                  // bigint serialized in decimal
  birthtimeNs: string | null;
  ctimeNs: string;
}

interface ArchiveDeletionAuthority {
  root: ArchiveObjectIdentity;
  entries: Array<{
    path: string;
    identity: ArchiveObjectIdentity;
    payload: ArchivePayloadEntry;
  }>;
  payload: ArchivePayloadFingerprint;
}
```

Directory `st_size` and directory mode are excluded from portable payload
identity. The copier does not promise to reproduce them, and neither value is
portable. Directory payload entries contain only path and kind. File content,
size, and the executable bit are reproduced and verified; symlinks reproduce
their target. Object identities are local deletion authority and never
participate in source-versus-stage portability comparisons.

All fingerprints used as authority come from stable reads:

- File: `lstat`, open without following a symlink, `fstat`, read/hash through
  the handle, `fstat` again, then `lstat`; type, identity, size, and guarded
  times must remain stable.
- Symlink: `lstat`, `readlink`, `lstat`; identity and type must remain stable.
- Directory: `lstat`, sorted `readdir`, recursively stable-read children, then
  `lstat`; identity and guarded times must remain stable.

Any instability is a blocker or recoverable conflict, never permission to
delete. Add bigint-capable stat/handle operations to the filesystem adapter.

### 3.1 Source deletion state machine

Never call recursive `rm` on the active change. First reserve a sibling,
transaction-owned quarantine container with exclusive `mkdir`:

```text
<active-parent>/.rasen-archive-source-<transactionId>/payload
```

Transitions:

```text
pending
  -> delete-intent        journal flushed with expected authority/container
  -> container-reserved   exclusive container mkdir; matching journal flushed
  -> claimed              active atomically renamed to container/payload; post-rename
                          stable authority exactly matches the plan
  -> removing             journal flushed
  -> removed              guarded bottom-up unlink/rmdir complete
```

After rename, a mismatch means the wrong occupant was claimed. Restore it to
the active path only with a no-replace operation. If that path has already
been recreated, retain both objects and report conflict. A recreated active
path after a successful claim is never deleted, even if its bytes match.

The `payload` destination is checked absent inside the exclusively owned
container before rename, so rename cannot overwrite an unrelated object.
Removal walks the unique quarantine bottom-up and revalidates each entry's
identity immediately before `unlink`/`rmdir`. Do not use recursive `rm`.
Identity mismatch retains the remainder for recovery. This closes the
same-byte replacement attack from finding 1.

The same claim-and-guard primitive is reused for whole-capability spec
deletion. It is not reused for arbitrary machine-root paths.

## 4. Cross-platform final publication

Node's directory rename cannot supply no-replace semantics on all supported
platforms. Publication therefore uses an exact destination reservation plus a
logical commit marker:

1. Flush `destination-reservation-intent` to the stage journal, including the
   final path and expected payload.
2. Atomically reserve `final` with non-recursive `mkdir(final)`. `EEXIST`
   blocks unless the directory contains a valid v2 journal for this exact
   transaction id and plan hash.
3. Flush a matching journal in the reservation before copying payload. A crash
   between steps 2 and 3 leaves an ambiguous empty reservation; retry retains
   it and reports manual recovery rather than assuming that an unrelated empty
   directory belongs to the transaction.
4. Copy the already verified stage into the reserved final using exclusive
   create primitives. Never overwrite an existing entry. Verify the expected
   final-reserved payload fingerprint.
5. Create `.rasen-archive-published.json` through a same-directory temporary
   file and an atomic no-replace hard-link publication primitive. Flush it and
   its directory. The marker binds transaction id, plan hash, archive path,
   and the final-reserved payload fingerprint.
6. Only a valid marker makes the archive logically published. Until this point
   the active change and every execution-root ephemera candidate remain
   untouched. A directory
   with a journal but no valid marker is a resumable reservation, not an
   unrelated destination and not a completed archive.
7. Apply the journaled cleaner to execution-root candidates, write and verify
   final `archive.json`, and verify the accounting-finalized fingerprint. A
   failure here is the specified post-publication, journal-recoverable state.
8. Claim and remove the active source only after accounting is durable. Remove
   the stage only after the source state is durable. Complete the journal.

If the filesystem cannot implement the no-replace file primitive, fail closed
with a supported-filesystem diagnostic. Never fall back to check-then-rename.
The adapter may implement `publishFileNoReplace` with a same-volume hard link
or a native equivalent; `EEXIST` is always a conflict. Archive readers and
archive listing must ignore or label incomplete reservations rather than
treating them as complete archives.

The marker and journal are engine control files. Exclude them from evidence
payload fingerprints, but validate them separately on every resume. A valid
publication marker proves that the verified staged payload became the final
archive; transaction completion additionally requires verified accounting and
durable source removal.

## 5. Spec compare-and-publish protocol

The engine is the only spec mutation owner. Reserve one exclusive
transaction workspace directory under the spec root; every backup, quarantine,
and temporary target is a child of that owned directory. This prevents rename
from overwriting an attacker-created sibling path. Every prepared action gains
a stable `actionId`, a full portable target fingerprint, target object
identity, and deterministic result bytes/fingerprint.

### Create

1. Flush spec intent to the archive journal.
2. Write and flush a same-directory transaction temp.
3. Publish with `publishFileNoReplace(temp, target)`.
4. Stable-read and verify target; then flush a `complete` result.

An existing target, including one created after planning, is a conflict. It is
never overwritten.

### Update

1. Flush intent with planned target identity/fingerprint, result fingerprint,
   backup path, and temp path.
2. Write and flush the temp.
3. Atomically rename target into the exclusively owned transaction workspace.
4. Stable-read the backup. Only an exact identity and payload match changes
   state to `claimed`.
5. Publish the temp at the now-absent target with no-replace.
6. Stable-read and verify the published result, flush `verified`, then remove
   the matching backup with guarded deletion and flush `complete`.

If the claimed object mismatches, restore it only when the target is absent.
If a concurrent target now exists, retain both and report conflict. A failure
after claim retains or rolls back the backup using the same no-replace rule;
it never overwrites a concurrent target.

### Delete

1. The planned precondition is the full capability directory tree payload and
   authority, not one `spec.md` hash.
2. Flush intent, then atomically rename the capability directory into the
   exclusively owned transaction workspace.
3. Stable-read the quarantine. An exact match changes state to `claimed`;
   mismatch restores no-replace or preserves both on conflict.
4. Guarded bottom-up deletion operates only on the matching quarantine.
5. Flush `complete`.

Create, update, and delete boundary tests must inject a concurrent target
immediately after the last precondition observation and before each claim or
publication syscall.

## 6. Journal v2 and truthful recovery

The journal is an atomic, flushed snapshot with these durable progress
records:

```ts
interface ArchiveJournalV2 {
  schemaVersion: 2;
  transactionId: string;
  planHash: string;
  change: string;
  paths: ArchivePlanV2['paths'];
  phase: ArchiveJournalPhaseV2;
  phaseFingerprints: Record<string, {
    state: 'intent' | 'verified';
    scope: 'stage' | 'final';
    before: ArchivePayloadFingerprint;
    expectedAfter: ArchivePayloadFingerprint;
    observedAfter?: ArchivePayloadFingerprint;
  }>;
  specProgress: Array<{
    actionId: string;
    action: 'create' | 'update' | 'delete';
    target: string;
    backupOrQuarantine: string | null;
    state:
      | 'pending' | 'intent-durable' | 'claimed' | 'published'
      | 'verified' | 'complete' | 'conflict' | 'failed';
    planned: ArchiveDeletionAuthority | { state: 'absent' };
    observed?: ArchivePayloadFingerprint;
    result?: ArchivePayloadFingerprint;
    error?: string;
  }>;
  cleanerProgress: Array<{
    path: string;
    planned: EphemeraCandidateFingerprint;
    state:
      | 'pending' | 'delete-intent' | 'deleted'
      | 'deleted-after-intent' | 'already-absent'
      | 'conflict' | 'failed';
    observed?: ArchivePayloadFingerprint;
    error?: string;
  }>;
  sourceProgress: {
    state:
      | 'pending' | 'delete-intent' | 'claimed'
      | 'removing' | 'removed' | 'conflict' | 'failed';
    quarantine: string;
    planned: ArchiveDeletionAuthority;
    observed?: ArchivePayloadFingerprint;
    error?: string;
  };
  updatedAt: string;
  failure?: ArchiveFailure;
}
```

The precise cleaner rule is:

```text
pending -> delete-intent (flush) -> guarded unlink/rmdir -> deleted (flush)
```

On resume from `delete-intent`:

- exact planned object exists: retry the guarded delete;
- it is absent: record `deleted-after-intent`, count it as discarded because
  durable authority preceded the absence, and preserve that audit distinction
  in the result;
- a different object exists: record conflict and do not delete;
- another error: record failed.

`already-absent` is only for absence observed before any delete intent and is
not counted as an engine deletion.

Spec totals are derived exclusively from `specProgress.state === 'complete'`.
`specsUpdated` means at least one completed action. A later conflict or failure
does not erase completed counts. Recoverable results include the full
per-action and cleaner progress summaries.

No external mutation occurs before its corresponding intent snapshot is
flushed. Fault injection must exist immediately before and after every
filesystem mutation and every journal flush.

## 7. Transformed phase fingerprints

A phase name is never sufficient evidence to skip work. Each transform has a
durable `before`, deterministic `expectedAfter`, and stable-read
`observedAfter`.

Required phases:

| Phase | Scope | Expected fingerprint source |
|---|---|---|
| `source-planned` | active | portable payload plus deletion authority in plan |
| `payload-copied` | stage | source portable payload |
| `handoff-finalized` | stage | pure projection of source payload and frozen handoff decisions |
| `evidence-finalized` | stage | previous phase plus frozen ship-log bytes, quality inputs, and `.openspec.yaml` outputs |
| `final-reserved` | final | verified evidence-finalized payload |
| `published` | final | valid commit marker binding the final-reserved digest |
| `accounting-finalized` | final | published payload plus exact `archive.json` bytes; control files excluded |

The plan must contain deterministic transformed output bytes or hashes for
handoff, ship-log, and quality capture. Accounting is the exception because
its exact bytes include actual durable cleaner/spec outcomes: compute those
bytes after the relevant outcomes, then flush an accounting intent containing
the exact bytes and expected fingerprint before writing `archive.json`.

Resume behavior for an intent without a result is exact:

- current equals `before`: retry the idempotent transform;
- current equals `expectedAfter`: the mutation won the crash race, so record a
  verified result without repeating it;
- anything else: conflict and no further mutation.

For a verified phase, recompute and compare `observedAfter` on every resume.
Corruption of stage or reserved final blocks recovery even when the journal
claims the phase completed.

## 8. Generated consumer adapter

Remove every generated call to `rasen-sync-specs`. `--skip-specs` freezes the
no-sync decision in the plan; absence of that flag means the archive engine
prepares and owns spec actions.

All single archive, bulk archive, and in-ship templates must use this same
executable sequence:

1. Run `rasen archive <change> --intent-template --json`.
2. Judge every handoff inventory entry. Write a complete intent even for an
   empty inventory. Add probes independently; a probe-only intent is valid.
3. Run
   `rasen archive <change> --intent-file <path> --dry-run --save-plan --json`
   with the selected planning flags.
4. Require a complete plan and capture its exact token. A nonzero preview is
   a blocker and its plan is retained as evidence.
5. Run `rasen archive --apply-plan <token> --yes --json`.
6. On recoverable status, rerun step 5 with the same token. Never regenerate
   intent, resync specs, or replan during recovery.

The intent file is execution-root ephemera or another explicitly supplied
path. The CLI, not the generated workflow, copies its normalized facts into
the global transaction envelope. The workflow must not write directly to the
machine-root transaction store.

Bulk creates one token per change, applies each token independently, and
retains structured failures while continuing according to its existing bulk
policy. Ship finalizes code/evidence inputs before step 3 and changes only its
wording from “archive commit” to “code commit”.

Template tests that merely label a direct `ArchiveCommand` invocation as a
consumer are insufficient. The integration harness must execute the real
Commander argv emitted by each generated workflow, including intent
inventory, saved token, and token apply.

## 9. Finding-to-change map

| Finding | Required implementation |
|---|---|
| 1 | Stable reads, filesystem deletion authority, source claim/quarantine, no recursive active deletion |
| 2 | Exact final `mkdir` reservation plus no-replace logical commit marker |
| 3 | Exclusive create; claim/verify/publish update; full-tree claim/verify delete |
| 4 | Per-candidate cleaner intent before syscall and result after syscall |
| 5 | Per-spec progress; totals derived from completed actions on every result |
| 6 | Before/expected/observed transformed fingerprints; resume always rehashes |
| 7 | Portable payload schema excludes directory mode and `st_size` |
| 8 | Planning `treeState` is bound in plan hash and revalidated by apply |
| 9 | Ship-log append preserves every pre-existing byte, including trailing whitespace |
| 10 | `--save-plan`, opaque token, `--apply-plan`, same-token resume |
| 11 | Delete generated sync calls; engine is sole spec owner; freeze `--skip-specs` |
| 12 | All gates become plan blockers; nonzero blocked preview; structured failure/recovery JSON |
| 13 | Complete intent/probe flow and real CLI integration for all generated consumers |
| 14 | Generated bulk wording says code commit |

For finding 8, apply recomputes the current planning `treeState` with the same
clean/dirty definition and compares it with the saved value before the first
mutation and on resume. Once a transaction owns a stage/final journal,
engine-created transaction paths are excluded so the engine does not
self-invalidate. This finding binds and revalidates the specified clean/dirty
fact; it does not introduce a new path-by-path Git status digest.

For finding 9, ship-log finalization is byte-oriented: retain the entire source
buffer and append the canonical suffix, adding a separator newline only when
the source does not already end with one. Do not trim.

## 10. Exact test matrix

Put primitive/state-machine tests in `test/core/archive-engine.test.ts` and
`test/core/archive-fault-matrix.test.ts`; CLI/result tests in
`test/core/archive.test.ts`; real consumer tests in
`test/core/archive-consumer-integration.test.ts`; generated-text assertions in
`test/core/templates/archive-engine-consumers.test.ts`.

Required cases:

1. Replace active root with a same-byte directory after plan and immediately
   before source claim. Apply conflicts and leaves the replacement.
2. Replace a same-byte child after source claim and before unlink. Guarded
   deletion stops and retains quarantine.
3. Create final immediately before reservation. `mkdir` returns conflict and
   preserves it on Linux, macOS, and Windows.
4. Crash after reservation intent, immediately after `mkdir(final)`, during
   copy, after marker, after accounting, and after source claim. Same-token
   retry either completes or reports the exact retained/ambiguous conflict; it
   never replans. No pre-publication crash deletes ephemera.
5. Corrupt stage and final after every journaled phase. Resume rehashes and
   conflicts rather than skipping.
6. Spec create race after plan and before publication preserves the concurrent
   target.
7. Spec update race before claim, after claim, and before publication preserves
   every concurrent target and the claimed backup.
8. Spec delete swaps any file in the capability tree immediately before and
   after directory claim. Mismatch restores or preserves quarantine; it is
   never recursively deleted.
9. Inject a fault after spec action N completes. Result reports N's exact
   counts and retry starts at N+1.
10. For each cleaner candidate, fault before intent flush, after intent flush,
    after unlink, and after result flush. Verify `deleted-after-intent` versus
    `already-absent` accounting.
11. Directory payload equality succeeds after copy for POSIX mode `0711`,
    unusual allocation/history, and the Windows implementation because
    directory mode/size are absent from the payload digest.
12. File executable-bit and symlink-target changes still fail verification.
13. Saved plan round-trip validates canonical hash; one-byte tampering,
    transaction-id mismatch, plan-hash mismatch, and path escape block before
    mutation.
14. `--apply-plan` does not call planning probes. Spy on validation, prompt,
    spec preparation, final precheck, and root resolution.
15. Pure dry-run writes nothing. `--dry-run --save-plan` writes only its global
    envelope and returns a token. Applying the token uses that exact plan hash.
16. Blocked human and JSON previews exit nonzero and retain a full plan.
    Recoverable JSON retains the full result/progress and retry command.
17. Planning tree state transitions (`clean -> dirty` and `dirty -> clean`)
    block apply; engine-owned journal/stage changes do not self-invalidate.
18. A ship log ending in spaces, tabs, multiple newlines, and no newline
    preserves its exact prefix bytes.
19. Single, every bulk item, and in-ship execute real CLI argv:
    intent-template -> complete intent -> saved preview -> token apply.
20. Consumer fixtures include no handoff, multiple handoffs, probe-only,
    multiple probes, absent intent preserve-all, sync, and skip-specs. The
    direct, single, bulk, and ship paths produce equivalent plan facts and
    accounting for equivalent inputs.
21. Generated workflow sources contain no `rasen-sync-specs`, no second plain
    `rasen archive <change> --yes` after preview, and no “archive commit”
    wording.
22. A v1 destructive/incomplete journal fails closed and names manual recovery
    paths; no v2 state is inferred.

Run the native matrix on Windows plus a POSIX CI runner. Cross-platform
publication and identity tests must use the real filesystem in addition to
fault-injected adapters.

## 11. Implementation order and ownership

Implement in this dependency order:

1. Portable payload/identity schemas, stable reader, guarded delete, and
   no-replace publication primitives.
2. Plan v2 canonical hashing, global plan store, token parser, and CLI modes.
3. Journal v2 writer and phase/spec/cleaner/source state machines.
4. Final reservation/marker publication and source claim deletion.
5. Spec claim/publish/delete protocol and truthful aggregation.
6. Move all pre-gates into planning and preserve structured CLI results.
7. Convert generated consumers to the intent/save/apply adapter and remove
   external sync.
8. Add the fault/native/consumer matrices above, then update artifact task
   evidence.

The narrow primitive boundaries worth exposing for tests are
`stableFingerprintTree`, `claimTreeForDeletion`,
`removeClaimedTreeGuarded`, `publishFileNoReplace`,
`reserveArchiveDestination`, `writeJournalSnapshot`, and
`loadStoredArchivePlan`. Higher-level policy remains inside
`ArchiveTransaction`.

Completion means all 14 review findings have a passing regression, every
destructive transition is preceded by a durable intent, every resume validates
current bytes/identity instead of trusting a phase label, and all generated
paths consume the exact plan they previewed.

## 12. Closure compatibility remediation (2026-07-31)

Closure partition 6 exposed a package-compatibility regression at the direct
one-shot `ArchiveCommand.execute` adapter. The engine contract above remains
authoritative, but section 2.3 requires this compatibility qualification:

- A failed or recoverable **apply** continues to return the complete structured
  engine result.
- A direct, non-dry-run `archive <change> --json` that is blocked by one of the
  established 0.1.6 pre-apply failures continues to return `archive: null` and
  the exact legacy diagnostic code/message/fix. The immutable blocked plan is
  now included as an additive top-level `plan`, so no blocker is lost.
- The preserved legacy projections are `archive_change_not_found`,
  `archive_validation_failed`, `archive_spec_validation_failed`,
  `archive_spec_update_failed`, and `archive_tasks_incomplete`. Their original
  precedence is retained; for example, incomplete tasks win over the later
  spec-confirmation gate.
- A newly introduced engine-only blocker with no legacy projection returns the
  populated blocked archive/plan result and generic `archive_plan_blocked`
  status. It is never collapsed to `archive: null`.
- The direct adapter returns before `applyArchive` whenever `plan.complete` is
  false or the plan has blockers. Dry-run, saved-plan, apply-plan, human, and
  `--yes` behavior are unchanged.

The implementation preserves the exact spec-preparation diagnostic before the
planner sorts blockers. It does not infer a legacy diagnostic from the first
sorted blocker. The command tests assert the additive plan, all exact legacy
diagnostics, original precedence, and zero stage/journal/target/spec/source
mutation. A direct unit seam additionally counts apply calls for a malformed
sidecar blocker and proves the count remains zero while the complete structured
blocker result is returned. Independent review then identified that generic
`timing` and `target-lstat` blockers could still inherit legacy status codes.
The adapter now recognizes merge confirmation only from the exact PR timing
blocker plus its matching plan facts, recognizes an occupied target only from
`target-lstat` with `EEXIST`, and leaves other engine-only inspection failures
generic. An injected `target-lstat` `EACCES` regression proves this path also
returns the structured plan with zero apply calls.

Verification on Windows:

- `pnpm exec vitest run test/commands/store-root-selection.test.ts test/core/archive.test.ts --maxWorkers=1 --minWorkers=1 -t "archive --json is non-interactive|returns an engine-only blocked plan without calling archive apply"`
  - superseded by the final targeted form using
    `-t "archive --json is non-interactive|engine-only.*without"`: exit 0;
    2 files passed; 9 tests passed; 76 filtered/skipped.
- `pnpm exec vitest run test/core/archive.test.ts --maxWorkers=1 --minWorkers=1`
  - exit 0 in 39.21s; 1 file passed; 51 tests passed.
- Explicit archive behavior group (archive command, engine, consumer
  integration, fault matrix, path semantics, accounting, ephemera, and engine
  consumer templates), one worker
  - exit 0 in 112.19s; 8 files passed; 134 tests passed; 1 POSIX-only test
    skipped on Windows.
- `pnpm exec tsc --noEmit`, `pnpm run lint`, and `pnpm run build`
  - all exit 0.
- `node dist/cli/index.js validate file-placement-hardening-archive-engine --strict --json`
  - exit 0; 1 change passed; 0 issues.
- Independent re-review after the status-provenance remediation
  - `CLEAN`; no files edited and no P6/full partition run by the reviewer.

The broader nine-file archive-group attempt also included
`skill-templates-parity.test.ts`; its only failures were the two already-drifted
closure-owned ship-template hashes (`getShipCommandSkillTemplate` and
`rasen-ship`). Per closure ownership, this remediation does not update those
goldens. It also does not check task 7.6: remote native macOS/Linux/Windows CI
acceptance remains closure/delivery-owned.

## 13. Closure P8 static-guard parity remediation (2026-07-31)

Closure partition 8 exposed one false-positive in
`test/core/windows-hide-guard.test.ts`. The source scanner correctly guards
standalone child-process calls named `exec`, but it also matched the method
signature `exec(root: string, args: string[]): Promise<string>` in the
`ArchiveGitAdapter` interface as though it were a runtime call. This is
archive-engine-owned type syntax meeting a closure-derived whole-source guard;
it is not a missing runtime launch option.

The narrow repair changes only that interface member to the semantically
equivalent function-property form:

```ts
exec: (root: string, args: string[]) => Promise<string>;
```

The runtime adapter remains unchanged: its real
`execFileAsync('git', ['-C', root, ...args], { windowsHide: true })` call still
passes `windowsHide: true`. The guard implementation, its child-process name
set, and its sole interactive-editor allowlist are also unchanged.

Verification on Windows, without rerunning closure partition 8:

- `pnpm exec vitest run test/core/windows-hide-guard.test.ts --maxWorkers=1 --minWorkers=1`
  - exit 0; 1 file and 6/6 tests passed.
- `pnpm exec vitest run test/core/archive-engine.test.ts --maxWorkers=1 --minWorkers=1`
  - exit 0; 1 file; 20 tests passed and 1 POSIX-only test skipped.
- `pnpm exec tsc --noEmit --pretty false`
  - exit 0.
- `pnpm run lint`
  - exit 0.

The initial P8 nonzero report remains closure evidence. These focused checks
close only the diagnosed false-positive; they do not relabel P8 or the complete
partition aggregate as passing before an authorized locked rerun.
