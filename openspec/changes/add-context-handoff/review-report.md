# Independent Review — add-context-handoff

Reviewer: independent (did not author). Branch `dev-harness`.
Verification: `npx tsc --noEmit` clean; in-scope suites 156/156 passing
(`agent-context`, `handoff`, `pipeline-registry/run-state`, `pipeline-registry/pipeline`,
`commands/pipeline`, `review-cycle`, `profiles`).

Overall: the implementation satisfies all four delta specs and the design. No Blocker or
Major findings. Findings below are Minor/Trivial robustness and coverage notes.

## Findings

| Severity | Location | Finding | Confidence |
|----------|----------|---------|------------|
| Minor | src/core/agent-context.ts:157 (`claudeProjectsDir`) | Slug replaces only `:` `/` `\` with `-`, but Claude Code's real project-dir convention also replaces `.` (dots). A cwd containing a dot (e.g. `my.app`) makes `--latest` resolve a nonexistent projects dir and throw. `--dir`/`--transcript` are escape hatches; current repo path has no dots. | Medium |
| Minor | src/cli/index.ts:620 / src/commands/agent.ts | `--limit <n>` is `parseInt`'d with no validation and passed straight through as `options.limit ?? resolveModelLimit`. `--limit 0` → `pct = tokens/0 = Infinity` → JSON emits `"limit":0,"pct":null`; `--limit abc` → `NaN` limit → `pct:null`. Non-fatal garbage output; no guard rejects a non-positive/NaN limit. | High |
| Trivial | src/core/agent-context.ts:184 (`findLatestMainTranscript`) | mtime tie-break uses strict `>`, so on an exact-ms tie the first file in `readdir` order wins (order not guaranteed). Real transcripts rarely tie to the millisecond. | High |
| Trivial | src/core/pipeline-registry/types.ts:173 & 298 | `StageSchema.handoff` reuses `HandoffConfigSchema`, so a stage-level `handoff.roles` validates, but `resolveStageHandoffConfig` never reads `stage.handoff.roles` — it is silently-ignored dead config. Design states `roles` is pipeline-level only. Also a stage `handoff:{roles:{…}}` (only) reports `source:'stage'` while contributing nothing to the resolved values. Harmless. | High |
| Trivial | test/core/pipeline-registry/pipeline.test.ts (handoff config) | No test asserts the `(0,1]` upper boundary `threshold: 1` is ACCEPTED (only `0` and `1.5` rejection are covered) and no test exercises the `--limit 0`/NaN misuse path. Coverage gap only. | High |

## Dimension-by-dimension

1. **Correctness / jsonl parsing** — Clean except the notes above.
   - BOM: handled. `line.trim()` strips a leading U+FEFF (it is ECMAScript WhiteSpace), so a
     BOM-prefixed first line still parses.
   - CRLF: handled (`trim()` removes the trailing `\r` before `JSON.parse`).
   - Malformed lines / blank lines / missing usage fields / empty file / missing file:
     handled and tested; `sumUsage` treats absent fields as 0; last-usage-entry-wins is correct.
   - `--latest` excludes `agent-*.jsonl`, throws on absent dir / subagent-only dir (tested).
   - `pct` division: limit is always a resolved model window (≥200k) or an explicit override;
     only the unvalidated `--limit 0`/NaN misuse (finding above) yields a bad quotient.
   - Limit map matching order: `haiku` guard is first and cannot collide with the large-context
     substrings; unknown/older models fall to the conservative 200k default (safe direction —
     overstates pct, so handoff fires early not late).
   - Windows cwd slug: `E:\a\b` → `E--a-b` matches the real convention and the scratchpad path
     (double dash after the drive letter). Only the dot gap above.

2. **Schema safety** — Clean. `threshold` `gt(0).lte(1)` rejects 0 and 1.5, accepts 1;
   `maxRelays`/`stallLimit` `.int().positive()` reject 0/-1/non-int; `.strict()` rejects unknown
   keys. Run-state is backward compatible: all new fields optional, `.passthrough()`, old
   `auto-run.json` parses unchanged (tested). Resume never throws on a missing transcript
   (`tryContextEstimate` swallows all read errors and `readRunState` returns null on any failure).

3. **Consistency (playbook ↔ CLI/config/docs)** — Clean. Defaults `{threshold:0.5, maxRelays:3,
   stallLimit:2}` match `DEFAULT_HANDOFF_CONFIG` and appear identically in `_orchestration.ts`
   Step H, `auto.ts` Step 0, and `docs/opsx-workflow-guide.md`. Doc YAML field names
   (`threshold`, `roles`, `maxRelays`, `stallLimit`) match the schema. Flag names
   (`--transcript`, `--latest`, `--dir`, `--limit`, `--json`) match `probeAgentContext`.
   review-cycle.ts + auto.ts cross-references to "Step H.5/H.6" exist in the playbook.

4. **Registration completeness** — Clean. `handoff` present in: profiles `ALL_WORKFLOWS`;
   tool-detection `COMMAND_IDS`; init `WORKFLOW_TO_SKILL_DIR`; profile-sync-drift
   `WORKFLOW_TO_SKILL_DIR`; skill-generation both lists (`getSkillTemplates` +
   `getCommandTemplates`); skill-templates re-export. Drift removal on deselection covers BOTH
   artifacts: the skill-dir loop (profile-sync-drift.ts:131) and the command-file loop
   (:158) both iterate `ALL_WORKFLOWS`; generation test confirms `.claude/commands/opsx/handoff.md`.
   Not in `CORE_WORKFLOWS` (tested).

5. **Test quality** — Strong. Precedence resolution uses exact `toEqual` (stage/role/pipeline/
   default + `source`); resume tests assert real on-disk transcript enrichment and the
   missing-transcript no-fail path; run-state round-trips and old-format parse are covered.
   Gaps: the `(0,1]` upper boundary-accept and the `--limit` misuse path (Trivial, above).

## Round 2 (delta re-review)

Verified each fix against the live code (agent-context.ts / test are untracked — read
directly, not via `git diff HEAD`). Gates after fixes: `tsc --noEmit` clean; 160/160 across
the seven in-scope suites (+4 new tests). New tests assert the fixed behavior and would fail
against the pre-fix code.

| Original finding | Resolution | Status |
|------------------|------------|--------|
| Minor — slug omits `.` (agent-context.ts:157) | `claudeProjectsDir` now `cwd.replace(/[:\/.]/g,'-')`; comment updated; test `also replaces dots` asserts `E:\work\my.app` → `E--work-my-app`. | CONFIRMED |
| Minor — `--limit` unvalidated (agent-context.ts) | `probeAgentContext` now throws `--limit must be a positive integer` when limit is defined and `!Number.isInteger \|\| <= 0`; test loops `[0,-5,1.5,NaN]`, all throw. Catches 0/negative/non-int/NaN. | CONFIRMED |
| Trivial — stage-level `roles` dead config (types.ts) | New `StageHandoffConfigSchema = HandoffConfigSchema.omit({roles:true}).strict()` wired into `StageSchema.handoff`; test `rejects roles at stage level` asserts it throws. Matches design ("roles is pipeline-level only"). | CONFIRMED |
| Trivial — no `(0,1]` upper-boundary-accept / `--limit` misuse coverage | Test `accepts the (0,1] upper boundary threshold of exactly 1` added; `--limit` misuse now covered by the limit test above. | CONFIRMED |
| Trivial — mtime tie-break nondeterministic | Not fixed; triaged accepted-known (real transcripts don't tie to the ms; recorded in run-state). | ACCEPTED-KNOWN (agreed) |

VERDICT: CLEAN — no open Blocker/Major; the one unaddressed item is a Trivial accepted-known.
