# Verification Report: runtime-adapter-interface-extraction

Schema: spec-driven. Verified against 5 delta specs (8 requirements, 30
scenarios), design.md (D1–D15), and tasks.md (44 tasks).

**Author ≠ verifier for the substance.** The implementer wrote this change, so
all 30 scenarios were re-verified by three independent adversarial readers
instructed to treat `evidence/implementation-record.md` as a claim, not proof.
Their findings are reproduced and adjudicated below; two Majors they raised
were reproduced by hand on the shipped build before being accepted.

## Summary

| Dimension | Status |
|---|---|
| Completeness | 44/44 tasks; 8/8 requirements implemented |
| Correctness | 30/30 scenarios covered; 2 scenario clauses qualified (see Major-1) |
| Coherence | 5 design deviations, all recorded as ADRs; 1 design text now stale |

```
VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:3 Trivial:2
```

All findings raised during verification that were actionable were **fixed
during this pass**, then re-verified. The section "Findings raised and resolved"
records what was found, because a verdict of CLEAN with no history would hide
the two real defects this pass caught.

## Findings raised and resolved

### Major-1 (RESOLVED) — the "every bridge" guarantee was one hardcoded literal

`claude-exec-runtime` requires the identity be established "for **every** bridge
Rasen starts, not only the bridge that needs it today, so a bridge added later
inherits the guarantee instead of having to re-derive it."

As shipped for review it was not generic:

- `runner.ts` read `DISPATCH_ADAPTERS.claude.childEnv` — a hardcoded member
  access at a Claude-specific spawn site, not a lookup by target.
- `DispatchAdapter.childEnv` was **optional**, so a new `spawn: 'rasen-owned'`
  adapter that omitted it compiled clean. The obligation lived in a docstring —
  exactly the unenforceable prose D7 exists to eliminate.
- No test asserted the guarantee for anything but Claude.

Fixed:

- `src/core/runtime-adapters.ts:222-249` — `DispatchAdapter` is now
  `DispatchAdapterFacts<Id> & DispatchSpawnOwnership`, a discriminated union
  where the `rasen-owned` arm requires `childEnv` and the `playbook-owned` arm
  forbids it (`childEnv?: never`).
- `src/core/runtimes/dispatch-adapters.ts:53-73` — new `bridgeChildEnv(target,
  inherited)`, the single place that knows the merge rule.
- `src/core/claude/runner.ts:204` and `src/core/management-api/supervisor.ts:327`
  both call it; neither reaches into an adapter itself.
- `test/core/runtimes/registry-enforcement.test.ts:128-152` — iterates the
  registry and asserts every rasen-owned target injects its own id while the
  spawning harness's fingerprints still reach the child.

Enforcement demonstrated, not assumed. Flipping codex to `spawn: 'rasen-owned'`
without adding `childEnv`:

```
src/core/runtimes/dispatch-adapters.ts(35,3): error TS2322: ...
  Property 'childEnv' is missing in type '{ id: "codex"; ... spawn: "rasen-owned"; ... }'
  but required in type '{ readonly spawn: "rasen-owned"; readonly childEnv: Readonly<Record<string, string>>; }'
```

`pnpm build` execs the real `tsc` over `src/**/*` (`build.js:9-30`), and CI runs
`tsc --noEmit` besides, so this is a genuine build failure.

### Major-2 (RESOLVED) — a second rasen-owned Claude worker bypassed the merge

`src/core/management-api/supervisor.ts:320-328` spawns `claude -p <prompt>
--output-format stream-json` — a Rasen workflow skill running in a user cwd —
with `env: process.env`. It never went through `runClaudePrint`, so the D7 fix
did not reach it. The chain is live: `src/commands/daemon.ts:179` spawns the
daemon detached with no `env` override, so a daemon started from a Codex session
inherits `CODEX_THREAD_ID`/`CODEX_SANDBOX`, and every supervisor-launched Claude
worker inherited them too — then ran `rasen agent context --latest` (mandated by
the shipped playbooks) and reported its parent's runtime as its own.

This is the requirement's own failure mode at a site the change never examined;
`design.md` D7, `tasks.md` 4.4, and the implementation record all name only
`runner.ts`. Fixed at `supervisor.ts:322-330` via `bridgeChildEnv`.

### Major-3 (ACCEPTED AS SCOPED, spec qualified) — the audit invariant is broader than recognition can deliver

`cli-agent-audit` scenario 2 states, unqualified: "a session that could not be
analyzed by that auditor SHALL NOT appear as a zero-valued report of that
runtime." Two reachable paths still violate it. Both reproduced by hand on the
built CLI:

| Input | Result |
|---|---|
| `agent audit <omp file> --runtime claude --out r.json` | exit 0, report written, `session.runtime:"claude"`, `agentCount:0`, `requests:0` |
| `agent audit <unrecognized .jsonl> --out r.json` (no override) | exit 0, report written, `session.runtime:"claude"`, `agentCount:0`, `requests:0` |

Adjudication: **not fixed here, and the scenario text is the thing that is
wrong.** Both are pre-existing and outside what this change claims. The
proposal scopes the fix to a file that "belongs to a harness Rasen
**recognizes**"; design D4 states an explicit override wins outright (unchanged
from before this change); and the fallback arm is unreachable by recognition by
construction — a genuinely empty Claude session is a legitimate zero, so no
"zero requests → error" guard can separate the two without a format assertion
that is its own change.

Downgraded from Major to a **declared follow-up** because no requirement
regressed and the change delivers exactly what it scoped. Recorded in
`implementation-record.md` with the reproduction. The honest repair is either a
format-recognition guard in `runClaudeAudit`, or tightening the scenario to
"a session belonging to a *recognized* harness"; the second is what the rest of
the capability actually says.

### Minor-1 (RESOLVED) — a test comment stated the inverse of the fact

`test/core/claude/runner.test.ts:400-402` claimed `RASEN_AGENT_RUNTIME` is
"deliberately not scrubbed by the setup file". It **is** scrubbed
(`vitest.setup.ts:52`), and that scrub is precisely why the test is
non-vacuous. The comment drew the right conclusion from a false premise, and
the test spreads `...process.env` — so anyone who relaxed the scrub on the
strength of that comment would make both cases pass without the merge on a
developer machine while CI stayed honest. That is the exact failure mode this
project's own `vitest-setup-ambient-env-pinning` rule exists to prevent.
Rewritten at `:398-406`.

### Minor-2 (RESOLVED) — a fourth hand-maintained mirror drifted

`packages/ui/src/config/controls.ts:40-49` `KNOWN_MODEL_IDS` mirrors
`MODEL_PRESETS` and did not gain `opus-5`, so the model datalist suggested the
previous Opus generation and omitted the current one — on the very change whose
point is that `opus-5` is current. Its parity test
(`packages/ui/test/config/controls.test.ts:156-169`) is one-directional
(mirror → preset, never preset → mirror), so the drift was silent, and
`packages/ui` is outside the root vitest include. Added at `:43`; UI suite
24/24 green. D11 names two typecheck-free mirrors as follow-ups; this is a
third, now closed.

### Minor-3 (RESOLVED) — stale references left by the extraction

- `src/core/token-audit/audit.ts:2-4` still described runtime selection as
  "reusing `detectTranscriptKind` from `agent-context.ts`", a symbol task 3.1
  deleted. Rewritten to describe `detectSessionOwner` and the refusal.
- `src/core/agent-context.ts:24` imported `resolveCodexHome`, unused after
  `resolveTranscriptPath`'s codex arm moved to `session-stores.ts`. Removed.
  Not caught by lint: `eslint.config.js:15` sets
  `@typescript-eslint/no-unused-vars: 'off'`.

### Trivial-1 (RESOLVED) — env assertion was named-key, not key-set

`runner.test.ts` checked that named keys survived, so a second `childEnv`
member would have gone unnoticed against a scenario worded "every **other**
inherited environment value". Now asserts key-set parity at `:430-436`.

### Trivial-2 (ACCEPTED) — design text is stale where ADRs superseded it

`design.md` D1 still specifies a single `src/core/runtimes/registry.ts`; four
sibling modules shipped. Task 3.6 still says to keep `probeCodex`/`probeClaude`;
they were removed. Both are recorded with evidence in
`implementation-record.md` (ADR-1, ADR-4). Left as-is: the design is the plan of
record and the ADRs are the amendment trail. Not worth rewriting history.

## Completeness

- **Tasks**: 44/44 complete. Every file named in a task is touched by the
  branch diff except three, all correct: `test/core/runtime-adapters.test.ts`
  and `test/core/config-keys.test.ts` are required by tasks 1.5/4.6 to be
  **unchanged** (`git diff upstream/dev/0.1.7...HEAD` → 0 lines for both), and
  `src/core/runtimes/registry.ts` does not exist by ADR-1.
- **Requirements**: 8/8 have implementation evidence. Independent verifiers
  mapped every one to file:line.

## Correctness

30/30 scenarios covered. Highlights from the independent pass:

- **Build enforcement** (2 scenarios) — the compiler test at
  `registry-enforcement.test.ts:22-92` is a *characterization* of the mechanism
  on a hand-copied reproduction, not a compile of the real maps. It still meets
  the requirement on two legs: the real enforcement is `satisfies` under
  `pnpm build`/CI `tsc --noEmit` over `src/**/*`, and the drift gap is closed at
  runtime by `:96-113`, which compares `Object.keys` of each **real** map
  against the **real** derived sets. Verified fresh by the codex-flip probe above.
- **Bridge diagnostics** — `execution-validation.test.ts:272-315` iterates the
  shipped targets, records every probe call, and asserts `checked === [target]`
  plus that the other adapter's bridge and install hint are absent from the
  message. This kills the pre-change ternary that probed the Claude binary for
  any non-`codex-exec` bridge.
- **Route parity** — the 10-row `it.each` table is byte-unchanged, which is what
  makes it a valid oracle for the derivation. Independently corroborated by 35
  host × pipeline `pipeline show --for-execution --json` outputs matching the
  base commit exactly.
- **Refusal reach** — every caller of the probe/estimate/reader functions in
  `src/` was enumerated; only two exist (`commands/agent.ts:284`,
  `commands/pipeline.ts:960`) and both go through the capability gate. The
  reader functions are unreachable except through `CONTEXT_READERS`.
- **Write ordering** — the only write site in `audit.ts` is `writeReport`,
  called from exactly three places, all inside per-runtime auditors reachable
  only after the capability check. "Refuses before any report file is written"
  is true by construction, not by discipline.

Two behavior changes are declared and were **not** in the specs; both are now
recorded:

1. `agent context --transcript <threads.db>` now refuses naming `zed` where it
   previously ran the Claude reader and failed with "No assistant usage found".
   Strictly better and arguably mandated by the ADDED requirement, but task 2.2
   says recognition must change nothing, and design D4 declares exactly one
   exception (the Oh My Pi file). Zed is a second, undeclared exception.
2. The `--runtime` override bypasses recognition (Major-3).

## Coherence

Design adherence: 5 deviations, each recorded as an ADR with evidence in
`implementation-record.md` — 4 modules instead of one registry (measured
+6.8 ms / +9.8 MB from the WASM SQLite engine on the probe path), the accepted
provider↔registry cycle (7 such SCCs already exist in `src/`), no
`buildInvocation` on the adapter (no call site selects between the two
builders), `probeCodex`/`probeClaude` removed rather than kept (keeping them
reinstates the runtime-literal branch task 3.8 removes), and management-scope
dispatch declared locally rather than on `AUDIT_READERS` (avoids a second
cycle). All five are judged sound.

Pattern consistency: the four registry modules follow one shape (one
`satisfies`-checked map, arrow members to keep cycles inert). No naming or
layout deviations found.

## TEST EVIDENCE

```
TEST EVIDENCE
- scope: full repository suite, plus the packages/ui suite (separate vitest project, outside the root include)
- rationale: the change touches the leaf declaration imported by every schema consumer, four new registry modules, two spawn sites, three locale catalogs, four shipped playbooks and their SHA-256 baselines; a focused scope could not cover the serialized-surface preservation claim
- command: npx tsc --noEmit && pnpm lint && pnpm build && npx vitest run && (cd packages/ui && npx vitest run test/config/controls.test.ts)
- result: pass
- tree: 89c0b641a9117c55e87c75e53c9f4a3388a1cbe1
```

Root suite: **6065 passed, 27 skipped, 1 failed**. UI suite: 24 passed.

The single failure is `test/cli-e2e/basic.test.ts > localizes pipeline human
output`, proven environmental and unrelated: it asserts `stderr === ''` and
receives the skill/CLI version-drift warning. A dev-local global install carries
a `-dev.local.<n>` suffix that can never equal the repository's plain
`package.json` version, so the installed-skill stamp
(`0.1.7-dev.local.1`) and the repo build the test spawns (`0.1.7`) always
disagree. The same test passes on a clean base worktree, and CI never sees it
because `.claude/` is gitignored so a CI checkout has no installed skills. Full
analysis in `implementation-record.md`.

## Verdict

```
VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:3 Trivial:2
```

No Blocker and no Major open. Two Majors were found during this pass and fixed,
with the fixes verified (build-failure probe, 6065-test suite, UI suite); one
was re-adjudicated as a spec over-reach and recorded as a declared follow-up
with its reproduction. Ready for archive.
