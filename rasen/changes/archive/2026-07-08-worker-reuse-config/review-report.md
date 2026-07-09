# Review report — worker-reuse-config

**Reviewer:** reviewer-config (author != verifier)
**Scope:** uncommitted working-tree diff — `src/core/pipeline-registry/{types,run-state,index}.ts`, `src/commands/pipeline.ts`, and the three touched test files.
**Verdict:** APPROVE — no Blocker / Major / Minor findings. Two Trivial notes below.

## Evidence
- `npx vitest run test/core/pipeline-registry/pipeline.test.ts test/core/pipeline-registry/run-state.test.ts` → 80 passed.
- `pnpm run build` → clean, then `npx vitest run test/commands/pipeline.test.ts` → 32 passed (includes the new `reuse` show test and the `reusedFrom` resume test; no Windows EBUSY/timeout flake this run).
- `openspec validate worker-reuse-config` → valid.

## Spec fidelity — every scenario covered by behavior + test
| Requirement / Scenario | Behavior | Test |
|---|---|---|
| Reuse block — valid parses | `ReuseConfigSchema` mounted on `PipelineYamlSchema`; surfaced via `resolvePipelineReuseConfig` in `show --json` | `pipeline.test.ts` "parses a valid reuse block" + CLI "surfaces the resolved reuse config … (declared block)" |
| Reuse block — invalid rejected (bad mode / threshold out of (0,1] top-level & per-role / unknown key) | `ReuseModeSchema` enum, `ReuseThresholdSchema` gt(0)/lte(1), `.strict()` on all three schemas | "rejects a mode other than auto/never", "rejects a threshold outside (0,1] (top-level and per-role)", "rejects unknown keys", "rejects an unknown (non-reusable) role" |
| Resolution order — per-role > pipeline > default | `roles[role] ?? threshold ?? default` | "resolves per-role threshold: roles[role] > pipeline threshold > default" |
| Resolution order — modes declared > default; defaults auto/auto/0.25 | `reuse?.[role] ?? DEFAULT_REUSE_CONFIG[role]` | "resolves modes", "resolves to built-in defaults", CLI "built-in defaults when no block is declared" |
| Worker lineage — resume surfaces `reusedFrom`, omits when absent | `reusedFrom` on `RunStateWorkerSchema`; `resume()` spreads full worker into `workersWithContext` | run-state round-trip pair + CLI "surfaces a reused worker's reusedFrom lineage and omits it when absent" |

## Correctness / convention checks (all pass)
- Resolver precedence verified by hand for the three cases (roles-only, threshold-only, nothing) — matches the spec field-wise order; top-level `threshold` and per-role `roles` resolved independently and correctly.
- `(0,1]` boundary: `gt(0)` rejects 0, `lte(1)` accepts exactly 1 — both asserted.
- Pipeline-level only: no `StageReuseConfigSchema`, nothing added to `toStageView`; `reuse` attached once to the `show()` result as a sibling of `agents` (design decision 2). `StageView` untouched.
- `reusedFrom` passthrough: `stageWorkers()` inclusion filter (`agentId || transcript || threadId`) left unchanged; a reused worker carries a transcript so it is already included, and `workersWithContext[id] = … : w` spreads the full record — no gating on `reusedFrom`. Matches design decision 3.
- Convention match with the `handoff` sibling: private threshold/roles schemas (mirrors `HandoffThresholdSchema`/`HandoffRolesSchema` staying unexported), self-describing "reuse threshold" validation vocabulary, `.strict()` for free unknown-key rejection, barrel exports parallel to the handoff symbols. `ReuseRolesSchema` correctly restricted to `planner`/`implementer` only, so a `reviewer` role key is rejected as unknown (asserted).
- No breaking changes: every new field optional; `RunStateWorkerSchema` stays `.passthrough()`; run-states without `reusedFrom` parse unchanged (asserted).

## Trivial notes (non-blocking, no action required)
1. **[Trivial] Spec scenario "Valid reuse config parses" names `openspec validate <name> --type pipeline`, but no CLI test invokes `validate` on a reuse-bearing pipeline** — coverage is effectively equivalent since `parsePipeline` in the unit test exercises the exact `PipelineYamlSchema` that `validate` consumes, and `show --json` is tested end-to-end. Fix (optional): add one `runCLI(['validate', …, '--type', 'pipeline'])` assertion, or leave as-is.
2. **[Trivial] `index.ts` also exports the `ReuseConfig` / `ReuseMode` value/inference types** beyond the five symbols tasks.md 1.5 enumerates — harmless and consistent with how `handoff` exports `HandoffConfig`. No action.

Out of scope: a sibling `openspec/changes/worker-reuse-policy/` dir is untracked in the working tree — that is the declared follow-up change, not part of this diff.
