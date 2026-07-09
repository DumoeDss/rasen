# Design: externalize-artifacts-sha-stamping

## Context

Implementation-order item 4 of the design of record, plus the store-mode mechanism from its Externalization verdict ("ship pulls proposal + repo-relevant delta spec from the store and embeds them in the PR body … SHA cross-stamps for traceability"). Verified current state:

- **Ship-side stamps already exist** (`ship.ts`, post-child-3): the workDir ship-log records `Mode:`, `Branch:`, `Commit:`, `Tree:`, `Base:`/`PR:` (pr mode), `Status:`, and `Archived in ship: <path>` under in-ship timing. Nothing needs duplicating — the archive end is what's missing.
- **Archive side records no SHAs** (`archive-change.ts`, post-child-3): the sync + bookkeeping steps produce a commit by repo convention (`chore(rasen): archive X (specs synced)`) with no reference to the ship commit, and nothing is written back to the ship-log.
- **Ship-log placement makes the chain durable**: it lives in workDir (child 2), keyed by change name — it survives the change directory's move to any destination and even `prune` (child 4). One file can therefore hold both ends of the chain.
- **Store mode signals**: the status JSON ship already fetches carries `planningHome.kind` (`repo` | `store`) and store-side absolute `changeRoot`; ship's PR-body step still reads `rasen/changes/<name>/proposal.md` repo-relatively — a latent store bug this child fixes in passing (same pattern as commit 2d855e1's store-safe paths).
- **Child 4 is MID-APPLY** on `ship.ts`/`archive-change.ts`/`bulk-archive-change.ts` (destination-aware bookkeeping, `resolveArchiveDestination`, destructive-destination guards). This design targets those templates AS CHILD 4'S DESIGN LEAVES THEM; apply must verify the landed text before editing.

## Goals / Non-Goals

**Goals:**
- A change's delivery chain (code commit ↔ spec-sync/archive commit) traceable from either end: from the ship-log (both SHAs in one file) and from git history (archive commit message names the ship SHA).
- Store-mode PRs carry their review material (proposal + delta specs) with dual-repo SHA stamps, compensating the co-review loss the design doc accepted for store mode.
- Zero CLI changes; template prose + regen only. Thinnest child.

**Non-Goals:**
- Stamping synced spec headers (churns T1 content with delivery metadata; rejected).
- Writing code-repo SHAs back into the store repo (needs store write flows; follow-up).
- New readers of the chain record (retro/dashboard consumption is future work).
- Any change to WHAT ship or archive do — only what they RECORD and what the PR body CARRIES.

## Decisions

### D1. The workDir ship-log is the canonical two-ended chain record

Archive's bookkeeping (whichever destination, per child 4) is followed by APPENDING an `## Archive` section to the change's ship-log:

```markdown
## Archive
**Date:** <timestamp>
**Ship commit:** <sha>            (copied from this log's Commit: line — recorded fact, not re-derived)
**Archive commit:** <sha>         (the spec-sync/removal commit, once created)
**Outcome:** archived to <path> | pruned | archived in ship (see above)
```

Append, never rewrite: ship's section stays untouched (recorded-facts discipline). Under in-ship timing ship writes the whole chain itself in one pass (its existing `Archived in ship:` line plus the archive commit SHA once the ship commit exists — they are the same commit, recorded as such). When bookkeeping and the commit are split in time (the commit happens after the append), the workflow records the commit SHA in a second append line immediately after committing — the log is a journal, not a form.

*Why the ship-log and not a new file:* child 2 made it the one delivery artifact that survives every destination including prune; a second file would split the chain again.

### D2. Direction-2 stamp rides the archive commit message

The archive/spec-sync commit message gains the ship reference: `chore(rasen): archive <name> (specs synced; ship <short-sha>)` — the short SHA of the ship-log's recorded `Commit:` (a recorded fact; if the log records no commit, e.g. a never-shipped spec-only change, the suffix is omitted rather than invented). Bulk archive uses the same form per change. *Rejected alternative — headers in synced specs:* every archive would rewrite T1 spec files with delivery metadata, churning contract content and PR diffs forever; `git log --grep 'ship <sha>'` gives the same traceability from history where provenance belongs.

### D3. Store-mode PR-body embedding: existing read surfaces only

When `planningHome.kind` is `store` in the status JSON, ship's PR Body Generation additionally:

1. Reads the proposal Why/What (as today, but from `changeRoot` — the store-safe fix, which also applies in repo mode) and the change's delta specs (`changeRoot/specs/**/spec.md`).
2. Embeds them in the PR body inside collapsed `<details>` blocks ("Review material from planning store") so human review sees intent + spec delta without leaving the PR — the co-review compensation.
3. Stamps traceability: the store's identity/path, the change's store path, and the store repo HEAD SHA via `git -C <planningHome.root> rev-parse HEAD` (agent-side git; the CLI still never shells out). A dirty store tree (`git -C <root> status --porcelain` non-empty) is stamped as `<sha> (store tree dirty at ship time)` — honest, never hidden.
4. Records the same store SHA in the ship-log (`Store:` + `Store commit:` lines), so the chain covers three points in store mode: code commit ↔ store commit ↔ archive commit.

Everything above uses paths the status JSON already provides plus plain git — no store-API plumbing. If the store root is not a git repository (registered non-git store), the SHA stamp degrades to `(store not under git)` and the embedding still happens; deeper store metadata is the recorded follow-up.

### D4. Placement relative to child 4's landed text

The archive append (D1) and commit stamp (D2) attach immediately after child 4's destination-aware bookkeeping step and inside its per-destination commit guidance (external/prune's pathspec commit gains the message form; in-repo's conventional archive commit likewise). Apply verifies the landed step numbering/wording first and threads the additions into BOTH getters of each template. If child 4's landed reality differs from its design, the recorded-facts rule still pins where the append happens: after bookkeeping succeeds, before the workflow reports completion.

## Risks / Trade-offs

- [Child 4 mid-apply — template text may shift under this proposal] → tasks instruct verifying landed text + per-file `git status` before every edit; the additions are append-shaped (new lines/sections), minimizing merge friction.
- [Ship-log absent (never-shipped or legacy change)] → archive append degrades: create the ship-log with only the `## Archive` section in workDir (fallback change dir per child 2's sticky rule); commit suffix omitted when no ship SHA is recorded.
- [PR body size with large delta specs] → collapsed `<details>` blocks; the prose caps embedding at the delta specs (not full main specs) and says to link the store path instead when content is extremely large — reviewer ergonomics over completeness.
- [Store SHA captured at ship time may not be the SHA a later store commit lands as] → stamped honestly as ship-time state (plus the dirty-tree note); the archive-side append closes the chain later. Perfect store-side pinning needs store write flows — the recorded follow-up.
- [Parity blast radius] → only `ship.ts`, `archive-change.ts`, `bulk-archive-change.ts` hashes should move; the parity suite verifies exactly that.

## Migration Plan

Prose-only and append-shaped: existing ship-logs gain sections only when archive next runs; old logs without them remain valid (readers of the chain are future work). Rollback = revert the template commits; already-written `## Archive` sections are inert extra markdown.

## Open Questions

None blocking. Recorded follow-ups: store-side write-back of code-repo SHAs (store write APIs); chain-record consumers (retro/dashboard); PR-body embedding size heuristics if real stores hit the cap in practice.

## Apply-time correction

D3's premise that the status payload carries `planningHome.kind` (`repo` | `store`) is factually wrong against the landed code: `toPlanningHome()` (`src/core/root-selection.ts`) is a documented "compatibility bridge" that hardcodes `kind: 'repo'` unconditionally — it never reports `store`, even for a store-selected root. The actual store-mode signal already present in the same status JSON is `root.store_id` (set by `toRootOutput()` whenever `--store <id>` or a declared fallback selected a store; see `isStoreSelectedRoot`). Templates and specs were implemented against `root.store_id`, not `planningHome.kind`. `root.path` under a store-selected root is the store's absolute filesystem path, used for the `git -C <root.path> ...` stamps.
