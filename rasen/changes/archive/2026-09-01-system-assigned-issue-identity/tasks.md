## 1. Identity Domain and Versioned Codecs

- [x] 1.1 Add branded Issue UID/key/selector/storage-key types, UUID/key/slug validation, deterministic key vectors, UUIDv4 entropy injection, and UUIDv5 legacy projection.
- [x] 1.2 Add strict version-2 Issue record parsing/serialization and a unified stored-record domain view while preserving every version-1 byte contract.
- [x] 1.3 Add version-2 Execution Plan, acceptance-conditions, and accepted-record codecs with `issueUid`, version-aware digests, and V1-to-V2 ordinal compatibility.
- [x] 1.4 Add the identity-specific refusal/problem vocabulary and HTTP mappings for invalid, ambiguous, conflicting, mismatched, and exhausted allocation outcomes.

## 2. Generated Catalog and Selector Seam

- [x] 2.1 Implement identity allocation, stored-record identity projection, and selector resolution behind the three-entry identity module.
- [x] 2.2 Refactor local and cross-ref Issue collection to project records before grouping, group by UID, and retain each copy's internal storage locator.
- [x] 2.3 Resolve UID, generated key, slug, explicit prefixes, and legacy aliases fail-closed, including incomplete-ref and multi-candidate diagnostics.
- [x] 2.4 Add fixed-vector, mixed V1/V2, cross-Store legacy, ambiguous-selector, disposable-index, and zero-write read tests.

## 3. Layout, Locking, and Mutations

- [x] 3.1 Change Issue layout/address helpers to accept only branded internal storage keys and keep Windows/POSIX containment behavior.
- [x] 3.2 Add Store-scoped Issue allocation/selector locking before UID Issue locking, atomic expected-absent record publication, bounded retry, and lock-order/concurrency tests.
- [x] 3.3 Change core creation to require title only, publish a V2 UID directory/record, and treat optional legacy `issueId` input only as an alias.
- [x] 3.4 Route state, plan, acceptance, and accept mutations through selector resolution, lock by UID, and write to the resolved storage locator.
- [x] 3.5 Publish new child resources with V2 `issueUid`, reject owner mismatches, and preserve V1 historical serializers and golden digests.

## 4. Query and Downstream Issue Composition

- [x] 4.1 Widen Issue summaries/details/write results with structured identity while retaining a deprecated compatibility selector field and hiding storage keys from wire output.
- [x] 4.2 Resolve plan and acceptance reads through the selected copy's storage locator and project V1/V2 child resources into one domain view.
- [x] 4.3 Thread UID/key identity through status, attention, review, execution binding, publication, acceptance, and Change-link composition without re-parsing selectors.
- [x] 4.4 Update query parity, divergence, completeness, read-only guard, and existing Issue lifecycle regression tests.

## 5. HTTP and CLI Surfaces

- [x] 5.1 Change management HTTP creation to title-only input, return structured identity, and use one selector contract and explicit status codes on every Issue route.
- [x] 5.2 Change `rasen store issue new` to require no positional ID, retain an optional deprecated alias adapter, display the Issue key, and expose full identity in JSON.
- [x] 5.3 Update every CLI Issue subcommand, command registry/completions, localized presentation, help text, and CLI/API parity tests for UID/key/legacy selectors.

## 6. Web UI Surfaces

- [x] 6.1 Update browser API mirrors and clients for structured identity, title-only create, V2 child resources, and compatibility response fields.
- [x] 6.2 Remove the Issue ID input from the Board create dialog, submit only title, refresh server truth, and render key plus title on cards.
- [x] 6.3 Key Issue components and canonical detail links by UID, resolve compatible deep links, and replace them with canonical UID routes.
- [x] 6.4 Update Unlinked Changes create-preview, create-to-plan publication, conflict handling, and partial-create recovery to consume the returned UID/key.
- [x] 6.5 Add UI tests for non-ASCII/repeated titles, no ID field, server-assigned identity, canonical navigation, and legacy-link compatibility.

## 7. Verification and Documentation

- [x] 7.1 Run focused identity, codec, Store Issue, query, management API, CLI, and UI suites; fix all regressions without weakening V1 golden assertions.
- [x] 7.2 Run explicit concurrent creation and Windows/POSIX path suites, plus strict UTF-8/BOM and diff checks for all changed text files.
- [x] 7.3 Run full build, lint, strict change validation, and the proportionate full test suite required by the final diff.
- [x] 7.4 Update the architecture index quick locator and Store/UI module references for the new identity/selector seam.
- [x] 7.5 Harden atomic create recovery with an explicit publication-indeterminate identity contract, path-free public warnings, structured CLI/HTTP recovery, and retained-carrier/read-failure regressions.
- [x] 7.6 Centralize unreadable Issue wire redaction, make option-shaped compatibility aliases argv-safe, and add direct unreadable reverse-lookup plus gated selector/create concurrency coverage.
- [x] 7.7 Lock Unlinked Changes against duplicate creation after indeterminate publication, recover only by the returned UID, and make Execution Plan wire identity depend on a verified public Issue summary.
