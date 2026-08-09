# Durable Session host security boundary

## Authority result

The host is a process/request lifecycle component only. It cannot claim or
mutate a canonical Action, Run, Record, EvidenceStore, completion attestation,
or signing authority. A successful result remains untrusted input for the next
ECP-7 child.

Static scan run from the isolated worktree:

```text
rg -n "from .*change-run|Action|EvidenceStore|trusted|private.*key|sign" \
  src/core/session-host src/commands/session.ts \
  src/core/management-api/hosted-sessions.ts
```

The only semantic match in the host is the diagnostic-redaction expression for
`private-key`; there are no forbidden imports or trust calls.

## Input/process boundary

- Public command validation is closed-shape. `binary`, `argv`, environment,
  signing, and arbitrary limit fields are rejected.
- The daemon resolves the backend executable and fixed argv. Production spawn
  uses `shell:false`, `windowsHide:true`, piped stdio, and canonical cwd.
- Prompt content travels through the authenticated local request and structured
  stdin. The deterministic CLI journey verifies it is absent from recorded argv
  and from the durable registry.
- Input, raw line/output, normalized output, diagnostics, body size, and timeout
  all have server-owned upper bounds. Bounds reset per turn, not per resident
  process.

## Persistence/ownership boundary

- Registry schema `rasen-session-host-registry/2` stores lifecycle metadata,
  an opaque ProcessRef, optional display PID, and
  digests/references only. Owner-only permissions are asserted where supported.
- Publication uses a complete owner token, generation CAS, same-directory
  flushed candidate, atomic replace, exact-token release, and bounded Windows
  sharing retry. Seven fault boundaries and one real competing OS process are
  covered.
- The host reuses only the existing hard-link single-writer primitive. The
  writer nonce is the registry owner token but is never process authority.
- Startup/cancel/restart/retire/shutdown pass the opaque ref back to
  ProcessScope. Foreign identity, probe uncertainty, or an unobserved close is
  never signalled through a PID and never releases ownership.
- Windows uses a source-built controller outside an unnamed kill-on-close Job;
  the inner supervisor is created suspended with Job assignment before publish
  or activation. Real controller death reaped the root and detached descendant,
  while duplicate-handle and early-activation mutations failed their oracles.
- Linux uses boot/start identity plus pidfd signalling and process-group empty
  observation. macOS uses kernel unique birth identity and has no `ps lstart`
  fallback. Both source branches passed Rust cross-compilation checks here.
- A prepared or live scope that cannot prove close retains its writer claim and
  registry authority. Clean shutdown fails and remains retryable without a
  second settlement or authority loss.
- Active cancellation/retirement fences late results; ambiguous work is never
  presented as settled or replayed. A transport-close exception caused by
  recorded control intent is mapped from the durable ambiguous request to
  `turn-outcome-unknown`, never downgraded to a generic protocol failure.
- Pruned terminal request ids are represented by a fixed-size Bloom tombstone.
  Hits fail closed, so false positives refuse work safely and inserted ids have
  no false negatives that could permit a second stdin write.

## Platform statement

Real process/registry/CLI/daemon gates and the native controller-death oracle ran
on Windows in this child. Linux/macOS helper branches passed target compilation
but did not execute on those operating systems. The release workflow now builds
the helper on all three OSes; ECP-8 still owns the actual remote behavioral
Windows/Linux/macOS CI matrix.
