# Ship Log — phase0d-router

**Shipper mode:** local commit only, no push.
**Repo:** `Reference/OpenSpec-code` @ branch `dev-harness`.

## Final verification (re-run by shipper before archive)

| Gate | Result |
|------|--------|
| `bun run skill:check` | exit 0 — all 30 gstack skills (incl. `navigator`) reported FRESH |
| `npx tsc --noEmit` | exit 0 — no type errors |
| `openspec validate phase0d-router --strict` | exit 0 — "Change 'phase0d-router' is valid" |

All three gates green. Proceeded to archive.

## Archive

`openspec archive phase0d-router -y` → archived as `2026-07-06-phase0d-router`.
Specs updated: `navigator-router-skill` (created, +3), `skill-user-invocation-support` (created, +1).

## Review conclusion (carried from review-report.md)

**Verdict: DONE_WITH_CONCERNS** — 0 Blockers, 1 Major, 4 Minor/Notes.

- **0 Blockers.**
- **1 Major (M1):** `skill-generation.test.ts` ships with 2 residual red assertions (`getCommandTemplates` / `getCommandContents`, both asserting `17` where runtime is `18`). Reviewer traced this to the sibling `add-context-handoff` change, which committed the handoff command into the runtime registration but left the command-count assertions stale when it archived at HEAD `3a70bd4`. Navigator's own diff does not touch those two assertions (navigator adds an expert, not a command) and its own assertions (skill-template counts) are correct and green. Attribution: **sibling/baseline, not navigator**. Fixed separately in a dedicated baseline-repair commit (see below) rather than folded into navigator's commit, to keep the two units of change independently attributable.
- **4 Minor/Notes (all informational, no merge action required):** N1 proposal's count guidance ("46+1") was itself based on a stale committed baseline, but the implementer landed on the correct true value (48) anyway; N2 the two expert duplicates `/ship` and `/office-hours` are represented in the router map only via their `/opsx:ship` / `/opsx:office-hours` command forms — deliberate, not a hallucination; N3 `/handoff` (added by the sibling, fork-absent when navigator was authored) is not yet referenced in the router map — reasonable future touch-up, out of scope; N4 the generated `navigator/SKILL.md` carries the full gstack preamble per task 1.1, but since the skill is `disable-model-invocation: true` it carries zero standing context load.

## Commits produced

1. **Commit A** — navigator router skill + user-invocation support (feature commit, precise pathspec scoped to navigator-owned files only).
2. **Commit B** — sibling baseline repair: `test/core/shared/skill-generation.test.ts` command-count assertions `17 → 18`, syncing the test suite to the already-archived `add-context-handoff` registration. Independent, small, no behavior change.

Both commits are local only; not pushed.
