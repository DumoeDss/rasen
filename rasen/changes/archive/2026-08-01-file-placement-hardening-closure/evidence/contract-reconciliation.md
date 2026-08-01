# Contract reconciliation ledger

Date: 2026-08-01
Saved PR baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`
Integration order: migration safety -> archive engine -> root routing -> Windows
legacy-lock contention correction -> closure. The lock correction is
implementation-independent of the placement children but was discovered by
the closure P4 gate and must be included before closure declares the normative
union complete.

This ledger is the merge authority for the closure. `MODIFIED` requirements
replace the main requirement with the same title; `ADDED` requirements are
inserted once. Overlaps are merged semantically in dependency order rather
than applied as last-writer-wins text.

## Migration-safety child

| Child capability / requirement | Main destination | Design destination | Reconciliation |
| --- | --- | --- | --- |
| `file-placement` / Ephemera cleaner uses a whitelist by filename, never discretionary deletion | `rasen/specs/file-placement/spec.md` | 清理纪律 | Replace the stale filename-only contract with schema-aware immutable classification, recursive source signals, exact preserve reporting, typed blockers, and platform path identity. |
| `work-migration` / Migration is preview-first and idempotent | `rasen/specs/work-migration/spec.md` | 兼容与迁移 | Semantic merge with root-routing's requirement: safety contributes pure complete planning, preview/apply action identity, visible destructive actions, no-mint preview, and idempotence; routing contributes frozen roots and exact-plan command orchestration. |
| `work-migration` / A command migrates legacy machine-home state to terminal locations | same | 兼容与迁移 | Replace stale reporting-only archived deletion and broad scoped scans with actual apply outcomes and ownership-proven scoped migration. |
| `work-migration` / Migration conflicts never overwrite — both copies are kept | same | 兼容与迁移 | Replace check-then-move language with exclusive publication, identity verification, directory-child race handling, and preservation of both copies. |
| `work-migration` / Migration filesystem failures are explicit and fail closed | same | 兼容与迁移 | Add once: only `ENOENT` is absence; non-absence scan errors block; `EXDEV` alone permits exclusive copy fallback; source-removal failures remain incomplete and recoverable. |

## Archive-engine child

| Child capability / requirement | Main destination | Design destination | Reconciliation |
| --- | --- | --- | --- |
| `cli-archive` / Archive Process | `rasen/specs/cli-archive/spec.md` | Archive transaction | Replace direct move with one immutable plan/apply engine and transaction-identity resume. |
| `cli-archive` / Ephemera cleaning at archive time | same | 清理纪律 | Consume the complete cleaner plan; source signals preserve; incomplete inspection blocks all mutation. |
| `cli-archive` / `--keep-ephemera` | same | 清理纪律 | Preserve complete effective inventory without hiding inspection failures. |
| `cli-archive` / `--dry-run` | same | Archive transaction | Emit the exact saved plan, complete blockers/dispositions/sidecar/spec intent, and perform no write. |
| `cli-archive` / `archive.json` | same | `archive.json` | Finalize and atomically verify accounting before active-source removal; ambiguous Git/evidence failures remain journaled. |
| `file-placement` / Archive publication is recoverable and source-last | `rasen/specs/file-placement/spec.md` | Archive transaction | Add once: verified same-parent staging, no-clobber publication, source-last cleanup, exact recovery journal, and native path identity. |
| `file-placement` / Archive dispositions classify every change-produced file | same | Archive dispositions | Replace stale direct-directory-move wording with one engine and verified payload/accounting across every entry point. |
| `file-placement` / Handoff absorption is the sole discretionary point at archive | same | handoff / Archive transaction | Skill writes complete change-bound intent without mutating active files; engine validates it and transforms only the staged payload; malformed intent blocks. |
| `file-placement` / `archive.json` records disposition accounting | same | `archive.json` | Final recursive evidence inventory, distinct no-judgment state, actual cleaner outcomes, fail-closed Git/evidence facts, and no post-hash mutation. |
| `opsx-archive-skill` / Archive Process | `rasen/specs/opsx-archive-skill/spec.md` | Archive consumers | Single and bulk consumers use one saved plan per change. |
| `opsx-archive-skill` / Archive closes the delivery chain | same | SHA cross-stamping | Finalize ship-log archive facts before evidence hashing; no later append. |
| `opsx-archive-skill` / Bookkeeping step always moves in-repo | same | Archive consumers | Engine owns publication; generated templates contain no direct move. |
| `opsx-archive-skill` / Handoff absorption | same | handoff | Express strict intent only; no pre-engine delete/move. |
| `opsx-archive-skill` / Cleaner outcome | same | 清理纪律 | Report completeness, blockers, signals, deleted and preserved paths truthfully. |
| `opsx-archive-skill` / Ensures `archive.json` | same | `archive.json` | Journaled/manual recovery is never summarized as success. |
| `opsx-archive-skill` / Probes recorded as 静置 | same | probes | Validate containment and commit before apply; invalid facts block. |
| `opsx-ship-command` / Ship Log | `rasen/specs/opsx-ship-command/spec.md` | SHA cross-stamping | Evidence prefix is immutable; in-ship archive receives final bytes. |
| `opsx-ship-command` / Ship honors archive timing | same | Archive consumers | In-ship invokes the engine after evidence finalization; on-merge behavior remains explicit. |
| `opsx-ship-command` / Ship stamps delivery chain | same | SHA cross-stamping | Use non-self-referential code/planning facts and final archive accounting. |
| `archive-quality-capture` / Quality Artifact Scanning | `rasen/specs/archive-quality-capture/spec.md` | evidence / Archive transaction | Recursively scan finalized `evidence/`, keep legacy top-level compatibility, and fail closed on unreadable reports. |
| `archive-quality-capture` / Quality Summary Written to Archive | same | `archive.json` | Quality metadata is final before accounting and retains source-path identity. |
| `sha-cross-stamping` / Ship log records a two-ended delivery chain | `rasen/specs/sha-cross-stamping/spec.md` | SHA cross-stamping | Archive facts are finalized before hash; no planning/archive-commit self-reference is appended later. |

## Root-routing child

| Child capability / requirement | Main destination | Design destination | Reconciliation |
| --- | --- | --- | --- |
| `file-placement` / Placement consumers freeze one explicit root context | `rasen/specs/file-placement/spec.md` | 三种 root / Store 路径 | Add once: planning, execution, legacy-home owner, and explicit identity flavor are frozen at the authority boundary; unavailable execution is never guessed. |
| `work-migration` / Migration is preview-first and idempotent | `rasen/specs/work-migration/spec.md` | 兼容与迁移 | Merge into the safety requirement: complete plan carries the frozen root context and the registered command applies the exact displayed object without rescanning or re-resolution. |
| `work-migration` / Work migration freezes planning, execution, and legacy-home ownership | same | Store 路径 / 兼容与迁移 | Add once with shared mutually exclusive selectors and Store/member ownership. |
| `work-migration` / Migration compatibility surfaces remain stable | same | 配置和命令 / 兼容与迁移 | Add once; root fields are additive and safety guarantees remain intact. |
| `session-supervision` / Session listing is filterable by space and joins run state per session's own space | `rasen/specs/session-supervision/spec.md` | Store 路径 | Replace stale space-derived machine-home lookup with the frozen execution root and its legacy-home owner; missing/stale execution returns absent without fallback or writes. |

## Windows legacy-lock contention child

| Child capability / requirement | Main destination | Design destination | Reconciliation |
| --- | --- | --- | --- |
| `opsx-pipeline-registry` / Concurrent pipeline imports survive transient Windows registry-lock sharing errors | `rasen/specs/opsx-pipeline-registry/spec.md` | 安全与集成状态 | Add once: Windows `EPERM`, `EACCES`, and `EBUSY` lock-open errors retry only within the existing deadline; clearing contention reaches the existing semantic winner/`pipeline_already_exists` result, persistent contention returns the existing busy/timeout diagnostic, and other/non-Windows errors retain create-failed behavior. |

## Closure capability

| Closure requirement | Main destination | Design/evidence destination | Reconciliation |
| --- | --- | --- | --- |
| `ci-test-harness` / Cross-Platform Test Matrix on Pull Requests | `rasen/specs/ci-test-harness/spec.md` | native CI evidence | Replace with general matrix plus dedicated Node-floor native archive-recovery matrix; required aggregate depends on both. |
| `ci-test-harness` / Repository-wide test completion is bounded and auditable | same | full-suite evidence | Add once: a 480-second outer bound and summary/exit evidence from a monolith or exact, disjoint, deterministic direct partitions. Local process cleanliness is `NOT EVALUATED` without spawn-time OS lineage; diagnostics never become ownership claims, bespoke/manual termination is prohibited, and any observed or suspected survivor remains blocking for CI/orchestration. |

## Overlap proof

- `file-placement` overlaps only at the cleaner/disposition boundary. The
  migration cleaner defines immutable classification; the archive engine may
  consume it but never reclassify it. Root routing adds only frozen ownership.
- `work-migration` has one merged preview-first requirement. It contains every
  safety scenario and every routing/compatibility scenario exactly once; the
  no-clobber and filesystem-failure requirements remain separate because they
  define apply primitives, not command orchestration.
- No archive consumer retains external spec sync, direct `mv`, pre-publication
  cleaner deletion, or a post-hash archive-commit append.
- The Windows legacy-lock requirement is independent of placement overlap. Its
  requirement and all three scenarios appear exactly once in
  `opsx-pipeline-registry`; no timeout, transaction, or non-Windows diagnostic
  contract is redefined elsewhere by closure.
