## 1. Teardown race (proven cause)

- [x] 1.1 Switch `session-host/host.test.ts` teardown to `cleanupTempPathAsync`, matching the session-cache suites
- [x] 1.2 Confirm the suite still passes and still removes its roots (no leaked temp dirs)

## 2. Make the archive failure self-diagnosing

- [x] 2.1 Report `plan.blockers` (operation, path, errno) plus the sibling conditions when `complete` is false
- [x] 2.2 Demonstrate the new message against an injected blocker, so the diagnostic is proven to render rather than assumed

## 3. Weights

- [x] 3.1 Add measured `KNOWN_SLOW_TEST_WEIGHTS_MS` entries for both files, annotated with the measurement and with the fact that shard balance was NOT the observed defect

## 4. Verify

- [x] 4.1 Both touched suites green; `tsc --noEmit`, `rasen validate --strict`, `git diff --check` clean
