# Verification Report: omp-install-target-and-context-probe

Schema: spec-driven. Verified against 7 delta specs (20 requirements, **61
scenarios, each individually adjudicated**), `design.md` (D1–D14), and
`tasks.md` (55 tasks).

**Author ≠ verifier.** The implementer wrote this change, so an earlier
self-written report asserting CLEAN was replaced by this one. All 61 scenarios
were re-adjudicated by six independent adversarial readers instructed to treat
that report as a claim, not proof, and to find what it got wrong. They found a
**Blocker the author's own verification had missed**, plus five Majors. Every
Blocker and Major below was reproduced by hand on the shipped build before being
accepted, and every one is now fixed.

**Open follow-ups travel in a sibling file.** The verdict is CLEAN, which means
no Blocker and no Major is open — it does NOT mean nothing is left. Thirteen
deferred items are recorded in `evidence/deferred-followups-report.md` (FU-A…FU-M),
seven of them surfaced by this verification. `rasen archive` counts that file's
entries into `quality.metrics` and hashes it into `archive.json`; **read it before
treating this change as closed.**

## Summary

| Dimension | Status |
|---|---|
| Completeness | 55/55 tasks; 20/20 requirements implemented |
| Correctness | 61/61 scenarios adjudicated; 1 Blocker + 5 Majors found and fixed |
| Coherence | D1–D14: 13 followed, 1 deviated with an ADR now added; 4 original ADRs all survived adversarial re-measurement |
| Regression | Claude / Codex / unknown-host probe output byte-identical to the pre-change build |

Premise: `omp/17.2.10` on darwin/arm64, recorded as `OMP_CLI_VERSION_PREMISE`.

## Verification method

Six concurrent slices, each with a disjoint scope and a mandate to attack rather
than confirm:

| Slice | Scope | Result |
|---|---|---|
| InstallSpecs | `adapted-agent-visibility`, `ai-tool-paths`, `cli-init`, `omp-integration` (32 scenarios) | 0 Blocker, 0 Major, 4 Minor |
| ProbeSpecs | `omp-session-probe`, `runtime-adapter-registry` (19 scenarios) | 0 Blocker, 1 Major, 4 Minor, 1 Trivial |
| ContextSpec | `cli-agent-context` (10 scenarios) | **1 Blocker**, 2 Major, 1 Minor, 2 Trivial |
| DesignAdherence | D1–D14, the four ADRs, the Evidence table | 0 Blocker, 0 Major, 2 Minor, 3 Trivial |
| CodeQuality | branch diff as code, test quality | **1 Blocker** (same), 2 Major, 6 Minor/Trivial |
| SecurityAudit | new filesystem + environment handling | 0 Blocker, 0 Major, 3 Minor |

Three slices converged independently on the same Blocker, from three different
directions (spec scenario, code review, and the author's own parallel check).

## Blocker (found, reproduced, fixed)

### B1 — An unknown context window produced a confident, wrong handoff verdict

**What was wrong.** `computeContextFromOmpSession` reports `limit: 0` when the
model has no `MODEL_PRESETS` entry (design D8, deliberately preferring that to a
fabricated 200 000). At `limit === 0` the reader also reports `pct: 0` and
`remainingTokens: 0` — and those two are PLACEHOLDERS, not measurements. They
flowed unchanged into `resolveHandoffThresholdReport`, where both threshold forms
then answer wrongly, in OPPOSITE directions:

```
$ # unlisted model, 510 tokens occupied, project sets handoff.threshold {remainingTokens: 60000}
$ rasen agent context --latest --json
{...,"contextTokens":510,"limit":0,"pct":0,"remainingTokens":0,
 "threshold":{"remainingTokens":60000},"shouldHandoff":true}      <-- fires at 510 tokens
$ rasen agent context --latest        # default fraction threshold 0.5
runtime=omp ... context=124101/0 (0.0%) remaining=0 ... handoff not yet needed   <-- never fires at 124k
```

- Fraction form: `pct >= threshold` can never fire, because `pct` is always `0`.
- Absolute form: `remainingTokens <= N` ALWAYS fires, because `0 <= N` for every
  headroom floor — from the session's first completed turn onward.

**Why it is a regression, not a pre-existing gap.** At base `ad650853`,
`canProbeContext` was `false` for `omp`, so probing an Oh My Pi session exited
NON-ZERO and the orchestration playbook's H.1b arm governed: *"treat that
worker's occupancy as UNMEASURED — do not warm-continue on the strength of an
unmeasured probe."* After the flip the same probe returns `available: true,
pct: 0`, so H.2 governs instead: *"Below its resolved threshold → continue
warm."* A decision that was explicitly guarded became a decision taken on a zero
that describes nothing.

**Why the author's verification missed it.** The live smoke test ran on
`claude-opus-5`, which HAS a preset. `MODEL_PRESETS` has ten match strings and
covers no Gemini, GLM, DeepSeek, Kimi, Grok, Qwen, Llama or Mistral id — nor
`claude-sonnet-4-5`, `gpt-4.1` or `o3`. Oh My Pi routes to dozens of providers,
so the unmeasurable case is the COMMON one, not an edge case. No test paired
`limit: 0` with a threshold; the existing absolute-threshold test uses
`remainingTokens = 50_000`.

**Aggravating factor.** The shipped playbook told the LEAD to disregard the one
tell. `_orchestration.ts:329` read: *"A probe reporting `limit: 0` (no window
known — e.g. a Codex rollout with zero completed turns) fires NEITHER form: a
young rollout is by definition not near its limit, so treat the threshold as
not-yet-fired and re-probe later."* That rationale is sound for the only
pre-existing producer of `limit: 0`, where `contextTokens` is also 0. This change
created a second producer with the opposite meaning and left the line untouched.
Design D8 claimed the consequence was *"honest unavailability, and it is
visible"* — it was visible in neither the fraction channel, the verdict clause,
nor the playbook.

**Fix.** The unknown window is now carried into the verdict layer instead of
being left to a comparison against placeholders:

- `isUnmeasurableWindow(limit, contextTokens)` = `limit === 0 && contextTokens > 0`
  (`src/core/agent-context.ts`). The `contextTokens > 0` discriminator is what
  keeps a Codex rollout with zero completed turns byte-identical, as
  `cli-agent-context` requires — there the zeros are truthful.
- `HandoffThresholdReport.shouldHandoff` became OPTIONAL and is ABSENT when
  unmeasurable; `window: 'unknown'` is reported instead. Optional rather than
  `false` on purpose: `false` is indistinguishable from a real below-threshold
  reading.
- `agent context --json` omits `shouldHandoff` and emits `window: "unknown"`, so
  a consumer branches on PRESENCE.
- Text mode prints `context=510/unknown ... handoff undetermined (context window
  unknown for model X; ... cannot be evaluated)` instead of the contradictory
  `context=510/0 (0.0%) ... handoff recommended`.
- `_orchestration.ts:329` now names both causes, tells the LEAD to branch on
  `shouldHandoff`'s presence rather than its falsiness, and routes an absent
  verdict to the H.1b unmeasured outcome.
- Design D8's consequence paragraph is corrected in place, marked as corrected
  during verification.

Verified after the fix:

```
$ # the reproduction above, re-run
{...,"contextTokens":510,"limit":0,"pct":0,"remainingTokens":0,
 "threshold":{"remainingTokens":60000},"window":"unknown"}        <-- no shouldHandoff
runtime=omp ... context=510/unknown ... handoff undetermined (...)
```

Pinned by 5 new tests: `isUnmeasurableWindow`'s four cases (including the Codex
`0/0` false), the withheld verdict for both threshold forms, the e2e JSON shape
(`window: 'unknown'` present, `shouldHandoff` absent), the e2e text shape, and a
Codex young-rollout control asserting `shouldHandoff` is still a boolean.

## Majors (found, reproduced, fixed)

### M1 — The delta spec mandated own-store routing for every probe-capable host

`specs/cli-agent-context/spec.md:7` stated that when a harness has a probe
adapter *"the implicit path SHALL locate that harness's own newest session"* —
while the same requirement's own scenario requires a Codex host's discovery to
stay byte-identical, and `LEGACY_LATEST_STORE_HOSTS = ['codex']` deliberately
pins it to the fallback store. Measured: with a Codex rollout present for the
probe cwd, a `CODEX_THREAD_ID` host still answers from the Claude projects
directory. So the scenario passed while the requirement prose was false, in the
same requirement — and on merge the shipped spec would carry a SHALL no code
satisfies. ADR-4 and FU-C both explain the pin; neither noticed the sentence was
broader than the behavior.

Fixed: the sentence now names the pin as a stated exception.

### M2 — Design D8's stated consequence was factually inverted

D8 claimed *"fraction-based handoff thresholds do not fire for it while absolute
`remainingTokens` thresholds also cannot (remaining is `0` at an unknown
limit)"*. Remaining being `0` makes every absolute threshold fire, not none.
Found independently by the author's own pass and by two slices, reproduced end to
end. Fixed alongside B1.

### M3 — An ADDED registry requirement the shipped Claude locator violates

`specs/runtime-adapter-registry/spec.md` added *"A runtime's declared session
locator SHALL … confirm each candidate against the working directory the session
itself recorded"* — stated over ANY locator. `findLatestMainTranscript` does not:
it trusts the slug `claudeProjectsDir` derives and reads no `cwd`. Verified the
hazard is real, not theoretical:

```
$ node -e "const s=c=>c.replace(/[:\\\\/.]/g,'-'); console.log(s('/a/b.c'), s('/a/b/c'))"
-a-b-c -a-b-c
$ head -c 4000 <a real claude transcript> | grep -o '"cwd":"[^"]*"' | head -1
"cwd":"/Users/boao.zeng/SyncLocal/rasen"
```

The slug collides, and Claude transcripts DO record `cwd`, so the confirmation is
implementable. Its `fs.statSync` is also unguarded, throwing raw `ENOENT` on a
raced deletion rather than routing through the environmental-absence path.

Fixed by scoping the requirement to multi-layout runtimes and naming the Claude
locator's derivation as permitted, with the repair recorded as **FU-H**. Not
fixed in code: `cli-agent-context` requires Claude discovery to stay
byte-identical and the proposal declares Claude probing unchanged.

### M4 — A copy edit removed a warning that was only half false

`hostRuntimeWithoutDispatchAdapterWarning` lost its whole second clause. Only
part of it had become false. Reproduced against the shipped CLI with both stores
populated for the same cwd:

```
OMPCODE=1                              -> runtime=omp,    contextTokens=401002  (this session)
OMPCODE=1 RASEN_AGENT_RUNTIME=claude   -> runtime=claude, contextTokens=7       (an unrelated conversation)
```

So *"lifts the context-probe refusal"* became false, but *"`agent context
--latest` reads the Claude transcript store instead of this host's own session"*
is still true — and now MORE consequential, because the override is the one thing
that undoes the capability this change adds. Worse, the new test assertion
`not.toMatch(/context|…/i)` actively pinned the removal.

Fixed: the redirection caveat is restored in all three catalogs (placeholders
intact, catalog parity green) and the negative assertion now targets
`/refusal|拒否|拒绝/` — the claim that actually became false.

### M5 — The CLI's own `--help` still refused to admit `omp`

Task 10.x corrected `docs/**` and the orchestration templates but not the option
help strings. Shipped output before the fix:

```
--runtime <runtime>  ファイル判定を使わず "claude" または "codex" を指定します
--dir <dir>          --latestが使用するClaude projectsディレクトリを上書きします
```

`omp` is an accepted `--runtime` value (the error message names it correctly) and
`--dir` now feeds three different stores. The primary discovery surface contradicted
the behavior. Fixed in all three locales.

## The four original ADRs: all survived adversarial re-measurement

Every fact was re-run by a slice that did not write it.

- **ADR-1 (bucket evidence)** — UPHELD and strengthened. The hashed bucket for
  this repository still does not exist (`sha256` reproduces `0a97387b3087…`;
  `ls` finds no such bucket), so a derived-name locator returns ABSENCE for a
  running session. A **third** layout has since appeared —
  `--private-tmp-omp-smoke--`, the documented `abs` form, created by this change's
  own smoke test — so three naming layouts now coexist.
- **ADR-2 (global candidate ordering)** — UPHELD; the `omp://session.md` citation
  ("colliding legacy buckets are split by the cwd recorded in each session
  header") verified verbatim at source. A mutation implementing design D6's own
  per-bucket pseudocode failed 2 tests.
- **ADR-3 (subagent journals excluded by depth)** — UPHELD, both halves, with a
  live example that was the verifying agent itself: `DesignAdherence.jsonl`
  (mtime 1786070036) is strictly newer than its LEAD (1786070034), records the
  same `cwd`, and the probe still returned the LEAD. A mutation that recursed
  failed 1 test.
- **ADR-4 (implicit-path routing)** — UPHELD, not overstated. Re-derived from the
  pre-fix source, and the "claude needs no pin" theory was verified rather than
  accepted: 28 instrumented cells show `SESSION_STORES.claude.locateLatest`
  receiving a byte-identical argument object on both the pinned and host-aware
  paths, plus byte-exact CLI stdout across six host environments with all three
  stores populated. The reader-stays-recognition claim was verified in both
  directions by planting foreign files in each store.

## Corrections to the author's own report

Three claims in the replaced report did not survive:

1. *"every fact it asserts was re-verified here"* — two further Evidence rows are
   also stale: this repository no longer holds an empty `.omp/` at all, and *"all
   12 `skills.*` settings default to `true`"* is wrong as written (3 of the 12 are
   arrays defaulting `[]`). Neither affects the implementation.
2. The non-deletion claim cited *"the smoke test's absent `.omp/commands`"* as
   proof. An absent directory cannot demonstrate a non-deletion property. Fixed by
   adding a test that pre-seeds both retired adapter shapes and asserts they
   survive `init`.
3. `VERIFY VERDICT: CLEAN` was asserted over 61 scenarios with no scenario→test
   mapping. This report carries the adjudication.

## Regression check

A pre-change build from the merge base (`git worktree add /tmp/rasen-baseline
ad650853`) compared on identical inputs, `env -i` with an explicit host
fingerprint:

```
CLAUDECODE=1         IDENTICAL
CODEX_THREAD_ID=t1   IDENTICAL
RASEN_NOTHING=1      IDENTICAL   (the `unknown` host's legacy resolution)
```

Text mode byte-identical for a Claude host. Explicit-transcript readers unchanged:
the Codex rollout fixture and a named Claude transcript both report identical
fields from both builds.

## Install and probe smoke tests

`rasen init --tools omp` in a scratch git repo wrote 34 skills to
`.omp/skills/rasen-*/SKILL.md` with non-empty `description` front matter and no
command directory. Oh My Pi itself then discovered them, and
`skill://rasen-apply-change` resolved to
`/private/tmp/omp-smoke/.omp/skills/rasen-apply-change/SKILL.md` — the
project-local root, at the highest precedence Oh My Pi offers.

The live probe from this repository's own session reports its own occupancy from
the legacy `-SyncLocal-rasen` bucket, and the figure is the session's own
arithmetic rather than the `totalTokens` trap:

```
$ jq -r '…(input + cacheRead + cacheWrite)…' "$f" | grep -n '^433793'
328:433793	total=434068
$ jq -r '… .message.usage.totalTokens' "$f" | grep -c '^433793$'
0
```

Independently corroborated at scale by a slice that enumerated `message.usage`
across all 63 real session files: the key universe is CLOSED at seven keys, so no
sent-token field is silently dropped; `cttl` is a per-tier breakdown of
`cacheWrite` (equal in all 4395 rows, so counting it would double-count); and
`input + cacheRead + cacheWrite + output == totalTokens` holds for 4416/4416 rows.

## Security

No Blocker, no Major. Threat model applied: a single-user, non-privileged CLI with
no setuid bit, daemon, or listener. `..` in `OMP_PROFILE`/`PI_CONFIG_DIR` does
escape the intended root, but the resolved path has exactly one consumer and is
read-only, no hostile input can set those variables, and the user already has the
capability via `--transcript`. The locator's `Dirent` filter was verified to
refuse FIFOs, device symlinks, symlinked buckets and symlink loops in 1 ms, and it
is 4× faster than the shipped Codex locator at 100 000 files. Three Minors are
recorded as FU-J/FU-K and SEC-2's guard test, which was added here.

## Gates run

| Gate | Result |
|---|---|
| `pnpm run lint` | pass |
| `pnpm exec tsc --noEmit` (root realm) | pass |
| `pnpm --dir packages/ui typecheck` | pass |
| `pnpm --dir packages/ui test` | 49 files, 502 tests pass |
| `pnpm exec vitest run` (root suite, after `pnpm run build`) | **349 files, 6150 pass, 27 skipped** |
| `git diff --check <base>...HEAD` | clean |

Parity hashes refreshed in the order `rasen/specs/workflow-template-parity`
mandates (edit → build → run the BUILT CLI's update → recompute). Exactly three
templates moved in each map, all three embedding the edited playbook.

TEST EVIDENCE
- scope: full repository root suite plus the `packages/ui` suite and both typecheck realms
- rationale: the fix changes a shared contract (`HandoffThresholdReport.shouldHandoff` became optional) consumed by the command layer and the generated orchestration templates, so narrowing to the touched files would not cover the consumers; the UI suite is outside the root include and holds one half of the wire-mirror guard
- command: `pnpm run lint && pnpm exec tsc --noEmit && pnpm run build && pnpm exec vitest run && pnpm --dir packages/ui typecheck && pnpm --dir packages/ui test`
- result: pass
- tree: `7b011ea6eaedee114f78f2c852f84d0b943509c6` (`git rev-parse HEAD^{tree}` at the time the gates ran, i.e. the parent of the fix commit). The verified content is identified by the code-diff digest `b89eeafab383811b` (sha256, first 16 hex) over `git diff --cached -- . ':(exclude)rasen/changes/omp-install-target-and-context-probe/evidence/*'` — the evidence files are excluded because writing this line would otherwise invalidate the digest of the diff containing it.

## Open follow-ups

Thirteen items in **`evidence/deferred-followups-report.md`** — the audit slice
(FU-A) and dispatch slice (FU-B) with the four `runtime-adapter-interface-extraction`
follow-ups they own, plus FU-C…FU-F from implementation and FU-G…FU-M from this
verification. Read that file before treating this change as closed.

VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:13 Trivial:8
