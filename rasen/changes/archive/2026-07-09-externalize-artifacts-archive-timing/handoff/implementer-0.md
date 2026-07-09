# Handoff: externalize-artifacts-archive-timing — implementer #0

Reason: `retired-between-children`. I implemented the prerequisite child
`externalize-artifacts-t3-workdir` (shipped `ab3fe7e`, archived `160294d`).
This document carries forward the conventions, gotchas, and file layout you
inherit — not task-by-task chatter from that change.

## Remaining

Empty. `externalize-artifacts-t3-workdir` is complete and shipped; nothing
from it is outstanding. Everything below is knowledge transfer for the child
you are about to implement.

## Key decisions (and why)

- **The `workDir`/`workDir`-adjacent wording formula, use it verbatim for
  `archive: { timing }`.** Every template sentence that names an ephemeron
  file follows this shape: `` `<file>` in the work directory (`workDir` from
  `rasen status --change <name> --json`; fall back to the change directory
  when it is absent or the file already lives there) ``. Copy this pattern's
  *spirit* for `archive.timing`, but note the field you're adding is
  **config**, not ephemera — it resolves from `rasen/config.yaml` (via
  `project-config.ts`), not from a `workDir`-relative file. Don't conflate
  the two: `archive.timing` needs its OWN one-line explanation in each
  template ("resolve `archive.timing` from `rasen status --change <n>
  --json`'s `archive.timing` field — default `on-merge` when absent"), not a
  workDir/change-dir fallback sentence.
- **Sticky-legacy fallback rule is stated ONCE, in `_orchestration.ts` Step F
  (`### Step F — Maintain run-state`, ~line 138-149 as I left it).** Every
  other template that touches an ephemeron file (ship.ts, archive-change.ts,
  verify-change.ts, etc.) just says "work directory (`workDir` from status
  JSON; fall back to the change directory)" WITHOUT re-explaining the rule —
  they point at the concept, Step F owns the explanation. If you add new
  archive-timing prose to `_orchestration.ts`, follow the same discipline:
  explain the mechanism once (probably in Step D, "Honor stage metadata" —
  `~line 86` — since archive-stage pending-merge is a stage-metadata-driven
  behavior; or in a new subsection near Step G's portfolio "single
  portfolio-level delivery" item 5, `~line 200`, since your PR-merge-gating
  logic is delivery-adjacent), then reference it tersely everywhere else.
- **CLI-layer spread, not synchronous-core-mutation.** For `workDir` I
  deliberately did NOT touch `ChangeStatus`/`ArtifactInstructions` (the
  synchronous core types in `instruction-loader.ts`) — I computed `workDir`
  asynchronously at the CLI command layer (`status.ts`, `instructions.ts`)
  and spread it into the JSON payload: `{ ...status, ...(workDir ? {
  workDir } : {}), root: rootOutput }`. Do the same for `archive: {
  timing }`: resolve it in `status.ts` (it's synchronous — just a
  `readProjectConfig` + a resolution helper, no async needed) and spread it
  in alongside `workDir`, rather than adding it to `ChangeStatus` itself.
  This kept the core artifact-graph module ignorant of CLI-only concerns
  and made "absent when unresolvable, never null" trivial to guarantee by
  construction (conditional spread) — the same guarantee your `archive.timing`
  field needs (your proposal says "default applied", so actually you'll
  probably always spread a value, but keep the same spread-not-mutate
  shape for consistency).
- **Design doc is authoritative on exact field names.** I'm describing
  patterns, not your spec — re-read your own `design.md` for the exact
  `archive: { timing }` shape before implementing; don't assume the field
  name from this document.

## Dead ends & gotchas

- **`resolveProjectHome`/registry reads THROW — always wrap in try/catch,
  even on "just reading" paths.** This bit me twice in `t3-workdir`'s review
  round (finding F1, Major): `resolveProjectHome(..., {ensure:false})` looks
  like an innocuous probe but internally calls `readProjectRegistryState`,
  which throws on malformed/corrupt registry JSON. I initially wrapped only
  the `ensure:true` mint path in try/catch and left the `ensure:false` probe
  unwrapped — a corrupt `registry.json` bricked `status`/`instructions`/
  `context`/`pipeline resume` entirely. Fixed by wrapping the WHOLE
  `resolveChangeWorkDir` body (`src/core/change-work.ts`) and the direct
  probe in `src/commands/context.ts` in try/catch → null/degrade. **You
  likely won't touch `resolveProjectHome` at all** (archive.timing is a
  plain config field, not machine-home state), but if you add ANY new call
  into `project-registry.ts`/`project-home.ts`, assume it throws on
  corruption and wrap it — don't rely on it being "just a read."
  `readProjectConfig` (the function you WILL use, in `project-config.ts`)
  is already safe — it returns `null` on a missing/unparseable config file,
  never throws. Confirmed via `test/commands/doctor.test.ts` staying green
  that doctor's own registry-corruption reporting (a separate code path,
  its own `registryUnreadable` flag in `relationship-health.ts`) is
  untouched by this pattern.
- **`node build.js` before ANY CLI-spawning test.** `ensureCliBuilt()` (in
  `test/helpers/run-cli.ts`) only rebuilds `dist/` when it's MISSING, not
  when it's stale. If you edit `src/` and then run a CLI-spawning test
  (anything using `runCLI(...)`) without rebuilding first, it silently runs
  STALE code and either passes for the wrong reason or fails confusingly.
  Always `node build.js` immediately after touching `src/`, before any test
  run.
- **`pnpm` is broken machine-wide in this environment** — `pnpm build`,
  `pnpm test`, even bare `pnpm --version` all fail with `ERROR packages
  field missing or empty`. This is NOT caused by any change in this repo
  (confirmed: no `pnpm-workspace.yaml` in git history at all, and the
  failure reproduces on a totally unrelated `pnpm --version`). Use `node
  build.js` and `npx vitest run` directly — they're the literal underlying
  commands `pnpm build`/`pnpm test` would invoke. Don't waste time debugging
  "pnpm broke" — it's environmental, already reported to the team lead.
- **Editing `src/core/templates/experts/_shared.ts` has a WIDE blast
  radius on the parity-hash test.** That file's PREAMBLE (in particular the
  "Dispatched vs standalone mode" section) is embedded by far more expert
  skills than the 6 obviously-generic ones (review/cso/qa/qa-only/
  benchmark/design-review) — chrome-use, codebase-design, codex,
  design-consultation, investigate, navigator, office-hours, prototype, and
  tdd all pull it in too and their hashes move whenever you touch it. This
  is correct behavior (shared preamble = shared consumers), just don't be
  surprised by a large diff in the parity test if you touch `_shared.ts`.
  You probably won't need to touch it for archive-timing (that's a
  ship/archive concern, not an expert-dispatch concern), but flagging it in
  case merge-confirmation logic ever needs a shared clause.
- **Parity-hash update flow (you WILL need this — you're editing ship.ts
  and archive-change.ts, both parity-pinned).** Don't hand-transcribe
  hashes from a diff — write a tiny Node script that imports the BUILT
  `dist/core/templates/skill-templates.js` and `dist/core/shared/
  skill-generation.js`, replicates the test's exact `stableStringify`/
  `hash` functions (copy them verbatim from
  `test/core/templates/skill-templates-parity.test.ts`), computes every
  function/generated-skill hash, and prints JSON. Then write a second tiny
  script that regexes the test file for `` `<name>: '<oldhash>',` `` and
  `` `'<dirName>': '<oldhash>',` `` and replaces with the freshly-computed
  values. This guarantees zero transcription error and lets you verify
  "only the templates I actually touched moved" by diffing the JSON before/
  after. I did this in the scratchpad as `compute-hashes.mjs` +
  `patch-hashes.mjs` (session-scoped temp files, not committed — you'll
  need to recreate them, they're small, ~15 min of work). Sequence: `node
  build.js` → `node bin/rasen.js update --force` (regenerates
  `.claude/skills/**`, gitignored, so `git status` won't show it) → run the
  compute script → run the patch script → `npx vitest run test/core/
  templates/skill-templates-parity.test.ts` to confirm green and that the
  changed-key set matches your expectation (no unexpected drift).
- **`.codex/` doesn't exist in this repo** (not a configured delivery
  target) — `rasen update --force` only touches `.claude/skills/**` here.
  Don't chase a `.codex` diff that will never appear.
- **`archive-change.ts` has TWO near-identical sites** for every section
  (steps 1-6 appear twice, once around line ~22-104 and again ~154-236 in
  the file as I left it — two skill/command variants sharing prose). When
  you add merge-confirmation gating to "Perform the archive" (step 5), you
  MUST edit both sites or use `replace_all` on the shared substring — I hit
  this exact trap for the `verification-report.md`/`ship-log.md` workDir
  wording (task 6.1) and used `Edit` with `replace_all: true` since both
  sites were byte-identical text. Check they're STILL identical before you
  assume `replace_all` is safe — a concurrent session's edit could have
  diverged them.

## Working set (current structure, as I left it — extend, don't duplicate)

- **`src/core/templates/workflows/ship.ts`** — Steps: `1. Select the
  Change`, `2. Pre-Flight Checks` (a-d), `3. Ship Phase` (a-g, delivery
  mode resolution through "g. Deliver per mode" at ~line 115), `4. Write
  Ship Log` (~line 120-122, where I added the workDir-first wording for
  `ship-log.md`), `5. Optional: Land and Deploy (pr mode only)` (~line
  147), `6. Post-Ship` (~line 170). The header block comment (~line 7-9)
  and the inline doc line (~line 18) both describe where `ship-log.md`
  lives now — update BOTH when you add timing-aware post-ship guidance,
  they're easy to update one and miss the other (I did this exact thing
  for t3-workdir and caught it in my own sweep, task 6.4). Your `in-ship`
  semantics belong in step 3 (a new sub-step after "g. Deliver per mode",
  since sync+bookkeeping-inside-ship is logically part of the ship phase)
  or step 4/5 boundary; your `on-merge` pending-merge language belongs in
  step 6 "Post-Ship" (what the user/LEAD does after ship returns) plus
  the header/doc-line pair.
- **`src/core/templates/workflows/archive-change.ts`** — TWO duplicated
  site pairs (see gotcha above). Step `3.5. Check verification verdict
  (HARD GATE)` (~line 58, ~190) and `3.6. Check delivery precondition
  (soft)` (~line 65, ~197) are exactly where I added
  "work directory (`workDir` from status JSON; fall back to the change
  directory — `changeRoot` — when...)" wording — your merge-confirmation
  gate is a NEW check, distinct from these two; I'd expect it as a new
  `3.7` (or folded into step 5) that reads the ship-log's PR URL (already
  workDir-resolved by 3.6's existing wording — reuse that resolved
  location, don't re-derive it) and shells to `gh pr view`. Step `5.
  Perform the archive` (~line 87, ~219) is where the actual `Move
  changeRoot to the archive directory` line lives (~line 98, ~230) — this
  is where `in-ship`'s "already archived" no-op check and `on-merge`'s
  merge-gate refusal both need to short-circuit BEFORE reaching the move.
- **`src/core/templates/workflows/_orchestration.ts`** — NO archive-stage
  section exists yet. The pipeline tail (ship/archive) is only referenced
  generically today, e.g. Step L's "`Stop.` Gate satisfied → proceed to the
  pipeline tail (ship/archive...)" (~line 126). Step F (~line 138, "Maintain
  run-state") is where I put the two-location blackboard + sticky-legacy
  rule — do NOT restate that rule; reference it. Your "record the archive
  stage as pending-merge in run-state and end cleanly" behavior is a NEW
  concept this file doesn't have a home for yet — read your own design.md
  for where you decided it belongs before picking a spot; my best guess
  from the proposal text is a new subsection near Step D (stage metadata)
  or as an addendum to Step F's run-state shape (a new stage status value
  or a `pendingMerge` marker, parallel to how `escalated`/`in_progress`
  already work).
- **`src/core/project-config.ts`** — you'll add `archive.timing` parsing
  here. Follow the EXACT resilient field-by-field pattern already used for
  `schema`, `store`, `projectId` (search for `// Parse <field> field` — each
  one validates with Zod, and on failure warns + drops rather than
  throwing or defaulting silently). Precedent to copy: the `store` field
  parse (`// Parse store pointer field: a string, or dropped with a
  warning.`) and the `projectId` field parse right after it — both are
  small, self-contained blocks you can pattern-match against for a new
  `archive` block with a `timing` sub-field.
- **`src/commands/workflow/status.ts`** — this is where `workDir` gets
  resolved and spread into the JSON payload (search for `resolveChangeWorkDir`
  and the `...(workDir ? { workDir } : {})` spread). Add your
  `archive.timing` resolution right alongside it, spread the same way,
  keeping the "CLI reports, template consumes" contract intact.

## Eliminated hypotheses / approaches I ruled out (relevant to you)

- **Considered folding `workDir` into `ChangeStatus`/`ArtifactInstructions`
  directly** (the synchronous core types) instead of spreading at the CLI
  layer — rejected because it would make the core artifact-graph module
  depend on the async machine-home resolver for no benefit; the CLI-layer
  spread achieves the same JSON shape with a cleaner dependency direction.
  Apply the same reasoning to `archive.timing`.
- **Considered swallowing `resolveProjectHome` errors ONLY on the
  `ensure:true` (mint) path**, reasoning that the probe path was "just a
  read" — this was wrong (see F1 gotcha above) and cost a full review
  round to fix. If you write anything that reads machine-global state
  (unlikely for you, but just in case), assume every read can throw.

## Next action

None — this change is complete and shipped. Your next action is to read
`rasen/changes/externalize-artifacts-archive-timing/design.md` and
`tasks.md` and begin your own implementation from a clean slate, using the
conventions and file layout above as your starting orientation rather than
re-discovering them.
