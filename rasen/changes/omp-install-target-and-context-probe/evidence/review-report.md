# Pre-Landing Review: omp-install-target-and-context-probe

Base branch **`dev/0.1.7`** (merge-base `ad650853`), 7 commits, 51 files, +4719/−1141.
Not `origin/main`: that remote is 590 commits stale (last updated 2026-07-15) and
produces a meaningless 338k-line diff. `ad650853` is the base the change's own
verification report used.

Reviewed by six parallel slices (Standards, Spec, Enum-completeness, Adversarial,
Test-coverage, Docs/Scope) plus direct live verification against the **`omp/17.2.10`**
binary on PATH — the same version `OMP_CLI_VERSION_PREMISE` pins, so the harness
claims in the doc comments could be tested rather than trusted.

The 13 known follow-ups (FU-A…FU-M) and the 6 already-fixed items (B1, M1–M5) were
excluded from re-reporting, except where a recorded fix was found INCOMPLETE.

## Verdict

`REVIEW VERDICT: 1 Blocker + 7 Major + 7 Minor fixed and pinned; 3 Major open, 6 Minor rejected with evidence`

Scope Check: **CLEAN**. Intent: make `omp` an adapted install target and a
context-probe-capable runtime. Delivered: exactly that — all nine `What Changes`
bullets map to file changes, and no changed file falls outside the proposal's Impact.
Commit `e5745581` ("LF normalization") was verified genuinely content-free:
`sha256` of both sides after `tr -d '\r'` is `53b71f4a7bf4…`, and the 986-byte
delta equals exactly the 986 CRs removed.

## Blocker — found, reproduced, fixed

### RV-B1 — A trailing all-zero usage row reported a 353,360-token session as EMPTY

`computeContextFromOmpSession` took the LAST `message.usage` row unconditionally.
Oh My Pi writes an **all-zero** usage row for a turn that sent nothing (aborted or
interrupted) and writes a RUN of them at the tail of a session that ended that way.

Measured on a real journal, not a fixture:

```
/Users/boao.zeng/.omp/agent/sessions/-SyncLocal-rasen/2026-08-05T02-34-04-257Z_019fcfc5-….jsonl
  479 rows, 164 usage rows, last TWELVE usage rows all
  {"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,…}
  true occupancy (last nonzero row) = 353360
```

End to end on the real `--latest` path, before the fix:

```
$ rasen agent context --latest --runtime omp --dir … --json
{"contextTokens":0,"limit":1000000,"pct":0,"remainingTokens":1000000,"shouldHandoff":false}
runtime=omp … context=0/1000000 (0.0%) remaining=1000000 … handoff not yet needed
```

A 35%-full session reported as empty **with its whole window free**. The playbook's
H.2 warm-continue guard reads "Below its resolved threshold → continue warm", so the
LEAD keeps feeding a session whose real headroom it cannot see. Silent: every number
looks plausible.

**Why it is NEW, not inherited.** The rule is copied from the Claude reader, and it is
safe there — Claude records no all-zero usage row at all. Measured: **0** zero-sum rows
across 53 Claude usage rows and **0 of 6** transcripts ending on one, versus **21** zero
rows on the omp side with **1 of 23** sessions ending on one. The change adopted a
sibling's shape without checking that omp's data has a different one.

**It is also an inconsistency inside the change's own reader registry.** The Codex
sibling already defends against exactly this: `computeContextFromRollout` ignores a
trailing `token_count` whose `last_token_usage` is degenerate and keeps the previous
valid snapshot, pinned by "uses the last valid token_count snapshot"
(`test/core/agent-context.test.ts`). Oh My Pi was the odd one out.

**Fix.** Two cursors: `lastMeasured` (last row whose `input+cacheRead+cacheWrite > 0`)
and `lastAny`, using `lastMeasured ?? lastAny`. Skip-and-keep-previous, mirroring the
Codex precedent rather than inventing a shape. A session whose rows are ALL zero keeps
reporting its existing honest `0` rather than becoming an error. The model is taken
from the measuring row for the same reason the sum is. The Claude reader is
deliberately untouched — `cli-agent-context` requires it byte-identical.

After:

```
{"contextTokens":353360,"limit":1000000,"pct":0.35336,"remainingTokens":646640,…}
runtime=omp … context=353360/1000000 (35.3%) remaining=646640 … handoff not yet needed
```

Matches the independently computed occupancy exactly.

### RV-B1a — the fix's own interaction guard (`reset_boundary`)

Caught by the adversarial slice before landing: walking back to the last nonzero row
makes `/clear` **strictly worse**. `/clear` appends a payload-free `reset_boundary`,
and Oh My Pi rebuilds model context AFTER the latest one — everything before it is
hidden from the model (`omp://session.md`, `buildSessionContext` step 4). A `/clear`
followed by an aborted turn would walk PAST the boundary and report the pre-clear
occupancy of a context that is now empty: an under-report turned into a much larger
over-report.

Fixed in the same scan: a `reset_boundary` row resets both cursors, so occupancy is
measured within the current context epoch only.

## Major — found, reproduced, fixed

| # | Where | What was wrong |
|---|---|---|
| RV-M1 | `src/core/pipeline-registry/execution-validation.ts` | The M4 repair reached the three locale catalogs but NOT the unlocalized English fallback the reporter-less caller prints (`validate.ts` passes no reporter). It still claimed the override "also lifts the context-probe refusal" — false: `omp` declares `canProbeContext`, so there is no refusal. A test at `execution-validation.test.ts` **actively pinned the false claim**, the exact failure mode M4 itself called out. |
| RV-M2 | `src/locales/{en,ja,zh-cn}.json` | The M4 replacement traded one false clause for another: "redirects … to **that runtime's** session store" is false for half the values the same sentence offers — `LEGACY_LATEST_STORE_HOSTS` pins a `codex` host to the Claude store. |
| RV-M3 | `src/core/templates/workflows/handoff.ts` | The B1 fix reached `_orchestration.ts` but not the standalone `rasen-handoff` skill, which does **not** embed the playbook. Step 1 enumerated only two probe outcomes, so the withheld-verdict state fell into the "measured" arm and the LEAD would present `limit:0 / pct:0 / remaining:0` placeholders as measurements; step 4 then persisted `pct: 0` into `sessionHandoff` run-state. |
| RV-M4 | `src/core/omp/project-context.ts` | The `.git` boundary was tested only on ANCESTORS (the walk starts at `dirname(start)`), so `rasen init --tools omp` **at a repository root** walked straight out of the repo and named an enclosing `.omp/AGENTS.md` that Oh My Pi would never have loaded — the opposite of the function's own doc comment. |
| RV-M5 | `test/core/omp/project-context.test.ts` | The suite wrote `$TMPDIR/.omp/AGENTS.md` **outside its sandbox** (`home` was the mkdtemp, so `dirname(home)` is the shared system temp dir) and `afterEach` never removed it. Confirmed present on this machine, 10 bytes, mtime from a suite run. Permanently pollutes `$TMPDIR` and makes later capture walks over temp-dir install roots order-dependent. |
| RV-M6 | `docs/cli.md`, `docs/zh/cli.md` | The flagship copy-pasteable example was `rasen init --tools claude,cursor` — a command that is **refused**, 18 lines below text this change added to make `--tools` accurate. |

Evidence for RV-M1/RV-M2, reproduced end to end on an Oh My Pi host:

```
$ OMPCODE=1                            rasen agent context --latest --json
  {"runtime":"omp",   "contextTokens":272582, transcript: …/.omp/…}     <- own session
$ OMPCODE=1 RASEN_AGENT_RUNTIME=claude rasen agent context --latest --json
  {"runtime":"claude","contextTokens":75948,  transcript: …/.claude/…}  <- another conversation
$ OMPCODE=1 RASEN_AGENT_RUNTIME=codex  rasen agent context --latest --json
  {"runtime":"claude","contextTokens":75948}                            <- the CLAUDE store, not Codex
```

The third line is the proof for RV-M2. Corrected copy is destination-agnostic
("away from this host's own session"), which is true for both accepted values and
stays true if FU-C later routes Codex to its own store.

Evidence for RV-M4:

```
detectOmpNestedInstallCapture('/tmp/rv-boundary/work/repo', '/tmp/rv-boundary')
  before -> {capturedRoot:'/tmp/rv-boundary/work', capturedFiles:['…/work/.omp/AGENTS.md']}
  after  -> undefined
```

Not a live false alarm on this machine (omp's user-level context lives under
`~/.omp/agent/`, so `~/.omp/AGENTS.md` does not normally exist) — it needs a populated
ancestor `.omp/` above a repo root.

## Minor — fixed

- `ProbeOptions.dir` / `cwd` / `homeDir` / `runtime` doc comments still described a
  single Claude projects directory and the pre-flip `'claude' | 'codex'` pair, while the
  CLI help they back was widened to name all three stores and `omp` in all three locales.

## Tests added (9, all mutation-checked)

| Test | Defends |
|---|---|
| trailing zero-usage row does not mask occupancy | RV-B1 — **fails without the fix** |
| a RUN of 12 trailing zero rows (the real journal shape) | RV-B1 — **fails without the fix** |
| model taken from the measuring row, not a later zero row | RV-B1 — **fails without the fix** |
| all-zero session still reports 0 rather than erroring | pins the PRESERVED fallback (passes both ways by design) |
| measures only the current epoch after a reset boundary | RV-B1a |
| does not walk past a reset boundary to find a nonzero row | RV-B1a — the load-bearing interaction |
| `handoff recommended` arm is rendered | closes the coverage gap where the widened three-way ternary left its firing arm untested |
| install root IS the repository root | RV-M4 — **fails without the fix** |
| install root is a worktree whose `.git` is a FILE | RV-M4 — **fails without the fix** |

Parity hashes refreshed in the order `rasen/specs/workflow-template-parity` mandates
(edit → build → run the BUILT CLI's `update` → recompute). Exactly one template moved
in each map (`getHandoffSkillTemplate` / `rasen-handoff`), which is the correct blast
radius. `.claude/` is gitignored, so the regenerated dogfooding skills are untracked.

## Gates

| Gate | Result |
|---|---|
| `pnpm run lint` | pass |
| `pnpm exec tsc --noEmit` (root) | pass |
| `pnpm --dir packages/ui typecheck` | pass |
| `pnpm run build` | pass |
| `pnpm exec vitest run` (root) | **349 files, 6159 pass, 27 skipped** (+9 = exactly the new tests) |
| `pnpm --dir packages/ui test` | 49 files, 502 pass |
| `git diff --check` (base + worktree) | clean |

## Round 2 — the Minors, fixed in `c906a6ae`

Everything the first round left open as a Minor was re-examined. Most were
fixed; six were rejected with evidence rather than forced, because applying them
would have traded a measured problem for an unmeasured one.

**Fixed.** The locator's 8 KiB header bound now retries once at the 64 KiB
recognition bound when the first read was truncated, so a header pushed past it
by the documented growth fields no longer makes a live session invisible.
Candidate ordering breaks mtime ties on basename, which is chronological because
Oh My Pi names each file with an ISO-8601 prefix. The detector discriminates
ENOENT/ENOTDIR ("absent") from every other errno ("present but unreadable"), so
an unlistable `.omp/` stops the walk instead of letting it blame a farther
ancestor. The home boundary moved ahead of the capture test — `~/.omp` is the
config root and is populated for every Oh My Pi user, so it was the most
frequently reached false positive — while the `.git` boundary deliberately stays
after it, preserving the monorepo case. `SESSION_STORES.omp` threads
`options.homeDir`. `rasen update` runs the same detector before its writes and
renders the same disclosure as `init`; the copy dropped its self-applied
"Warning:" (the renderer already emits `⚠`) and stopped naming `rasen init`, now
that two commands render it. Docs, CHANGELOG, the `adapted-agent-visibility`
definition and task 4.3's missing e2e assertion are all closed.

**Rejected, with the evidence.**

- *Canonicalize path identity in `findLatestOmpSession`.* Attempted both
  realistic macOS aliases — a symlinked cwd and a case variant on
  case-insensitive APFS — and neither reproduces: `process.cwd()` already
  returns the physical canonical path, so both sides of the comparison agree.
  Adding `realpathSync` per candidate would buy an unreproducible case at the
  cost of I/O on the hot path, and the pre-existing `findLatestRollout` has the
  identical shape. Left as a documented conformance note.
- *Match the header's `additionalDirectories` as well as `cwd`.* No real session
  on this machine carries the field, and it is unconfirmed whether Oh My Pi
  itself resumes a session from a secondary root. Matching it would be
  speculative generality — behaviour added for a need no spec has.
- *Cache the `statSync` sweep.* The 343 ms figure comes from a synthetic 5000-
  candidate store; the real store here holds 23 files. A cache keyed on bucket
  mtime buys nothing measurable and adds a staleness surface to the one function
  whose entire job is finding the NEWEST session.
- *Reverse-chunk the reader instead of `readFileSync` + `split`.* Real: a 42 MiB
  journal costs ~98 MiB RSS. But the probe is a short-lived process, the read is
  62 ms, and reverse-chunking a JSONL file correctly across partial lines and
  multi-byte boundaries is a rewrite of the one function this review already
  found a Blocker in. Deferred deliberately, not overlooked.
- *Derive `OMP_PROJECT_DIR` from the `AI_TOOLS` registry entry.* Coupling the
  detector to the install registry to deduplicate a four-character literal is
  worse than the duplication.
- *Collapse `shouldHandoff` + `window` into one discriminant.* That is a wire
  contract change, not a cleanup — `window` is what the shipped playbook teaches
  consumers to branch on.

Still open and unchanged: the three Majors below, and `isUnmeasurableWindow` at
`contextTokens === 0`.

## Open — NOT fixed, needs a decision

### Major

1. **`ContextEstimate` carries no unmeasurable marker** (`src/core/agent-context.ts`).
   It is the second wire shape for occupancy, published as `workers.<id>.contextEstimate`
   by `pipeline resume --json` and compared by the playbook's warm-reuse rule
   (`pct ≤ threshold`). The playbook tells the LEAD the tell is `"window":"unknown"` plus
   an omitted `shouldHandoff` — neither of which this surface ever emits. Fixing it is a
   wire-shape change with a `packages/ui` mirror implication, so it is a deliberate
   decision, not a mechanical fix.
2. **`rasen/specs/cli-agent-context/spec.md` still SHALLs a `shouldHandoff` flag.**
   The B1 repair made it optional and no delta spec modifies the main-spec requirement,
   so on archive the shipped spec asserts a field the code omits — the same
   "prose broader than code" class M1 and M3 were graded Major for. Needs a MODIFIED
   requirement covering both the withheld verdict and the undocumented `window` field.
3. **`compaction` and branch/`leafId` semantics are still ignored by the reader.**
   `reset_boundary` is now handled; the other two documented epoch markers are not. A
   post-compaction probe reports the row's own `tokensBefore`, and an abandoned branch
   reports the dead branch's occupancy rather than the active leaf's. Documented in
   `omp://session.md` but **unexercised on this machine** (0 occurrences across 23 real
   journals), so this is documented-but-unobserved. A correct fix means following
   `parentId` from the leaf rather than file order — genuinely a separate change.

### Minor — all closed in round 2

The thirteen Minors this section originally listed were resolved in `c906a6ae`:
seven fixed, six rejected with the evidence. See "Round 2" above for the
disposition of each. Nothing from that set remains open.

### Also open

- `isUnmeasurableWindow` returns `false` at `contextTokens === 0`, so an unlisted model
  with an all-zero session plus an absolute `{remainingTokens: N}` threshold still
  answers `shouldHandoff: true` — "handoff recommended" for an empty session.
  Reproduced. Narrowed a great deal by the RV-B1 fix (it now needs a session where
  nothing ever measured), and tightening it would change the Codex young-rollout
  reading that `cli-agent-context` pins byte-identical. Left deliberately.
- `findLatestOmpSession` compares path identity without canonicalizing, against a
  documented repo standard (`CLAUDE.md`, `test/AGENTS.md`). Both realistic macOS
  aliases — a symlinked cwd and a case variant — were attempted and **neither
  reproduces**, because `process.cwd()` already returns the physical canonical
  path. Left as a standards-conformance gap rather than a live defect; the
  pre-existing `findLatestRollout` has the identical shape.

Task 4.3's missing e2e assertion and the `adapted-agent-visibility` definition
sentence, previously listed here, were both closed in `c906a6ae`.

## Verified clean (stated so it is not re-investigated)

- **`resolveOmpAgentDir` is correct.** All six documented resolution claims reproduce
  exactly against the live `omp/17.2.10` binary (`omp config path`), including
  `OMP_PROFILE` winning when defined-but-empty, a named profile ignoring
  `PI_CODING_AGENT_DIR`, and `PI_CONFIG_DIR` being joined under home even when it looks
  absolute. The undocumented cases match too: a relative `PI_CODING_AGENT_DIR` is
  cwd-relative in both Oh My Pi and `path.resolve` (`/private/tmp/relmarker` from
  `/tmp`), and `~` is left literal by both.
- **The `totalTokens` trap is real** and the decision to avoid it is right: on a frozen
  snapshot `input+cacheRead+cacheWrite = 163611` while `totalTokens = 164571 = 163611 +
  output(960)`.
- **The reader's arithmetic is right.** On a frozen snapshot the CLI and an independent
  `jq` recompute agree exactly (`163611`).
- Locale key and placeholder parity across en/ja/zh-cn is green and test-enforced.
- The `packages/ui` wire mirror was widened BEFORE the server, in commit order, per the
  repo's mirror-relaxation rule, and is now guarded in both directions.
