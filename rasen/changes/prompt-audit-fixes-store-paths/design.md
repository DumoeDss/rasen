## Context

Final child (#6) of the `prompt-audit-fixes` portfolio, covering audit findings WF-3 (templates hardcode repo-local paths despite embedding store-selection guidance) and WF-9 (single archive uses loose `tasks.md`/`rasen/specs` paths while bulk archive uses resolved `artifactPaths`). Per the user's standing directive, this child was sequenced last so its fix could be reconciled with the concurrent `externalize-artifacts` portfolio, whose design may redefine "correct" path resolution. This design records that reconciliation and the scope it dictates.

## Goals / Non-Goals

**Goals:**
- Fix the WF-3/WF-9 path resolution that is correct under BOTH the current model and the externalize design — the artifacts that stay in-repo/in-store and only need CLI resolution.
- Leave zero collision with the live externalize work; hand each deferred offender to the externalize child that already owns it, explicitly.

**Non-Goals:**
- Touching `src/core` runtime (root-selection.ts, workspace-root.ts, project-home.ts, etc.) — that is the externalize session's surface. Templates only.
- Implementing or depending on the external `workDir` (T3) mechanism — it belongs to `externalize-artifacts-t3-workdir` and its CLI exposure is not yet built.
- Re-opening the externalize design (it is a converged, adversarially-reviewed doc; "设计不再重议" per the externalize kickoff handoff).

## Decisions

### D1 — Alignment with externalize-artifacts: DECISION (b), narrow to the externalization-proof subset

**What I found (the state has moved well past the original deferral premise):**
- The externalize design (`rasen/office-hours/externalize-openspec-artifacts.md`) is converged and is being IMPLEMENTED, not just drafted. It defines a four-tier artifact taxonomy by consumer: **T1** specs (in-repo/in-store, permanent), **T2** review material — proposal/design/tasks/delta specs (in-repo, rides the PR), **T3** process ephemera — handoff, review-cycle logs, **ship-log, verification reports, run-state** (moved EXTERNAL to `<home>/changes/<name>/work/`, never in git), **T4** knowledge — office-hours/research (in-repo, permanent).
- Slice ⓪ (machine-home foundation) is **landed and archived** (commit `ed1adbd`, archive `bc7069b`): `resolveProjectHome(projectRoot,{…}) → {homeDir, workDir(changeName), archiveDir, mode}` is a frozen API.
- `externalize-artifacts-t3-workdir` (slice ①) is **live, `status: in_progress, stage: propose` right now.** Its scope (externalize planning-context §DAG): "workDir resolution on the home; context/instructions exposure; audit + switch templates writing ephemera to the CLI-resolved workDir." Open Q5 — "template ephemera-path inventory" — is explicitly assigned to this child's apply.
- Remaining externalize children `archive-timing`, `archive-dest`, `sha-stamping` are `pending` (gated serially behind t3-workdir).

**Why (b) and not (a) or (c):**
- Not **(c) escalate**: there is no design conflict. The externalize design and the WF-3/WF-9 audit AGREE on the mechanism — "stop hardcoding, resolve via the CLI." I can partition cleanly by artifact tier, so no silent proposing-around-a-conflict occurs.
- Not **(a) fix all WF-3/WF-9 as audited**: WF-3's offenders split across tiers, and for T3 the externalize design CHANGED the correct answer — the audit says "resolve to the change dir," but the converged design says "resolve to an external `workDir`." Fixing T3 to `changeRoot` now would (i) implement a knowingly-interim answer that Open Q5 will immediately rewrite, and (ii) collide on the SAME template files (`ship.ts`, `verify-enhanced.ts`, `retro.ts`, run-state) with a child that is proposing them THIS session. That is throwaway work on a live collision surface — exactly what the deferral existed to avoid.
- **(b) narrow** is the fit: fix the tiers whose correct answer is UNCHANGED by externalization (T1/T2/T4 = still CLI-resolved, in-repo/in-store) and are UNCLAIMED by any externalize slice; defer the T3 tier to its owner.

**The partition (per WF-3/WF-9 offender):**

| Offender (audit) | Tier | Disposition |
|---|---|---|
| `archive-change.ts` tasks file (WF-9) | T2 | **FIX** — resolve via `artifactPaths.tasks.existingOutputPaths` (match bulk) |
| `archive-change.ts` main-spec compare (WF-3, WF-9) | T1 | **FIX** — resolve main specs from planning home |
| `sync-specs.ts` main-spec target (WF-3) | T1 | **FIX** — resolve main specs from planning home |
| `office-hours.ts` (workflow) doc writes (WF-3) | T4 | **FIX** — resolve from `changeRoot`/`planningHome` |
| `ship.ts` ship-log write (WF-3) | T3 | **DEFER** → `externalize-artifacts-t3-workdir` |
| `verify-enhanced.ts` report writes (WF-3) | T3 | **DEFER** → t3-workdir |
| `retro.ts` retro output (WF-3) | T3 | **DEFER** → t3-workdir |
| `verify-change.ts` verification-report (post-audit, child #2) | T3 | **DEFER** → t3-workdir |

`ship.ts`'s incidental T2 *reads* (tasks.md/proposal.md) are left with the ship-log write: `ship.ts` is on the t3-workdir edit surface, so all of `ship.ts` is deferred to avoid a live same-file collision (its store-mode read bug rides along with the T3 slice that will already be in the file). This keeps child #6 entirely off the live surface.

### D2 — Resolution mechanics for the fixed subset

All fixes resolve from EXISTING status-JSON fields, never the not-yet-exposed `workDir`:
- **Tasks (WF-9):** `artifactPaths.tasks.existingOutputPaths` — byte-identical to how `bulk-archive-change.ts` already does its task check. This also fixes WF-9's non-`tasks.md` schema case (the tasks artifact isn't always literally `tasks.md`).
- **Main specs (WF-3 T1):** the main specs live in the `specs/` directory that is the sibling of `planningHome.changesDir` (i.e. `<planning root>/…/specs/<capability>/spec.md`), NOT the literal repo-relative `rasen/specs/…`. In a store, `planningHome.changesDir` points into the store, so the sibling `specs/` is the store's specs — the WF-3 store bug fixed. Phrased as a resolution rule, not a new literal.
- **Office-hours output (WF-3 T4):** the in-change-dir doc resolves under `changeRoot`; the no-active-change doc resolves under the `office-hours/` directory that is the sibling of `planningHome.changesDir` — the exact location child #5's WF-2 propose-reader already scans, so producer and consumer now agree in store mode too.

### D3 — Spec homes (all existing; no new capability)

- `opsx-archive-skill` — ADD "Archive resolves artifact paths from status JSON" (WF-9 tasks + WF-3 T1 main specs). ADDED, not MODIFY: child #5 just MODIFIED the "Task Completion Check" requirement for hard-gating; re-MODIFYing it is fragile and risks clobbering that. A dedicated path-resolution requirement states the resolution contract and references bulk-archive as the precedent.
- `specs-sync-skill` — ADD "Sync resolves the main-spec target from the planning home" (WF-3 T1).
- `opsx-office-hours-command` — ADD "Office-hours resolves its output paths from status JSON" (WF-3 T4). Complements child #5's `Downstream Consumption by Propose` reader-side resolution.

### D4 — Parity: these three templates are now pinned (child #5)

`rasen-archive-change` was always pinned; `rasen-sync-specs` was always pinned; `rasen-office-hours-command` became pinned via child #5's registry expansion. So all three edits move existing parity hashes — the regen tail re-locks them. No shared-block (`_shared.ts`/`_orchestration.ts`) edits, so NO other template hashes move; a moved expert/orchestration hash means something is wrong.

## Risks / Trade-offs

- **T3 store bug stays open until t3-workdir lands.** In store mode, ship-log/verification-report writes still hit a stray cwd path; child #5's archive *reader* resolves them from `changeRoot`, so there's a producer/consumer asymmetry in store mode. This is intentionally owned by t3-workdir (which moves both producer and reader to `workDir` together). Repo mode (the default) is unaffected — `changeRoot`-relative equals the hardcoded path there.
- **Shared-file overlap with the LIVE `externalize-artifacts-t3-workdir` change (VERIFIED against its just-landed proposal).** t3-workdir's proposal edits `archive-change.ts` **"read side only"** — it repoints archive's verification-report + ship-log GATE READS (child #5's steps 3.5/3.6) from `changeRoot` to the external `workDir`. My child #6 edits DIFFERENT regions of the same file: step 3 (task-file path → `artifactPaths.tasks.existingOutputPaths`) and step 4 (main-spec compare → planning home). Non-overlapping regions, but the SAME file + both getters, and BOTH changes add a delta spec to `opsx-archive-skill` (t3-workdir a MODIFIED "gates read from workDir" requirement; mine an ADDED "resolve tasks/main-specs from status JSON" requirement — compatible, different requirements). Both are in PROPOSE; neither has applied `archive-change.ts` yet. **Recommendation: the LEAD serializes the APPLY of child #6 and t3-workdir on `archive-change.ts`** — whichever applies second re-applies its region (trivial; t3-workdir's own proposal already mandates re-check-git-status-before-edit + pathspec commits). t3-workdir explicitly does NOT claim the tasks/main-spec resolution ("archive timing/destination stay as-is — siblings own those"; read side only), so WF-9 + WF-3 T1 are genuinely unclaimed and correctly land here — they would fall through the cracks if deferred.
- **`sync-specs.ts` and `office-hours.ts` are CLEAN of t3-workdir** (verified: neither appears in t3-workdir's template-audit list — office-hours is T4, sync-specs T1). `sync-specs.ts` remains on the *pending* `archive-timing` surface (orthogonal: path resolution vs sync decomposition; not live). `office-hours.ts` has no externalize claimant.
- **Narrow scope leaves part of WF-3 unfixed by THIS child.** That is the point of the alignment: the deferred part is fixed better, and by its rightful owner, in the externalize portfolio. Recorded in durable findings so the portfolio close-out can confirm WF-3 is fully closed across both portfolios.
- **`office-hours.ts` was just edited by child #5** (WF-6 delegation, WF-2 promise text); child #5 is shipped+archived, so no concurrency — this edit stacks on landed code.
