# Deferred Follow-ups: runtime-adapter-interface-extraction

Open work this change deliberately did not close. Written as a `-report.md` so
`rasen archive` detects it: `isQualityFilename`
(`src/core/archive-engine.ts:2721-2723`) matches the `-report.md` suffix,
`captureArchiveQuality` (`:2755-2761`) counts every line matching
`/\b(?:findings|issues|scenarios):/i`, and writes the count into the archived
`.openspec.yaml` under `quality.metrics`; `hashArchiveEvidence`
(`archive-accounting.ts:138-176`) records its sha256 in `archive.json`. Each
entry below opens with exactly one such line, so the recorded metric equals the
number of open follow-ups.

**Read this before treating the archived change as closed.** The count in
`quality.metrics` is the machine-detectable signal; this file is the payload.

## FU-1 — The bridged-worker identity guarantee is enforced on declaration, not on application

Findings: 1 open — a third rasen-owned bridge can still bypass the merge by calling `spawnAgentCli` directly.

Verification of this change found that `childEnv` was applied by a hardcoded
`DISPATCH_ADAPTERS.claude.childEnv` read at one Claude-specific spawn site, and
that a second rasen-owned Claude worker (`management-api/supervisor.ts:320`)
bypassed it entirely — a daemon started from a Codex session handed every
Claude worker a Codex identity. Both were fixed in `4d103f92`: the
`DispatchAdapter` union now makes `childEnv` **required** on the `rasen-owned`
arm (omitting it fails the build with `TS2322`), and `bridgeChildEnv` is the
single merge site both spawn sites call.

What remains open is the other half. **Declaration** is enforced by the type
system; **application** is not. A future bridge that calls `spawnAgentCli`
directly, without routing through `bridgeChildEnv`, compiles clean and silently
reintroduces the defect. Nothing in the type system or the test suite requires a
rasen-owned spawn to go through the helper.

- Evidence: `src/core/runtimes/dispatch-adapters.ts:53-73` (the helper),
  `src/core/claude/runner.ts:204` and `src/core/management-api/supervisor.ts:327`
  (the two callers), `src/core/agent-cli-process.ts:141-166` (`spawnAgentCli`,
  which takes no adapter and merges nothing).
- Why it was missed the first time: the task-3.8 audit enumerated runtime
  **literals**, never **spawn sites**. When a requirement says "every X", the
  audit has to enumerate X.
- Candidate repairs, cheapest first: (a) a lint rule or test that asserts every
  `spawnAgentCli` call in a dispatch path passes a `bridgeChildEnv` result;
  (b) move the merge inside `spawnAgentCli` behind a required target argument,
  so bypassing it is impossible rather than merely discouraged.
- Owner: the Oh My Pi `DispatchAdapter` follow-on, which adds exactly the third
  rasen-owned bridge this entry is about.

## FU-2 — The audit zero-report invariant is broader than recognition can deliver

Findings: 1 open — a spec scenario is not satisfied by shipped code; the repair is a decision, not a patch.

`cli-agent-audit` scenario "A report is never attributed to a foreign runtime"
states, unqualified: "a session that could not be analyzed by that auditor SHALL
NOT appear as a zero-valued report of that runtime." Two paths still violate it,
both reproduced on the built CLI during verification:

| Input | Result |
|---|---|
| `agent audit <omp file> --runtime claude --out r.json` | exit 0, report written, `session.runtime:"claude"`, `requests:0` |
| `agent audit <unrecognized .jsonl> --out r.json` (no override) | exit 0, report written, `session.runtime:"claude"`, `requests:0` |

Neither is a regression and neither is in this change's stated scope — the
proposal scopes the fix to a file belonging to a harness Rasen **recognizes**,
and design D4 states an explicit override wins outright (unchanged behavior).
But the scenario as written is not met, and shipping it as if it were would be
the declaration/implementation gap this whole change exists to close.

- Mechanism (second row, the one needing no override):
  `SNIFF_FALLBACK_RUNTIME` sends an unrecognized file to the Claude auditor,
  `parse.ts` yields zero requests, `Math.min(...[])`/`Math.max(...[])` become
  `±Infinity` and are nulled by the `Number.isFinite` guards
  (`src/core/token-audit/audit.ts:369-372`), and `writeReport` (`:399`)
  commits it.
- Why a naive guard is wrong: a genuinely empty Claude session is a legitimate
  zero. A guard must assert Claude **format**, not zero **count**.
- The decision to make: either add a format-recognition guard to
  `runClaudeAudit`, or tighten the scenario to "a session belonging to a
  *recognized* harness", which is what the rest of the capability already says.
- Owner: the Oh My Pi `AuditReader` follow-on, where a real second reader makes
  the distinction concrete.

## FU-3 — UI wire mirror still hand-maintains the audit-runtime union

Findings: 1 open — declared out of scope by design D11, unchanged by this change.

`packages/ui/src/api/types.ts:341` mirrors the audit-runtime union by hand in a
separate typecheck realm. Per this project's
`management-api-wire-mirror-field-relaxation` rule, relax the mirror **before**
the server widens, and add a parity test against `AUDIT_RUNTIMES`. Owner: the
audit capability change, where it first matters.

## FU-4 — Audit viewer allow-list should become a schema-tag check

Findings: 1 open — declared out of scope by design D11, unchanged by this change.

`viewer/audit.html:219,372-384` keeps a runtime allow-list. The right repair is
to delete it, accept any report carrying the `rasen-token-audit/2` schema tag,
and give the render dispatch an explicit unknown-runtime arm — a contract change
that makes the viewer forward-compatible so no future runtime touches it at all.

## FU-5 — The UI model-preset parity test is one-directional

Findings: 1 open — caused by this change's D14 and only half-closed here.

Adding `opus-5` to `MODEL_PRESETS` silently drifted
`packages/ui/src/config/controls.ts` `KNOWN_MODEL_IDS`, so the UI suggested the
previous Opus generation. The list was fixed here, but the parity test
(`packages/ui/test/config/controls.test.ts:156-169`) only asserts
mirror → preset, never preset → mirror, so the next preset addition drifts
silently again. `packages/ui` also sits outside the root vitest include, so the
root suite cannot catch it either. Add the reverse assertion.

## FU-6 — Zed recognition on the context-probe path is an undeclared exception

Findings: 1 open — a behavior change that design D4 does not list and no test pins.

Unifying recognition moved Zed's extension check onto the probe path, where it
never existed. `rasen agent context --transcript <threads.db>` previously fell
through to the Claude reader and failed with "No assistant usage found"; it now
refuses naming `zed`. Strictly better and arguably mandated by the ADDED
requirement, but task 2.2 says recognition must change nothing and design D4
declares exactly one exception (the Oh My Pi file). Either name Zed as a second
declared exception in the spec, or add the probe-path assertion.

## FU-7 — The audit-side refusal has no unit test

Findings: 1 open — coverage asymmetry between the two twin refusals.

`src/core/token-audit/audit.ts:173-179` is the twin of
`agent-context.ts:195-202`. The context side has both unit
(`test/core/agent-context.test.ts:722-737`) and e2e coverage; the audit side has
only e2e (`test/cli-e2e/agent-audit.test.ts:231-252`). The e2e is good — it
asserts exit code, the harness name, and that no report file exists — but the
cheap sibling assertions (that `AUDIT_RUNTIMES` is named in the advice; that the
`--match`/`--db` flag gate is unaffected) go uncovered.

## FU-8 — A published audit doc states a stale host-fingerprint precedence

Findings: 1 open — pre-existing, deepened by neither this change nor the last.

`docs/audits/rasen-codex-host-runtime-and-subagent-wait-diagnosis.md:272-279`
publishes a precedence list as "current" that omits `CODEX_THREAD_ID` and
`OMPCODE`, and `:340-348` recommends a list a reader following it verbatim would
use to rebuild the exact bug `detect-omp-host-runtime` fixed. `:356` also claims
the registry has only a `canDispatch` dimension, which three capabilities
falsify. The file reads as a live diagnosis of a state two changes stale; it
wants a superseded banner like `docs/codex-workflow-integration.md:3`, or a
targeted refresh.

## Carrier note

`rasen archive` has **no** concept of deferred work — verified against
`archive.ts`, `archive-engine.ts`, `archive-accounting.ts`, and
`specs-apply.ts`. The only archive-time gate on unfinished work is unchecked
`- [ ]` in the tracked-tasks file, which *blocks* the archive rather than
carrying anything forward, and `--yes` overrides it.

So this file is detected two ways, and neither is a block:

1. **CLI** — the `-report.md` suffix puts it in `plan.qualityInputs`, its
   per-entry count lands in the archived `.openspec.yaml` `quality.metrics`,
   and its sha256 lands in `archive.json`. The number survives permanently in
   the archived record.
2. **Agent** — `verification-report.md` cross-references this file, and the
   `/rasen-archive-change` skill reads that report at its `VERIFY VERDICT:` hard
   gate (`src/core/templates/workflows/archive-change.ts:98-103`), so the
   archiving agent is pointed here before it proceeds.

For the durable lessons that should resurface in *future* sessions rather than
at archive, this project runs `retention: codify`, and a managed learned skill
is the only carrier in this repo that re-presents itself without anyone opening
a file. FU-1's lesson is registered that way.
