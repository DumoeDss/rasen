# DEBUG REPORT: registered Project membership retry

## Outcome

The repeated browser failure is caused by a stale daemon runtime, not by the
current source fix, the browser payload, the real registry data, or linked
worktree resolution.

The process serving `http://127.0.0.1:42544` is running runtime
`0.2.0-3b56668819b8e912375dca6ce11c3caa73480029a4f47feb10563c19149fd6ae`,
not the rebuilt runtime fingerprint
`7ad55647af7975d773950acb3e6eb1f17ef302c3800e3b2f811f20f52227921a`.
Its bundled `dist/core/store/operations.js` predates the registered-Project
identity fallback. It therefore validates the Project directory basename
`rasen-2.0-test` as a Store id and rejects the dot. The current worktree's
`dist` uses the registered UUID and succeeds twice against the same isolated
registry/state.

Status: **DONE (investigation-only; no fix applied by mandate)**

## Exact symptom

- operation: `add-project-to-store`
- Project: `8943c3a4-9b59-401a-aea2-4d72b45e98b8`
- Store: `qa-issue-onboarding-20260830-2337`
- response: HTTP `422`, code `cli_error`
- message: `Store id must be kebab-case with lowercase letters, numbers, and single hyphen separators`

## Red-capable feedback loops

### Browser-origin loop (the original boundary)

Mechanism: use the existing CDP proxy on port 3456 to open one disposable tab
at `http://127.0.0.1:42544/`, then evaluate this same-origin expression twice:

```js
await fetch('/api/v1/spaces', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    op: 'add-project-to-store',
    projectId: '8943c3a4-9b59-401a-aea2-4d72b45e98b8',
    storeId: 'qa-issue-onboarding-20260830-2337'
  })
})
```

The PowerShell wrapper asserts status/code/message and intentionally exits
non-zero with `RED` when the exact symptom is present. Only the sanitized
operation, Project, Store, status, code, and message are emitted. Results:

| Run | Status | Code | Exact message |
|---:|---:|---|---|
| 1 | 422 | `cli_error` | yes |
| 2 | 422 | `cli_error` | yes |

This loop is deterministic, unattended, uses the real browser session and
daemon, and takes about 10 seconds for two requests.

### Minimized loop (same daemon CLI and isolated machine home)

The minimized loop removes HTTP, UI, and browser state. Its wrapper:

1. locates the one Store registry containing the target Store without printing
   its path;
2. sets `RASEN_HOME` to that registry's data root (sanitized tag
   `d5ddf3827b37`);
3. reads only the target Project entry;
4. obtains the running daemon's CLI entry from its PID without printing the
   command line; and
5. invokes the exact old CLI twice:

```text
node <running-daemon-cli> store add-project <target-project-root> \
  --to qa-issue-onboarding-20260830-2337 --dry-run --json
```

Sanitized results:

| Run | Exit | CLI diagnostic | Exact message |
|---:|---:|---|---|
| 1 | 1 | `invalid_store_id` | yes |
| 2 | 1 | `invalid_store_id` | yes |

This is the smallest real-state reproduction: the three load-bearing inputs
are the daemon CLI bundle, the target Project root from the matched registry,
and the target Store selector. `--dry-run` proves no repository mutation is
needed to trigger the failure. Removing the old daemon bundle (using current
`dist` instead) makes the same invocation green; using another machine home
makes it fail earlier with `store_add_project_target_not_found` instead of the
reported symptom.

## Real registry evidence (sanitized)

Only the selected Project and Store were inspected. This report records no
other registry entries, tokens, environment contents, cookies, or full paths.

| Field | Project | Store |
|---|---|---|
| type | `project` | `store` |
| id | `8943c3a4-9b59-401a-aea2-4d72b45e98b8` | `qa-issue-onboarding-20260830-2337` |
| name | `rasen-2-0-test` | `qa-issue-onboarding-20260830-2337` |
| root basename | `rasen-2.0-test` | `qa-issue-onboarding-20260830-2337` |
| mode | `in-repo` | `store` |
| id satisfies Store-id grammar | yes | yes |
| id satisfies Project-id grammar | yes | yes |
| name satisfies both grammars | yes | yes |
| root basename satisfies either grammar | **no** | yes |

The Project root is not a Git repository, so linked-worktree piercing is not
active in this case. With the matched machine home, the current
`findAdoptableProjectIdentity` returns `adoptable: true` and candidate
`8943c3a4-9b59-401a-aea2-4d72b45e98b8`; its registration root is unchanged.

## `validateStoreId` trace and actual candidates

### Management boundary

`src/core/management-api/create-space.ts:222,296-304` deliberately validates
membership selectors only as bounded, non-control-character strings. It does
not apply `validateStoreId` to `projectId`. It resolves the catalog entries and
constructs this CLI argv at `src/core/management-api/create-space.ts:385-427`:

```text
store add-project <resolved Project root> --to qa-issue-onboarding-20260830-2337 --json
```

The spawned CLI is the daemon package's own `dist/cli/index.js`
(`src/core/management-api/create-space.ts:46-64,533`), which is why a stale
daemon retains stale command behavior even after a different runtime is built.

### Reached call in the stale daemon

The stale daemon bundle contains:

- `dist/core/store/operations.js:188` —
  `validateStoreId(path.basename(storeRoot))`;
- `dist/core/store/operations.js:641-643` — metadata absent, no explicit
  `--as`, then
  `existingMetadata?.id ?? explicitId ?? inferStoreIdFromPath(projectRoot)`.

Actual reached candidate: **`rasen-2.0-test`**. It fails the shared kebab regex
because of `.`. Execution stops here, before target-Store resolution or
registration.

### Calls not reached in the stale failing run

- the explicit `--as` call at stale bundle line 642 has candidate
  `undefined`, so `validateStoreId` is not called there;
- target resolution would call `validateStoreSelector` and then
  `validateStoreId('qa-issue-onboarding-20260830-2337')`; the candidate is
  valid, but this point is never reached;
- later registration validators are also unreachable after the basename
  exception.

### Current worktree path

The current code adds `resolveAddProjectDisplayId` at
`src/core/store/operations.ts:598-621`. For the same state it calls
`findAdoptableProjectIdentity` (`:606`), obtains the registered Project UUID,
normalizes it, and validates candidate
`8943c3a4-9b59-401a-aea2-4d72b45e98b8` at `:608` (passes). The target Store
selector later reaches `validateStoreSelector` at
`src/core/store/operations.ts:1624` with
`qa-issue-onboarding-20260830-2337` (passes). The resolved UUID is threaded to
registration at `src/core/store/operations.ts:1221-1226,1300` (passes the
registration's repeated Store-id grammar checks because canonical lowercase
UUIDs are also legal kebab ids).

## Ranked, falsifiable hypotheses and results

1. **Running daemon/CLI bundle is stale.** Prediction: the daemon process will
   point at a runtime other than fingerprint `7ad556...`, lack
   `resolveAddProjectDisplayId`, and the current `dist` will succeed against
   the identical home. **Confirmed.** Runtime id is `0.2.0-3b566...`; process
   start was `2026-08-30T14:03:54.8345702Z`, while current
   `dist/core/store/operations.js` was written at
   `2026-08-30T16:45:11.8000250Z`. The daemon operations hash is
   `044c9d898cce76552a07f836817e66e6dcb825da8ea6034b50ab67fa1b3f69d4`;
   current is
   `a1352f9c470624252b4fc14cb528b51222735f400ca1b744a242167051f3ef3f`.
   The old bundle lacks the resolver and contains the direct basename
   fallback; the current bundle has the resolver. Current `dist` succeeds
   twice with `--dry-run` against machine-home tag `d5ddf3827b37`.

2. **Daemon and current CLI select different registry homes.** Prediction:
   forcing current `dist` onto the daemon's exact home will fail to find the
   Project or Store. **Falsified.** The target Project registry entry and
   target Store are both present in home tag `d5ddf3827b37`; current `dist`
   succeeds twice there. A deliberately wrong home produces a different,
   earlier `store_add_project_target_not_found`, proving the home is
   load-bearing and the matched-home test is discriminating.

3. **Linked-worktree/canonical-root resolution prevents registry adoption.**
   Prediction: the current identity resolver will report unregistered or a
   different registration root. **Falsified.** The real root is not a Git
   repository (therefore not a linked worktree), registration root is
   unchanged, and the resolver returns the exact registered UUID.

4. **Store namespace and Project namespace validators reject the real UUID.**
   Prediction: the registered UUID will fail `validateStoreId` or Project-id
   parsing. **Falsified.** The UUID passes both; the Store id passes both. The
   only rejected value is the directory basename `rasen-2.0-test`. There is a
   semantic naming smell in using Store-id validation for a Project display
   id, but it is not causal for this UUID case.

5. **Focused fixtures do not match the real Project shape.** Prediction: an
   integration fixture with a registered UUID and `rasen-2.0-test` basename
   will fail current `dist`. **Falsified.** The focused command test and the
   real-CLI management integration test use that shape and both pass. Their
   divergence from browser QA is the CLI artifact selected, not the fixture.

## Focused verification and regression seam

Command run:

```text
pnpm exec vitest run test/commands/store-add-project.test.ts \
  test/core/management-api/create-space.integration.test.ts \
  -t "reuses the registered Project identity|establishes and replays real membership"
```

Result: 2 test files passed; 2 selected tests passed; 19 skipped.

The exact product regression seams are:

- `test/commands/store-add-project.test.ts:85-109` — registered UUID plus a
  non-kebab root basename; this goes red against the old fallback;
- `test/core/management-api/create-space.integration.test.ts:17,85-138` —
  `createSpaceCreator` spawning this worktree's real `dist/cli/index.js`, two
  idempotent membership requests, UUID metadata assertion, and unchanged
  planning pointer. This also goes red against the old bundle.

These tests correctly lock down the source fix. They cannot detect a separate,
already-running daemon from an older cached runtime. The missing operational
seam is a release-harness test/preflight that starts (or reuses) a daemon only
when its runtime id equals the requested content fingerprint, then performs
the browser-origin POST. That check would have gone red immediately here:
requested `7ad556...`, serving `3b566...`.

## Confirmed root cause

The rebuild produced a new runtime, but the server at port 42544 was not
replaced. The process predates the new `dist` by roughly 2 hours 41 minutes and
its command does not reference this worktree. `createSpaceCreator` correctly
spawns the CLI beside the running server package, so every retry deterministically
executes the old fallback and validates `rasen-2.0-test`.

This explains all observations at once:

- browser payload is correct;
- real registry entry is correct;
- current focused tests pass;
- current CLI passes on the same real state;
- the browser-connected daemon still returns the pre-fix error.

## Smallest recommended fix

No further product-code change is required for the observed repeated failure.
Retire the daemon/runtime `0.2.0-3b566...`, start the daemon from the rebuilt
`0.2.0-7ad556...` runtime while preserving the same isolated machine home,
then rerun the two-request browser-origin red loop. Before declaring green,
assert the serving process's runtime id equals the requested fingerprint; a
build fingerprint alone is insufficient evidence that the bound port was
restarted.

Do not alter registry data, invent `--as`, rename the Project folder, or loosen
the kebab grammar. Those would mask the stale-runtime problem or change user
state.

## Affected-area allowlist for a subsequent fixer

Required operational scope:

- the local/release harness daemon lifecycle that maps a content fingerprint
  to the process bound to the QA port (stop/restart or refuse stale reuse);
- its focused lifecycle/preflight test asserting requested fingerprint equals
  serving runtime id;
- browser verification evidence after restart.

Product files to preserve, not rework:

- `src/core/store/operations.ts`;
- `test/commands/store-add-project.test.ts`;
- `test/core/management-api/create-space.integration.test.ts`.

If preventing stale reuse requires an in-repository protocol addition, declare
that scope expansion before editing; likely candidates are the management
server identity/status surface and its tests. It is not needed for the
immediate operational fix.

## Scope audit

- Investigation ownership allowed only this report.
- Files changed by this investigator: only
  `rasen/changes/project-issue-onboarding-ui/evidence/investigation-report.md`.
- No product source, spec, test, QA report, review report, registry, daemon, or
  Store/Project repository was modified.
- The minimized CLI reproduction used `--dry-run`; disposable browser tabs
  were closed.
- No debug instrumentation or probe files were added.
- Pre-existing working-tree changes remain untouched.

## Durable findings

1. A release build fingerprint and a serving-process fingerprint are distinct
   facts. QA must bind evidence to the process/runtime actually serving the
   tested port.
2. For daemon-spawned CLIs, tests against the current worktree's `dist` prove
   product behavior but not parity with a long-lived cached daemon package.
3. A sanitized, same-home `--dry-run` CLI replay is the fastest discriminator
   between registry/state defects and stale executable artifacts on this path.

# BOARD FAILURE INVESTIGATION: onboarding creates a Store the Board rejects

## Outcome

The canonical Board failure is a current product onboarding contract bug, not
damage caused only by the stale runtime or by the membership retry.

Both the stale `0.2.0-3b566...` runtime and the current serving
`0.2.0-7ad556...` runtime implement `create-store` as:

```text
store setup <id> --path <parent>/<id> --json
```

That command mints metadata schema version 2 and a permanent Store uid, but it
adds `layoutVersion: 2` only when setup receives `--layout 2`. The aggregate
Issue query independently requires both a permanent uid and declared planning
layout v2. Onboarding therefore creates a healthy legacy-layout Store and then
immediately navigates to a Board that rejects that Store by design.

Status: **DONE (root cause identified; investigation-only, no product fix
applied by mandate)**

## Red-capable feedback loop

The original three failing Board reads were minimized to the single endpoint
that establishes Store scope:

```text
GET /api/v1/stores/issue-projections
space=store:qa-issue-onboarding-20260830-2337
```

The browser-origin wrapper asserts HTTP status and the structured error code.
It was run twice against the current serving runtime:

| Run | HTTP | Code |
|---:|---:|---|
| 1 | 400 | `issue_scope_required` |
| 2 | 400 | `issue_scope_required` |

Both responses state that the Store does not declare planning layout v2 with a
permanent identity. The Store does carry a valid permanent uid, so the
discriminating failed predicate is the missing layout declaration. The loop is
same-origin, unattended, deterministic, and completes in seconds.

## Named Store integrity

The named QA Store was inspected read-only. Its relevant facts are internally
consistent:

- metadata schema version is `2`, the permanent uid is present, and
  `layoutVersion` is absent;
- the registry contains exactly one Store entry for it, and registry id, root,
  and uid agree with metadata;
- the initial Store commit (`4409e22`, 2026-08-30T23:43:43+08:00) already
  contains that exact metadata shape, proving the layout declaration was not
  removed later;
- the legacy flat directories `rasen/specs`, `rasen/changes`, and
  `rasen/changes/archive` exist;
- the corrected membership record path,
  `.rasen-store/projects/8943c3a4-9b59-401a-aea2-4d72b45e98b8.yaml`,
  exists and records the requested Project identity with the expected default
  roles `planning: false` and `knowledge: true`;
- the Store config contains the Project reference.

The earlier membership-record probe used the wrong `rasen/projects/...` path;
that absence was not evidence of a failed membership. The authority record is
present under `.rasen-store/projects/...`.

Membership also cannot explain the layout state. In
`src/core/store/membership.ts:838-849,877-934`, mutation first reads the
already-declared layout, then writes either a v2 project catalog or the legacy
per-Project record. For this Store it correctly chose the legacy record.
`src/core/store/operations.ts:1305-1334` separately appends the Store config
reference and applies that membership mutation. Neither path rewrites
`.rasen-store/store.yaml`.

## Fresh current-runtime reproduction

To separate stale fixture history from current onboarding behavior, one unique
disposable Store was created through the current serving runtime's real
`POST /api/v1/spaces` `create-store` operation. Its resolved directory was
validated as a direct child of the OS temp directory before creation and again
before cleanup.

Creation returned HTTP 201 and operation `store-setup`. Fresh inspection
showed:

- metadata version `2`;
- a newly minted permanent uid;
- no `layoutVersion`;
- the legacy flat specs/changes/archive tree;
- no layout-v2 projects tree.

The same `issue-projections` request was then run twice against this fresh
Store. Both runs returned HTTP 400 with `issue_scope_required` and the same
missing-layout message. This directly falsifies the stale-fixture-only
classification.

After the probe, the fixture was removed with the current runtime's guarded
`store remove --yes` path. The exact id, metadata id, direct-temp-child
containment, and non-reparse-point target were validated first. The registry
entry is absent, the spaces catalog reports zero matches, and the disposable
directory is gone. The deletion is permanent and intentionally not
recoverable.

## Exact rejection and creation seams

The data flow is:

```text
onboarding create-store
  -> create-space argv omits --layout 2
  -> setup writes uid but no layoutVersion
  -> membership records the existing legacy layout
  -> canonical Store Issues route
  -> aggregate query requires layoutVersion 2
  -> 400 issue_scope_required
```

Concrete source evidence:

- `src/core/management-api/create-space.ts:328-335` constructs
  `store setup <id> --path <target> --json` with no layout argument.
- `src/core/store/operations.ts:934-945` always mints version-2 metadata and
  a uid for a new Store, but conditionally writes `layoutVersion: 2` only
  when the setup plan explicitly requests it.
- `src/core/store/query/refs.ts:148-160` rejects unless
  `metadata.layoutVersion === 2` and a permanent uid exists.
- The bundled `create-space.js` in both the old `3b566...` runtime and the
  current `7ad556...` runtime contains the same no-layout argv and contains
  no `--layout` argument.

The history shows how the contract drift arose:

- `233ded29` (2026-07-25) introduced UI Store creation and its unit test,
  explicitly pinning the no-layout argv;
- `af6f3e9d` (2026-08-13) introduced Store aggregate Issue reads with the
  layout-v2 gate;
- `889f1ef7` (2026-08-20) added `store setup --layout 2`, but the management
  bridge and its pinned argv expectation were not updated.

This is an integration/configuration-drift pattern: each local contract behaves
as implemented, but the producer used by onboarding does not satisfy the
consumer's required Store shape.

## Ranked hypotheses and classification

1. **Current `create-store` omits layout v2.** Prediction: a fresh Store made
   by the serving runtime has a uid but no layout declaration and reproduces
   the Board error. **Confirmed twice.**
2. **Only the stale runtime created a bad fixture.** Prediction: the current
   runtime's bundled argv includes `--layout 2`, or a fresh current Store
   renders an empty Board. **Falsified:** old and current argv are identical,
   and the fresh current Store returns the same 400 twice.
3. **Membership downgraded or partially damaged the Store.** Prediction:
   metadata history changes during membership or the authority record is
   absent/incoherent. **Falsified:** initial metadata already lacks the
   declaration, the correct record exists, and membership does not write Store
   metadata.
4. **Registry identity/root disagreement prevents scope resolution.**
   Prediction: registry and metadata select different Store facts.
   **Falsified:** the single entry's id/root/uid agree.
5. **The Board resolver rejects an otherwise valid layout-v2 Store.**
   Prediction: the failing predicate lies after successful layout and uid
   validation. **Ruled out as causal here:** execution stops at the explicit
   layout/uid gate, and the uid half is satisfied. This investigation makes no
   broader claim about post-gate behavior.

Classification: **product onboarding contract bug affecting all Stores created
through the current management `create-store` operation**, including both the
Project Issues handoff and standalone Spaces creation. The named Store is a
valid witness, not the unique cause.

## Smallest recommended fix and regression seam

The smallest product correction is to make management `create-store` invoke:

```text
store setup <id> --path <target> --layout 2 --json
```

The initial affected-area allowlist for a fixer is:

- `src/core/management-api/create-space.ts` — make new Stores satisfy the
  aggregate Issue consumer contract;
- `test/core/management-api/create-space.test.ts` — replace the currently
  pinned no-layout argv expectation;
- `test/core/management-api/create-space.integration.test.ts` (or an equally
  deep management/store API integration seam) — create a Store through the
  real bridge, assert `layoutVersion: 2`, then prove the empty
  `issue-projections` read returns 200 rather than
  `issue_scope_required`.

That integration check is important: an argv-only test would prove argument
construction but would not lock the producer-to-Board contract that failed.
The membership leg should also assert that a newly created layout-v2 Store
writes the v2 project catalog, without changing the Project's planning Store.

Do not treat migration of the named QA Store as the product fix. It would make
one fixture pass while leaving every future UI-created Store incompatible.
After the product change, rerun onboarding from zero membership with a new
disposable Store. If the named Store must be retained, its explicit
`migrate-layout` operation is separate operator work and requires its own
authorization and verification.

## Ship Readiness

**Not ready.** The current release-shaped runtime deterministically creates a
Store that the destination Board rejects. Ship readiness requires:

1. the producer contract fix and focused unit/integration regression coverage;
2. a rebuilt serving runtime whose fingerprint is verified at the bound port;
3. a fresh browser rerun from Project onboarding through Store creation,
   membership, canonical navigation, and a 200 empty/usable Issue Board;
4. clean Board console/network evidence and creation of the intentionally
   withheld success screenshot.

## Scope audit

- Investigation ownership permitted changes only to this report.
- The named QA Store was read but not migrated, recreated, deleted, or edited.
- No product source, spec, test, QA report, or review report was changed by
  this investigation; their pre-existing worktree changes remain untouched.
- The only extra write was the authorized disposable OS-temp Store; it was
  fully unregistered and permanently removed after the probe.
- The managed browser tab was closed, and no probe/debug files or
  instrumentation remain.
