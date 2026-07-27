# Tasks: pr88-rf-authority — Store record is the sole Session-eligibility authority

Scope: M6 only. Edit `src/core/management-api/session-launch-context.ts`,
the two named specs, and `test/core/management-api/session-launch-context.test.ts`.
Do NOT touch C1/C2/C3/C4 files (bootstrap.ts, project-config.ts, file-state.ts,
import.ts, membership.ts, project-records.ts, run-state.ts, init.ts,
pipeline.ts, portfolio-state.ts, catalog.ts, project-knowledge-home.ts,
knowledge-bundle/*, registry.ts operations, foundation.ts).

## 1. Eligibility-rule change in `session-launch-context.ts`

### 1.1 Narrow `storePermitsProject` to the Store-record authority

File: `src/core/management-api/session-launch-context.ts:93-108`.

- Remove the declaration arm (lines 102-107: `readStorePointer`,
  `hasStoreDeclaration`, `storeBindingDeclarationFrom`,
  `resolveStoreBinding`, `rootsEqual`).
- The function returns `true` iff `resolveProjectMembership` returns a
  non-null membership; otherwise `false`.
- Keep the function's doc-comment but rewrite the body comment so the
  "two-authority" framing is gone. The new comment states: the Store record
  is the sole authority; the project declaration is a locator and may shape
  diagnostics only, never grant eligibility.

### 1.2 Classify the rejection in the caller for the diagnostic

File: `src/core/management-api/session-launch-context.ts:276-283` (the
`storePermitsProject` failure branch inside the Store + `project:<x>` arm).

When `storePermitsProject` returns `false`, the caller re-runs the
declaration resolution that the old arm used to do, **only to classify the
failure**:

- Read `readStorePointer(checkoutRoot)`; if `pointer.malformed !== undefined`
  the malformed-pointer branch at lines 267-274 already handled it — we are
  past that point.
- If `hasStoreDeclaration(pointer)`, call `resolveStoreBinding` with
  `storeBindingDeclarationFrom(pointer)`; if `binding?.kind === 'resolved'`
  and `rootsEqual(binding.store.root, resolvedSpace.space.root)`, the
  declaration WOULD have vouched under the old rule — emit the
  legacy-migration diagnostic shape:
  - `code`: keep `'execution_not_member'` (existing code; no new enum value
    needed for the wire protocol).
  - `message`: include the projectId, the storeId, an explicit statement
    that "the project's own declaration names this Store, but the Store has
    no membership record for it", and the copy-pasteable repair command
    `rasen store add-project <projectId> --store <storeId>`.
  - Optional but recommended: add a `diagnostic` field (or extend `message`
    with a stable substring) so a test can detect the legacy-migration
    marker without parsing free-text. The simplest approach is a stable
    substring in `message` (e.g., `"legacy declaration-only install"`)
    that the test asserts on — keeps the wire shape unchanged.
- Otherwise (declaration absent, malformed and skipped past, or resolves to
  a different Store), emit the standard missing-record diagnostic with the
  same `rasen store add-project` command and a one-line note that the
  project's declaration does not name this Store.

Keep the existing repair-command shape (matches the spec requirement in
`store-project-membership` "Membership diagnostics are read-only and name
the repair").

### 1.3 Imports

`readStorePointer`, `hasStoreDeclaration`, `storeBindingDeclarationFrom`,
`resolveStoreBinding`, `rootsEqual` all stay imported — they are now used
ONLY by the diagnostic classifier in 1.2. Do not remove any import that
1.2 still needs. (Currently `storeBindingDeclarationFrom` is imported from
`../effective-config.js`, `readStorePointer` and `hasStoreDeclaration`
from `../project-config.js`, `resolveStoreBinding` from
`../store/identity.js`, and `rootsEqual` is local.)

## 2. Spec edits

### 2.1 `session-runtime-context` MODIFIED

Delta file: `rasen/changes/pr88-rf-authority/specs/session-runtime-context/spec.md`
(already authored by planner).

The implementer MUST verify, before stage entry, that the canonical
requirement title "Choosing a project to work on in a Store session is
validated before the session starts" still matches
`rasen/specs/session-runtime-context/spec.md` verbatim. If PR #88 has
shifted its line number, the title is what matters — line drift alone is
not a defect.

### 2.2 `store-project-membership` MODIFIED

Delta file: `rasen/changes/pr88-rf-authority/specs/store-project-membership/spec.md`
(already authored by planner).

Same title-match check against
`rasen/specs/store-project-membership/spec.md:8` ("A Store records each
member project in its own file, keyed by project identity").

### 2.3 Collision check vs C2

The implementer MUST re-confirm that C2's delta at
`rasen/changes/pr88-rf-locks/specs/store-project-membership/spec.md`
modifies ONLY:
- "Adding membership writes each repository in a defined order and reports what still needs repair"
- "A project carries portable locator hints for the Stores it belongs to"

If C2's delta has grown new MODIFIED titles in the same capability since
this plan was written, the implementer MUST stop and escalate — the
archive-time sync would otherwise collide.

## 3. Tests

File: `test/core/management-api/session-launch-context.test.ts`. No other
test file is in scope.

### 3.1 Flip the "declaration alone vouches" tests to rejection shape

Both tests below currently expect `ok: true` because they exercise the
OR-arm that this change removes. They MUST be renamed and rewritten to
assert the new rejection diagnostic. Renaming is mandatory because the old
names assert the OPPOSITE behavior and would otherwise read as a
regression once the new titles meet the new bodies.

#### 3.1.1 `accepts a project with no membership record whose own declaration names this Store` (line 334)

Rename to: `rejects a project whose declaration names this Store but has no membership record, with a migration repair`.

- Set up the same fixture (declaration present, no Store record).
- Pre-check that `getStoreProjectRecordPath(storeRoot, 'declared-member-id')`
  does NOT exist (already in the existing test, keep it — it documents that
  the rejection is not silently minting a record).
- Assert `ok: false`, `status: 409`, `code: 'execution_not_member'`.
- Assert `message` contains BOTH:
  - the legacy-migration marker (e.g., `legacy declaration-only install`),
    AND
  - the repair command `rasen store add-project declared-member-id --store declared-store`.
- Post-check that the rejection did NOT write a Store record (the seam is
  still read-only).

#### 3.1.2 `accepts a uid-only durable declaration, which a display-name comparison would have missed` (line 375)

Rename to: `rejects a uid-only durable declaration when the Store record is missing, with a migration repair`.

- Set up the same fixture (durable declaration minted via
  `upgradeStoreIdentity`, no Store record).
- Drop the "display-name comparison would have missed" framing from the
  test rationale comment — that comparison no longer happens. Replace with
  a comment noting this was the OR-arm shape pre-0.1.5 and is now the
  legacy-migration rejection shape.
- Assert `ok: false`, `status: 409`, `code: 'execution_not_member'`.
- Assert `message` contains the legacy-migration marker and the repair
  command naming the durable-member-id and durable-store.

### 3.2 Add a legacy-migration classification test

Add a new test: `the rejection distinguishes a declaration pointing here from one pointing elsewhere`.

- Set up two Store-scoped sessions against the same project:
  - Session A: the project's declaration resolves to THIS Store (no record).
    Expect the legacy-migration marker in the message.
  - Session B: the project's declaration resolves to a DIFFERENT Store (no
    record in either). Expect the plain missing-record message WITHOUT the
    legacy-migration marker, and with the "declaration does not name this
    Store" clarification.
- The two `message` strings MUST differ in a way the test asserts on
  (marker substring present in A, absent in B).

### 3.3 Add a both-sides-present happy-path test

Add a new test: `accepts a project whose Store record and declaration both agree on this Store`.

- Write the Store record (`writeStoreProjectRecord`) AND leave the
  declaration pointing at the same Store. This is the post-migration shape
  and is what the previous OR-arm tests collapse into once the record
  exists.
- Assert `ok: true` with the expected `planningSpace` and `execution`
  fields.

### 3.4 Leave the existing rejection tests intact

- Line 277 `rejects a project neither the Store record nor its own declaration vouches for` — keep as-is; the behavior is unchanged. The pre-comment "membership is decided by the Store's own record, with the project's durable Store declaration as the second authority" is now WRONG — rewrite it to: "membership is decided by the Store's own record alone; the project's declaration is a locator and does not vouch."
- Line 303 `rejects a project whose declaration names an unusable Store and which has no membership record` — keep as-is; behavior is unchanged (still rejected). The comment on this block does not need editing (it does not assert the two-authority framing).
- Line 420 `accepts a project whose own planning Store is a DIFFERENT Store when the Store records it` — keep as-is. This is now the canonical happy-path test (record-driven).

### 3.5 Test-running instructions

Run only this file in the implementer and fixer stages:

```
pnpm vitest run test/core/management-api/session-launch-context.test.ts
```

This is a focused vitest run; the full `pnpm test` is reserved for the C6
evidence child. The expected pre-fix state is that 3.1.1 and 3.1.2 (under
their new names) FAIL because the OR-arm still grants. The expected
post-fix state is all tests in this file pass.

## 4. Out of scope (do NOT do)

- Do NOT add a new `code` enum value to the wire protocol. The
  legacy-migration marker is a stable substring inside `message`, not a
  new error code. A new code would touch wire-types and ripple into UI
  consumers — outside M6.
- Do NOT auto-migrate the declaration at launch time. The whole point of
  removing the OR-arm is to stop silent grants; auto-conversion would
  re-create the same problem under a different name.
- Do NOT modify `resolveProjectMembership`, `applyMembershipMutation`,
  `rasen doctor`, or any other membership-provider surface. They already
  do the right thing; the defect was only ever in `session-launch-context.ts`.
- Do NOT touch `rasen doctor` tests or any test outside the file named in
  section 3.
- Do NOT touch the `listProjectStoreCandidates` / "eligible Stores"
  direction. That is the project → store discovery direction (a different
  question) and is explicitly out of scope per the proposal.

## 5. Order of operations

1. Read the canonical spec titles in `rasen/specs/session-runtime-context/spec.md`
   and `rasen/specs/store-project-membership/spec.md` and confirm they
   match the delta titles verbatim.
2. Re-confirm C2's two MODIFIED titles in
   `rasen/changes/pr88-rf-locks/specs/store-project-membership/spec.md`
   have not grown.
3. Edit `session-launch-context.ts` per tasks 1.1, 1.2, 1.3.
4. Edit the test file per tasks 3.1, 3.2, 3.3, 3.4.
5. Run `pnpm vitest run test/core/management-api/session-launch-context.test.ts`.
   Expect green.
6. Run `pnpm build` (TypeScript). Expect green — no type changes expected
   beyond possibly narrowing `result.message` shape in the rejection
   branch.
7. STOP. Do NOT run the full `pnpm test` suite (that is C6's job). Do NOT
   touch any file outside the scope list.
