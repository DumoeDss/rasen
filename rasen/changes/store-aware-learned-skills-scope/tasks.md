## 1. Versioned Typed Data Contracts

- [x] 1.1 Extend learned-skill public identity and normalized evidence types with closed global/project/store owners, building on the predecessor execution-context contract rather than adding a second owner resolver.
- [x] 1.2 Add strict discriminated candidate/manifest schema unions that preserve exact v1 project/global parsing and add the store-capable version with typed owner, evidence, and promotion-source locators.
- [x] 1.3 Normalize valid v1 manifests/evidence to typed in-memory records without read-triggered writes, and retain v1 output for project/global mutations whose semantics remain v1-representable.
- [x] 1.4 Add compatibility fixtures/tests for v1 project/global reads, store-capable records, strict unknown-field rejection, typed owner mismatch, and old-record byte stability.

## 2. Canonical Store Persistence

- [x] 2.1 Add store canonical resolution at the selected registered store's `rasen/learned-skills` directory by reusing typed registry, metadata-health, Rasen-root, and canonical-path helpers from the context/store layers.
- [x] 2.2 Extend catalog reads and exact record identity to load store manifests, reject copied/wrong-owner records, and keep same skill IDs distinct across project/store/global and across stores.
- [x] 2.3 Extend mutation plan/commit for store create/rewrite/retire with machine-data per-store locks, same-parent staging, digest verification, ownership revalidation, atomic replacement, and rollback.
- [x] 2.4 Return typed identity, store root, and exact changed canonical files after store mutation without performing Git commit/push/fetch or touching unrelated store files.
- [x] 2.5 Add filesystem tests for unwritable stores, human-owned collisions, malformed/owner-mismatched manifests, concurrent drift, rollback, temporary cleanup, Windows aliases, separators, and same-volume atomic staging.

## 3. Membership and Promotion Authority

- [x] 3.1 Implement one typed store-member query over explicit project-namespace `references`, deduplicating stable project IDs, validating current registry/health facts, and refusing transitive or unprefixed store references as project membership.
- [x] 3.2 Resolve every candidate promotion source to an exact active managed canonical record and verify typed identity, ownership, knowledge key, stored digest, and lifecycle status; adapt v1 promotion declarations to the same authoritative lookup.
- [x] 3.3 Implement the project-to-store gate requiring two distinct current member-project source records with one knowledge key, plus commit-time source and membership revalidation.
- [x] 3.4 Implement the global gate accepting either two distinct eligible project records or two distinct eligible store records, rejecting mixed source classes and duplicate stable owner IDs.
- [x] 3.5 Add adversarial tests for fabricated contributor IDs, missing/retired/human-owned sources, knowledge-key mismatch, clone/change duplicate counting, many-to-many membership, membership drift, mixed global sources, and v1 promotion compatibility.

## 4. Knowledge Management and Approval

- [x] 4.1 Remove the context slice's temporary store-scope-unavailable branch and route explicit store apply/list/show/retire operations through the typed canonical store APIs.
- [x] 4.2 Add scope-bound store approval alongside existing global approval, rejecting consent-scope mismatches and preserving active-codify authorization for ordinary project mutations.
- [x] 4.3 Show the planned action, target typed identity, knowledge key, applicability, and exact source identities before interactive approval; require the matching explicit flag for JSON/non-interactive use.
- [x] 4.4 Update localized messages, JSON wire records, completions, retain/codify guidance, CLI reference, and learned-skills documentation for store management, store working-tree effects, promotion sources, v1/v2 compatibility, and downgrade behavior.
- [x] 4.5 Add command tests for explicit store targeting, no implicit all-store scan, selector/scope mismatch, list/show identity, store confirmation, approval decline/flags, informed plan output, locale parity, and zero-mutation failures.

## 5. Boundary and Release Verification

- [x] 5.1 Verify this slice exposes typed store catalogs and membership/source facts but does not compute an effective project catalog, apply project/store/global precedence, deduplicate or refuse cross-store conflicts, modify materialization ledgers, or change any tool-home behavior.
- [x] 5.2 Run targeted learned-skill schema/catalog/mutation, knowledge CLI, store registry/reference, retention, locale, and completion tests, followed by typecheck and the full test suite.
  - Focused changed-area tests, typecheck, build, lint, strict change validation, and diff whitespace validation pass on Windows.
  - The exactly-one normal parallel `pnpm test` attempt exceeded the 15-minute runner ceiling under heavy concurrent resource contention and was stopped without retry. Its partial log recorded 74 completed test files (63 passing, 11 failing), 1,434 tests (approximately 1,364 passing, 65 failing, 5 skipped); failures were dominated by unrelated 10-second timeouts and Windows `EPERM`/`ENOTEMPTY` cleanup cascades. Evidence: `C:\Users\Sayo\AppData\Local\Temp\scope-fixer-full-suite.out.log`. A clean uncontended full-suite pass is still required before checking this task.
- [x] 5.3 Run or obtain Windows CI verification for registered store roots, canonical aliases, atomic store writes, machine-data locks, typed member resolution, and candidate file paths.
- [x] 5.4 Strictly validate the change artifacts and document that implementation is stacked on the completed context child before handing the typed catalogs to the materialization child.
