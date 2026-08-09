# Durable Session host

The durable Session host is the daemon-owned execution layer for long-lived
agent CLI sessions. It lives beside the legacy one-shot Management Session
supervisor. Existing `POST /api/v1/sessions` launch semantics remain unchanged;
hosted fields are additive in shared list/detail views.

## Boundary and identity

One daemon instance constructs one backend-neutral `SessionHost`, one durable
registry, and an explicit set of server-supported backends. Short-lived CLI and
HTTP callers submit commands; they never own a resident child process or choose
an executable or argv.

A hosted Session has two identities:

- `sessionId`: the stable Rasen UUID used by every public command and receipt;
- `backendSessionId`: the backend's exact resume identity, captured from the
  first validated init event and never accepted from a client.

The Session is also bound to one canonical, existing working directory. Wake,
restart, and recovery reject a different checkout or a path that no longer
exists. `generation` increases when a dead idle transport is reopened with the
exact backend identity.

The host lifecycle is `starting`, `idle`, `active`, `cancelling`, `interrupted`,
`recovering`, `failed`, `retiring`, or terminal `retired`. Compatibility views
project those states to the existing `starting|running|exiting|exited` vocabulary.

## Durable turn protocol

Before input leaves the daemon, the registry stores a request id and input digest
as `prepared`; it becomes `sent` only after the transport's exact stdin-write
acceptance fence resolves. That fence is mandatory for every backend adapter and
is itself bounded by the turn's overall deadline. A missing or failed fence is
therefore a pre-acceptance failure, distinct from an ambiguous post-acceptance
failure. One validated init and one terminal result settle the request.
Initialization, output inactivity, and overall event clocks are independent;
only output resets the inactivity clock. Only result digests/references are
durable; prompt and result bodies are not written to the registry.

Retained request ids make retries deterministic:

- a settled id returns its retained digest without another stdin write;
- a prepared/sent id is busy;
- an ambiguous id returns `turn-outcome-unknown` and is never replayed;
- the most recent 64 settled requests are retained, while unfinished or
  ambiguous requests are never pruned merely to meet that bound.

The Claude backend prepares a source-built native `ProcessCapsule` with bounded
control pipes. `SessionHost` receives only an opaque `ProcessRef`: it persists
that capability under registry compare-and-swap and only then activates the
inert inner supervisor to launch the real backend child:

```text
claude -p --input-format stream-json --output-format stream-json --verbose
claude -p --input-format stream-json --output-format stream-json --verbose \
  --resume <exact-backend-session-id>
```

Prompts use structured stream-json stdin only. A byte-bounded UTF-8 NDJSON
decoder rejects malformed, truncated, oversized, duplicated, or identity-drifting
events with typed failures. The installed Claude CLI version/help is checked for
the required protocol before a resident process is admitted.

Neither the host nor the Claude backend parses the reference or signals a PID,
process group, Job, or native handle. `displayPid` is optional observation only.

The helper is resolved only from the package-adjacent closed manifest. Every
artifact must exact-match its protocol, platform, architecture, capabilities,
length, and SHA-256 entry. `compiler` and `sourceSha256` record build-input
provenance for that artifact; they do not claim that rebuilding the same source
will reproduce identical bytes. Runtime compilation, download, PATH lookup,
shell, PowerShell containment, and sampled PID fallback are not available.

## Registry and recovery

The document schema is `rasen-session-host-registry/2`. It lives at
`<global-data-dir>/session-host/registry.json` (normally
`~/.rasen/session-host/registry.json`, or below `RASEN_HOME`). The adjacent lease,
candidate, and stale-owner tombstone files are implementation details.

Registry publication uses an owner-aware exclusive lease, same-directory
candidate, file flush/close, whole-document digest, process generation plus a
monotonic per-Session lifecycle revision compare-and-swap,
and atomic replacement. Registry directories/files are owner-only where the
platform supports it. Windows sharing violations receive a bounded replacement
retry. Reads fail closed on malformed JSON, unknown schema, digest mismatch,
invalid canonical cwd, or missing checkout; original bytes are preserved.
An owner-free v1 document remains byte-for-byte v1 until its next successful
mutation writes v2. A v1 record with live or uncertain PID facts is not
upgraded into a strong capability and instead fails closed for operator review.

Daemon readiness waits for reconciliation. Idle records retain their exact
resume identity lazily. Any prepared/sent request left by a crash is marked
ambiguous without resend. A record without a safe identity becomes failed.
The writer nonce remains a single-writer lock only; it carries no process
authority. On Windows, the native controller stays outside containment and is
the unique owner of an unnamed, non-inherited kill-on-close Job. It creates the
inner supervisor suspended with Job assignment in the creation attribute list,
proves membership, then resumes it while it remains inert. Controller death
therefore closes the Job and kills the complete descendant tree. Linux combines
boot/start identity, pidfd signalling, and process-group empty observation.
macOS uses the kernel process unique identifier and fails closed when exact
birth cannot be obtained; it never falls back to `ps lstart`.

Unexpected transport close uses lifecycle-revision retry to clear only the
matching owner/runtime-ref facts; it cannot overwrite a valid settlement or terminal
retirement. Shutdown closes new admission first, aborts/awaits every in-flight
open, drains already-admitted transports concurrently, and treats both
`retiring` and `retired` as monotonic terminal fences. It then drains the legacy
supervisor. A prepared or live scope whose termination receipt is retained or
uncertain keeps its writer claim and opaque durable authority, fails shutdown
rather than claiming clean completion, and remains available to a shutdown
retry or startup reconciliation. Authority is released only after scope closure
is observed.

If the registry is corrupt, stop the daemon, preserve `registry.json` for
diagnosis, and repair or move that one file before restarting. Rasen will not
silently replace it with an empty registry. Rolling back to a v1-only binary
fails closed on v2 bytes and preserves them; it must not invent an empty
registry. Keep the registry until a later upgrade can inspect or retire the
identities.

## Local Management API

All routes require the existing local daemon bearer token. Request bodies are
bounded JSON and validated against a closed command shape; executable, binary,
argv, environment, private-key, Action, Run, and completion-claim fields are
not accepted.

| Method | Route | Meaning |
| --- | --- | --- |
| `POST` | `/api/v1/hosted-sessions/execute` | create or wake one bounded turn |
| `GET` | `/api/v1/hosted-sessions` | list hosted Session views |
| `GET` | `/api/v1/hosted-sessions/:uuid` | inspect one hosted Session |
| `POST` | `/api/v1/hosted-sessions/:uuid/cancel` | fence and terminate the live generation |
| `POST` | `/api/v1/hosted-sessions/:uuid/restart` | exact-resume an interrupted/idle Session |
| `POST` | `/api/v1/hosted-sessions/:uuid/retire` | permanently retire the Session |

`GET /api/v1/sessions` includes hosted views additively. Existing one-shot
records and status codes remain compatible. Deleting a hosted record through
the legacy detail route maps to cancel, never to permanent retirement.

## Security and scope

The deep host owns process and request lifecycle only. It has no dependency on
canonical Run, Action, Record, EvidenceStore, attestation, signing, policy,
Canvas, or self-hosting authority. A successful hosted result is untrusted data
for a later executor; it is not proof that a Run completed.

Current local tests exercise the real production adapter command shape with a
no-network resident replay process, the real Windows native controller-death
oracle and two fault mutations, plus Rust cross-compilation checks for Linux and
macOS. Release packaging builds the helper from pinned source on all three OSes.
Actual behavioral Windows/Linux/macOS remote CI remains the ECP-8 portfolio
delivery gate and is not claimed by this child.
