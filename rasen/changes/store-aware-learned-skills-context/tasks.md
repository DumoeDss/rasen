## 1. Typed Knowledge Context

- [x] 1.1 Add closed global/project/store owner-reference and planning-root-reference types plus the versioned frozen knowledge-context schema; retain candidate and manifest v1 schemas unchanged.
- [x] 1.2 Implement one learned-skill execution-context resolver that composes existing typed project/store registry, metadata-health, root-selection, and canonical-path helpers without deriving identity from basenames or candidate fields.
- [x] 1.3 Cover in-repo projects, store-backed pointer projects, direct stores, same-ID cross-namespace entries, stale registrations, ambiguous ownership, and Windows canonical path aliases with focused resolver tests.
- [x] 1.4 Thread the resolved typed context through existing project/global learned-skill plan, commit, list, and resolve calls, with one bounded compatibility adapter for legacy `projectRoot` callers.

## 2. Knowledge CLI Selection

- [x] 2.1 Add mutually exclusive `--project <id>` and `--store <id>` options to apply/list/show/retire and share their parsing and typed diagnostics across every knowledge subcommand.
- [x] 2.2 Enforce owner/scope agreement before planning a mutation or global approval, preserving unambiguous zero-selector project behavior and emitting a stable temporary diagnostic for store persistence owned by the scope child.
- [x] 2.3 Update human/JSON knowledge output, completions, localized message catalogs, and CLI documentation to explain that knowledge selectors choose an owner independently from the planning root.
- [x] 2.4 Add CLI tests for project/store selector lookup, mutual exclusion, global mismatch, ambiguous direct-store use, candidate identity redirection, JSON error stability, and no-mutation failure paths.

## 3. Retain and Resume Identity

- [x] 3.1 Extend auto run-state with optional versioned `knowledgeContext`, preserving parse compatibility for every existing state without the field and keeping frozen retention mode independent.
- [x] 3.2 Update retain/codify routing instructions to resolve and persist knowledge context before candidate creation, then reuse and revalidate it on resume rather than consulting a new cwd.
- [x] 3.3 Add run-state and retention tests for first-entry freezing, planning-store/project-owner divergence, resume from another directory, conflicting selectors, stale identity refusal, and conservative migration of pre-context state.

## 4. Boundary and Compatibility Verification

- [x] 4.1 Verify valid candidate v1 and manifest v1 project/global fixtures remain readable and are not rewritten merely by context resolution.
- [x] 4.2 Verify this slice does not add store canonical directories, store manifest/candidate fields, promotion policy, effective-set merging, precedence, ledger source changes, or tool-home behavior; those remain exclusively assigned to the scope and materialization children.
- [x] 4.3 Run targeted knowledge, learned-skill core, store namespace, pointer-root, retention, run-state, locale, and completion tests, then run the project typecheck and full test suite.
- [x] 4.4 Run or obtain Windows CI verification for selector paths, canonical identity comparisons, pointer projects, and frozen-context resume; keep all new path expectations platform-native.
