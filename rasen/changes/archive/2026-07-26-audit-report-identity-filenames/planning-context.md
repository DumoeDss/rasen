# Planning Context

## User intent

Fix `rasen agent audit` so default JSON reports for distinct sessions cannot overwrite one another when their identifiers share an initial prefix. The concrete failure is Codex UUIDv7 thread IDs created within the same roughly 65-second interval: their first eight hexadecimal characters are identical.

The change must:

- start from `origin/dev/0.1.5` in an isolated worktree and branch;
- preserve explicit `--out` behavior;
- remain compatible with Claude, Codex, and Zed reports in the shared analytics directory;
- keep repeat audits of the same canonical session deterministic;
- avoid full-suite testing and run only focused token-audit tests;
- finish by committing, pushing, and opening a pull request.

## Established findings

- `src/core/token-audit/audit.ts` currently derives the default filename with `sid.slice(0, 8)` and writes it with overwrite semantics.
- Codex passes the canonical `mainMember.threadId` into that filename helper.
- Observed collision examples on 2026-07-26 include two different thread IDs beginning with `019f9cd1`, two with `019f9cd7`, and two with `019f9cdd`.
- Every audit result already exposes a canonical `session.runtime` and `session.id`.
- The management repository lists and reads arbitrary valid direct JSON filenames, so it does not require the legacy eight-character filename shape.
- Existing saved reports should remain readable and should not be renamed or deleted automatically. Reports already overwritten cannot be recovered except by rerunning the source audit.

## Preferred direction

Derive the default report filename from the canonical identity `runtime + full session.id`, with cross-platform-safe handling for unusual or overlong identifiers. Include focused regression coverage for:

- two Codex UUIDv7 IDs sharing their first eight characters;
- stable naming when rerunning the same session;
- separation of equal IDs across runtimes where feasible at the helper level;
- unchanged explicit `--out` behavior.

The planner may refine the exact safe-filename mechanism after inspecting the current implementation and specifications.
