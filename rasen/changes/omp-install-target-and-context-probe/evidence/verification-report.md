# Verification Report: omp-install-target-and-context-probe

Schema: spec-driven. Verified against 7 delta specs, `design.md` (D1–D14), and
`tasks.md` (55 tasks).

**Open follow-ups travel in a sibling file.** The verdict below is CLEAN, which
means no Blocker and no Major is open — it does NOT mean nothing is left. Six
deferred items are recorded in `evidence/deferred-followups-report.md`, including
the two slices this change deliberately excludes (Oh My Pi token auditing and
worker dispatch) and the four `runtime-adapter-interface-extraction` follow-ups
they own. `rasen archive` counts that file's entries into the archived
`.openspec.yaml` `quality.metrics` and hashes it into `archive.json`; **read it
before treating this change as closed.**

## Summary

| Dimension | Status |
|---|---|
| Completeness | 55/55 tasks; both slices delivered and independently smoke-tested |
| Correctness | Install and probe verified end-to-end against live `omp` v17.2.10 |
| Coherence | 4 design deviations, all recorded as ADRs below |
| Regression | Claude / Codex / unknown-host probe output byte-identical to the pre-change build |

Premise: all live evidence was taken against `omp/17.2.10` on darwin/arm64,
recorded as `OMP_CLI_VERSION_PREMISE` in `src/core/omp/omp-home.ts`. The design's
evidence table was captured against 17.2.9; every fact it asserts was re-verified
here, and the two that had CHANGED are called out in ADR-1.

## ADR-1 — The bucket-layout evidence got stronger, not weaker

`design.md` justified D6 (scan every bucket, confirm each header `cwd`) with a
live observation: two buckets existed for this repository —
`home-rasen-0a97387b…` (hashed, current layout, newest session 2026-08-05) and
`-SyncLocal-rasen` (legacy home-relative, newest 2026-08-06) — so a locator that
derived one bucket name would read the hashed one and report a day-old session.

Re-measured on 2026-08-07, the hashed bucket **no longer exists at all**:

```
$ for d in ~/.omp/agent/sessions/*/; do ... done
bucket=-SyncLocal-rasen                                   files=13  newest=2026-08-07T00-58-31-209Z_019fd9ba-…jsonl
bucket=home-AlertCheck-2e3f4e9d60da9969eecdfa0f8a704ae7…  files=2
bucket=home-kumo-524c7048c28c068960ca10eee8d987471350e0…  files=2
bucket=home-xard-devtools-302e0db373c26b588877ad7b5e886…  files=4
bucket=home-xard-management-console-0d6bc3315e2015d1ed5…  files=1

$ printf '%s' "/Users/boao.zeng/SyncLocal/rasen" | sha256sum | cut -c1-16
0a97387b3087316e
$ ls -d ~/.omp/agent/sessions/*0a97387b*
ls: No such file or directory
```

So the naive derivation does not merely return a stale session for this
repository — it returns **absence** for a session that is running. Both bucket
layouts still coexist on the machine (`-SyncLocal-rasen` legacy beside four
`home-<basename>-<sha256>` hashed ones), which is the condition D6 exists for.
D6 is therefore upheld with stronger evidence; only the design's specific
sentence about which bucket held which date is stale.

## ADR-2 — The locator orders candidates globally, not per bucket

`design.md` D6's pseudocode takes **each bucket's newest** `.jsonl`, then the
newest of those. `findLatestOmpSession` instead orders every candidate across
every bucket newest-mtime-first and stops at the first cwd match.

Reason: `omp://session.md:45` states that colliding legacy buckets are split by
the cwd recorded in each session header during migration — i.e. one legacy bucket
CAN hold two directories' sessions. Under the per-bucket rule, a mixed bucket
whose newest file belongs to another directory hides our older session in the same
bucket, and the locator reports absence. That violates the `omp-session-probe`
scenario "The newest session wins across bucket layouts" and the
`runtime-adapter-registry` scenario "the newest qualifying session SHALL be
selected regardless of which layout holds it".

Global ordering satisfies both, is the shape `findLatestRollout` already uses for
Codex, and costs the same in the common case (the newest file on the machine is
usually the caller's own, so one header is read). Pinned by
`test/core/agent-context.test.ts` → "finds our older session when a mixed bucket
holds a newer foreign one".

## ADR-3 — Subagent journals are excluded by DEPTH, and the design never mentioned them

Not in `design.md`'s evidence at all. Oh My Pi writes each subagent's journal to
`<bucket>/<lead session basename>/<AgentName>.jsonl`:

```
$ find ~/.omp/agent/sessions -mindepth 3 -name '*.jsonl' | head -3
…/-SyncLocal-rasen/2026-08-06T05-28-17-995Z_019fd58b-…/PlaybookSweep.jsonl
…/-SyncLocal-rasen/2026-08-06T05-28-17-995Z_019fd58b-…/ArchiveHooks.jsonl
…/-SyncLocal-rasen/2026-08-06T05-28-17-995Z_019fd58b-…/VerifyBridgeAndPresets.jsonl

$ head -c 200 …/PlaybookSweep.jsonl
{"type":"title","v":1,…}
{"type":"session","version":3,"id":"019fd5b7-…","cwd":"/Users/boao.zeng/SyncLocal/rasen"}
```

A subagent journal records the **same** `cwd` and the **same** header shape as its
LEAD, so it is indistinguishable by content — and its mtime can be newer than the
LEAD's. A recursive scan would therefore sometimes report a subagent's occupancy
as the LEAD's: exactly the wrong-answer class `detect-omp-host-runtime` removed,
reintroduced through a different door.

`findLatestOmpSession` considers only files DIRECTLY under a bucket. This is the
Oh My Pi analog of `findLatestMainTranscript` excluding `agent-*.jsonl`, achieved
by depth rather than by name because Oh My Pi's names carry no marker. Pinned by
"never returns a subagent journal, which records the LEAD cwd and header".

## ADR-4 — Flipping `canProbeContext` was NOT sufficient; the implicit path needed routing

The design assumed the capability flip plus a registered locator and reader would
make `rasen agent context --latest` work inside Oh My Pi. It does not.
`resolveTranscriptPath` locates through `SESSION_STORES[runtime ?? SNIFF_FALLBACK_RUNTIME]`,
and an inferred `--latest` passes no runtime — so after the flip an Oh My Pi host
stopped being refused and started silently reading the **Claude** store, which is
the original defect wearing a success shape. The first run of the reworked task-9.1
test caught it:

```
- Expected: StringContaining "No Oh My Pi session found under"
+ Received: "No main-session transcript (*.jsonl) found in …/omp-sessions-empty…"
```

Fix: `probeAgentContext` now separates *which store locates* from *which reader
reads*. `implicitLatestStoreRuntime` returns the detected host when it is
probe-capable, so the host's own store answers; the reader stays a recognition
decision keyed off the explicit `--runtime` only, so nothing about how a located
file is measured changes with the host it was found from.

`codex` is pinned to the legacy fallback by `LEGACY_LATEST_STORE_HOSTS` because
`cli-agent-context`'s "Hosts with a probe adapter are unaffected" scenario —
pre-existing in the main spec, carried into the delta unchanged — requires a
Claude or Codex host's implicit discovery to stay byte-identical. `claude` needs no
pin: its own store IS the fallback. The pin is defended by its own test and
recorded as FU-C for the change that should remove it.

## Task 12.1 — Install smoke test

```
$ rm -rf /tmp/omp-smoke && mkdir -p /tmp/omp-smoke && cd /tmp/omp-smoke && git init -q .
$ node dist/cli/index.js init --tools omp --force
Rasen Setup Complete
Created: Oh My Pi
33 skills in .omp/
Config: rasen/config.yaml (schema: spec-driven)

$ ls .omp/skills | wc -l
34
$ head -3 .omp/skills/rasen-apply-change/SKILL.md
---
name: rasen-apply-change
description: Implement tasks from a Rasen change. Use when the user wants to start implementing, …
$ ls -d .omp/commands
ls: cannot access '.omp/commands': No such file or directory
```

Non-empty `description` front matter is present, which is what Oh My Pi's
`native` provider requires (`requireDescription: true`). No command directory was
created — D4's deliberate absence holds in practice.

Discovery and invocability confirmed by starting Oh My Pi in that directory:

```
$ omp --version
omp/17.2.10
$ omp -p --no-session "List every skill name you can discover that starts with 'rasen-'. …"
rasen-apply-change
rasen-archive-change
… (32 names)
rasen-workflow-review

$ omp -p --no-session "Read skill://rasen-apply-change and report ONLY … the absolute path …"
/private/tmp/omp-smoke/.omp/skills/rasen-apply-change/SKILL.md
Implement tasks from a Rasen change. Use when the
```

The resolved path is the project-local root Rasen wrote, so the skill is
discovered at the highest precedence Oh My Pi offers and `skill://rasen-<workflow>`
resolves to it. (`omp` has no `skills list` subcommand; a headless prompt is the
available observation of its own discovery.)

## Task 12.2 — Probe smoke test from a live Oh My Pi session

Run from this repository, inside the live session that authored the change:

```
$ node dist/cli/index.js agent context --latest --json
{"available":true,"runtime":"omp","model":"claude-opus-5","contextTokens":433793,
 "limit":1000000,"pct":0.433793,"remainingTokens":566207,
 "transcript":"/Users/boao.zeng/.omp/agent/sessions/-SyncLocal-rasen/2026-08-07T00-58-31-209Z_019fd9ba-93a9-7000-bbce-24ba3465849b.jsonl",
 "threshold":0.5,"thresholdSource":"default","shouldHandoff":false}
```

Three things are verified, not asserted:

1. **`transcript` names the bucket actually in use.** `-SyncLocal-rasen` is the
   legacy layout — the only bucket holding this repository's sessions (ADR-1), and
   the one containing today's session. Not another layout's, and not a
   derived-name guess, which would have found nothing.

2. **`contextTokens` is the session's own arithmetic.** The figure matches a real
   row's `input + cacheRead + cacheWrite` exactly:

   ```
   $ jq -r 'select(.type=="message" and .message.usage!=null)
            | "\(.message.usage.input + .message.usage.cacheRead + .message.usage.cacheWrite)\ttotal=\(.message.usage.totalTokens)"' "$f" \
       | grep -n '^433793'
   328:433793	total=434068
   ```

3. **It is NOT `totalTokens`.** That row's `totalTokens` is 434068 — 275 higher,
   its output — and no row in the file carries `totalTokens == 433793`:

   ```
   $ jq -r '… .message.usage.totalTokens' "$f" | grep -c '^433793$'
   0
   ```

   So the reported occupancy cannot have come from the trap field. D7 verified
   against a live file, not a fixture.

`model: claude-opus-5` is the bare id from the measured message, and
`limit: 1000000` is its `MODEL_PRESETS` window (`opus-5`) — not the
`DEFAULT_CONTEXT_LIMIT` fallback.

## Task 12.3 — Claude and Codex regression check

A pre-change build was produced from the merge base in a separate worktree
(`git worktree add /tmp/rasen-baseline ad650853`, then `pnpm run build`) and the
two builds compared on identical inputs:

```
$ for HE in CLAUDECODE=1 CODEX_THREAD_ID=t1 RASEN_NOTHING=1; do … done
=== CLAUDECODE=1      IDENTICAL
=== CODEX_THREAD_ID=t1 IDENTICAL
=== RASEN_NOTHING=1    IDENTICAL
```

(`env -i` with an explicit host fingerprint, `agent context --latest --dir
<claude projects dir> --json`, output compared as whole strings.) The third case
is the `unknown` host, whose legacy Claude-store resolution is also unchanged.

Explicit-transcript readers likewise unchanged: the Codex rollout fixture reports
the same `runtime/model/contextTokens/limit/pct/remainingTokens` from both builds,
and a named Claude transcript is byte-identical between them.

## Task 12.4 — Keepalive fail-safe untouched

```
$ git diff --stat test/core/keepalive.test.ts        # (empty)
$ grep -rn "keepalive.runtimes.omp\|runtimes\.omp" src/   # (empty)
$ pnpm exec vitest run test/core/keepalive.test.ts
Tests  27 passed (27)
```

No dispatch capability became true, so Oh My Pi stays withheld from beats by the
existing fall-through fail-safe and gains no configuration key.

## Task 8.2 — The registry's build enforcement was exercised, not assumed

The claim "the compiler forces the missing reader" was tested by removing the
entry and observing the failure, then restoring it:

```
$ # with CONTEXT_READERS.omp deleted
src/core/agent-context.ts(195,62): error TS7053: … Property 'omp' does not exist on type '{ claude: …; codex: … }'
src/core/runtimes/context-readers.ts(29,3): error TS1360: … Property 'omp' is missing … but required in type
  '{ codex: ContextReader<"codex">; claude: ContextReader<"claude">; omp: ContextReader<"omp">; }'
$ # restored
CLEAN
```

Both errors the task predicted are real and both are satisfied by registration
rather than cast past.

## Deliberate absences (D3, D4)

Recorded because the absence is the decision:

- **No project-config reconciler for Oh My Pi.** `src/core/init.ts`'s only
  per-tool branches remain `codex` (wait-policy reconcile), `opencode`/`pi`
  (hyphen transform), and `claude` (agent teams). Every `skills.*` setting ships
  `true`, so an installed skill is discovered with no file written; a
  `.omp/config.yml` writer would create a project file with nothing to say.
- **No command-path builder.** `TOOL_COMMAND_PATH_BUILDERS`
  (`src/core/shared/retired-command-paths.ts`) has no `omp` key, so
  `getRetiredCommandFilePath('omp', …)` returns `null` and the cleanup pass is a
  correct no-op. Adding one would make Rasen delete files it never wrote —
  confirmed by the smoke test's absent `.omp/commands`.
- **No hyphen transform.** Oh My Pi addresses skills by their canonical `rasen-*`
  name, like `claude`/`codex`/`hermes`.

## Non-edits confirmed (tasks 9.6, 9.7)

Both pass **unmodified**; recorded so nobody "fixes" them later:

- `test/core/management-api/threshold-schemes-api.test.ts` — derives
  `bindingRows` from `PROBE_RUNTIMES`, so it absorbed the widening on its own, and
  its `not.toContain('zed')` still holds.
- `test/core/config-keys.test.ts` — `toEqual(['claude','codex'])` on the dispatch
  set. A diff there would mean a dispatch capability was flipped, contradicting
  this change's scope.

## Gates run

| Gate | Result |
|---|---|
| `pnpm run lint` (eslint over `src/ test/ vitest.config.ts vitest.setup.ts`) | pass |
| `pnpm exec tsc --noEmit` (root realm) | pass |
| `pnpm --dir packages/ui typecheck` | pass |
| `pnpm --dir packages/ui test` | 49 files, 502 tests pass |
| `pnpm exec vitest run` (root suite, after `pnpm run build`) | 349 files, 6142 pass, 27 skipped |
| `git diff --check <base>...HEAD` (CI whitespace gate) | clean |

Ordering observed for the parity hashes as `rasen/specs/workflow-template-parity`
requires: template edits → `pnpm run build` → `node dist/cli/index.js update` →
recompute both maps. Exactly three templates moved in each map
(`getAutoCommandSkillTemplate`, `getGoalCommandSkillTemplate`,
`getReviewCycleSkillTemplate` / `rasen-auto`, `rasen-goal`,
`rasen-review-cycle`) — all three embed the edited orchestration playbook; every
other hash is byte-identical.

## Incidental finding: a line-ending trap in the test suite

`test/core/init.test.ts` was committed with mixed endings (984 CRLF lines, 106 LF,
plus two `\r\r\n` doubled terminators). Editing it under this repository's
`core.autocrlf=input` restages the whole file, so ~100 added lines arrived as a
2067-line diff. Verified as pre-existing rather than caused here: staging the
pristine base bytes reproduces the base blob exactly (no filter rewrite), while
staging any edited version strips every CR.

Split into its own mechanical commit (`style(test): normalize init.test.ts line
endings to LF`) so the behavioral diff for that file is 99 additions and 0
deletions. Content is byte-identical once terminators are ignored — only `\r`
characters were removed, and every one was part of a line ending.

## Open follow-ups

Six deferred items are recorded in **`evidence/deferred-followups-report.md`**:
the audit slice (FU-A, owning `runtime-adapter-interface-extraction`'s FU-2/FU-3/FU-4),
the dispatch slice (FU-B, owning FU-1), the pinned Codex implicit-store wart
(FU-C), Oh My Pi's contradictory `SYSTEM.md` documentation (FU-D), the
incompatible unused-symbol policies between the two typecheck realms (FU-E), and
the untested published `--tools` lists (FU-F). Read that file before treating
this change as closed.

VERIFY VERDICT: CLEAN
