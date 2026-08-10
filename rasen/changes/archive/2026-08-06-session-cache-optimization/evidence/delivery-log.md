# Final delivery log — session-cache-optimization (2026-08-06)

This file records the delivery that actually happened. It does not replace the
two artifacts beside it: `ship-log.md` is the **pre-E1 Draft PR publication log**
from 2026-08-03 (head `ffc73fbb`, candidate `b6a5651e`), and
`verification-report.md` is the portfolio verification written against that same
2026-08-03 state. Both were superseded by three later candidates; neither
describes the final delivery, which is why this file exists.

## What shipped

| | |
|---|---|
| PR | [#133](https://github.com/DumoeDss/rasen/pull/133) → `dev/0.2.0` |
| Merged | 2026-08-06T08:39:30Z, merge commit `275c8469` |
| Delivered head | `eddba973cd948522bab3de520d869f4738edf585` |
| Frozen candidate | `09ea2e2c3ca274e5351c5372b635fa923a79842238c4a663282c805f7e2e33c5` |
| Baseline / tree | `f50bdcf1` / `5f1f32ae` (identical to the delivered head's tree) |

A merge commit was used rather than a squash on purpose: the delivery record and
the CI evidence both bind head `eddba973`, and squashing would have removed that
SHA from the branch history.

## Blocking defects fixed on the final candidate

Each was reproduced locally before the fix and mutation-verified after it.

1. **Diagnostic tail assertion raced the stderr drain.** `createHost()` resolves
   on the stdout result envelope; the fixture's 70 KiB diagnostic goes to stderr,
   whose POSIX pipe delivers it in 64 KiB chunks, so the trailing `-suffix` chunk
   was still in flight. `appendTail` was never wrong. Mutation (keep OLDEST
   bytes) still fails the fixed test. Commit `019f6a3c`.
2. **macOS could never produce a process creation identity.**
   `processCreationIdentity` branched "not win32 → read `/proc/<pid>/stat`", and
   macOS has no `/proc`, so the admitted arm always settled
   `owned_process_creation_identity_ambiguous`. Added a darwin branch
   (`ps -o lstart=`). Commit `a25ac0d6`.
3. **The admission-fence proof raced its own competitor.** It relied on a 5 s
   agent barrier to hold the first turn open until the second launch arrived —
   which loses on a loaded runner: the first turn ends, the second launch meets
   an IDLE session, is admitted in turn, and both processes report `interrupted`
   with no `wake_busy` anywhere. Replaced with a deterministic handshake (launch,
   wait for the registry to publish `inFlight`, launch the competitor, release
   the held turn only after the competitor is answered). Mutation (disable the
   wake lease's live-owner check) still fails the reworked test. Commits
   `f50bdcf1` (fixture barrier) and `eddba973`.

## Acceptance evidence

- **E1** physical run, attempt `ed2770e0-f60d-45f4-a1a0-76867490d627`, all three
  arms `completed`:
  - `control-hit-55m` → `cache_hit` at 55 min (cacheRead 63158 vs create 699)
  - `control-miss-65m` → `cache_miss_or_rewrite` at 66 min (create 71811 vs read 20816)
  - `scheduler-cadence-deadline` → `one_touch_then_deadline`: exactly one touch at
    +50.9 min (inside the ±5 min cadence tolerance), `deadlineApplied: true`,
    transcript append 339042 → 341699 bytes with one terminal assistant row
- **E2** authorization `delivered`, authorizer `Sayo`, delivery mode `pr`
- **E3** `ciState: successful` — CI run `31074656530`, attempt 1, all five
  required jobs green on the exact delivered SHA
- **Local evidence gates** all exit 0; `nativeWindows`, `injectedPosix` and
  `physicalRetention` all true
- **E4** `assertFinalAcceptanceComplete` passes, `productGaps: []`

The machine-readable records (freeze, authorization, publication, attempt
checkpoints, arm results, CI snapshots, gate logs) live outside the repository in
the acceptance work directory:
`~/.rasen/projects/openspec-code-1e42477e/changes/session-cache-optimization-acceptance-evidence/work/`.
The superseded `b65ee1ef` candidate and its whole run staging were archived
byte-preserving under `history/frozen-candidates/` in that same directory, with
`supersede-note.md` explaining the baseline narrowing.

## Known gaps, stated rather than hidden

- The `strictValidation` gate no longer validates the child change
  `session-cache-optimization-acceptance-evidence` — it was archived on
  2026-07-31 and cannot be resolved by name, and this parent is a decomposition
  container with no deltas of its own. The gate validates the capability the
  portfolio actually delivered instead: `rasen/specs/session-host-lifecycle/spec.md`.
- The freeze's `deliveryPaths` lists two files, not the change's full file set,
  because the `dev/0.2.0` merge sits mid-branch and no pre-merge baseline can
  pass the ownership audit any more. The frozen *tree* is still the whole tree.
- The concurrent-bootstrap `wake_busy` fence in `durable-session-registry.ts` has
  no test coverage: disabling it leaves the acceptance suite green. The fence the
  admission proof actually exercises is the wake lease's live-owner check.
