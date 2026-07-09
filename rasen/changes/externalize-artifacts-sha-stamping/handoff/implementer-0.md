# Handoff: externalize-artifacts-sha-stamping — implementer #0

Reason: `retired-between-children`. I implemented and then review-fixed the
prerequisite child `externalize-artifacts-archive-dest` (destination axis:
`in-repo`/`external`/`prune`) — the same three template files you're about
to append to (`ship.ts`, `archive-change.ts`, `bulk-archive-change.ts`) were
just reshaped by that work, including a full review round (4 Majors fixed)
and a follow-up spec-tightening pass. This document is a map of where things
landed, not task-by-task chatter from that change.

## Remaining

Empty. `externalize-artifacts-archive-dest` is complete, review-approved,
and ready to ship/archive. Nothing from it is outstanding. Your proposal's
coordination note ("child 4 is MID-APPLY, verify landed text before
editing") is now STALE — child 4 is fully landed and settled. Read the
CURRENT file content yourself before editing (obviously), but you are not
racing a concurrent apply on these three files anymore.

## Current structure of the three files you're appending to

### `src/core/templates/workflows/ship.ts` (242 lines, two exports:
`getShipCommandSkillTemplate` / `getOpsxShipCommandTemplate` — this file has
only ONE template body, both exports return variations of the same
`SHIP_INSTRUCTIONS` constant, not two duplicated getters like the archive
files. Simpler than archive-change.ts's dual-getter shape.)

- **Step 3 "Ship Phase"**, sub-step **b "Commit the change (all modes)"**
  (~line 82-93): this is where in-ship bookkeeping lives. Numbered sub-list:
  1. capture PR-body sections from `proposal.md` + task-completion facts
     BEFORE the move (the directory is about to disappear);
  2. sync delta specs;
  3. **destination-aware bookkeeping** (~line 86-89) — resolves
     `archive.destination`/`archiveDir` from the status payload and branches
     `in-repo` / `external` / `prune` (this whole numbered sub-step is where
     child 4's destination axis landed inside ship);
  4. record the outcome for the ship log — `Archived in ship: <path>` or
     `Pruned: true`.
  This is almost certainly where your archive-side chain record (the ship
  SHA → archive commit cross-reference) needs to hook in too, for the
  in-ship-timing case specifically, since in-ship bookkeeping's commit IS
  ship's own commit (no separate archive commit exists under in-ship — the
  "archive commit message stamps the ship SHA" idea from your proposal only
  makes literal sense under **on-merge** timing, where archive is a later,
  separate commit; under in-ship there's one commit doing both, so re-check
  your design.md for how it wants that case handled, e.g. does the SAME
  commit's message need both facts, or is the ship-log append sufficient
  since there's no second commit to stamp).
- **PR Body Generation** (~line 115-127, unlabeled but sits right after
  step 3e "Review the diff"): branches explicitly on in-ship vs on-merge
  timing — in-ship reads the CAPTURED proposal sections (from step 3b.1,
  since `rasen/changes/<name>/proposal.md` no longer exists after the
  move), on-merge reads a fresh `rasen/changes/<name>/proposal.md`. Your
  store-mode PR-body embedding (proposal Why/What + delta specs from
  `changeRoot`, stamped with the store repo's HEAD SHA) is a NEW branch
  alongside this — note the existing code already has a "no proposal.md
  found" fallback path you'll need to preserve a third branch for (repo
  mode without a proposal, store mode, in-ship-captured).
- **Step 4 "Write Ship Log"** (~line 138-165): the exact markdown template
  block agents fill in. Field order as it stands: `Date`, `Mode`, `Branch`,
  `Commit`, `Tree`, `Base` (pr-only), `PR` (pr-only), `Status`,
  `Archived in ship:` (in-ship + in-repo/external only), `Pruned:` (in-ship
  + prune only, mutually exclusive with the line above), then `##
  Pre-Flight Results` / `## Test Gate` / `## Deployment` sections. `Commit`
  and `Tree` are ALREADY the ship-side SHA stamps your proposal calls
  "existing, referenced" — you don't add these, you reference them from the
  archive side. Your store-mode dual-SHA stamps are a plausible new field
  pair here (e.g. `**Store SHA:**` alongside the existing `Commit:`) — no
  such field exists yet, you're adding it fresh.
- **Step 6 "Post-Ship"** (~line 190-199): timing/mode-aware guidance on
  what to do after shipping — mentions the `Archived in ship:` / `Pruned:`
  markers by name. If you add archive-chain guidance here, follow the same
  "facts recorded in the ship log, not a re-resolved config value" framing
  already established in this section's opening sentence.

### `src/core/templates/workflows/archive-change.ts` (477 lines, TWO
`export function` getters — `getArchiveChangeSkillTemplate` ~line 10-209,
`getOpsxArchiveCommandTemplate` ~line 211-477 — each with its own COPY of
steps 1 through 6+Guardrails, byte-identical prose between the two EXCEPT
step 2's "how the user is prompted to confirm incomplete artifacts" wording
(AskUserQuestion tool vs. plain "prompt user"), step 6's "Display summary"
bullet list (minor wording diff), and the Output examples section (the
skill getter has ONE compact "Output On Success" block; the command getter
has FOUR: Success / Success-No-Delta-Specs / Success-With-Warnings /
Error-Archive-Exists / Error-Destructive-Blocked — five, actually, I added
one). Everything else — steps 1, 1.5, 2, 2.5, 2.6, 3, 3.5, 3.6, 4, 5, and
both Guardrails bullets about already-archived-no-op and
destructive-destination-preconditions — is LITERALLY byte-identical
between the two getters as of this handoff (I verified this
programmatically before every `replace_all` edit this round; re-verify
before you assume it, a byte-diff check takes 5 seconds and saves you from
a `replace_all` silently touching only one site).

- **Step 1.5** (~line 31-47 / ~234-250): "Check for a prior archive across
  every destination." THREE sub-parts now (this grew during my review
  round, don't trust an older mental model of "step 1.5 = one in-repo
  scan"): (a) in-repo directory scan via `rasen list --json`'s `root.path`
  — no CLI call beyond that; (b) external scan + ship-log tombstone check,
  reached ONLY when (a) finds nothing, via `rasen context --json`'s
  `root.machineHome` (chosen specifically because `rasen status` THROWS
  "not found" for a change whose directory is already gone — `context` is
  change-independent and never throws for a missing change, so it's the
  only viable CLI surface here). The tombstone check reads
  `<machineHome>/changes/<name>/work/ship-log.md` directly (the ONE place
  in this whole template set that hand-derives the frozen work-directory
  layout instead of resolving `workDir` from a status payload — documented
  inline as the deliberate exception, because no status payload exists yet
  for a directory-gone change). Match on EITHER an archived-directory hit
  OR the literal token `Pruned:` in that file → report and stop, skip step
  2 entirely.
- **Step 2.5** (~line 63-72 / ~266-275): "Check the ship log's recorded
  delivery mode" — now a SEVEN-branch matrix (not four — it grew when I
  added the `Pruned:` inconsistency branch this review round): no ship log
  → proceed; `Archived in ship:` present → HARD STOP inconsistency;
  `Pruned:` present → HARD STOP inconsistency (NEW, mirrors the
  `Archived in ship:` branch — step 1.5b should already have caught it, so
  reaching here means something's stale/corrupt); `Mode: pr` → run 2.6;
  `Mode: push/local` → proceed; `Mode` missing but `PR:` URL present →
  treat as pr, run 2.6; neither present → proceed. If your chain-record
  append changes what fields live in the ship log, re-check this matrix —
  it pattern-matches on specific literal tokens (`Archived in ship:`,
  `Pruned:`, `Mode:`, `PR:`) and a new field with a colliding prefix could
  confuse a literal grep-style read.
- **Step 2.6** "Merge-confirmation gate": unrelated to your work, don't
  touch unless your design specifically needs the merge SHA (it already
  extracts the PR URL and could plausibly also read a merged-commit SHA if
  your design wants one — `gh pr view <url> --json state,mergedAt` would
  need `,mergeCommit` added if so).
- **Step 5 "Perform the archive (destination-aware)"** (~line 126-171 /
  ~329-374): THIS is almost certainly your main hook. Four sub-blocks in
  order: destructive-destination preconditions (git-state check + prune's
  own named confirmation, unrelated to your work) → `in-repo` bookkeeping →
  `external` bookkeeping → `prune` bookkeeping (numbered 1: write the
  `**Pruned:** true` tombstone FIRST via workDir ship-log, 2: `rm -rf`) →
  **post-bookkeeping commit guidance** (the very last paragraph of step 5:
  `git add -- "<changeRoot>" "<specsDir>"` then `git commit -- "<changeRoot>"
  "<specsDir>"` for external/prune; in-repo's archive-dir addition rides
  the commit as-is). Your commit-message SHA cross-reference almost
  certainly attaches to this exact commit-guidance paragraph (the ONE place
  in this whole file that actually issues a `git commit` for the archive
  side, under on-merge timing) — and your ship-log chain-record append
  needs to happen somewhere in this same step, most naturally right after
  the bookkeeping move/delete and before or alongside the commit, so the
  ship-SHA-to-archive-SHA reference can be resolved in one place.
- **Recycled-name note** (right after step 1.5, both getters): now mentions
  BOTH `Archived in ship:` and `Pruned:` as markers that can trip step
  2.5's stale-log HARD STOP for a name reused by a new change whose workDir
  still holds the prior incarnation's log. If your chain-record adds a new
  field, this note doesn't need updating (it's about the marker fields
  specifically, not the whole log), but keep it in mind if you add a new
  gate that keys on a field that could ALSO be stale.
- **Guardrails**: two bullets I touched this round —
  "Already-archived no-op (Step 1.5), every destination" and
  "Destructive-destination preconditions (Step 5)" — both byte-identical
  across getters, both reference the `Pruned:` token by name. If your work
  adds a new Guardrails bullet, check whether it should be byte-identical
  across both getters (basically everything except the two exceptions
  listed above should be) and use `replace_all` accordingly.

### `src/core/templates/workflows/bulk-archive-change.ts` (549 lines, same
two-getter shape: `getBulkArchiveChangeSkillTemplate` ~line 10-280,
`getOpsxBulkArchiveCommandTemplate` ~line 281-549). Step numbering mirrors
`archive-change.ts` but flatter — no 1.5/2.5/2.6/3.5/3.6 sub-steps here,
just steps 1-9, with archive bookkeeping folded into **step 8b "Perform the
archive (destination-aware, same branch and preconditions as
`rasen-archive-change`)"** (~line 133-157 / ~406-430) and **step 8c "Track
outcome"** right after it. Step 8b explicitly says "same branch and
preconditions as `rasen-archive-change`" — I kept it a condensed
cross-reference rather than re-deriving the full prose, INCLUDING its own
post-bookkeeping commit guidance line (`git add`/`git commit` pathspec
pair) which I added this round to close a gap the reviewer found (bulk had
branches but no commit guidance at all, before my fix). Your chain-record
work needs the SAME condensed treatment here — don't re-explain the whole
mechanism, reference archive-change.ts's fuller version and add only what's
bulk-specific (e.g. "per change" framing, since this loops over a batch).

## Byte-identical dual-getter discipline (you will hit this)

Both `archive-change.ts` and `bulk-archive-change.ts` have TWO getters with
mostly-duplicated prose. Before using `Edit` with `replace_all: true` on a
shared substring, verify it's ACTUALLY still identical between both sites —
a concurrent session's edit (or your own earlier edit in the same session
that only updated one site) can silently diverge them. I did this via a
throwaway `node -e` script comparing the two slices programmatically
(cheap, ~5 lines, faster and more reliable than eyeballing a diff):

```js
const fs = require('fs');
const c = fs.readFileSync('src/core/templates/workflows/archive-change.ts', 'utf-8');
const a = c.indexOf('MARKER_TEXT');
const b = c.indexOf('MARKER_TEXT', a + 1);
// slice out the block you're about to replace_all on, from both sites,
// and console.log(sliceA === sliceB) before trusting replace_all
```

Also: this repo checks out with CRLF line endings on Windows (confirmed via
this exact script during my session — `\r\n` throughout the template
string literals), which matters if you ever hand-diff instead of using the
programmatic check.

## Recorded-facts-over-config rule — now spec'd, not just convention

`rasen/specs/archive-timing/spec.md` (already synced/archived by child 3,
so this is a MAIN spec, not a change-scoped delta), Requirement "Recorded
delivery facts outrank re-resolved config" (~line 93) — this is the
authoritative spec text for the rule every branch in these three files
follows: template branches key on what a ship log ALREADY RECORDED, never
on a currently-resolved config value, for anything already delivered. If
your chain-record work adds new branches, they need to follow this same
rule and your delta specs should reference this existing requirement
rather than re-deriving it.

## Parity-hash script pair (you will need this)

I did NOT hand-transcribe hashes — I found (and reused, then re-verified)
a compute/patch script pair another implementer had left in the SESSION
SCRATCHPAD from an earlier child. Scratchpad paths are session-scoped, so
whatever you had this session won't exist for you — but the recipe is
short, recreate it:

1. `compute-hashes.mjs` — imports the BUILT `dist/core/templates/
   skill-templates.js` and `dist/core/shared/skill-generation.js` (via
   `pathToFileURL(...).href` dynamic import — Windows absolute paths need
   this, a plain string import specifier throws `ERR_UNSUPPORTED_ESM_URL_
   SCHEME`), replicates `stableStringify`/`hash` VERBATIM from
   `test/core/templates/skill-templates-parity.test.ts` (copy them exactly
   — don't reimplement, the sort-keys-then-JSON.stringify shape matters),
   and prints `{ functionHashes, generatedSkillHashes }` as JSON for every
   template factory (I ran ALL of them, not just the ones I touched — lets
   you diff before/after and confirm ONLY your intended templates moved).
2. `patch-hashes.mjs` — reads that JSON, regexes
   `test/core/templates/skill-templates-parity.test.ts` for
   `` `<functionName>: '<oldhash>',` `` and `` `'<dirName>': '<oldhash>',`
   `` and replaces in place. Reports how many entries actually changed
   text (most will be no-ops since you only touched a few templates —
   that's the point, it proves nothing else moved).
3. Sequence: `node build.js` → `node bin/rasen.js update --force`
   (regenerates `.claude/skills/**`, gitignored, `git status` won't show
   it) → `node compute-hashes.mjs > hashes.json` → `node patch-hashes.mjs`
   → `npx vitest run test/core/templates/skill-templates-parity.test.ts`.

My child touched `getArchiveChangeSkillTemplate`, `getBulkArchiveChange
SkillTemplate`, `getOpsxArchiveCommandTemplate`,
`getOpsxBulkArchiveCommandTemplate`, `getShipCommandSkillTemplate`,
`getOpsxShipCommandTemplate` (6 function hashes) and the three matching
generated-skill dirs `rasen-archive-change`, `rasen-bulk-archive-change`,
`rasen-ship` (3 generated hashes) — 9 entries total, twice (once per review
round). You'll touch the same six functions/three dirs again (same files),
so expect the SAME 9 entries to move a third time — if MORE than 9 move,
something else drifted and needs investigating before you trust it.

## Regen flow

`node build.js` (compiles TS → dist/) then `node bin/rasen.js update
--force` (regenerates `.claude/skills/**` from the built templates;
`.codex/` isn't a configured delivery target in this repo, don't chase a
diff there). Always rebuild before any CLI-spawning test — `ensureCliBuilt()`
in `test/helpers/run-cli.ts` only rebuilds when `dist/` is MISSING, not
when it's stale, so a stale build silently runs old code under test.

## The completions command-registry parity trap (bit me twice-adjacent this session)

`src/core/completions/command-registry.ts` maintains a HAND-WRITTEN,
PARALLEL list of every CLI command's flags, checked against the live
Commander definitions by `test/core/completions/command-registry.test.ts`'s
`matches visible Commander command flags and aliases` test. This is
COMPLETELY SEPARATE from the skill-templates-parity test above — different
file, different mechanism, easy to forget. Machine-home's `--gc` flag on
`doctor` was already registered there before my session (child 1's work);
I added a NEW flag (`--confirm-prune` on `archive`, part of my review-round
fix) to `src/cli/index.ts` and initially FORGOT this registry — it's the
one real regression I introduced and caught via the full test suite, not
via review. If `externalize-artifacts-sha-stamping` is genuinely
template-prose-only with ZERO new CLI flags (per your proposal: "Templates
only... No CLI code"), you likely never touch this file — but if any task
turns out to need a new flag (e.g. something to control the store-mode
SHA-embedding behavior), register it here too, in the same command's
`flags: [...]` array, or this exact test will fail.

## Environment gotchas (unrelated to file structure, still bite)

- **`pnpm` is broken machine-wide** — `pnpm build`/`pnpm test`/even bare
  `pnpm --version` fail with "packages field missing or empty". Not
  repo-caused (no `pnpm-workspace.yaml` in git history at all). Use `node
  build.js` and `npx vitest run` directly — confirmed again this session,
  still true.
- Full `npx vitest run` takes ~3-5 minutes on this machine (124 files,
  ~2300 tests) — run it in the background (`run_in_background: true` on
  Bash, or poll the output file) rather than blocking synchronously; a
  synchronous 5-minute wait reads as a hang.
- One Windows-only flake is pre-existing and unrelated to anything in this
  portfolio: `test/core/init.test.ts > ... > should select all tools with
  --tools all option` — ENOTEMPTY rmdir / 10s timeout on a heavy
  "install 20+ tools" fixture, reproduces even in total isolation with zero
  code changes. Don't chase it; it was already flagged as pre-existing by
  the machine-home implementer before either of us touched this repo.

## Dead ends / approaches I ruled out (relevant to you)

- **Considered deriving the external archive location and work-directory
  ship-log path by hand-concatenating `<machineHome>/archive` and
  `<machineHome>/changes/<name>/work` everywhere** instead of resolving
  `workDir`/`archiveDir` from a status/context payload. Rejected as the
  GENERAL rule (child 1's "consumers must not re-derive home paths" holds)
  — the ONE exception I made (step 1.5b's tombstone read) is justified
  specifically because no status payload can exist for a change whose
  directory is already gone, and I documented that exception inline rather
  than treating it as precedent. Don't extend the exception without the
  same justification.
- **Considered making the CLI's prune-deletion confirmation reuse `--yes`**
  (the flag already used for the merge-timing guard and other routine
  confirmations) instead of a dedicated `--confirm-prune` flag — this was
  my ORIGINAL implementation and a reviewer caught it as a real data-loss
  footgun (a user following the timing guard's own refusal message,
  "rerun with --yes", would unknowingly also authorize a permanent
  deletion). Fixed by splitting into two separate flags/consents, now
  spec'd as its own requirement ("Timing-guard override and prune
  confirmation are separate consents", `cli-archive/spec.md`). If your
  design ever needs a new override flag for anything destructive or
  semi-destructive, default to a DEDICATED flag, not reusing `--yes`.
- **Considered a plain `git status --porcelain` (no `--ignored`) for the
  destructive-destination clean check** — also my original implementation,
  also caught in review: gitignored content is invisible to plain
  porcelain output, so a `.gitignore`'d change directory would read
  "clean" despite never having been committed, and prune/external would
  destroy the only copy. Fixed by requiring BOTH `--ignored` empty AND
  `git ls-files` non-empty. Not directly relevant to prose-only template
  work, but worth knowing if your design ever touches a git-status check.

## Next action

None — this child is complete, review-approved (0 Blocker/Major open after
two review rounds), and its delta specs are tightened to match the shipped
code exactly. Your next action is to read
`rasen/changes/externalize-artifacts-sha-stamping/design.md` and
`tasks.md` and begin your own implementation from a clean slate, using the
file maps and conventions above as your starting orientation rather than
re-discovering them.
