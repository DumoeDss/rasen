## Context

Capstone of decision #5. Two catalogs exist: `getBuiltInWorkflowDefinitions()` (22 registry units) and `getExpertSkillDefinitions()` (21 experts: `{ id, dirName, template, sidecarSourceId? }`, no digest, one alias `qa-only`→`qa`, `experts.ts:50`). Experts install unconditionally (`skill-generation.ts:140`). Callers of `getExpertSkillDefinitions`: `execution-validation.ts`, `skill-generation.ts`, `transaction.ts`, `registry.ts`, `index.ts` (re-export), plus tests `builtins.test.ts` and `workflow-author-review.test.ts`.

The lead deferred four design questions to this doc. They are settled below, along with the scope split and the fully-specified design of the recommended 6b sibling.

## Scope split (this change = behavior-preserving unification)

- **This change (6a — registry unification)**: experts become `kind: 'expert'` catalog units with digests and sidecarSourceId; the two catalogs collapse; every caller migrates; list gains an expert group; the delete guard extends to `requires.skills`; the golden fixture gains 21 rows. **Install behavior is preserved** — generation still force-installs all experts.
- **Recommended sibling (6b — install-semantics flip)**: replace the always-install branch with profile-default + dependency closure, plus the migration rule for existing installs. This is the single riskiest behavioral change; isolating it lets 6a be verified behavior-neutral and 6b be reviewed in focus. Its design is fully settled in the "6b sibling design" section below so its planner starts from a spec, not a blank page.

## Decisions (this change, 6a)

### D1. Sidecar model — HYBRID (directory-copy + digest coverage), experts non-exportable this round

The core question. Three options:
- **Inline into `files[]`**: one uniform model, digest covers everything, packageable — but bloats every package with expert sidecar trees, and the `qa-only`→`qa` alias (two experts sharing one sidecar dir) becomes an awkward duplicate-or-reference in the flat `files[]` model.
- **Keep directory-copy**: no bloat, alias stays natural (`sidecarSourceId` points at the shared dir), but keeps a `kind: 'expert'`-specific materialization path — the "one model" goal is not fully reached.
- **Hybrid (chosen)**: keep directory-copy materialization (reuse the existing `copySkillSidecars` path that already reads `skills/experts/<sidecarSourceId ?? id>/`), give built-in experts an **empty `files[]`** but a **digest computed over template + sidecar tree**, and declare experts **non-exportable** via `.rasenpkg` this round.

Rationale: experts are built-in and not community-distributed yet, so the only reasons to inline (packaging/export) do not apply this round — declaring them non-exportable removes the only forcing function for inlining. The hybrid keeps packages lean, preserves the alias with zero special-casing beyond what exists, and still gives experts a digest so drift-healing works. Honest tradeoff: the expert materialization path stays special (not unified into `files[]`); if experts later become community-authored/exportable, inlining can be revisited then (the `files[]` field already exists on the definition, so it is a forward-compatible upgrade, not a breaking one).

**Expert digest preimage**: `{ format: 'rasen-expert-digest', version: 1, id, dirName, template, sidecars: [{ path, sha256 }] }`, where `sidecars` is the hashed sidecar tree resolved from `sidecarSourceId ?? id`. Distinct from `digestBuiltIn` (skill+command) and `computeWorkflowDigest` (inline files). Two experts sharing a sidecar dir (`qa`/`qa-only`) get different digests because `id`/`dirName`/`template` differ.

### D2. `kind: 'expert'` and list visibility

Add `'expert'` to `WorkflowKind` (child 2's union was left open for exactly this). `workflow list` shows `task`, `driver`, and `expert` groups by default and hides `internal` unless `--all` — experts are user-facing review/analysis tools a user legitimately browses, unlike driver sub-units. `--json` continues to expose all kinds.

### D3. Catalog unification and caller migration

`loadWorkflowCatalog` composes built-in workflows + built-in experts + user workflows into one catalog. Callers migrate:
- `registry.ts` collision map already tags `kind: 'workflow'|'expert'` (`registry.ts:112-122`) — it now reads experts from the catalog instead of a side table.
- `execution-validation.ts` `resolvePipelineExecutionSkillSets` builds known/enabled skill sets — experts now come from the catalog's `kind: 'expert'` subset.
- `transaction.ts` installable-set assertions treat experts as catalog members.
- `skill-generation.ts` sources the expert set from the catalog; **the always-install branch stays in 6a** (behavior preserved).
- `getExpertSkillDefinitions`/`getExpertSkillNames` either remain as thin catalog filters (least churn) or callers switch to `catalog.byKind('expert')`. Prefer keeping the helper names as catalog-backed filters to minimize blast radius.

### D4. Delete guard extends to `requires.skills`

Child 4's `createWorkflowUsageContext` scans `requires.workflows` and pipeline stage `skill:` refs, but not `requires.skills`. Add a `requires.skills` scan so an expert referenced by a workflow's `requires.skills` (e.g. `rasen-review` via `review-cycle`/`verify-enhanced`/`auto`) is protected. Built-in experts are non-deletable regardless (the existing `builtin_delete_forbidden` guard covers `source: 'built-in'`, which experts now are). This makes the protection meaningful for any future user-authored expert.

### D5. Golden fixture churn is intended

The built-in catalog projection gains 21 expert rows (`commandId: null`, `kind: 'expert'`). Regenerate `test/fixtures/workflow-registry/builtins-v1.json` and its `builtins.test.ts` assertion to include them, in catalog order. This is the first sibling where the golden fixture legitimately moves — spec'd as intended, not incidental. The expert template parity hashes in `skill-templates-parity.test.ts` do NOT move (6a edits registry wiring, not template bodies); if any parity hash moves, the edit leaked into a template.

## 6b sibling design (settled here for its planner)

Recommended sibling `concept-coherence-expert-install-flip`:

- **Profile sets**: `full` profile = all built-in workflows + all 21 experts (so existing `full` installs are unchanged). `core` profile = CORE workflows + the quality-floor experts. **Quality floor = `review`, `cso`, `qa`, `qa-only`, `benchmark`, `design-review`** (the six review experts the built-in pipelines dispatch). Non-review experts (careful/guard/freeze/tdd/navigator/etc.) are opt-in outside `full`.
- **Installation = profile default ∪ dependency closure**: replace `skill-generation.ts:140` always-install with: install the experts named by the resolved profile PLUS the closure of every selected workflow's `requires.skills` (child 4's edges already pull `review`/`cso`/`qa`/`qa-only`/`design-review` via `verify-enhanced`/`review-cycle`/`auto`). This is the riskiest change — spec test coverage exhaustively: each profile installs the right expert set; closure pulls required experts even when the profile omits them; a deselected non-floor expert is removed on update ONLY when nothing references it.
- **Migration for existing installs (conservative, non-regressive)**: `full` is the default profile, and `full` includes all 21 experts, so the common install is unchanged. For `core`/`custom` installs, the profile+closure now governs, but update MUST NOT remove an expert that is (a) in the resolved profile, (b) in the dependency closure, or (c) protected by the referrer guard. Spec an explicit "update never uninstalls a referenced or profile-included expert" scenario.
- **Delete protection** already lands in 6a (D4), so 6b relies on it rather than adding it.

## Risks / Trade-offs

- **Catalog unification blast radius**: 5+ caller sites plus the collision map. Mitigated by keeping `getExpertSkillDefinitions`/`getExpertSkillNames` as catalog-backed filters so most call sites are source-compatible.
- **Digest for experts is new**: a wrong preimage would spuriously drift every expert on upgrade. Mitigated by covering template + sidecar hashes only (deterministic) and adding a golden expert-digest test.
- **Concurrent siblings (5a/5b)**: 5b edits `workflow-author`/`workflow-review` templates and moves their parity hashes; this change must land AFTER 5b (LEAD DAG). CLI identifiers from 5a/5b are re-verify-flagged. If 5b has not landed, the expert set/templates this change enumerates are still valid (it does not depend on 5b's prose, only on the templates existing).

## Migration Plan

6a is behavior-preserving: experts still all-install, now as catalog units. No user-visible change except experts appearing in `workflow list` and being protected from deletion. The install flip and its migration are 6b.

## Open Questions

None blocking. The inline-vs-directory sidecar question (the one the discussion flagged as core) is resolved as hybrid + non-exportable this round, with a forward-compatible path to inlining if experts ever become community-distributed.
