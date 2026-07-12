# Tasks — codex-runtime-playbook-integration

Version premise: codex-cli 0.144.1. Never bump the package version. Reference ONLY shipped machinery (src/core/codex at a658620 + 115c0c67, context-probe CLI) — do not invent commands, bridges, or plugins. The playbook is a built artifact: template edits flow build → `rasen update`, and parity hashes are re-pinned by hand with an eyeballed diff.

## 1. Playbook rewrite (src/core/templates/workflows/_orchestration.ts)

- [x] 1.1 Rewrite Step A.1's Codex runtime paragraph (~line 42): delete "app-server threads / installed Codex Claude Code plugin / Rasen Codex bridge" and the `turnId` promise; state the exec bridge (per-worker `codex exec` process), `threadId` as the durable handle, rollout path as the `transcript` pointer, and that exec mode records NO turn id
- [x] 1.2 Rewrite Step B's Codex dispatch guidance (~lines 58–64): show the rendered invocation shape (`codex exec --json --output-schema <schema> -o <last-message> -s <sandbox> -m <model> -c model_reasoning_effort="<effort>" "<prompt>" < /dev/null`) with the invariants as rules — always `< /dev/null`; prompt ends with the flat-hierarchy guard (cite `CODEX_FLAT_HIERARCHY_GUARD` by name, paraphrase its text); never `ultra` effort for workers; inline template/skill bodies client-side (prompt-file reliance fails silently); worker returns constrained by `LEAF_RETURN_SCHEMA`/`EVALUATE_GATE_SCHEMA` written to a schema file and parsed from the `-o` file; DELETE the `/codex:rescue` sentence entirely
- [x] 1.3 Rewrite the Step F identity-recording sentence (~line 64 and the Step F run-state section ~line 170): Codex workers record runtime/role/threadId/sandbox/model/effort + rollout path in `transcript`; no `turnId`
- [x] 1.4 Add lifecycle guidance (in Step B or the Step H vicinity, wherever the Claude equivalents live): resume by explicit `codex exec resume <threadId>` with the same capture flags, stdin closed, and NO `-s` (sandbox fixed at creation — changing sandbox = fresh thread); death = last `task_started` in the rollout without `task_complete`/`turn_aborted`; revival messages include the `CODEX_REVIVAL_NOTICE` semantics; 429 → backoff retry (20s doubling, 120s cap), 404 → fatal surface, unknown → escalate per the worker-death taxonomy; occupancy via `rasen agent context --transcript <rolloutPath> --json` with unchanged thresholds (zero-turn 0% is normal); one thread id, one writer (never two concurrent resumes)
- [x] 1.5 Verify the Step G reuse-ladder wording (~line 222) — "threadId resume for Codex" is now true; extend with rollout warm-seed (distilled final answers, commentary dropped) as the fallback when a thread is unresumable or context-poor
- [x] 1.6 Add the context-injection subsection (design D4): per-change context by prompt reference naming proposal/design/tasks paths (verified worker behavior), repo-root AGENTS.md for repo-global conventions only, never cd workers into change dirs for nested discovery
- [x] 1.7 Add the Step H.7 session-relay note (design D5): LEAD relay doesn't disturb Codex workers (successor resumes recorded thread ids); parenthetical naming `codex resume`/`codex fork` as candidates only if the LEAD role ever inverts
- [x] 1.8 Sweep the whole template tree for remaining fiction: `grep -rn -i "app-server\|codex:rescue\|turnId" src/core/templates/` and fix or justify every hit (auto.ts runtime-flag lines are real and stay)

## 2. Reality fixes outside templates

- [x] 2.1 Correct the `AgentRuntimeSchema` doc comment in `src/core/pipeline-registry/types.ts` (app-server thread → dispatched via the `src/core/codex` exec bridge, threadId recorded for resume); comment-only, no schema change
- [x] 2.2 Add the superseded banner + "Current state" pointer section (linking `docs/codex-parity/README.md`, `docs/zh/codex-parity-solutions.md`, `src/core/codex/`) to `docs/codex-workflow-integration.md` AND `docs/zh/codex-workflow-integration.md` in the same commit, keeping EN/ZH mirrored; preserve the existing body as historical record

## 3. Template build discipline and validation

- [x] 3.1 Build and regenerate: `pnpm build` then `rasen update`; inspect the regenerated auto/goal/review-cycle skill output and confirm the diff is exactly the intended Codex sections
- [x] 3.2 Re-pin parity hashes in `test/core/templates/skill-templates-parity.test.ts` for every entry the playbook feeds (`rasen-auto`, `rasen-goal`, `rasen-review-cycle` in the function-payload map and the generated-content map, plus their command payload entries) — paste new hashes only after the 3.1 diff review
- [x] 3.3 Run `pnpm test` (full suite) and `rasen validate codex-runtime-playbook-integration` — both clean
- [x] 3.4 Final sweep: no invented commands/bridges anywhere in the diff; every behavioral claim in rewritten playbook text traceable to a shipped symbol or dossier experiment; no version bump
