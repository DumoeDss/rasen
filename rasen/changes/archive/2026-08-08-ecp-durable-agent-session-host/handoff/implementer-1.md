# Implementer 1 handoff

## Outcome

Implemented the ECP-7 child-1 durable agent Session host in the isolated shared
ECP worktree. No commit, push, PR, ship, or archive action was performed.

The product now has a daemon-owned backend-neutral host with stable Rasen and
backend Session identities, a durable atomic registry, exact process ownership,
resident Claude stream-json create/wake, exact-resume recovery, lifecycle
control, authenticated local Management adapters, and Session CLI commands.
The legacy one-shot supervisor remains compatible.

## Primary production surfaces

- `src/core/session-host/`: contracts, protocol, backend seam, Claude adapter,
  registry, ownership, and orchestration host.
- `src/core/claude/session-state.ts`: exact owner token exposure and guarded
  stale-owner reap using the existing writer-claim/process-tree primitive.
- `src/core/management-api/hosted-sessions.ts` plus router/server/wire changes:
  daemon-local hosted control and additive legacy projection.
- `src/commands/session.ts`, CLI/completion/locale registration: exec, list,
  inspect, cancel, restart, and retire.
- `docs/session-host.md`, `docs/cli.md`, and the P1 correction in
  `docs/session-execution-layer-design.md`.

## Critical invariants and eliminated failures

- Host code has no canonical Action/Run/Record/EvidenceStore/trusted-completion
  mutation and no signing-key custody.
- Prompt bodies travel over stdin and are absent from backend argv, registry,
  and factual replay output. Backend binary/fixed argv and cwd are server-owned.
- Registry records are fully validated, owner-restricted, canonical-cwd-bound,
  integrity-protected, copy-on-read, bounded, and atomically replaced under an
  exact owner-aware lease.
- Registry in-memory state is published after lease release. Publishing before
  release caused an intermittent same-process cancel/retire `registry-busy`
  race and was rejected.
- Raw decoder/output budgets are per turn, not cumulative across a resident
  process. A post-terminal event poisons the transport rather than becoming the
  next request's event.
- Durable process authority is the exact writer nonce plus worker token/root
  PID. Exact stale owners may be cleaned; PID-only, live, or mismatched owners
  remain fail-closed.
- Cancel/retire use generation fences so late transport completion cannot
  overwrite terminal lifecycle state.
- A cancel-induced transport-close exception is classified from durable
  `ambiguous` state as `turn-outcome-unknown`; it cannot degrade the waiting
  caller to a generic backend protocol failure.
- A prepared/sent request with no durable terminal proof becomes ambiguous and
  is never automatically replayed.
- Pruned terminal request ids are retained in a fixed-size fail-closed Bloom
  tombstone; the reversible mutation discriminator proves the guard prevents a
  second input write.

## Verification evidence

Fresh on 2026-08-04 in this worktree:

- `pnpm run build`: pass.
- Post-fix focused combined suite: 13 files, 71/71 pass.
- Host cancel/retire race: ten consecutive runs of the 11-test host file pass.
- `pnpm run lint`: pass.
- `pnpm exec tsc --noEmit`: pass.
- UI typecheck: pass; UI tests: 59 files, 651/651 pass; UI build: pass.
- `node bin/rasen.js validate ecp-durable-agent-session-host --strict`: valid.
- Product CLI E2E: two short-lived callers reused one daemon-owned no-network
  `.cmd` resident with stable Rasen/backend/PID facts.
- Final isolated single-worker root test: 452/452 files, 6947 passed, 34
  skipped, explicit exit 0; hashes and exact invocation are in
  `evidence/apply-gates.json`.

Detailed mapping and boundaries are in `evidence/implementation-report.md`,
`evidence/scenario-test-map.md`, `evidence/security-boundary.md`, and
`evidence/claude-protocol-premise.md`.

## Honest remaining work

- Complete independent non-author security and code/spec review loops.
- Re-run focused/full gates after review fixes.
- Perform local ship and evidence-backed archive only after those reviews are
  clean. Do not push or create a per-child PR.
- Actual Linux/macOS runs and the final clean-branch transfer/unique PR remain
  ECP-8 responsibilities.
- Apply implementation, test-matrix, and root gates are complete. Only
  independent review/re-review and the review-gated ship/archive lifecycle
  remain unchecked in `tasks.md`.

## Boundary for child 2

The host command/outcome and registry lifecycle are usable substrate, not trust
authority. Child 2 must add frozen Action admission, authoritative evidence
reconciliation, trusted completion, and exactly-once canonical mutation above
this layer. Do not treat a host terminal result as a canonical Run completion.
