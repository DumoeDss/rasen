## 1. Versioned Typed Data Contracts

- [ ] 1.1 Extend learned-skill public identity and normalized evidence types with closed global/project/store owners, building on the predecessor execution-context contract rather than adding a second owner resolver.
- [ ] 1.2 Add strict discriminated candidate/manifest schema unions that preserve exact v1 project/global parsing and add the store-capable version with typed owner, evidence, and promotion-source locators.
- [ ] 1.3 Normalize valid v1 manifests/evidence to typed in-memory records without read-triggered writes, and retain v1 output for project/global mutations whose semantics remain v1-representable.
- [ ] 1.4 Add compatibility fixtures/tests for v1 project/global reads, store-capable records, strict unknown-field rejection, typed owner mismatch, and old-record byte stability.

## 2. Canonical Store Persistence

- [ ] 2.1 Add store canonical resolution at the selected registered store's `rasen/learned-skills` directory by reusing typed registry, metadata-health, Rasen-root, and canonical-path helpers from the context/store layers.
- [ ] 2.2 Extend catalog reads and exact record identity to load store manifests, reject copied/wrong-owner records, and keep same skill IDs distinct across project/store/global and across stores.
- [ ] 2.3 Extend mutation plan/commit for store create/rewrite/retire with machine-data per-store locks, same-parent staging, digest verification, ownership revalidation, atomic replacement, and rollback.
- [ ] 2.4 Return typed identity, store root, and exact changed canonical files after store mutation without performing Git commit/push/fetch or touching unrelated store files.
- [ ] 2.5 Add filesystem tests for unwritable stores, human-owned collisions, malformed/owner-mismatched manifests, concurrent drift, rollback, temporary cleanup, Windows aliases, separators, and same-volume atomic staging.

## 3. Membership and Promotion Authority

- [ ] 3.1 Implement one typed store-member query over explicit project-namespace `references`, deduplicating stable project IDs, validating current registry/health facts, and refusing transitive or unprefixed store references as project membership.
- [ ] 3.2 Resolve every candidate promotion source to an exact active managed canonical record and verify typed identity, ownership, knowledge key, stored digest, and lifecycle status; adapt v1 promotion declarations to the same authoritative lookup.
- [ ] 3.3 Implement the project-to-store gate requiring two distinct current member-project source records with one knowledge key, plus commit-time source and membership revalidation.
- [ ] 3.4 Implement the global gate accepting either two distinct eligible project records or two distinct eligible store records, rejecting mixed source classes and duplicate stable owner IDs.
- [ ] 3.5 Add adversarial tests for fabricated contributor IDs, missing/retired/human-owned sources, knowledge-key mismatch, clone/change duplicate counting, many-to-many membership, membership drift, mixed global sources, and v1 promotion compatibility.

## 4. Knowledge Management and Approval

- [ ] 4.1 Remove the context slice's temporary store-scope-unavailable branch and route explicit store apply/list/show/retire operations through the typed canonical store APIs.
- [ ] 4.2 Add scope-bound store approval alongside existing global approval, rejecting consent-scope mismatches and preserving active-codify authorization for ordinary project mutations.
- [ ] 4.3 Show the planned action, target typed identity, knowledge key, applicability, and exact source identities before interactive approval; require the matching explicit flag for JSON/non-interactive use.
- [ ] 4.4 Update localized messages, JSON wire records, completions, retain/codify guidance, CLI reference, and learned-skills documentation for store management, store working-tree effects, promotion sources, v1/v2 compatibility, and downgrade behavior.
- [ ] 4.5 Add command tests for explicit store targeting, no implicit all-store scan, selector/scope mismatch, list/show identity, store confirmation, approval decline/flags, informed plan output, locale parity, and zero-mutation failures.

## 5. Boundary and Release Verification

- [ ] 5.1 Verify this slice exposes typed store catalogs and membership/source facts but does not compute an effective project catalog, apply project/store/global precedence, deduplicate or refuse cross-store conflicts, modify materialization ledgers, or change any tool-home behavior.
- [ ] 5.2 Run targeted learned-skill schema/catalog/mutation, knowledge CLI, store registry/reference, retention, locale, and completion tests, followed by typecheck and the full test suite.
- [ ] 5.3 Run or obtain Windows CI verification for registered store roots, canonical aliases, atomic store writes, machine-data locks, typed member resolution, and candidate file paths.
- [ ] 5.4 Strictly validate the change artifacts and document that implementation is stacked on the completed context child before handing the typed catalogs to the materialization child.
