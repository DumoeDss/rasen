# Delivery handoff

Prepared: 2026-08-01

Branch: `fix/pr121-file-placement-hardening`

Saved PR-head baseline: `04cea87ae5bea9af2d90f526455b6ea513cd57e8`

Code/test delivery head: `4a07e3f508fcd6e24f62a5acb83eb5ef387c4863`

Delivery state: PR updated; code/test-head CI and aggregate checks pass

## Local evidence ready for delivery

- Fresh frozen repository gate: PASS; 341/341 exact/disjoint files,
  1,492/1,492 suites, 5,912 passed + 34 pending = 5,946 tests, zero failures.
- Focused archive group: PASS; 9 files, 143 passed, 1 expected Windows-local
  POSIX-only skip.
- Focused migration/root/session group: PASS; 6 files, 153/153 passed.
- CI contract: PASS; 3/3 tests.
- Build, typecheck, lint, strict closure validation, strict 208-spec validation,
  CLI/help compatibility, diff check, and path inventory: PASS.
- Process cleanliness: `NOT EVALUATED`.

Authoritative details are in `../evidence/release-evidence.md`,
`../evidence/direct-partition-results.md`, and
`../evidence/full-suite-report.md`.

## Remote CI evidence — complete at code/test head

| Required job | Remote URL | Result |
| --- | --- | --- |
| `File placement recovery (linux-node-floor)` | https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233748963 | SUCCESS |
| `File placement recovery (macos-node-floor)` | https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233749015 | SUCCESS |
| `File placement recovery (windows-node-floor)` | https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91233748984 | SUCCESS |
| required aggregate `Test` / `All checks passed` | https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91235591079 and https://github.com/DumoeDss/rasen/actions/runs/30653983123/job/91235591135 | SUCCESS |

- [x] Attach the Linux job URL and successful result.
- [x] Attach the macOS job URL and successful result.
- [x] Attach the Windows job URL and successful result.
- [x] Attach the required aggregate URLs and successful results.

Local Windows and deterministic `win32`/`posix` helper results are supporting
evidence only and do not substitute for native macOS/Linux execution.

## Delivery actions

- [x] Create the delivery commits.
- [x] Push the branch without force.
- [x] Update PR #121 title and body.
- [ ] Archive the closure or child changes.

Run https://github.com/DumoeDss/rasen/actions/runs/30653983123 completed
successfully at the code/test delivery head. Archive remains an on-merge action
and is not authorized by this handoff.
