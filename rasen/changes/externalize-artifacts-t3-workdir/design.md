# Design: externalize-artifacts-t3-workdir

## Context

Child 1 (`externalize-artifacts-machine-home`, ed1adbd) shipped the foundation: `resolveProjectHome(projectRoot, {globalDataDir?, ensure?}) → ProjectHome | null` (frozen API) with `workDir(changeName)` = `<globalDataDir>/projects/<home>/changes/<name>/work`. `ensure:false` is a non-mutating probe; `ensure:true` mints a `projectId` into `rasen/config.yaml` (one-line append), registers the project, and creates the home. `withProjectRegistryLock` serializes all registry writers; GC deletes any unreferenced directory under `<globalDataDir>/projects/`, so work directories MUST live inside registered homes (they do — `workDir` is inside the home).

Verified current state this design builds on:

- **The CLI only reads run-state; agents write it.** `writeRunState`/`writePortfolioState` have no production callers — templates instruct the LEAD to write `auto-run.json`/`portfolio-run.json` directly, and `rasen pipeline resume` reads them via `readRunState(changeDir)`/`readPortfolioState(changeDir)` (`src/commands/pipeline.ts`, `changeDir = path.join(root.changesDir, changeName)`).
- **Change-scoped agent surfaces**: `rasen status --change <n> --json` (templates already read `changeRoot` from it — archive template says so verbatim) and the two instructions payloads (`rasen instructions <artifact>`, apply-instructions), built in `src/commands/workflow/{status,instructions}.ts`. `rasen context` (`src/commands/context.ts`) is root-scoped (working set), not change-scoped.
- **Ephemera writers/readers are template prose**, audited exhaustively (open Q5): `_orchestration.ts` (run-state contract, goal-loop run artifact, Step H handoff records, inter-stage blackboard), `handoff.ts` (lead-N docs, relay-prompt.txt, sessionHandoff), `auto.ts` (portfolio-run), `ship.ts` (ship-log write + evidence pre-flight read), `verify-change.ts` (verification-report, 2 sites), `verify-enhanced.ts` (report read/write), `review-cycle.ts` (cycle report), `retro.ts` (report reads), `archive-change.ts` (verification-report + ship-log gate reads, 2 sites each), `goal-command.ts`/`goal-iterate.ts`/`goal-report.ts` (goal-run.json), `experts/_shared.ts` (canonical `<skill>-report.md` rule) and the dispatched-mode lines in `experts/{review,cso,qa,qa-only,benchmark,design-review}.ts`.
- **Shared working tree**: a concurrent session historically holds uncommitted edits to several of these template files. Clean at proposal time, but that can change at any moment.

## Goals / Non-Goals

**Goals:**
- Process ephemera external from birth: a full change lifecycle leaves `git status` clean.
- One CLI-resolved work directory path; templates consume it, never derive it.
- Graceful degradation: older CLIs, unregistered projects, and pre-existing changes keep working with change-dir ephemera.
- Cross-worktree resume: run-state survives `git clean -fdx` and worktree switches (home is shared per child 1's worktree predicate).

**Non-Goals:**
- Archive timing/destination (children 3/4), SHA cross-stamping (child 5).
- Retention/sweep/GC policy for work directories (archive-time sweep belongs to children 3/4; this change only guarantees work dirs are GC-safe by construction).
- Migrating existing ephemera files or touching existing archives.
- The repo-level no-active-change handoff fallback (`rasen/handoff/<topic>.md`) — it has no change scope, stays as-is; flagged as a follow-up.
- Any gitignore changes (external files need none).

## Decisions

### D1. Resolution helper: probe-first, mint-once (`src/core/change-work.ts`)

New small module bridging root resolution to the frozen resolver:

```ts
resolveChangeWorkDir(projectRoot, changeName, { globalDataDir?, ensure? })
  → Promise<string | null>
```

Implementation: `resolveProjectHome(projectRoot, {ensure:false})` first — a pure read, no lock, no writes. Only when that returns null AND `ensure:true` was requested does it call `resolveProjectHome(projectRoot, {ensure:true})` (mints projectId, registers, creates home). This keeps the hot path (every status/instructions call on an already-registered project) write-free and lock-free; `registerProject` is only invoked on the first home-needing call per project ever. Returns `workDir(changeName)`; never pre-creates the work directory itself — the CLI exposes the path, agents create files (consumers create what they use, matching child 1's resolver contract).

*Why a wrapper instead of calling `resolveProjectHome` inline at each surface:* the probe-then-ensure dance and the null-degradation policy must be identical at every surface; centralizing it prevents one command minting eagerly while another degrades.

### D2. Which surfaces ensure vs probe (the mutation boundary)

- **Instructions payloads ensure** (`rasen instructions`, apply-instructions): they are invoked exactly when an agent is actively working the change (propose/continue/apply flows), i.e. write-intent — the moment T3 placement is genuinely needed. This is the designated "home-needing command" under child 1's lazy-identity policy.
- **`status`, `pipeline resume`, `context` probe only** (`ensure:false` path): read-only commands never write into the repo or registry (shared-working-tree safety, child 1's D3/D6 contract). If the probe misses, the `workDir` field is simply absent and consumers fall back.

Consequence: any change that has been through a workflow skill has a minted home (instructions ran), so status/resume see `workDir` non-null in practice. A truly untouched project shows no `workDir` anywhere — exactly today's behavior.

### D3. Exposure surfaces (open Q5, exposure half — decided)

- `rasen status --change <n> --json`: top-level `workDir` (string, absent when unresolved). Human output gains a `Work dir:` line when present. This is the surface templates already read `changeRoot` from — they pick up `workDir` beside it.
- `rasen instructions <artifact> --json` and apply-instructions JSON: top-level `workDir` (ensure semantics per D2). Text renderers mention it once so non-JSON consumers see it.
- `rasen pipeline resume --json`: gains `runStateDir` — the directory the run-state (or portfolio-state) was actually read from — so a resuming LEAD writes updates to the same place it read from.
- `rasen context --json`: root object gains `machineHome` (the home dir, probe-only; absent when unregistered). Context is root-scoped, so it exposes the home, not a per-change workDir — the design doc's "context/instructions workDir" shorthand resolves to: change-scoped surfaces carry `workDir`, the root-scoped surface carries `machineHome`.

Templates never construct `<globalDataDir>` paths. The exposure contract is: **CLI reports, agent writes.**

### D4. Fallback and migration policy (open Q3 — decided: sticky-legacy per file)

For each ephemeron file F of change C:

- **Read**: `workDir/F` if it exists, else `changeDir/F` (legacy).
- **Write**: if `changeDir/F` already exists and `workDir/F` does not → keep writing `changeDir/F` (sticky: a file lives where it was born, no split-brain mid-flight). Otherwise write `workDir/F`.
- **`workDir` absent** (older CLI, unregistered project, probe miss): everything falls back to `changeDir` — byte-identical to today's behavior.

CLI implementation: run-state/portfolio-state get a candidate-resolution helper (workDir-first read) in `src/core/pipeline-registry/`; existing `readRunState(changeDir)`/`writeRunState(changeDir, ...)` signatures stay (tests, compat), with resume passing the resolved candidates. Template implementation: one compact shared rule sentence (in `_orchestration.ts`'s shared playbook and `experts/_shared.ts`'s shared preamble) plus per-template path references switched from `rasen/changes/<name>/X` to "`<workDir>/X` (the `workDir` from status/instructions JSON; fall back to the change directory if absent or if the file already exists there)".

Existing archives: untouched. No bulk migration, ever — the fallback read covers pre-existing changes for their remaining lifetime.

*Alternative considered — hard cut-over (all writes to workDir, readers fall back):* rejected because a change mid-flight at upgrade time would have run-state split across two files with the stale one shadowing history; sticky-legacy makes upgrade a non-event for in-flight changes.

### D5. Store mode and worktrees

`projectRoot` for resolution is the **already-resolved planning root** (`root.path` — repo- or store-side), exactly what child 1's resolver expects. Store-selected roots register their own home; T3 placement is identical in both modes (per the design doc: the home's internal layout is mode-invariant). Worktrees of one repo share one home (child 1's `isGitWorktreeSibling` predicate), so `workDir` is naturally shared — the review-cycle/EnterWorktree resume semantics come for free and `git clean -fdx` cannot destroy run-state.

### D6. GC interplay (child-1 findings-log caveat addressed)

Work directories live inside registered homes, so child 1's GC (which deletes unreferenced dirs under `<globalDataDir>/projects/`) never treats them as orphans. The GC lock-hold worry (deletions exceeding the 30s stale-steal while holding the registry lock) does not materially change: T3 trees are small text files (run-state JSON, markdown reports), not build artifacts; deleting a home with hundreds of such files stays well under the threshold. Retention policy for accumulating per-change work dirs is explicitly deferred to the archive children (sweep at archive time) — until then work dirs persist, which is also what makes retro's "read swept work/" future possible.

### D7. Open Q2 (bulky change-scoped research) — stays T2, raw dumps demoted

Change-scoped research remains Tier 2 (rides the PR — it is review material). Propose/explore template guidance gains one line: bulky raw material (scratch probing logs, fetched corpora, long transcripts) goes to `work/research/`, with conclusions distilled into design.md or a slim committed research doc. No enforcement — it is a placement convention, not a gate.

### D8. Template regeneration and parity

Templates under `src/core/templates/**` are the source of truth; `.claude/skills/**` and `.codex/**` are generated. Apply edits templates only, then runs the build → update flow to regenerate, keeping `skill-templates-parity` green. No generated file is hand-edited.

## Risks / Trade-offs

- [Concurrent session re-dirties template files mid-apply] → Before EVERY template edit and every commit: `git status --porcelain -- src/core/templates/` ; edit only clean files; commit with explicit pathspec (`git commit -- <paths>`) and verify with `git show --stat`; if foreign dirt appears on a file this change must touch, wait or escalate to the LEAD — never commit or revert foreign edits.
- [Agents ignore `workDir` and keep writing to the change dir (prompt regression)] → the fallback rule makes this non-destructive (files land in the legacy location, still readable); verification includes a live smoke: drive a minimal change lifecycle and assert `git status` stays clean of ephemera.
- [Split-brain run-state when both locations have `auto-run.json`] → sticky-legacy write rule prevents creating the second copy; CLI read order (workDir first) is deterministic if it ever happens, and `pipeline resume` reports `runStateDir` so the LEAD writes where it read.
- [`ensure` on instructions appends `projectId:` to `rasen/config.yaml` (a repo write on a read-looking command)] → sanctioned by child 1's lazy-identity policy; happens at most once per project, lock-serialized, append-only preserving comments; this repo already carries a projectId so dogfooding never hits it.
- [Windows backslashes in JSON-reported paths pasted into agent file ops] → paths are consumed as absolute opaque strings (same as `changeRoot` today, which templates already consume safely).
- [Older generated skills (pre-regeneration) meet a newer CLI] → additive JSON fields are invisible to old prompts; old prompts keep change-dir behavior via fallback. No ordering constraint between CLI and skill deployment.

## Migration Plan

Purely additive rollout: CLI fields appear, templates start directing new files to `workDir`, in-flight changes stay sticky-legacy, archives untouched. Rollback = revert the commits; orphaned work-dir files are inert (deleted with the home by `doctor --gc` when the project unregisters, or by the future archive sweep).

## Open Questions

None blocking. (Q2, Q3, Q5 are decided above: D7, D4, D1–D3 + the proposal's audit inventory.) Deferred, recorded: repo-level no-change handoff fallback placement; work-dir retention/sweep policy (children 3/4).
