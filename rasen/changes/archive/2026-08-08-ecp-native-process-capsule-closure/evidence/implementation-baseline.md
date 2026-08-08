# Implementation baseline

This Change starts from the cumulative, uncommitted strategy delta authored for
`ecp-durable-agent-session-host`. It does not claim the existing opaque
`ProcessScope`, Rust `ProcessCapsule`, package resolver, registry-v2 migration,
or Windows Job-at-create implementation as new work.

The last fresh strategy-author evidence recorded:

- the focused host surface: 21 files, 140 tests passing;
- the ProcessScope/package/migration/native subset: 4 files, 17 tests passing;
- the real Windows controller-death oracle: killing only the native controller
  closed the root and detached descendant while the unrelated process remained
  alive;
- the duplicate-Job-handle and early-activation mutations remained sensitive;
- build, lint, TypeScript, Rust fmt/clippy, Linux/macOS cross-target compile and
  package gates passed at that point.

Fresh independent review nevertheless classified the strategy attempt
`EXHAUSTED (PARTIAL)` with Blocker 0, Major 4, Minor 1:

| Id | Severity | Open finding at this Change's start |
| --- | --- | --- |
| S1 | Major | The macOS `proc_uniqidentifierinfo` declaration is 40 bytes instead of the required 56-byte XNU ABI. |
| S2 | Major | Backend-root `EXIT` is treated as whole-scope closure, so authority can be cleared while descendants remain. |
| S3 | Major | POSIX replacement termination controls only the controller and cannot exactly reap a surviving reserved supervisor group. |
| S4 | Major | ACTIVATE and prepared abort acknowledgements have no bounded control deadline. |
| S5 | Minor | Adjacent artifact integrity is proven, but source-identical Windows builds did not prove byte reproducibility. |

Historical source: `../ecp-durable-agent-session-host/evidence/strategy-attempt-1.md`
and its terminal review entry in
`../ecp-durable-agent-session-host/evidence/review-cycle-report.md`.
