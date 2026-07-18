# Review Report — fix-run-state-worker-handles

**Reviewer:** independent verifier (reviewer-1, dispatched report-only mode)
**Axis:** both Standards (repo conventions + smell baseline) and Spec (proposal/design/specs/tasks)
**Verdict:** **CLEAN — ship-able.** No Blocker, No Major. 1 Minor (test gap), 1 Trivial (accepted-known limitation). Every focus area verified with evidence below.

| Severity | Count |
|---|---|
| Blocker | 0 |
| Major | 0 |
| Minor | 1 |
| Trivial | 1 |

## Verification gates run
- `pnpm exec vitest run` (full suite): **2526 passed, 22 skipped, 0 failed** (124 files).
- `pnpm exec tsc --noEmit`: **exit 0**.
- `pnpm exec eslint` on all 6 changed source files: **clean**.
- Targeted run of the 3 affected test files: 110 passed.

## Scope check
**CLEAN.** Intent (proposal): fix the two coupled defects (durable handles in run-state + correct the within-session revival overclaim) plus the hidden-bug leads, backward-compatible, no new required schema fields. Delivered: exactly the 9 files listed in the dispatch, no out-of-scope creep. The `rasen/changes/fix-run-state-worker-handles/` dir is new (untracked) — expected.

---

## Spec axis — focus areas (each verified)

### 1. `detectDuplicateKeys` correctness — CLEAN (+ 1 Trivial)
`src/core/pipeline-registry/run-state.ts:374-496`. Confirmed by trace + passing tests:
- Scans RAW text, never `JSON.parse` (the whole function is a char scanner; `readString` at :397-409 skips `\<char>` escapes so an escaped quote does not end a literal early).
- Tracks object/array nesting via a `Frame` stack (`:403`); a key is recorded only when the next non-ws char is `:` AND the current frame is an object (`:429-437`).
- Ignores tokens inside string literals — the entire value string is consumed by `readString` before the key-test runs (`:420-428`).
- Returns `[]` for clean input (test: `run-state.test.ts:660`).
- Same key at two different levels is NOT a duplicate — verified by trace (`{"a":{"a":1}}` → two distinct frames `$.a` and `$`) and test (`run-state.test.ts:651`).
- Arrays handled: each element object gets its own fresh `seen` set with a precise `[index]` path (`:448-455`); a duplicate inside ONE array element is reported at `$.<arr>[i]` (verified by trace). Dup top-level key reported at `$` (`:642`); dup nested under `stages` reported at `$.stages` (`:648`).

> **Trivial — accepted-known limitation.** `detectDuplicateKeys` compares the RAW key text, so two keys that are textually different but canonically equal after JSON decoding — e.g. `{"a":1,"a":2}` — are NOT reported (both decode to `a`, and `JSON.parse` collapses them). This is an explicit consequence of design **D3** ("token-scans the raw JSON text"; a strict-parser dep and a reviver were both rejected). It is not a realistic LEAD-authoring pattern (the observed failure used literal duplicate `propose`/`verify`/`rounds` keys, which ARE caught). No action required; recorded so it is not silently dropped. If ever desired, decode `\uXXXX` in `readString`'s returned value before comparison.

### 2. `stagesLackingDurableHandle` correctness — CLEAN
`src/core/pipeline-registry/run-state.ts:499-523`. Reuses `normalizeWorker` (`:302-308`); does NOT mutate state or touch `stageWorkers`:
- `normalizeWorker` returns a NEW `{role}` for a bare string and the same ref for an object; the helper only reads (`agentId || transcript || threadId`) and `Object.keys(...).filter(k => k !== 'role')` — no write path.
- Mirrors `stageWorkers`'s inclusion test exactly (`agentId || transcript || threadId`, `:322` and `:516`), so "warned" ≡ "dropped from the warm-seed set" — semantically the right invariant.
- name-only `{name:'implementer'}` → `{stage, keys:['name']}` (test `:677`); role-only `{role:...}` → `keys:[]` (test `:686`); bare-string worker → `keys:[]` (test `:694`); durable handle (agentId/transcript/threadId) → omitted (test `:701`); no worker → omitted (test `:719`).
- The durable-handle set is `agentId`/`transcript`/`threadId` — matching the spec verbatim ("lacks ANY durable handle (`agentId`, `transcript`, or `threadId`)"). `turnId`-only is intentionally warned (it is not a warm-seed key for `stageWorkers` either); consistent, not a bug.

### 3. Resume warnings — CLEAN (+ 1 Minor test gap below)
`src/commands/pipeline.ts:456-461, 492-495, 527-537`.
- Computed BEFORE `const result` (`:456-461` precedes the result object at `:463+`) → no partial emission; json and text see the same set.
- Emitted ONLY when non-empty: spread-conditional `...(workerHandleWarnings.length > 0 ? {workerHandleWarnings} : {})` (`:494-495`). Backward compat asserted directly via `hasOwnProperty(..., 'workerHandleWarnings') === false` on a durable run (`pipeline.test.ts:803`).
- Exit 0 preserved — no new `throw`/`process.exit`; tests assert `exitCode).toBe(0)` for name-only and dup-key cases.
- Human lines correct: `"Worker handle warning: stage 'apply' worker has no durable handle (recorded: name)..."`; asserted via substring checks (`pipeline.test.ts:793-795`).
- `runStateLocation` guarded (`if (runStateLocation && fs.existsSync(...))`), so a missing/absent run-state file leaves `duplicateKeyWarnings = []` rather than throwing.

### 4. Playbook text — CLEAN
`src/core/templates/workflows/_orchestration.ts`. `grep -rn` of all three overclaim phrases across `src/` returns **nothing**:
- `DOES revive the same agent` — gone. Step F.1 (`:174`) now: "agentId-first … but a COMPLETED worker is NOT reliably addressable even in-session … treat agentId-first as 'try it, then fall back to the transcript warm-seed', **never a guarantee**."
- `by-NAME MAY still resolve` — gone. F.1 step-2 nuance (`:177`) rewritten to "the prior holder's **agentId** MAY still resolve … Do NOT rely on the spawn `name`".
- `is itself a resume-from-transcript` / `IS a transcript-resume` — gone. The "SAME mechanism" note (`:185`) now: "agentId-first is 'try it, then fall back', **not a guaranteed revival**."
- Stops short of claiming agentId GUARANTEES revival — explicit disclaimers in Step A (`:26`), F.1 (`:174`,`:185`), H.4a(b) (`:264`), H.4b (`:267`). Matches design **D4** ("do NOT claim agentId guarantees revival").
- Step B (`:64`) now captures agentId+transcript FROM THE SPAWN RESULT and forbids a fabricated `name` — matches the ADDED "Durable worker handles captured in run-state on dispatch" scenarios.
- H.4a(b)/H.4b both re-engage by `agentId`, fall back to transcript warm-seed of step 3 / F.1 — matches the "infra-death and unticked-DONE revivals are agentId-first" scenario. Internally consistent across A/B/F.1/H.4.
- `auto.ts:99` and `claude-settings.ts:2-14` aligned (agentId-first + completed-worker caveat; no guarantee of re-addressability).

### 5. Backward compatibility — CLEAN
`RunStateWorkerSchema` (`run-state.ts:50-69`): every field still `.optional()`, object still `.passthrough()`. Diff added ONLY a doc comment above it — no schema strictness change, no new required field. Archived run-state still parses: the dup-key CLI test confirms last-value-wins parsing proceeds and `hasRunState:true` (`pipeline.test.ts:838-840`).

### 6. Parity hashes — CLEAN
`test/core/templates/skill-templates-parity.test.ts`. The function hash is `sha256(stableStringify(fn()))` — i.e. the RETURNED template object including `content`. Because both the Rasen and OPSX variants in each file return the SAME edited instruction constant (e.g. `AUTO_INSTRUCTIONS`, `auto.ts:165`), all six function hashes that moved are exactly the ones whose `content` embeds `ORCHESTRATION_PLAYBOOK`:
- Changed (expected): `getAutoCommandSkillTemplate`, `getOpsxAutoCommandTemplate`, `getReviewCycleSkillTemplate`, `getOpsxReviewCycleCommandTemplate`, `getGoalCommandSkillTemplate`, `getOpsxGoalCommandTemplate` (function hashes); `rasen-auto`, `rasen-review-cycle`, `rasen-goal` (generated-content hashes).
- Unrelated templates unchanged: `rasen-handoff`, `rasen-ship`, `rasen-retro`, office-hours, verify-enhanced, and every expert skill hash — no drift.
- Regen method is correct by construction: the parity test recomputes from the live template functions and **passed** (`preserves all template function payloads exactly` + `preserves generated skill file content exactly`). No hand-rolled hash.

### 7. Tests — STRONG (★★★), with one Minor gap
Tests assert real behavior, not trivial existence. `run-state.test.ts` covers all five `detectDuplicateKeys` scenarios the tasks require plus the string-literal edge case (`:636-665`), all five `stagesLackingDurableHandle` cases (`:668-725`), and a `stageWorkers` regression guard proving the drop behavior is unchanged (`:729-754`). `pipeline.test.ts` covers name-only (json+text, exit 0), durable (no key via `hasOwnProperty`), and dup-keys (last-value-wins, exit 0).

> **Minor — test gap (spec SHALL: duplicate-key warning in human-readable output).**
> `test/commands/pipeline.test.ts:825-845` ('warns on duplicate JSON keys…') asserts only the `--json` surface (`json.duplicateKeyWarnings`). It does NOT assert the human-readable line, and no CLI-level test asserts `duplicateKeyWarnings` is ABSENT on a clean run (the durable-handle test asserts only `workerHandleWarnings` absent). The spec requirement "Duplicate JSON keys in run-state detected" states the warning SHALL appear "in `--json` output under a dedicated field AND in the human-readable output." The code implements the text path (`pipeline.ts:533-537`) and the unit test proves the data, so risk is low (identical loop to the worker-handle text path, which IS tested at `:793-795`), but the SHALL is not directly exercised.
> **Fix:** mirror the worker-handle test — in the dup-key test add a text-mode invocation asserting `stdout` contains `Duplicate run-state key` and `'rounds'` and the path `$`; and in the durable-handle test add `expect(Object.prototype.hasOwnProperty.call(json, 'duplicateKeyWarnings')).toBe(false)`.

---

## Standards axis
No violations. No `any` introduced (helpers are typed `{path:string;key:string}[]` / `{stage:string;keys:string[]}[]`); exports re-exported from `index.ts:84-85`; dead-code/consistency clean; no magic-number/string coupling beyond the spec-mandated durable-key list (which is shared with `stageWorkers`, so the two cannot drift independently). `eslint` clean.

## Adversarial pass (inline, dispatched — no subagent)
Chaos cases considered and ruled safe:
- Unterminated string in `auto-run.json` → `readString` returns `len`, slice clamps, scanner finishes without throwing (advisory, never throws). OK.
- Top-level array / bare values → array frame path `$`, value chars iterated harmlessly. OK.
- Key-like text inside a value string containing `:`/`{`/`,` → consumed whole by `readString`, never reaches the key test. OK (also unit-tested).
- Duplicate key across a nested-object boundary (`{"a":{...},"a":2}`) → correctly reported at `$`. OK.
- `pendingKey` stale across siblings → always overwritten by the most recent key before the next `{`, and arrays use index not `pendingKey`. OK.

## Recommendation
Ship. The Minor test gap is a non-blocking completeness improvement the LEAD may route to a fixer or accept as-is; the Trivial is an accepted design tradeoff already documented in design D3.

---

## Round 1 re-review

**Re-reviewer:** independent verifier (round-1 delta re-review; did NOT write the fix)
**Scope:** the test-only m1 fix delta in `test/commands/pipeline.test.ts` — exactly two assertion additions against the prior Minor. (The whole change is uncommitted in this worktree, so `git diff` shows the full test block; the m1 delta is the two additions the prior review's "Fix" line called for.)

### m1 verdict — RESOLVED

The fix applies precisely the two additions the prior review recommended:

**(a) Human-readable dup-key warning asserted (dup-key test, `pipeline.test.ts:834-840`).**
The dup-key CLI test now adds a text-mode invocation and three `toContain` checks:
- `'Duplicate run-state key'`
- `"'rounds'"`
- `'repeated at $'`

Verified against the production line `src/commands/pipeline.ts:533-537`:
```
Duplicate run-state key: '${d.key}' repeated at ${d.path} (JSON.parse keeps the last value).
```
For the fixture, `detectDuplicateKeys` returns `{ path: '$', key: 'rounds' }` (root-level dup), so the emitted line is `Duplicate run-state key: 'rounds' repeated at $ (JSON.parse keeps the last value).` All three substrings are genuine, non-trivial substrings of that line — they would fail if the text path were removed, the key were wrong, or the path were wrong. This directly exercises the SHALL ("in the human-readable output") that was previously untested.

**(b) `duplicateKeyWarnings` absent on a clean run asserted (durable-handle test, `pipeline.test.ts:805-806`).**
The durable-handle test now adds:
```js
expect(Object.prototype.hasOwnProperty.call(json, 'duplicateKeyWarnings')).toBe(false);
```
This exercises `src/commands/pipeline.ts:495` — the spread-conditional `...(duplicateKeyWarnings.length > 0 ? { duplicateKeyWarnings } : {})`. The assertion is meaningful (would fail if the key were unconditionally emitted, e.g. `duplicateKeyWarnings: []`); it confirms clean runs gain neither warning key.

Both additions mirror the worker-handle test pattern, exactly as the prior review's "Fix" prescribed.

### New findings from the delta

**None.** No new Blocker / Major / Minor / Trivial.
- The assertions do not pass trivially and do not assert the wrong thing (see per-addition analysis above).
- Not flaky — deterministic CLI invocations against hand-written fixtures; the dup-keys fixture is written once and read by both the `--json` and text invocations in the same test.
- No production code changed; no schema/parity/ESLint surface touched.

### Independent verification run
- `pnpm run build`: **success** (tsc 5.9.3, clean).
- `npx vitest run test/commands/pipeline.test.ts`: **46 passed, 0 failed** — including `warns on a name-only worker in json + text`, `emits no workerHandleWarnings for a durable-handle worker`, and `warns on duplicate JSON keys in auto-run.json (last value wins, exit 0)`.

### Overall re-review verdict — CLEAN (ship-able)

m1 is resolved; the delta introduces no new findings. The fix is the minimal, correct test-only addition that closes the SHALL-coverage gap. No further rounds needed.
