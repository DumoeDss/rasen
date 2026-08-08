# Review round 3 — verification of the round-2 fix delta (`store-layout-v2-migration`, child 3)

Reviewer: independent (not the fixer, not the round-2 reviewer). Read-only.
Input: `evidence/review-report-r2.md` (4 findings: R2-1 through R2-4) and `evidence/fix-report-r2.md` (all 4 fixed).

**Verdict: all four round-2 fixes are genuinely closed. No damage introduced.**

Every claim below was independently re-derived from the shipped code, not from the
fixer's tables. The discrimination analysis was done by tracing the production code
path each fix guards — not by reverting (read-only on `src/` and `test/`), but by
verifying the test assertions would fail if the production change were absent.

---

## R2-4 — the `id` contract divergence (the blocker) — CLOSED

### (a) `id` is no longer validated as a kebab-id

`planning-catalogs.ts:78`: the Zod schema defines `id: z.string().min(1).optional()`
— any non-empty string. The `parseChangeId` call that was applied to `id` is gone
from code entirely; it now appears only inside the explanatory comment at
`:269-285`. I verified by grep: `parseChangeId` has zero call sites in the `id`
validation path.

### (b) `id:"Elftia"` and `id:"my app"` are accepted by the v2 catalog

The test at `layout-migration-catalog-receipt.test.ts:188-203` iterates over
`['elftia', 'Elftia', 'my app', 'elftia-website', 'Elftia · 前端', 'a']` and
asserts both `serializeStoreProjectRecord` (v1) and `serializeStoreProjectCatalogV2`
(v2) accept each. `serializeStoreProjectCatalogV2` (`:330`) calls
`validateStoreProjectCatalogV2` (`:249`) which runs through the Zod schema, so a
restored `parseChangeId` would make the v2 arm of the loop throw for `Elftia`,
`my app`, and `Elftia · 前端`.

### (c) `projectId` remains the identity that names the file

`planning-catalogs.ts:265`: `projectId = parseProjectId(result.data.projectId)`.
`:267`: `validateProjectCatalogFilename(projectId, filePath)`. No other field
determines the filename.

### (d) The repair message tells the operator what to do

`catalog-upgrade.ts:87-104` (`repairFor`): each blocked field has a specific,
actionable repair message — e.g. `remote` → "Replace 'remote' with a
credential-free clone URL (https:// or ssh://, no embedded username or token)."
The generic default (`"Correct '<field>' in the record; migration never rewrites a
value to make it fit."`) is only the fallback for unanticipated fields, and the
test at `:170-172` explicitly asserts the repair for a known-blocked field does
NOT contain "never rewrites a value to make it fit".

### Discrimination — independently re-derived

The test at `:132-175` ("blocks a v1 value the stricter v2 validators reject") was
rewritten to use a credential-bearing `remote` instead of `id: Not A Portable Id`.
Under a revert (restoring `parseChangeId` for `id`), the fixture's `id: Elftia`
at `:143` would block first with a kebab-case message — before the credential-bearing
remote is ever reached. Three test assertions would fail:

1. "accepts every display name…" (`:188`) — `Elftia`/`my app` rejected by v2
2. "migrates a Store whose membership record carries a human display name" (`:206`) — blocked on `id`
3. "blocks a v1 value the stricter v2 validators reject" (`:132`) — `id` blocks before `remote`; the assertion at `:174` (`not.toContain('kebab')`) fails

This matches the fixer's claim of 3 failed / 5 passed. The discrimination is sound.

---

## R2-2 — `migrate-membership` destructive message — CLOSED

### (a) On a clean migrated Store, `migrate-membership` no longer produces `invalid_store_project_record`

`migration-ops.ts:1555-1578`: when `layout.declared === 2`, the function returns
early with an `info`-severity `store_layout_membership_already_migrated` diagnostic
and empty `converted`/`storeWrites`. The legacy census — `listStoreProjectRecords`
at `:1585` — is never reached.

The test at `layout-migration-doctor.test.ts:205-248` migrates a real Store
(plan → apply → retire), calls `migrateStoreMembership` with `apply: true`, and
asserts:
- `converted: []`, `storeWrites: []`
- No `error`-severity diagnostics
- Advice does not contain `Repair or remove` or `invalid_store_project_record`
- The catalog file is byte-identical before and after
- `store_layout_membership_already_migrated` is present in diagnostics

### (b) The re-audit of all v1-only read sites is complete and correct

I independently enumerated every call site of the three v1-only reader functions
(`listStoreProjectRecords`, `readStoreProjectRecord`, `readProjectOwnership`) across
`src/`. The results match the fixer's 12-site table in `caller-inventory.md:73-97`:

| Read site | Reachable in v2? | Diagnostics escape? | Verdict |
| --- | --- | --- | --- |
| `migrateStoreMembership` census (`listStoreProjectRecords` :1585) | yes | **yes, to operator** | **fixed** (early return) |
| `migrateStoreMembership` apply loop (`readStoreProjectRecord` :1660/:1683) | no — early return + default-deny | — | guarded |
| `readProjectOwnership` ← `ejectProject` (:941/:199) | no — `ejectPartition` returns first | — | structurally guarded |
| `clearProjectOwnership` ← `ejectProject` (:243) | no — same guard | — | structurally guarded |
| `readProjectOwnership` ← `diagnoseMigrationDrift` (:1821) | **yes** | no — reads `record?.adoption`, discards diagnostics | reachable, benign |
| `evidence.ts` E2 reader | yes | no — `catch { continue }` | migration source reader |
| `plan.ts` catalog upgrade | yes | yes — as `blocked:unrecordable-catalog-field` (intended) | migration source reader |
| `membership-layout.ts` :75/:129 | dispatcher v1 arm | — | correct dispatch site |
| `membership.ts` :846/:923/:939 | no — behind `declared === 2` check at :840 | — | properly dispatched |

No new defects beyond what the fixer found.

### Discrimination — independently re-derived

If the early return at `:1556` were disabled (`if (false && layout.declared === 2)`),
execution would reach `listStoreProjectRecords(storeRoot)` at `:1585`, which parses
v2 catalogs through the v1 parser. The resulting `invalid_store_project_record`
diagnostics would be spread into the result at `:1591`
(`const diagnostics = [...existing.diagnostics]`). The test assertions at
`layout-migration-doctor.test.ts:238` (`filter(severity === 'error').toEqual([])`)
and `:240` (`not.toContain('Repair or remove')`) would both fail. Sound.

### Default-deny provenance check — verified

`migration-ops.ts:1614-1616`: `if (member.provenance !== 'legacy-adoption' && member.provenance !== 'legacy-reference') continue;`
This is belt-and-braces behind the early return. If a future member source is
added without updating this check, it fails closed (skipped) rather than open
(falling through to `writeStoreProjectRecord`). The comment at `:1605-1613`
explains why this matters: the loop writes through the raw writer, bypassing both
the layout dispatch and the M6 assert.

---

## R2-1 — ambient `rasen doctor` in a migrated Store — CLOSED

### The fix

`doctor.ts:659`: `...(options.project === undefined ? { intent: 'store-read' as const } : {})`

When no `--project` is given, doctor now requests `store-read` intent instead of
defaulting to `project-read`. This lets the resolver accept a `store-aggregate` ref
(the resolution shape of a migrated Store) instead of throwing
`project_scope_required` at `resolver.ts:1768-1778`.

### The test uses a fixture that can actually fail

`store-migration-cli.test.ts:164-226`: creates a Store with `layoutVersion: 2`
(`:171`), an orphan partition (`:188-191`), and runs `rasen doctor --json` ambiently
(`cwd: migrated`). It asserts:
- `exitCode` is 0 (not 1)
- `payload.storeLayout` is defined (not absent)
- `store_layout_partition_orphan` is in the findings
- Codes and repairs match `rasen doctor --store migrated-store --json` and
  `rasen store doctor migrated-store --json`

The orphan partition is the key: it gives the Store a real finding to report, so the
assertion cannot pass on an empty list. And the fixture declares `layoutVersion: 2`,
so it resolves as `store-aggregate` — the one mode the old `project-read` intent
refused.

### Discrimination — independently re-derived

Without the intent change, `resolveOpenSpecRootThroughPlanning` defaults to
`intent: 'project-read'` (`root-selection.ts:729-742`). For a v2 Store root, the
resolver at `resolver.ts:1768-1778` throws `project_scope_required` because
`intent === 'project-read' && ref.mode === 'store-aggregate'`. The test's
`expect(ambient.exitCode).toBe(0)` at `:195` would fail.

### Damage check — no damage

The `intent: 'store-read'` change affects three resolution modes:

1. **Standalone projects** (no Store): `resolveOpenSpecRoot:1044-1080` calls
   `resolveOpenSpecRootThroughPlanning` inside a try/catch. When the planning
   resolver throws `project_scope_required` for `store-read + standalone`, the
   catch at `:1063` checks `storeFact` (false for a standalone), falls through, and
   returns `resolveStandaloneOrLegacyRoot` at `:1080`. No breakage — the fallback
   handles it.

2. **Legacy flat Stores**: the resolver at `:1742-1745` explicitly allows
   `store-read` intent with `legacy-store` mode. No breakage.

3. **v2 Store aggregates**: this is the fix — it now succeeds.

I verified this by running `membership.test.ts` (29 tests), `space-scoping.test.ts`
(22 tests), `store-migrate-layout-cli.test.ts` (8 tests), and
`migration-ops-flat-baseline.test.ts` (6 tests) — all pass, confirming standalone
and legacy paths are unaffected.

---

## R2-3 — census hole: optional-call syntax — CLOSED

### The fix

`source-guards.ts:109-112`: after matching a flat-path helper name and skipping
whitespace, the code checks for `?.` and skips past it before looking for `(`. This
means `changesDir?.(storeRoot)` is counted as a call, normalized to the token
`changesDir(storeRoot): 1`.

The docblock at `:85` says "KNOWN HOLES — three" (not "two" or "one") and lists
import alias, const rebinding, and computed property.

### Discrimination — independently re-derived

Without the `?.` branch at `:109-112`, after matching `changesDir` in
`changesDir?.(storeRoot)`, the `open` pointer would land on `?`. The check at
`:115` (`if (code[open] !== '(') continue;`) would skip this match — the `?.(` is
not `(`. The function would return `{}` for this input. The test at
`planning-path-source-guard.test.ts:251-253` expects `{'changesDir(storeRoot)': 1}`,
so it would fail. Sound.

---

## Damage check — R2-2 early return and R2-1 intent change

Both are behavior changes in shared paths. Neither broke anything previously right.

**R2-2's early return** (`migration-ops.ts:1556`): purely additive — it fires only
when `layout.declared === 2`. For flat Stores (layout v1 or undeclared), the function
proceeds exactly as before. The default-deny provenance check at `:1614` is also
only in the v1 conversion loop, which doesn't run for v2.

**R2-1's intent change** (`doctor.ts:659`): the `store-read` intent is passed
whenever `--project` is absent. For standalone projects, the planning error is
caught by the `resolveOpenSpecRoot` fallback (`:1063-1080`). For legacy Stores, the
resolver explicitly allows it. For v2 Store aggregates, it is the fix. No
previously-working path is broken.

---

## Gate results

All gates run from a clean build in the same shell invocation.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **PASS** — exit 0, no diagnostics |
| `npx eslint src test` | **PASS** — exit 0, no output |
| `node bin/rasen.js validate store-layout-v2-migration --strict` | **PASS** — "Change 'store-layout-v2-migration' is valid" |
| `pnpm run build` | **PASS** — "Build completed successfully" |

### Test suites (all `--maxWorkers=1`)

| Suite | Tests | Result |
| --- | --- | --- |
| `layout-migration-catalog-receipt.test.ts` | 8 | **PASS** |
| `layout-migration-doctor.test.ts` | 12 | **PASS** |
| `planning-path-source-guard.test.ts` | 6 | **PASS** |
| `store-migration-cli.test.ts` | 5 | **PASS** |
| `membership.test.ts` | 29 | **PASS** |
| `membership-operations.test.ts` | 37 | **PASS** |
| `migration-ops-flat-baseline.test.ts` | 6 | **PASS** |
| `migration-ops-v2-partitions.test.ts` | 0 (empty describe) | **PASS** |
| `layout-migration-module.test.ts` | included in batch | **PASS** |
| `layout-no-dual-write.test.ts` | 8 | **PASS** |
| `layout-migration-apply-recovery.test.ts` | included in batch | **PASS** |
| `store-migrate-layout-cli.test.ts` | 8 | **PASS** |
| `space-scoping.test.ts` | 22 | **PASS** |

**Failing files: none.** Zero environmental failures triggered (the 5 known
`config.test.ts` / `config-editor.test.ts` failures were not in any batch I ran).

---

## What I could not verify

- **The fixer's revert-and-re-run discrimination runs.** I am read-only on `src/`
  and `test/`, so I could not physically revert the changes and re-run. Instead I
  traced each production code path independently and confirmed the test assertions
  would fail if the production change were absent. Where the fixer's claim and my
  independent trace agree (all four findings), I consider it verified.
- **Non-Windows behavior.** All runs on win32.
- **`dist/` stability.** One batch (`store-migrate-layout-cli + space-scoping`)
  appeared to run only one file in the first attempt — likely a concurrent rebuild
  from child 7's live implementer. I re-ran `space-scoping` separately after a
  clean build and it passed 22/22.
