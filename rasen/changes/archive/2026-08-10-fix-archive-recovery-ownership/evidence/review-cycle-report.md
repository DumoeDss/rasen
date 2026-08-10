# Review Cycle Report: fix-archive-recovery-ownership

- Branch: `fix/archive-transaction-recovery-follow-up`
- Integration base: `dev/0.1.7`
- Review tier: A (role-isolated implementation, design-level fix, and fresh non-author re-review)
- Rounds completed: 2
- Status: CLEAN
- Current canonical findings: **0 Blocker / 0 Major / 0 Minor / 0 Trivial**

## Role separation

- **Original implementation:** produced by the Tier A archive-child implementer.
- **Round 1 review:** independent report-only reviewer; found F1–F4 (2 Blocker, 2 Major).
- **Design-level fix:** `/root/fix_archive_review_findings`; a fresh non-author fixer that addressed F1–F4 and added three follow-up invariants.
- **Round 2 review:** `/root/review_archive_recovery_delta`; fresh report-only reviewer, not the original author or fixer.

No reviewer edited product code/tests/tasks, and no author/fixer supplied the final CLEAN verdict.

## Round summary

| Round | Findings (Blocker/Major/Minor/Trivial) | Fixed by | Confirmed by | Outcome |
|---|---:|---|---|---|
| 1 | 2/2/0/0 | — | Independent Round 1 reviewer | FAIL; F1–F4 routed to non-author fixer |
| Design-level fix | — | `/root/fix_archive_review_findings` | — | F1–F4 plus comparator/retry/decimal follow-ups implemented |
| 2 | 0/0/0/0 | — | `/root/review_archive_recovery_delta` | CLEAN |

## Finding disposition

| Finding | Final state | Closure |
|---|---|---|
| F1 legacy delete progress/absence bypass | Resolved | Complete authority gate precedes all cleaner progress and absence interpretation; missing/prior-progress legacy regressions pass. |
| F2 timestamps omitted from destructive identity | Resolved | Six-field exact source identity plus a bounded verified rename transition and complete post-rename claim authority; metadata-drift regressions pass. |
| F3 tombstone paths used as destructive operands | Resolved | Carrier text is validation evidence only; the resumed claim is reconstructed from immutable plan/transaction identifiers and mutation-operand regression passes. |
| F4 partial Win32 path flavor | Resolved | Native flavor reaches parsing and all relevant journal/tombstone/progress/association/source comparisons; actual Windows dispatch matrix passes. |
| Follow-up: mixed-case deterministic order | Resolved | Shared code-unit comparator permits `Z.log`/`a.log` plan creation and persistence. |
| Follow-up: restored retry state machine | Resolved | Old restored identity is cleared durably before the second destructive callback; surviving claims re-freeze identity, absent claims promote delete intent. |
| Follow-up: canonical decimal grammar | Resolved | Unsigned object fields and signed timestamp fields are validated independently in plan and journal recovery state. |

## Verification evidence

### Reviewer rerun

- Archive-engine targeted native-Windows selection: **28 passed, 65 skipped**.
- Cleaner/retry/source-removal fault selection: **4 passed, 52 skipped**.
- Focused ESLint: **pass**.
- Full build: **pass**.
- Strict child validation: **pass**.
- Archive-child `git diff --check` and strict UTF-8 decoding: **pass**.

### Fixer/author recorded, not counted as reviewer rerun

- Original implementation: **148 passed, 9 skipped** focused archive suites; **170 passed, 9 skipped** Windows placement.
- Design-level fixer: **27 passed, 66 skipped** original/new boundaries; **3 passed, 53 skipped** cleaner recovery; **1 passed, 55 skipped** combined crash selection; build/ESLint/UTF-8/diff green.

## Final gate

The mandatory non-author clean round is satisfied. No canonical finding remains in the archive child. Post-commit portfolio CI and integration-wide tests remain delivery evidence owned by the lead; they do not change this child review verdict unless new failures appear.
