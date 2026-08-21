# Tasks: issue-autodecompose-graph

## 1. Plan-node contract: suggestion, rationale, uncertainty

- [x] 1.1 In `src/core/store/issues/types.ts` + `plans.ts`: add optional `suggestedPipeline`,
  `rationale`, `uncertainty` to the node base (both kinds, input and stored shapes). Canonical
  serialization OMITS absent fields (the `lifecycle` precedent), so every revision published before
  these fields re-derives its stored digest byte-for-byte; a digest-stability test pins this.
- [x] 1.2 Validation at publication: `suggestedPipeline` non-empty and resolving through the same
  registry-validation seam `store issue start --pipeline` uses (unknown pipeline refused naming
  node + pipeline); `rationale`/`uncertainty` pass `assertPortableIssueText` (refused at schema,
  never trimmed). Strict read: the new fields are recognized; unknown fields still refused.

## 2. The decomposition publication source

- [x] 2.1 `src/core/issue-publication/`: the decomposition document reader + publication path
  beside `publishPlanFromPortfolio` — YAML `nodes:` list; every node `kind: intent`; every node
  carries `suggestedPipeline` and at least one of `rationale`/`uncertainty`; edges as `dependsOn`;
  authored `lifecycle: optional` accepted (absent reads required). Refusals: change-kind node →
  names `--from-portfolio`; missing field → names the node and field; unreadable document →
  unreadable, never absent; planning-member gate applies identically (design D3).
- [x] 2.2 `src/commands/store-issue.ts`: the `--from-decomposition <path>` flag; the
  exactly-one-source rule covers three sources (any two together or none refused naming all
  three); publication report (human + `--json`) carries the document path, revision ordinal, and
  node count; the document is left byte-identical (pinned test).
- [x] 2.3 Publication suite: the delta's scenarios as tests — intent nodes with suggestions and
  rationale publish; change-kind refused toward portfolio source; missing field refused;
  knowledge-only target refused with roles + repair; document byte-identical; revision ordinal
  sequence unchanged (publication adds, never rewrites).

## 3. Reviewable read surface

- [x] 3.1 `src/core/issue-status/projection.ts`: node lines (and `--json` node facts) carry the
  recorded `suggestedPipeline`, `rationale`, `uncertainty` when present; both forms agree (parity
  test); the fields drive NO phase/health/progress value (before/after axes-unchanged test, same
  shape as the target-project one).

## 4. The truthful boundary verdict (the only pipeline-registry semantic change)

- [x] 4.1 `src/core/pipeline-registry/execution-plan-internal.ts`: a v1 definition carrying a
  `kind: decompose` stage reports `unsupported_pipeline_semantics` — the decompose-stage check
  runs before the null-profile short-circuit in the `requiresV2` path (and the flat path already
  covers it via `hasUnsupportedSemantics`). `task-loop` and the six v2 built-ins' verdicts are
  unchanged (pinned tests prove it); `execution_profile_unavailable` stays reachable for genuinely
  unresolvable bindings.
- [x] 4.2 Update the two pinned expectations — `test/acceptance/session-cache/pipeline-binding.test.ts`
  and `test/core/change-run/engine-product-surface.test.ts` — to the new reason with the
  fail-closed outcome unchanged; `pipeline show auto-decompose` receipt captured for evidence
  (verdict + `compatibilityBoundary: issue-dispatch-0.3.0` unchanged).

## 5. LEAD playbook: the Issue-dispatch branch

- [x] 5.1 `src/core/templates/workflows/auto.ts` + `_orchestration.ts` (Step G): the Issue-dispatch
  branch — target is a Store Issue → decompose into the document shape (intent nodes, targets,
  edges, lifecycle, suggested pipeline, rationale/uncertainty) → publish via `store issue plan
  --from-decomposition` → report review-ready (ordinal + node count) → STOP; no fan-out, no child
  worktrees, no node starts. The change-level Step G text is untouched; the branch states the
  distinction explicitly. Follow the template discipline: skill hash pins, template parity tests,
  dist rebuild.

## 6. Dogfood staging: Issue #3, review-ready (persistent store, LEAD-coordinated)

- [x] 6.1 On the persistent `issue-registry` store (writes LEAD-coordinated): stage Issue #3's
  decomposition — author the document for the portfolio's remaining work (intent nodes with real
  target projects, edges, suggestions, rationale) and publish it as the revision via
  `--from-decomposition`; capture receipts into `evidence/`: the publication report (both forms),
  the document bytes before/after, and the read-back `store issue show` with per-node suggestions
  and `phase: planning`. No node starts; close/accept actions appear only in evidence, never as
  tasks (g-003 owns the revision and confirm flow).

## 7. Validation

- [x] 7.1 Focused suites green locally (issue plan/publication, issues module digest suites,
  projection, pipeline show/registry, engine-product-surface, session-cache pipeline-binding,
  template parity), then the full local suite with every failure enumerated honestly; CI (including
  the Windows leg) is the authoritative gate.
- [x] 7.2 `rasen validate` the change; confirm every delta requirement header matches its
  `rasen/specs/<capability>/spec.md` title exactly and existing scenario titles are unchanged
  (validate does not apply deltas; archive-time sync is the closure proof).
