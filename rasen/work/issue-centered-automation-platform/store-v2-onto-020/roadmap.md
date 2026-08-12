# Roadmap: Store-v2 onto 0.2.0

Candidate order, evidence-adjustable. Each slice must close on observable evidence
(goal north-star 戒律 2–3, 9), not on file/module/endpoint existence.

## NOW — first vertical foundation (unblocks the rest)

- **store-v2-foundation** — port the store base v2 model + the Store Issues module onto 0.2.0.
  Acceptance: `StoreIssues` (create / setState / publishPlan / list / show) works on 0.2.0; ported
  store base + Issues suites green; a real Issue lifecycle on 0.2.0; existing 0.2.0 store/change-run
  suites green. This is the 0.3.0-adjacent content D1 includes; nothing else in this workstream can
  land without it.

## LATER — sequenced after the foundation (order adjustable by evidence)

- **layout-migration** (L2) — port `store/layout-migration/` (flat→v2 mapping, immutable plan,
  receipt v1). Acceptance: a flat Store migrates to v2 (project Changes) on 0.2.0, byte-stable plan/receipt.
- **coordinator-bridge** (L8, the 0.1.7 patch) — port `migrate-cross-project-coordinators-to-store-issues`.
  Acceptance: a real cross-project coordinator becomes a Store Issue end-to-end (the dogfood capstone).
  **Unblocked (calibrated 2026-08-12):** the patch shipped in the released 0.1.7 (PR #154, archived
  `9472d7dc`), so the reference — including its scene-bridge coordinator fixture — is frozen.
- **store-session-execution-context** (L6) — replace cwd-probe `resolveExecutionRoot` with
  `resolvedExecutionProjectRoot`; split space vs execution selector; `resolveSessionLaunchContext`;
  Supervisor `--add-dir <store-root>`. Acceptance: agent launches from member-project cwd; Store root
  only attached; store-session dogfood.
- **finalization + stored-plan** (L3+L5, one slice) — port `withStoredArchivePlanOperation` +
  `store/finalization/module.ts` (TOCTOU); coexist with B1 `mergeConfirmed`. Acceptance: archive
  stored-plan apply via finalization; TOCTOU mutation-tested; B1 gate intact.
- **dispatch-adapter** (L4) — `createAgentCliResolver`/`probeCodex` → `DISPATCH_ADAPTERS`; rewire
  SessionSupervisor/management-api to dispatch by adapter. Acceptance: multi-runtime dispatch via the
  registry; per-bridge isolation (D6/D7). Decision D3 locked; work last among the execution-side slices.
- **router/runs/management-api seams** (L7) — reconcile store-scoped routing against 0.2.0
  management-api per-endpoint (the bidirectionally-divergent zone). May split per-endpoint.

## NOT NOW — out of this workstream (parent direction Phase 0–8)

- Issue Dispatch agent; Execution Plan DAG scheduling / auto-decompose uplift; Issue Board and
  Operations UI; Issue acceptance; external tracker integration; remote runtime. These belong to
  `issue-centered-automation-platform` and are gated on its own roadmap, not on this store foundation.

## Notes on order

- The planning-domain spine (foundation → layout-migration → coordinator-bridge) is the first real
  closed loop and the workstream's primary dogfood.
- L6 (execution root) is correctness-critical for Store-v2 to behave right; sequence it as soon as
  the foundation can host a launch, do not defer it to the end.
- L4/L7 are execution-side and the largest reconciliation surfaces; they come after the
  planning-domain spine has proven out, per D3.
