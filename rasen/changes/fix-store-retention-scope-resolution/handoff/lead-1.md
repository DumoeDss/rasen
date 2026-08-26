# Handoff: Store-v2 retention tranche (3 changes) — LEAD #1

> This is a LEAD session handoff covering THREE sibling changes driven together in one
> `/rasen-auto` run. It lives in change A's handoff dir because A is the tranche's primary
> change; B and G2R each carry their own `implementer-1.md` distillate written by their
> own worker. Read those for per-change depth; read this for the tranche-level picture,
> the operator decisions, and what is NOT done.

## Original intent

The operator pasted a report from a Codex session (`01a02fb2-31a8-7391-a6ed-e290f242569e`,
elftia project) which said, verbatim:

> 代码与规划 PR 已全部交付并合并。但 Rasen 生命周期还剩 retention/archive：Rasen 0.1.7 的
> Store-v2 实现无法把已验证 planning worktree 与 registered store 识别为同一根目录，官方命令
> 硬拒绝且没有合法 workaround。我没有伪造 identity、强行绕过门禁或虚假勾选归档。
> 若要把这两个 Change 也正式归档，需要你明确授权我扩大范围，修复 Rasen 的 Store-v2 retention 缺口。

and asked "检查分析一下，这个说的是什么问题". After analysis the operator said
"那接下来在0.2.0上做这个修复吧" and, when asked how to scope it, chose **"A+B+G2 一起"**
(all three tranches) and **"删除 + gitignore"** for the stale `.rasen-store/` marker.
Then `/rasen-auto 开始推进完成这几个changes`.

So: fix the Store-v2 retention/scope-resolution gap, the workspace pair-transaction bugs,
AND the G2 residue — not just the first one.

## Position

Pipeline: `small-feature` (per change). Gate policy `off` (global config). Tier A.
Selection policy `manual`.

Three changes, ALL past review, ALL validate-clean under `--strict`:

| Change | Tasks | Review verdict | Stage |
|---|---|---|---|
| `fix-store-retention-scope-resolution` (A) | groups 1–5 + fixer §7 | 0 Blocker / 2 Major → both FIXED | review-loop done, ship pending |
| `fix-store-workspace-pair-transactions` (B) | 28/28 | 0 Blocker / 2 Major (artifact-only) → both FIXED | review-loop done, ship pending |
| `rehearse-legacy-store-layout-migration` (G2R) | 26/26 | 0 Blocker / 0 Major | review-loop done, ship pending |

`author != verifier` held across four distinct agents: implementer → reviewer-1 → fixer-A →
LEAD verification. Every agent is retired; nothing is in flight.

## Done / Remaining

**Done** — see each change's `tasks.md` for the authoritative tick record; do not copy it here.
Tranche-level: 27 tracked files changed (+1864/−174) plus three NEW test suites
(`store-scope-resolution-e2e` 328 lines, `workspace-repreparation` 717, `layout-migration-empty-store` 693).
Final gates: all three `rasen validate --strict` valid; `git diff --check` clean;
LEAD re-ran A's four owned suites post-fixer → 4 files / 125 tests / EXIT=0.

**Remaining — the ONLY open work is ship, and it needs two operator decisions:**
1. Commit shape: three commits (LEAD recommends — each change has its own proposal/spec
   delta/evidence, and archive works per-change) vs one squashed.
2. PR framing: one PR carrying all three (LEAD recommends — shared tree, reviewed together,
   cross-validated) vs three stacked PRs needing merge sequencing.

**Deferred by explicit operator decision (NOT waived, do not silently do these):**
- A's group 6 (6.1–6.3): dogfood pilot + CLI reinstall. Operator chose "暂不做试点，先合代码".
- CLI reinstall waits until AFTER merge into dev/0.2.0. Global CLI is still
  `0.1.7 (dev.local 9472d7dc)`; the fixes live only in the repo tree.
- Full 693-file test suite on a quiet tree at ship time — recorded as an OPEN OBLIGATION
  in all three changes, with measured reasons why it is not attributable today.
- Repo-level `pnpm run build` for G2R (its `node build.js` ran clean twice in pinned trees
  over exactly its own code, and `tsc --noEmit` is clean, so compilability is NOT unverified).

## Key decisions (and why) — do NOT re-litigate

- **Three changes, not one.** Verified by import analysis that the three file sets are
  genuinely disjoint (B imports `workspace/identity.js` + `identity-types.js`, NOT A's
  `store/identity.ts`; G2R touches neither). That proof is what made parallel work safe.
- **A's D3 gate: first-agreeing-pair-wins is CORRECT; the delta was wrong.** fixer-A argued
  this against the LEAD's stated lean and won on evidence. The deciding argument: under the
  rejected alternative, a DELETED planning directory stays a near-miss while a REUSED one
  becomes a hard refusal — same residue, opposite verdicts, contradicting the module's own
  "absence is not disagreement" rule at `resolver.ts:274-278`. Also verified: the gate returns
  `Promise<void>` (authorization, not selection), and sibling pair files cannot reach scope
  selection at all (`readAssociationFact` reads only the seat's own root).
- **B's D6 (surviving pair branch) was authorized mid-flight** and is load-bearing: without it,
  tasks 2.2/3.2 were UNREACHABLE, because `git worktree add -b` fails outright on an existing
  branch and the pair branch survives both `worktree remove` and `workspace cleanup`.
- **G2R's fix is ONE seam fix, not two patches.** `applicable` was computed from item blockers
  while the token carried a second unreported precondition. Fixing the seam closes the empty-store
  dead end AND the silent identity hole AND any precondition added later.
- **`archive-consumer-integration` is PRE-EXISTING on committed HEAD** — proven in G2R's pinned
  `git archive HEAD` tree with all three changes' markers verified absent: 6 failed / 1 passed.
  Excluded from all three changes' verification. Do not attribute it to anyone.
- **Ship with NARROW pathspecs.** The tree carries pre-existing junk a broad `git add rasen/`
  would sweep into canonical trees: `rasen/specs/billing/spec.md` (its entire Purpose is the
  letter `p`), `rasen/changes/add-thing/`, `rasen/changes/add-gauntlet-loop/`, plus the operator's
  uncommitted `HANDOFF-canvas-gesture-ir-compiler.md`, `docs/zh/file-placement-and-planning-roots.md`
  and `rasen/config.yaml`. Exact include/exclude lists are in each change's run-state under `shipPrep`.
- **Branch off `dev/0.2.0`; never commit directly** — it is the shared integration branch.

## Dead ends & gotchas

- **A false green from an untimed test suite cost this run ~2 hours.**
  `archive-consumer-integration.test.ts` (7 tests, real CLI subprocesses in-process, NO explicit
  timeouts, 30s default, one observed failure at exactly 30013ms) passed 7/7 once at 14:49 on a
  machine where its true baseline is RED. That single lucky green generated a Blocker attribution
  against change A, seven refuted hypotheses, two stash cycles, and ~90 minutes of an implementer's
  time chasing a regression that never existed.
- **`build.js:17-20` does `rmSync('dist')` before compiling**, and `dist/` is shared. Any sibling
  build during a run corrupts every real-CLI test in flight — surfacing as MODULE-RESOLUTION errors,
  not test failures. Real-CLI verification needs an exclusive build window.
- **A src-only `git stash` leaves TESTS asserting behaviour the stashed SOURCE lacks**, and every
  resulting failure looks like a genuine defect in whoever owns the test. This manufactured two
  phantom failures in change A's cache tests that sibling B dutifully reported.
- **`SendMessage` never reaches a PARKED worker** — a worker in `rasen agent wait` reads ONLY its
  signal file (`<changeRoot>/signals/<role>.json`, written temp+rename). A parked worker shows as
  "running" in ListAgents precisely because it is blocked on a poll.
- **Windows/Git Bash:** `cat -A`/`sed` silently hide CR. `src/**` in this tree is CRLF while newer
  `test/**` files are LF; `git stash pop` round-trips can report sha256 mismatch that is pure
  line-ending normalisation, not content loss (verify with `tr -d '\r' | sha256sum`).
- **Do NOT "fix" line endings** — this repo's blobs are LF and a normalisation churn commit is far
  worse than the artifact.

## Eliminated hypotheses (the archive-consumer hunt — do NOT re-walk)

All SEVEN were refuted by experiment, not argument:
1. A's git-spawn latency from the D2 probe — refuted by a scoped control (same duration with and without the diff).
2. A's module-graph edge via `dependencies.ts` — refuted by bisect step 1 (reverting the whole file changed nothing).
3. A's "fallback logic is innocent" — refuted as CONFOUNDED: the neuter disabled the logic but left the static git import in place.
4. LEAD's `listWorkspacePairs` machine-state read — refuted structurally (the call sits inside the v2 branch under `if (store)`, unreachable for a Store-less fixture).
5. LEAD's sync→async ordering — refuted (both external callers already awaited).
6. LEAD's `config-context.ts:91` false-match — refuted by the neuter (fallback disabled, still red).
7. LEAD's suspicion of G2R's O5 fix — refuted by stashing that file alone (still 6/7).
**Actual answer: the failure is pre-existing on committed HEAD.** The 14:49 pass was the anomaly,
not the failures. Current best hypothesis for WHY it ever passed: 30s-default budget + ~1332
leftover `%TEMP%` fixtures + three-agent contention = a coin flip.

## Working set

- Three change dirs under `rasen/changes/` (proposal/design/specs/tasks/evidence/handoff each).
- Run-state: `.rasen/changes/<change>/ephemera/auto-run.json` × 3 — these carry the full decision
  record, LEAD notes, `shipPrep` pathspecs, and five recorded LEAD process failures.
- `.rasen/changes/g2-tranche-plan.json` — 9 G2 items + 3 carried findings + run summary.
- 18 modified `src/` files, 9 modified test files, 3 new test suites (see `shipPrep` for exact lists).
- `.gitignore` gained `.rasen-store/` (with rationale comment) after the operator authorized deleting
  the stale v1 marker that was blocking every flat-path `rasen new`/`archive` in this repo.
- Per-change worker distillates: `<change>/handoff/implementer-1.md` × 3, plus
  `rehearse-legacy-store-layout-migration/handoff/to-sibling-a-upgrade-identity-uuid-mismatch.md`
  (the O26 handover — now its own G2 item, nobody in this tranche owns it).

## Next action

Ask the operator for the two ship decisions (commit shape, PR framing), then run
`rasen-ship` per change using the `shipPrep` pathspecs from run-state — branching off
`dev/0.2.0`, never committing to it directly, and never using a broad `git add rasen/`.
