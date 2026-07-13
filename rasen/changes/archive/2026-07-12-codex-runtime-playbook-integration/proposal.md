## Why

The orchestration playbook's Codex sections predate the parity research: they tell the LEAD to drive Codex workers "through app-server threads via the installed Codex Claude Code plugin", offer `/codex:rescue` as the command path, and promise `turnId` capture — none of which the shipped implementation does or the dossier verified as the dispatch path. Meanwhile the three sibling changes (exec-core a658620, lifecycle 115c0c67, context-probe) have shipped the REAL, live-verified exec bridge: invocation builder, thread identity, resume, death detection, retry classification, warm seed, and occupancy probing. This merge node rewrites the playbook (and the stale pre-research docs) to describe the machinery that actually exists, so a `runtime: codex` stage is executable guidance instead of fiction.

## What Changes

- **Playbook rewrite** (`src/core/templates/workflows/_orchestration.ts`, shared into the auto / goal / review-cycle templates): Step A.1 and Step B's Codex paragraphs — and every other Codex mention (Step F identity recording, Step G reuse ladder wording, Step H) — are rewritten from the "app-server threads / Codex plugin / `/codex:rescue`" fiction to the real exec bridge:
  - dispatch via the shipped invocation builder's contract (shell form with stdin closed; flat-hierarchy guard and leaf effort cap are builder-enforced; template bodies inlined client-side; structured returns via contract schema file + last-message file);
  - identity: `threadId` captured from the `--json` stream, recorded in run-state with the rollout path as the `transcript` pointer; exec mode records NO `turnId` (the old prose promised one — exec events don't carry it);
  - warm continuation/revival: `codex exec resume <threadId>` with sandbox fixed at thread creation (live-verified: resume rejects `-s`); death detection from the rollout event log plus the revival notice for interrupted workers;
  - failure handling: retryable (429) backoff vs fatal (404) vs unknown escalation;
  - occupancy: `rasen agent context --transcript <rolloutPath>` (works as of context-probe) with the existing thresholds unchanged;
  - parallel discipline: one thread id, one writer.
- **Project-context guidance** (dossier solution 11): the playbook's Codex dispatch guidance states the live-verified pattern — per-change context passed by prompt reference (workers really read referenced files), repo-root AGENTS.md for global machine-wide conventions, and no reliance on nested AGENTS.md auto-discovery for change context.
- **Session-relay conclusion archived** (solution 13): Step H.7 gains one clarifying note — session relay is a Claude-LEAD mechanism, Codex workers are unaffected (their threads simply get resumed by the successor LEAD); `codex resume`/`codex fork` are named as the future primitives if the LEAD role ever inverts.
- **Reality fixes outside templates**: the `AgentRuntimeSchema` doc comment in `src/core/pipeline-registry/types.ts` (currently "dispatch through a Codex app-server thread") is corrected to the exec bridge; `docs/codex-workflow-integration.md` and its `docs/zh/` mirror (the 2026-06-08 pre-research app-server design) get a prominent superseded banner plus a short current-state section pointing at `docs/codex-parity/` and the shipped `src/core/codex/` module, rather than a full rewrite.
- **Template discipline**: the playbook is a built artifact — the change follows build → `rasen update`, and re-pins the affected parity hashes (`rasen-auto`, `rasen-goal`, `rasen-review-cycle` payload and generated-content maps) in the golden-master test.
- No new runtime machinery is invented: everything the playbook references is shipped library surface or existing CLI. The app-server bridge stays out (tier-3, not needed for the minimal loop).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities
- `opsx-orchestration`: the playbook capability gains requirements pinning the Codex exec-bridge dispatch contract, the Codex worker lifecycle signals (death/revival, retry classes, occupancy, single-writer), and Codex project-context injection (prompt reference + root AGENTS.md). Existing requirements are unchanged — the old app-server wording was template prose, never specced.

## Impact

- Modified code: `src/core/templates/workflows/_orchestration.ts` (main rewrite), minor aligned wording in `auto.ts` if touched by the same paragraphs, `src/core/pipeline-registry/types.ts` (comment only), `test/core/templates/skill-templates-parity.test.ts` (hash re-pins).
- Modified docs: `docs/codex-workflow-integration.md`, `docs/zh/codex-workflow-integration.md` (superseded banner + pointer section, EN/ZH kept mirrored).
- Consumed (not modified): the shipped `src/core/codex` surface (a658620 + 115c0c67) and the context-probe CLI behavior; `RunStateWorkerSchema` (already carries all fields the playbook will name).
- Tests: parity golden-master re-pins plus the full suite; template content changes are otherwise exercised by existing template tests. No new dependencies; version premise stays codex-cli 0.144.1; never bump the package version.
