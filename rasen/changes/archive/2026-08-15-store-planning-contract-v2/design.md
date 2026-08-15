## Context

This is the first of three serial children of the `store-v2-foundation` slice
(`rasen/work/issue-centered-automation-platform/store-v2-onto-020/`), which lands the Store-v2 stack
onto `dev/0.2.0`. It is Layer 0: the pure contract every later layer compiles against.

`dev/0.1.7` is a released, tagged, frozen behavior reference — never a copy target. The two lines are
bidirectionally divergent and both merge and cherry-pick have been proven unviable, so each seam is a
re-implementation on 0.2.0's structures.

**Measured collision surface for this child (all verified in this worktree, base `origin/dev/0.2.0`
@ `657c546d`, merge-base `e62b101f`):**

| Path | 0.2.0 churn since merge-base | Consequence |
| --- | --- | --- |
| `src/core/store/**` | **empty diff** | Every file this child adds or edits under `src/core/store/` lands on an untouched base. |
| `src/core/change-metadata/**` | **empty diff** | The metadata schema extension lands on an untouched base. |
| `src/core/id.ts`, `zod-issues.ts`, `store/identity-types.ts`, `store/errors.ts`, `store/remote.ts` | **empty diff** | Every dependency this layer reaches is byte-identical on both lines. |
| `src/core/workflow-package/canonical.ts` | **empty diff** (its siblings `codec.ts`/`index.ts` did change) | Converting it to a re-export touches nothing 0.2.0 built. |
| `src/core/index.ts` | +1 line (`change-run`) | Both lines only append export lines; adding one more is an append, not a conflict. |
| `src/core/config.ts` | 0.1.7 added an unrelated AI-tool entry | Not needed here; this layer's use of `config.js` is satisfied by 0.2.0 as-is. |

So the honest statement is: **for this child there is essentially no structural adaptation work.**
The 0.1.7 → 0.2.0 divergence is real, but it lives in the daemon/ECP consumer rim
(`management-api/router.ts`, `wire-types.ts`, `packages/ui/src/api/types.ts`), which this child does
not touch at all. Inventing adaptation work here would be fiction. The genuine work is (a) porting
the contract faithfully, (b) drawing the child boundary correctly against its two siblings, and (c)
closing two defects the frozen reference is known to carry.

**Prior art.** 0.1.7 built exactly this contract in one commit, `a7135669` (`feat(store): add planning
foundation v2`, 4,307 insertions across 13 source and 5 test files), with full artifacts archived at
`origin/dev/0.1.7:rasen/changes/archive/2026-08-05-store-planning-foundation-v2/`. Three later 0.1.7
commits edited files this child owns; their attribution is Decision 2.

## Goals / Non-Goals

**Goals:**

- Land the Layer-0 planning contract on 0.2.0: identifier grammars, layout v2 addresses and catalogs,
  domain-separated identities, v2 Change metadata, and the Archive v2 record.
- Draw a boundary that is exactly covered by its own tests — no code shipped that only a sibling's
  suite will exercise, and nothing a sibling needs left un-ported that would strand it.
- Make Layer-0 purity a *proven* property, not a docstring claim.
- Make Windows path semantics verifiable from any host, and make the Windows CI leg actually run the
  path fixtures.
- Fold in the defects 0.1.7 discovered in this contract after shipping it, rather than re-introducing
  known bugs.
- Change nothing observable: no command, flag, endpoint, UI surface, Store mutation, Git operation, or
  archive transaction moves.

**Non-Goals:**

- Selecting a Store, project, or target line; opening a planning scope; routing any command's root.
- Writing catalogs or v2 identity from any command; migrating legacy flat Store content.
- Resolving Git refs, creating or removing worktrees, or proving commit reachability.
- Planning or applying any Archive or finalization mutation; changing `archive-engine.ts`.
- Store Issues, Execution Plans, workspace bindings, target-line operations — the next two children.
- The `store/finalization/` module, `store-planning/`, `layout-migration/`, `layout-write-guard`,
  `migration-ops-v2`, `consistency-gates` — later roadmap slices. `finalization-v2.ts`, the contract
  *types* file, is Layer 0 and is in scope; the `finalization/` *directory* is Layer 3 and is not.

## Decisions

### 1. One pure planning-foundation boundary, six modules behind one barrel

The contract ships as `src/core/store/planning-foundation.ts`, a barrel re-exporting five internal
modules, plus one neutral canonical-JSON utility:

| Module | Owns |
| --- | --- |
| `planning-validation.ts` | Branded value types, the typed error family, portable-segment rules, the single Windows reserved-device-name list, project/target-line/Change id, Git ref, Git OID, digest, and portable-relative-path validators. |
| `planning-catalogs.ts` | Strict v2 project catalog and target-line catalog records and their filename agreement. |
| `planning-identity.ts` | Canonical-JSON + SHA-256 domain-separated derivation and verification for the four identity kinds, and instance-seed mint/parse. |
| `planning-layout-v2.ts` | Layout v2 addresses, explicit path flavor, validation-before-join, containment proof. |
| `finalization-v2.ts` | Finalization outcomes, semantic supersession validation, the Archive v2 record schema and deterministic serializer. |
| `src/core/canonical-json.ts` | RFC 8785 canonical JSON, the repository's single implementation. |

Callers validate at this boundary instead of importing internal regular expressions, hash preimages,
or path joins. `foundation.ts`, `project-records.ts`, and the existing archive accounting stay the
compatibility surfaces until their owning children integrate the new contracts.

*Alternative rejected:* extend `ResolvedOpenSpecRoot` and the existing archive DTOs in place. That
would make command routing and I/O policy prerequisites for validating data, and would preserve
several competing path algorithms.

### 2. The child boundary is `a7135669` plus its own later fixes, minus its siblings' additions

The 0.1.7 tip of these files is **not** the right port target, because three later commits edited
them. Attribution was established by diffing `a7135669..origin/dev/0.1.7` per file:

| Later change to a file this child owns | Owner | Decision |
| --- | --- | --- |
| `planning-validation.ts` +93: `IssueId` and `ExecutionPlanRevisionId` brands, their parsers, `formatExecutionPlanRevisionId`, and the `invalid_issue_record` / `invalid_execution_plan` error codes | S3 `store-issue-resources` | **Excluded.** No Layer-0 suite exercises them; they belong to the Issue resources child. |
| `planning-layout-v2.ts` +47: the `issue`, `issue-record`, `execution-plans`, and `execution-plan` addresses | S3 `store-issue-resources` | **Excluded**, same reason. |
| `planning-layout-v2.ts` +18: `isAbsoluteStoreRoot` (commit `1fa114d4`, "reject wrong-flavor planning roots") | **this child** | **Included** — see Decision 5. |
| `planning-catalogs.ts` +28: stop validating the project display name as an identifier | **this child** | **Included** — see Decision 6. |
| `finalization-v2.ts` +27: capability ids are slash-delimited paths, not single kebab ids | **this child** | **Included** — see Decision 7. |

Measured consequence of excluding the sibling additions: the port is exactly covered by the five
Layer-0 suites. Measured consequence of *not* excluding them: ~140 lines would ship with no test in
this child at all (the tip's own test delta over `a7135669` is 15 lines, all in `finalization-v2.test.ts`).
S3 re-opens both files additively; the chain is strictly serial, so there is no conflict cost.

*Alternative rejected:* port the 0.1.7 tip verbatim for byte-fidelity. It ships untested code and
blurs the child boundary the portfolio was decomposed to create.

### 3. Layout is versioned independently, and legacy records are never rewritten

`StoreMetadataStateV2.version` already means "metadata carries a permanent Store UID". Layout is a
distinct optional `layoutVersion: 2` field, accepted by both the v1 and v2 metadata forms. Absence
means legacy layout; directory presence never upgrades a Store; the serializer preserves absence.
No command writes the field in this child.

Layout v2's authoritative relative addresses:

| Address | Relative path |
| --- | --- |
| Store metadata | `.rasen-store/store.yaml` |
| Project catalog | `.rasen-store/projects/<projectId>.yaml` |
| Target-line catalog | `.rasen-store/target-lines/<targetLineId>.yaml` |
| Project planning home | `rasen/projects/<projectId>/` |
| Project canonical specs | `rasen/projects/<projectId>/specs/` |
| Project design docs | `rasen/projects/<projectId>/design-docs/` |
| Active Change | `rasen/projects/<projectId>/changes/<changeId>/` |
| Project Archive line | `rasen/projects/<projectId>/changes/archive/<targetLineId>/` |
| Store design docs | `rasen/design-docs/` |

Target lines are not another active-Change directory layer: unmerged target-line state is isolated by
Store Git branches and worktrees, and only Archive needs a stable target-line directory. The v1
project membership record stays readable; a v2 project catalog uses the same per-project file
location, drops adoption ownership from the durable member contract, and separates membership from
planning binding (`unbound` | `bound`, where only `bound` carries `boundAt` and requires
`roles.planning: true`). Machine paths are never fields. A target-line catalog is new at record
version 1, its file stem must equal its `id`, each project-map key must be a canonical v2 project
identity, and refs are validated only against a conservative portable subset of `git check-ref-format`
— existence and reachability belong to the worktree and finalization children.

### 4. Identities are canonical-JSON, SHA-256, versioned-domain, branded

Preimages are strict objects carrying an explicit versioned `domain`; outputs are a type prefix plus
a lowercase hex digest:

```text
ps_<64 hex> = H({ domain: "planning-scope/v2", storeUid, projectId, targetLineId })
ci_<64 hex> = H({ domain: "change-instance/v2", planningScopeId, instanceSeed })
wt_<64 hex> = H({ domain: "worktree-instance/v2", repositoryIdentity, worktreeIdentity })
wp_<64 hex> = H({ domain: "workspace-pair/v2", changeInstanceId,
                  planningWorktreeInstanceId, executionWorktreeInstanceId })
```

`instanceSeed` is 16 random bytes as 32 lowercase hex characters, minted once. Neither the Change
alias, a path, a branch, nor a Git ref enters `PlanningScopeId` or `ChangeInstanceId`. Worktree
identities are deliberately machine-local: a later Git adapter supplies canonical repository and
worktree identity strings, and this layer verifies only their canonical, control-free shape before
hashing — it never interprets them as paths. Workspace-pair input is role-ordered, so swapping
planning and execution changes the id. Every kind has `parse` / `is` / `derive` and, where meaningful,
`mint` / `verify`, with branded TypeScript output so a bare `string` cannot satisfy a downstream API
by accident. `mintChangeInstanceSeed` and the digests use `node:crypto` only — randomness and hashing
are not ambient state.

*Alternative rejected:* concatenate fields, or hash the absolute Change path, or include `changeId`.
Concatenation is ambiguous without an escaping protocol; path identity is not portable; `changeId` is
a mutable human alias.

### 5. A Store root must be self-contained, not completed from process state

`resolveStorePlanningLayoutV2Path` requires an absolute `storeRoot` and otherwise throws
`invalid_store_layout_v2`. This is a product requirement, not a detail: it is what makes locked
decision D2 ("runtime cwd is never a durable target binding") and D5 ("planning space and execution
root never collapse") enforceable at the contract layer rather than by convention upstream.

Absoluteness alone is insufficient under Windows semantics, which is the defect `1fa114d4` fixed:
`path.win32.isAbsolute('/store')` is `true`, because Windows accepts a current-drive-rooted path — a
path whose drive is supplied by process state. Under `win32` semantics (explicitly, or `native` on a
win32 host) the root must therefore carry a drive, UNC share, or device root. This child ports the
fixed behavior, and the spec states it as a product rule ("Drive-less Windows root is refused").

### 6. A project's display name is data, not an identifier

`a7135669` validated the v2 project catalog's `id` field with `parseChangeId` — the *Change* id
validator, applied to a field that `StoreProjectRecord`, `StoreMembershipRecord`, and
`MembershipMutationInput.projectDisplayId` all document as the project's **human display name**. The
v2 catalog therefore rejected values the v1 record accepts (`Elftia`, `my app`), and because catalog
upgrade carries `record.id` forward verbatim, any Store whose membership record held what the field
is documented to hold could not be migrated at all without hand-editing YAML.

This child ports the fixed behavior: `projectId` is the identity and alone names the file; `id` is
carried through unvalidated as a display name. The general rule this defect teaches — **a migration
must never block on data the schema it migrates from accepted** — is why Decision 8 exists.

### 7. A capability id is a spec address, not a single kebab id

`a7135669` typed Archive v2 spec-action `capabilityId` as a single kebab id. A capability's canonical
address can be a slash-delimited path of kebab segments, so the original schema rejected legitimate
spec actions. This child ports the fixed contract: each `/`-separated segment must be a canonical
lowercase kebab id, with empty, `.`, `..`, and backslash-bearing values rejected.

### 8. Change metadata becomes strict — and admits the field the product's own archive writes

The reference hardened `ChangeMetadataSchema` with `.strict()`, so an unknown field is rejected rather
than silently ignored and then dropped on the next write. That posture is right and this child adopts
it, but adopting it unchanged would be Decision 6's defect repeated:

- `archive-engine.ts:2965` writes `metadata.quality = summary` into the **archived** `.openspec.yaml`
  via raw YAML (bypassing this schema, so the *write* path is unaffected).
- `readChangeMetadata` (`src/utils/change-metadata.ts:130`) **throws** on strict-parse failure.
- Measured in this worktree: **33** archived `.openspec.yaml` files carry `quality:`; active changes
  carry only `schema` / `created` / `goal`. Historical shapes vary — the oldest also carry
  `rulesExtracted`, which is not in the current `ArchiveQualitySummary`.

So plain `.strict()` makes the product's own archive output unreadable through its own reader. This
child therefore admits `quality` as an engine-owned passthrough that the schema carries without
interpreting (permissive shape, deliberately — historical records must stay readable), and pins it
with a test that reads a real archived record. This is a **deliberate divergence from the frozen
reference**, which carries the same latent defect on its own line.

### 9. Layer-0 purity is proven by a guard test, not asserted by a docstring

The barrel's docstring states that these modules contain no filesystem, registry, cwd, environment,
command, or Git-process access. The reference has **no test that enforces this** — its
`planning-foundation-consumer.test.ts` is a type-level branding test, valuable but orthogonal. Since
purity is the product contract this whole layer sells (Decision 5 depends on it), this child adds a
static guard, `test/core/store/planning-foundation-purity.test.ts`, that reads the Layer-0 sources
from disk and asserts:

- every import specifier is in a fixed allowlist — `zod`, `yaml`, `node:crypto`, `node:path`,
  `../canonical-json.js`, `../zod-issues.js`, `../id.js`, `./identity-types.js`, `./remote.js`,
  `./planning-validation.js`, `./planning-identity.js` (measured from the reference's actual imports);
- no reference to `node:fs`/`fs`, `node:child_process`, `node:os`, `process.cwd`, `process.env`,
  `execSync`/`spawn`, or the Store registry.

Two properties make the allowlist honest. It is an **explicit list**, matching the repo rule "use
existing constants and lists — don't invent detection mechanisms", so widening it is a visible diff a
reviewer must approve. And it is transitively sound — *enforced*, not asserted. The guard follows the
allowlisted edges into the dependency closure (`canonical-json.ts` → `canonicalize`; `id.ts` and
`errors.ts` with no imports; `zod-issues.ts` → a zod type; `identity-types.ts` → `node:crypto`;
`remote.ts` → `./errors.js`) and holds every file it reaches to its own explicit dependency allowlist
and to the same forbidden-pattern list. A hand-verified prose claim would have been point-in-time
only: a forbidden import added to an allowlisted dependency (`node:fs` in `id.ts`, say) falsifies the
Layer-0 purity claim without touching a Layer-0 file at all. Only allowlisted edges are walked, so
the governed set is exactly the walked set — a specifier outside the allowlist is a finding in its
own right rather than a licence to drag the rest of the tree into this guard's surface.

Specifier collection must cover static `import`, `export … from`, **and dynamic `import()`**: a
single `await import('./foundation.js')` reaches `node:fs`, the Store registry, and the global data
dir, so a collector that only reads static imports can be walked straight past.

A guard in this repository is presumed non-discriminating until proven otherwise, so the
implementation must include a recorded mutation proof: inject a forbidden import into one Layer-0
module, observe the guard go RED, revert, observe GREEN. A guard that has never been seen to fail is
not evidence.

### 10. Cross-platform semantics are testable from any host, and the Windows leg must actually run

`resolveStorePlanningLayoutV2Path` takes an explicit `flavor: 'native' | 'win32' | 'posix'` precisely
so Windows semantics do not require a Windows host. Path fixtures are built with `path.win32.join` and
`path.posix.join` — never hardcoded separators — and both flavors are asserted in
`planning-layout-v2.test.ts`.

Note for the implementer: the reference has **no** `planning-*-windows-paths.test.ts` file. Its
`*-windows-paths.test.ts` suites belong to `finalization/`, `layout-migration/`, and `workspace/` —
all out of scope here. Windows coverage for this child lives inside `planning-layout-v2.test.ts`, and
must include native win32 case/alias behavior in addition to the explicit-flavor expectations.

The five suites are pure unit tests with no fixtures, so they need no `KNOWN_SLOW_TEST_WEIGHTS_MS`
entry in `vitest.config.ts` — unlisted files fall back to a size-derived weight, which is correct for
them. (S2 and S3, with their fixture suites, will need to revisit that.)

### 11. Errors are typed and legacy parsing is untouched

Contract failures use a stable typed error family: `invalid_store_layout_v2`, `invalid_project_catalog`,
`invalid_target_line_catalog`, `invalid_planning_identity`, `invalid_archive_v2`, `planning_path_escape`.
Errors name the offending field but never coerce a record into another owner or scope. Legacy Store
metadata without a layout declaration, v1 project records, Change metadata without an identity block,
and Archive v1 accounting all keep parsing through their existing entry points. There is no dual write
and no automatic upgrade in this child.

## Risks / Trade-offs

- [Risk] `.strict()` on `ChangeMetadataSchema` is a behavior tightening on a read path that throws,
  and this repository holds 33 archived records with an extra field. → Decision 8 admits `quality`
  explicitly; the verification gate reads a real archived record through the new schema, and re-reads
  every `.openspec.yaml` under both planning roots to prove none regressed.
- [Risk] Adding an optional `layoutVersion` to an already-strict metadata schema could rewrite legacy
  files. → Keep it optional, preserve absence through serialization, activate no writer here, and
  assert byte-stability of a legacy metadata round trip.
- [Risk] v1 project records and v2 catalogs share one directory and could be confused. → Discriminate
  on the record version, keep explicit v1 parsing, never infer a version from fields or filenames.
- [Risk] The 12-character Archive instance suffix is not a global uniqueness proof. → Derive it only
  from a verified full instance identity and require no-clobber publication in the finalization child;
  the full identity always remains in the record.
- [Risk] Pure Git-ref syntax will drift from real `git check-ref-format`. → Validate a conservative
  portable subset here; the worktree and finalization adapters still ask Git to prove existence and
  reachability.
- [Risk] Excluding the S3 additions means S3 must re-open two Layer-0 files. → Accepted, and cheap:
  the chain is strictly serial, and the additions are purely additive (new brands, new address kinds).
  The alternative ships untested code, which is worse.
- [Risk] Moving canonical JSON to `src/core/canonical-json.ts` changes an import direction for
  `workflow-package`. → It is a pure re-export with no behavior change; `workflow-package/canonical.ts`
  is byte-identical on both lines, and the workflow-package suites are in the verification gate.
- [Risk] Adding Archive v2 before any consumer creates two archive record types temporarily. →
  Archive v2 stays additive and unreferenced by every mutation caller until the finalization slice
  switches all consumers together.
- [Trade-off] Layer-0 purity forbids convenience helpers that read a Store. Callers must pass data in.
  That is the point: it is what makes the same inputs resolve identically on every machine.

## Migration Plan

1. Add the pure validation, catalog/layout, identity, outcome, and Archive v2 contracts plus their
   tests; add the neutral canonical-JSON utility and make the workflow-package helper re-export it.
2. Extend the Store metadata, project record, and Change metadata parsers additively, and prove legacy
   fixtures stay byte-stable through a serialize round trip.
3. Export the boundary from `src/core/store/index.ts` and `src/core/index.ts` without changing any
   command or mutation caller.
4. Let the dependent children activate it in order: `store-worktree-bindings-v2`, then
   `store-issue-resources`.

Rollback is removal of the additive modules and optional schema fields. Because this child writes no
v2 data from any command, rollback requires no filesystem or Git migration.

## Open Questions

None for this child. Catalog mutation timing, the source of machine worktree identity, and Archive
transaction integration are deliberately decided by their owning later children against these frozen
data contracts.
