# Reviewer TS-1 Handoff

STATUS: DONE_WITH_CONCERNS

I completed the fresh read-only Linux process-authority TypeScript code/spec/security review. Canonical report:

- `rasen/changes/ecp-linux-process-authority-provider/evidence/review-report-ts-round-1.md`

Verdict: **FAIL — 2 Blockers, 4 Majors, 2 Minors.** No product, test, task, or run-state files were modified; no commit was created.

Top blockers:

1. `LinuxAuthorityPublicationLedger` subclass/prototype overrides survive the WeakSet provenance check. A fresh probe obtained publication acknowledgement with an empty ledger root, and the provider would trust the same overridden `requirePublished()` before activation.
2. The only exported provider factory is injection-only. It accepts arbitrary structural transport/runtime objects and caller-supplied digest strings; no product code constructs a concrete resolved native transport or performs Linux reopen. Exact Linux selection therefore does not yet establish native authority.

Reproduced major chains:

- Reordered private-reference keys plus a recomputed digest are accepted as different bytes for the same generation/capability.
- Deleting a committed publication entry makes replacement lookup report `prepared-inert`.
- A replaced helper plus self-authored valid companion manifest is accepted as `package-integrity`.
- Ledger root identity/ancestor isolation is not pinned, leaving path replacement and same-UID tamper seams.

Verification:

- Focused Vitest: **6 files, 71 tests passed**.
- Shared suite consumption is byte-for-byte real, but the Linux fixture uses an in-memory fake transport and proves only provider-neutral adapter behavior—not actual Linux native authority.

Recommended next action: fix B-001 and B-002 with a non-author implementer, add regression tests for all three probe outputs plus the trusted-root attack, then rerun a fresh TS review before claiming the common conformance/platform gate.
