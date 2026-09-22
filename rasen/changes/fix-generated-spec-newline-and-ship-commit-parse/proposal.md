## Why

Two independent archive defects were reproduced against `upstream/dev/0.1.8` (`77c860dd`). The four files involved — `src/core/specs-apply.ts`, `src/core/parsers/requirement-blocks.ts`, `src/core/archive.ts`, and `src/core/archive-engine.ts` — are byte-identical between that upstream branch and the local checkout, so both defects are current upstream behavior rather than local drift.

**Generated canonical specs are not commit-clean.** Every canonical specification written from a delta ends with two newline characters whenever `## Requirements` is the last section, which is the canonical shape. `extractRequirementsSection` promotes an empty trailing section to `after: '\n'`, the serializer's `join('\n')` adds another, and the existing `replace(/\n{3,}/g, '\n\n')` only collapses three or more. The path-scoped archive commit then fails `git diff --cached --check` with `new blank line at EOF` until the generated files are normalized by hand. This affects new capabilities and updates to existing canonical specs alike, not only new ones.

**A recorded ship commit is lost when the hash is presented as a Markdown code span.** `**Commit:** <hash>` is read, but `` **Commit:** `<hash>` `` yields `recordedCommit: null`, so the archive-owned `## Archive` section silently omits `**Ship commit:**` and the delivery provenance disappears from the evidence chain. The preview reports no blocker distinguishing that case from a change that legitimately never shipped. A code span is an ordinary Markdown presentation of a hash, and the same ship-log template already teaches qualified SHA values in the adjacent `**Store commit:**` field, so the strict whole-line match is unnecessarily brittle. The same regular expression is duplicated verbatim in archive planning and archive finalization, so a partial correction would let a plan and the transaction that applies it disagree.

## What Changes

- Normalize every canonical specification written from a delta to end with exactly one newline and no trailing blank line or trailing whitespace, at the serializer's output edge, independently of the input's terminating newlines or line-ending style. The normative body is unchanged and the normalization is idempotent.
- Accept a ship-log `**Commit:**` value wrapped in a matched pair of backticks as the same recorded commit as a bare hash. Reject an unmatched backtick and any other non-hexadecimal value, as today, without inventing a substitute commit.
- Replace the duplicated ship-commit regular expression in `src/core/archive.ts` and `src/core/archive-engine.ts` with one shared reader, so archive planning and archive finalization can never diverge.
- Not BREAKING. Saved archive plans carry `rebuilt` verbatim and the engine writes that stored string without recomputing it; the spec drift check compares `sourceSha256`, which is the digest of the delta source file, not of `rebuilt`. A plan saved by an older build therefore still applies unchanged. `beforeSha256`/`afterSha256` are per-transaction records with no cross-run chaining invariant in the source. The single observable difference is that a canonical spec already ending in a blank line loses that line once, the next time a delta rewrites it.

## Capabilities

### Modified Capabilities

- `openspec-conventions`: require canonical specifications generated from a delta to be written commit-clean.
- `sha-cross-stamping`: define ship-commit reading as presentation-independent for a matched code span, and require one shared reader across archive planning and finalization.

## Impact

- Production code: `src/core/specs-apply.ts` (serializer output edge) and the shared ship-commit reader consumed by `src/core/archive.ts` and `src/core/archive-engine.ts`.
- Regression coverage: canonical-spec terminal newline across zero, one, and multiple input newlines, CRLF input, a spec whose `## Requirements` is not the last section, and idempotency; ship-commit reading across bare hash, matched code span, unmatched backtick, abbreviated hash, non-hexadecimal value, and absent field; planning and finalization agreeing on the same recorded value.
- No new CLI flag, configuration key, dependency, serialized plan or journal schema version, or user-facing message is introduced, so the locale catalogs are unaffected.
- Base for implementation and delivery is `upstream/dev/0.1.8`. Archive timing and the archive decision itself remain with the upstream repository owner.

## Out of Scope

- Treating a present but unreadable `**Commit:**` field as a typed blocker, rather than as an absent ship fact. The distinction is real and worth closing, but it touches the archive blocker vocabulary and the saved-plan contract, so it is deferred to its own change.
- The placeholder `Purpose` text emitted for a newly created canonical capability (`TBD - created by archiving change <name>. Update Purpose after archive.`). That text is the documented behavior of the sync-specs workflow, and it passes strict validation because it exceeds the minimum purpose length, so nothing resurfaces it after the archive reports success. Whether to accept validated purpose input during planning, to carry suitable text from the delta, or to flag the placeholder during validation is a separate design question raised here and decided elsewhere.
