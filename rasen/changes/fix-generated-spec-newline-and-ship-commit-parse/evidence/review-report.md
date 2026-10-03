# Review Report — fix-generated-spec-newline-and-ship-commit-parse

**Mode:** dispatched (report-only). No source file was modified; only this report was written.
**Diff reviewed:** `git diff upstream/dev/0.1.8...HEAD` — `0dceb2f3` (code + tests), `dea4c046` (planning artifacts).
**Branch:** `fix/generated-spec-newline-and-ship-commit-parse`
**Round:** 1 of a bounded review cycle.

## Scope check

- **Status:** CLEAN.
- **Intent:** normalize generated canonical specs to one terminal newline; read a ship-log `**Commit:**` code span as a commit through one shared reader.
- **Delivered:** exactly that. Three production files, three test files, four planning artifacts. No unrelated refactor, no new flag, no new dependency, no schema bump.

## Findings

### Blocker — none

No data loss, corruption, security hole, failing gate, or missing required behavior was found.

### Major — none

No wrong behavior on a plausible path and no significant regression was proven. The two candidate regressions below are real narrowings of accepted input but do not reproduce against any of the 67 ship logs present in this repository.

### Minor

#### M-1 — `readRecordedShipCommit` stops at the first `**Commit:**` label; the removed regex skipped an unreadable one

`src/core/archive-engine.ts:129`

The removed expression `/^\*\*Commit:\*\*\s*([0-9a-f]{7,64})\s*$/im` required the whole line to be a hash, so `String.match` kept scanning and returned the **first readable** `**Commit:**` line. The new expression matches the **first labelled line regardless of its value**, then validates it, so a later readable line is never reached. Measured (node, both expressions side by side):

| input | removed regex | new reader |
|---|---|---|
| `**Commit:** <commit-hash>` then `**Commit:** 8a11f74…` | `8a11f74…` | `null` |
| fenced template example first, real field after | `8a11f74…` | `null` |

Multi-field ship logs are real in this repository: `rasen/changes/archive/2026-08-09-fix-existing-change-workspace-binding/evidence/ship-log.md:6,44` carries two `**Commit:**` lines (header field plus a `## CI Fix Follow-up` section). Unreadable header fields are also real: `rasen/changes/archive/2026-07-09-telemetry-admin-console/ship-log.md:6` holds `<filled post-commit>`. No single log combines both today, so nothing in the corpus regresses — but the composition is reachable, and when it is hit the archive section silently omits `**Ship commit:**`, which is the exact defect this change exists to remove.

First-field-wins is arguably the *better* semantic (a follow-up section's commit is not the ship commit). The defect is that the choice is silent: neither the code comment nor the `sha-cross-stamping` delta says which field is authoritative when several exist, and the delta's prose reads "the log's `**Commit:**` field" in the singular.

Recommended fix — pick one and state it:

```suggestion
export function readRecordedShipCommit(content: string): RecordedShipCommit {
  const matches = [...content.matchAll(/^\*\*Commit:\*\*[ \t]*(.*?)[ \t]*\r?$/gim)];
  if (matches.length === 0) return { field: 'absent', commit: null };
  for (const match of matches) {
    const unwrapped = /^`(.*)`$/.exec(match[1])?.[1] ?? match[1];
    if (/^[0-9a-f]{7,64}$/i.test(unwrapped)) {
      return { field: 'present', commit: unwrapped };
    }
  }
  return { field: 'present', commit: null };
}
```

Or keep first-field-wins and add a scenario to `specs/sha-cross-stamping/spec.md` stating that the **first** `**Commit:**` field is authoritative and a later field is never consulted.

#### M-2 — An observed real ship log with a qualified code-span commit still records nothing, contradicting the proposal's own justification

`src/core/archive-engine.ts:132-135`, `proposal.md` ("Why", paragraph 3)

The proposal justifies widening with: *"the same ship-log template already teaches qualified SHA values in the adjacent `**Store commit:**` field, so the strict whole-line match is unnecessarily brittle."* The implementation rejects exactly that shape. Scanning all 67 `ship-log.md` files under `rasen/`, the new reader still yields `null` for four present fields, including the one code-span log that motivated the framing:

| value | file |
|---|---|
| `` `8d6ae87` (pushed `3793c5f..8d6ae87`) `` | `rasen/changes/archive/2026-07-07-remove-gstack-parallel-lifecycle/ship-log.md:6` |
| `<filled post-commit>` | `rasen/changes/archive/2026-07-09-telemetry-admin-console/ship-log.md:6` |
| `SELF (this log is included in the single local ship commit…)` | `rasen/changes/archive/2026-08-05-store-planning-foundation-v2/evidence/ship-log.md` |
| `SELF (…)` | `rasen/changes/archive/2026-08-06-store-planning-scope-routing/evidence/ship-log.md` |

The rejection is deliberate and documented (`design.md`, defect-2 decision table, row `**Commit:** <hash> (dirty)`), so this is not an accidental bug. It is still an inconsistency worth resolving before landing: either

- delete the `**Store commit:**` qualified-value sentence from `proposal.md` "Why", since it argues for behavior the change does not deliver, **or**
- extract the leading token of a qualified value before validating (`` `8d6ae87` (pushed …) `` becomes `8d6ae87`), which the same two-step shape supports without weakening the unmatched-backtick rejection.

For reference, the fix does work on real data: three corpus logs go from `null` to a recorded commit — `2026-08-06-detect-omp-host-runtime`, `omp-install-target-and-context-probe`, `runtime-adapter-interface-extraction` (all `evidence/ship-log.md`).

### Trivial

#### T-1 — `RecordedShipCommit.field` is computed but never read

`src/core/archive-engine.ts:109-113`

Both call sites discard it: `src/core/archive.ts:621` and `src/core/archive-engine.ts:9147` use `.commit` only. Verified by search across `src/` and `test/` — no reader of `.field` exists. `design.md` states this is intentional forward compatibility for a deferred blocker change, so it is a taste call, not a bug; it does collide with the project rule against unused surface. Either drop `field` and return `string | null` until the deferred change needs it, or leave it and let the LEAD record it as accepted-known.

#### T-2 — The removed regex accepted a hash on the line *after* the label; the narrowing is undocumented

`src/core/archive-engine.ts:129`

`\s` in the removed pattern matched `\n`, so `**Commit:**` followed by a newline and `8a11f74…` resolved to the hash; `[ \t]*` plus a line-scoped `(.*?)` does not. Same class: a non-`[ \t]` separator such as U+00A0 was accepted before and is not now. The new behavior is more correct (the value of a one-line field is what is on that line) and matches the sibling idiom at `src/core/archive-engine.ts:106`, so no code change is needed — but nothing in the diff records that a value spanning a line break is deliberately no longer read.

## Verified — claims checked, no finding

Each item below was checked against code or executed evidence rather than assumed.

1. **"Not BREAKING."** Holds. `rebuilt` is stored verbatim in the plan (`src/core/archive.ts:2073`) and written as-is (`src/core/archive-engine.ts:10014`); every `rebuiltHash` comparison (`7174`, `9954`, `10017`, `10071`, `10261`, `10283`) is intra-transaction against that same stored string. `sourceSha256` digests the delta source (`src/core/specs-apply.ts:256`; checked at `archive-engine.ts:3125`, `9741`). `targetPrecondition` digests the on-disk canonical file at planning time (`specs-apply.ts:440`). `afterSha256` is derived from the stored `rebuilt` per transaction (`src/core/store/finalization/spec-actions.ts:37,56`); no source path compares transaction N's `beforeSha256` to N-1's `afterSha256`.
2. **"No existing test pinned the previous output."** Holds for the assertions I could reach: the exact-content spec assertions in `test/commands/store-root-selection.test.ts:780` and `test/commands/archive-outcome-cli.test.ts:259` are *unchanged-on-abort* checks, and every `rebuilt` literal in `test/core/archive-engine.test.ts` / `archive-standalone-baseline.test.ts` is a hand-written fixture, not serializer output.
3. **Terminal-newline blast radius.** 221 canonical specs under `rasen/specs/`; 94 currently end with two newlines and will lose the blank line once, on their next delta rewrite; 1 (`rasen/specs/cli-list/spec.md`) currently ends with no newline and gains one; 2 have a section after `## Requirements` and are already single-newline. This matches `proposal.md`'s "single observable difference" claim exactly.
4. **`replace(/\s+$/, '')` cannot eat meaningful content here.** No canonical spec in the corpus has a non-newline trailing-whitespace tail, so the strip is newline-only in practice. In principle it also removes trailing spaces on the final content line — which the `openspec-conventions` delta explicitly requires ("SHALL NOT end with … trailing whitespace"). A trailing fenced block is unaffected: the closing fence is not whitespace.
5. **`rebuilt` can never be a bare newline.** `parts.headerLine` is always the non-empty `## Requirements` line (literal fallback at `src/core/parsers/requirement-blocks.ts:35`, or the matched line at `:55`), and it is never filtered — only index 0 is (`specs-apply.ts:735`). Minimum output is `## Requirements` plus one newline.
6. **No bad interaction with the `emptied` path.** An emptied spec is deleted, not written (`specs-apply.ts:1030`), and its action digests to `afterSha256: null` (`store/finalization/spec-actions.ts:44`, pinned by `test/core/store/finalization-spec-sync.test.ts:338`). The normalized `rebuilt` is never consumed on that path.
7. **`commit: null` with `field: 'present'` is threaded correctly.** `archive.ts:621` still records `recordedCommit: null` and adds no blocker; `archive-engine.ts:9147`'s `plan.shipLog.recordedCommit ?? readRecordedShipCommit(content).commit` is correct — planning reads the source log, finalization the staged copy of the same payload, and the planned value wins when present, so the two can no longer disagree.
8. **Delta specs match the implementation.** The `sha-cross-stamping` MODIFIED block preserves all four canonical scenarios (`rasen/specs/sha-cross-stamping/spec.md:12,19,25,31`) verbatim plus both existing prose paragraphs, and adds three; nothing was dropped, so `findMissingCurrentScenarios` will not refuse it. The `openspec-conventions` ADDED requirement name does not collide with any of the 13 existing requirement headers in that capability. The only prose gap is the multi-field ambiguity in **M-1**.
9. **Test quality — no finding.** Both new suites discriminate. `test/core/specs-apply.test.ts` — ran it: **23 passed** in 1.23 s; the created, updated, terminators (x3) and CRLF cases all assert the trailing-newline run is exactly one newline, which is two with the fix reverted. `test/core/archive-engine.test.ts -t "records a ship commit written as a Markdown code span"` — ran it: **1 passed**; the fixture `plan()` supplies no `shipLog`, so the assertion genuinely traverses the fallback reader and fails with the fix reverted. In `test/core/archive.test.ts:2299` the seven non-code-span rows pass under the old regex by design — they defend the *rejection* contract against the optional-backtick widening alternative that `design.md` rejected, so they are not padding. `preserves a section that follows the requirements` and `rewrites an already-normalized spec to identical bytes` likewise pass pre-fix, but they guard the new trailing-whitespace strip against over-trimming and pin the idempotency scenario. Isolation is sound: the table sits under the `ArchiveCommand` `beforeEach` at `test/core/archive.test.ts:87`, so each row gets a fresh temp root.
10. **Conventions.** The new export mirrors its sibling `hasReservedArchiveShipLogSection` (same file region, same `[ \t]*\r?$` line idiom, same import block in `archive.ts`). No barrel re-export exists for either, so none was missed. The removed `extractRecordedShipCommit` has no remaining references.

## Counts

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 2 (M-1, M-2) |
| Trivial | 2 (T-1, T-2) |

Worst issue: **M-1** — silent first-field-wins narrowing in `readRecordedShipCommit`.

## VERDICT

**SHIP WITH MINOR FIXES.** Both defects are real, correctly diagnosed, and correctly fixed; the compatibility analysis in `design.md` survives independent verification and the new tests genuinely fail without the fix. Nothing blocks landing. Before merge, resolve **M-1** (iterate to the first readable `**Commit:**`, or state first-field-wins in the `sha-cross-stamping` delta) and **M-2** (drop the qualified-SHA justification from `proposal.md`, or accept qualified values); **T-1** and **T-2** may be accepted-known.

---

# Round 2 — non-author verification of the fix delta

**Scope:** the uncommitted working tree versus `dea4c046` only (`git diff`), six files. I authored none of it.
**Method:** read every hunk, re-verified every cited `file:line`, re-ran the regex comparison across all 67 real `ship-log.md` files in this repository, and ran the updated table (`vitest run test/core/archive.test.ts -t "records one ship commit through planning and finalization"` — **11 passed**).

## Round-1 findings — disposition

### M-1 — first *readable* `**Commit:**` field — **RESOLVED**

`src/core/archive-engine.ts:129-138`

```ts
export function readRecordedShipCommit(content: string): string | null {
  for (const [, value] of content.matchAll(
    /^\*\*Commit:\*\*[ \t]*(.*?)[ \t]*\r?$/gim
  )) {
    const unwrapped = /^`(.*)`$/.exec(value)?.[1] ?? value;
    if (/^[0-9a-f]{7,64}$/i.test(unwrapped)) return unwrapped;
  }
  return null;
}
```

Loop audited: the `g` flag is present (`matchAll` throws without it); the pattern cannot match empty, so `lastIndex` always advances and the iteration terminates; a non-validating line falls through the `if` and does **not** end the scan; the first validating line returns and the lazy generator stops advancing there, so the early return really is early. Group 1 always participates, so `value` is `string` under `strict` with no `noUncheckedIndexedAccess` in `tsconfig.json`, and `String.prototype.matchAll` is in `lib: ["ES2022"]`. The implementation is also better than the fix I suggested in round 1, which spread the iterator into an array and scanned the whole document before deciding.

Re-measured across all 67 real ship logs, comparing the **original upstream** expression, the round-1 reader, and this one: **0 values lost versus the original**, 3 gained, and round-1/round-2 agree on every real file. Synthetic confirmation of the repaired case:

| input | original upstream regex | round-1 reader | round-2 reader |
|---|---|---|---|
| `**Commit:** pending` then `**Commit:** 8a11f74…` | `8a11f74…` | `null` | `8a11f74…` |
| two readable fields | first | first | first |
| hash on the line after the label | `8a11f74…` | `null` | `null` (documented) |

Test rows: `test/core/archive.test.ts:2288-2301` adds three rows through the real plan-and-apply path. `an unreadable field followed by a readable one` is the genuine regression guard — it returns `null` under the round-1 reader and fails. `two readable fields` and `a hash on the line after the label` pass under the round-1 reader by construction; they are not padding, because the first pins first-wins against a last-wins loop (a live hazard the moment a loop exists) and the second pins the deliberate narrowing against the original upstream expression, which returned the hash. The `commitLine` → `commitLines` rename is complete; no stale identifier remains.

### M-2 — qualified-SHA justification — **RESOLVED** (artifact only, no behavior change)

`proposal.md:8` and `proposal.md:33`

The sentence claiming the template "already teaches qualified SHA values in the adjacent `**Store commit:**` field" is gone. It is replaced by an accurate statement that a qualified value such as `` `8d6ae87` (pushed `3793c5f..8d6ae87`) `` in `rasen/changes/archive/2026-07-07-remove-gstack-parallel-lifecycle/ship-log.md` "is out of scope and stays unreadable", cross-referenced to `## Out of Scope`, which now names the qualified form and says the decision to read its leading hash or block on it belongs to the deferred change. I re-read both paragraphs in full: nothing in them promises behavior the reader does not deliver, and `## What Changes` now lists the trailing qualifier among the rejected forms.

### T-1 — drop the discriminator — **RESOLVED**

`src/core/archive-engine.ts:129`, `src/core/archive.ts:621`, `src/core/archive-engine.ts:9148`

`RecordedShipCommit` is deleted and the signature is `readRecordedShipCommit(content: string): string | null`. Both call sites take the value directly, and the finalization fallback ordering `plan.shipLog.recordedCommit ?? readRecordedShipCommit(content)` is preserved with no blocker added. A search for `RecordedShipCommit`, `.field`, `field: 'present'` and `field: 'absent'` across `src/`, `test/` and the change directory returns only this report's own round-1 text. `design.md:75` records why the discriminator is absent and when it returns.

### T-2 — document the line-scoping narrowing — **RESOLVED**

`design.md:58-59`, `proposal.md:12`, `specs/sha-cross-stamping/spec.md:7,44-48`

Both decisions are now stated as decisions rather than left implicit: a "First readable field wins" bullet and a "A value is line-scoped" bullet in `design.md`, matching prose in `proposal.md` "What Changes", a rewritten normative paragraph in the delta, and a new scenario `A hash on the line after the label is not read`. The decision table gained a `Replaced expression` column so the three-way comparison is explicit. The U+00A0 separator case is named too.

**MODIFIED-block completeness re-checked** — this is the risk a MODIFIED requirement carries, since it replaces the canonical block wholesale. The delta's requirement now carries 10 scenarios; all four that exist in `rasen/specs/sha-cross-stamping/spec.md:12,19,25,31` are present verbatim (`spec.md:13`, `:55`, `:61`, `:67` in the delta), and both original prose paragraphs survive. Nothing was dropped.

### Second reviewer's Major — the "not BREAKING" overclaim — **RESOLVED**, and it does not overclaim in the other direction

`proposal.md:14`, `design.md:88`

The bullet no longer says "Not BREAKING"; it says "No serialized contract changes" and then enumerates *two* observable behavior differences, the second being the Store v2 one. Every citation checks out against the source:

- `resolveCodeCommitCandidate` ranks flag → ship-log → execution `HEAD` at `src/core/store/finalization/reachability.ts:29-44` (ship-log branch `:37-39`, execution-head branch `:40-42`).
- `proveLanded` feeds `input.archive.shipLog.recordedCommit` into it at `src/core/store/finalization/module.ts:1331-1335`.
- `landed_commit_unresolved` is thrown at `reachability.ts:84`, inside the cited `:78-93`; `landed_commit_unreachable` at `reachability.ts:157`, inside the cited `:155-166`.
- The planning-only escape (`context.implementation === 'none'`) returns before any commit is resolved at `module.ts:1325-1330`, so the "planning-only changes are unaffected" clause is correct.

The load-bearing claim — that `change-finalization-outcomes` *requires* that priority, so the refusal is the specified outcome rather than a defect — is **true**, not a rationalization: `rasen/specs/change-finalization-outcomes/spec.md:55` reads "A code-backed `landed` finalization SHALL resolve a code commit in fixed priority — an explicitly supplied commit, the Change's recorded ship-log commit, then the execution worktree's `HEAD`". Equally, the text does not swing too far the other way: it states plainly that a change which previously landed by proving `HEAD` "can now be refused", and it does not claim the impact is zero or purely theoretical.
## New findings introduced by this delta

Two **Trivial** documentation-precision items, both raised independently by the parallel adversarial reviewer and confirmed here against source. Neither is a code defect and neither blocks; the runtime behavior in both cases is correct or preferable.

### N-1 (Trivial) — the Impact bullet states the Store v2 consequence unconditionally, omitting `--commit`

`rasen/changes/fix-generated-spec-newline-and-ship-commit-parse/proposal.md:26`

"A code-backed change whose ship log presents its commit as a code span is therefore proven against that commit instead of the execution `HEAD` from this change on" is unconditional, but the ship-log commit is only the **second**-ranked candidate: an explicit `--commit` outranks it (`src/core/store/finalization/reachability.ts:34-36`, fed from `request.commit` at `src/core/store/finalization/module.ts:1332`), and `--commit` is a real archive option (`src/core/archive.ts:371,409,1668`). With it supplied, the recorded ship commit is never consulted. The bullet's own citation `reachability.ts:29-44` exposes the flag branch, and the `design.md` Risks entry is correctly non-absolute ("ranks it above the execution `HEAD`"), so only this sentence overstates. Fix: qualify it — "absent an explicit `--commit`, … is proven against that commit instead of the execution `HEAD`".

### N-2 (Trivial) — "can never record different ship commits" is absolute, but a plan saved by a pre-change build can diverge from the transaction that applies it

`rasen/changes/fix-generated-spec-newline-and-ship-commit-parse/specs/sha-cross-stamping/spec.md:9`; mechanism at `src/core/archive-engine.ts:9147-9148`

The requirement reads "Archive planning and archive finalization SHALL read the field through one shared rule, so a saved plan and the transaction that applies it can never record different ship commits for the same log." Finalization falls back to re-reading the staged log whenever the plan recorded none: `plan.shipLog.recordedCommit ?? readRecordedShipCommit(content)`. A plan saved by a pre-change build for a code-span log carries `recordedCommit: null`; applied by a post-change build, the fallback now reads the hash and writes `**Ship commit:** <hash>` into the archive section while the saved plan's JSON still says `null`. That is literally a saved plan and its applying transaction recording different ship commits for the same log — and `proposal.md:14`'s neighbouring claim that "a plan saved by an older build therefore still applies unchanged" holds for `rebuilt` but not for this half.

The runtime effect is benign or positive: the archive section gains the true provenance, `archive.json` digests the finalized content at apply time so no digest mismatch arises, and Store v2 reads the *plan's* `null` (`module.ts:1333`) and therefore falls through to `HEAD` exactly as it did before the upgrade. No code change is warranted. Fix the prose: scope the guarantee to one build — "a saved plan and the transaction that applies it, running the same build, can never record different ship commits" — or add a sentence noting that a plan saved before this rule changed may carry no commit while the applying transaction reads one.

## Round-2 counts

| Severity | Round-1 open | Resolved in round 2 | Still open | New in round 2 |
|---|---|---|---|---|
| Blocker | 0 | — | 0 | 0 |
| Major | 1 (second reviewer) | 1 | 0 | 0 |
| Minor | 2 (M-1, M-2) | 2 | 0 | 0 |
| Trivial | 2 (T-1, T-2) | 2 | 0 | 2 (N-1, N-2) |

Also checked and clean: early-terminating or non-terminating loop; regex `lastIndex` state from a reused `g`-flagged literal (`matchAll` clones, and the literal is built per call); a type error from destructuring the match (`strict` without `noUncheckedIndexedAccess`, `lib: ["ES2022"]`); over-scanning a large log (the generator is lazy, so the early return is real); stale `commitLine` identifiers after the rename; a dropped scenario in the MODIFIED block; and every `file:line` citation in the artifacts.

## ROUND-2 VERDICT

**SHIP.** All five prior findings are resolved with verifiable evidence, and the delta introduces no code defect at any severity. The one code change is narrower and better than the fix I proposed in round 1 — it early-returns off a lazy iterator instead of materializing every match — it is pinned by a test row that genuinely fails without it, and it loses nothing the expression it replaced accepted except the single cross-line form that is now a documented, spec'd and tested decision. The two new Trivial items are one-sentence prose qualifiers in `proposal.md:26` and `specs/sha-cross-stamping/spec.md:9`; they may be applied now or recorded as accepted-known.
