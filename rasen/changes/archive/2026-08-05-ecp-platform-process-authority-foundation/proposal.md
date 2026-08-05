## Why

ECP cannot safely host recoverable agent processes on multiple operating systems while each native helper invents its own lifecycle, authority identity, and failure semantics. A platform-neutral contract is needed now so Linux, Windows, and a later explicitly selected macOS provider can be built and reviewed independently without reintroducing PID-tree or process-group fallbacks or mistaking uncertainty for closure.

## What Changes

- Introduce a platform-neutral `ProcessAuthorityProvider` contract and a closed provider registry that selects an exact provider/capability/protocol tuple before any workload can run.
- Introduce a versioned opaque authority-reference envelope that binds provider, capability, protocol, and integrity identity while keeping PID, PGID, Job, broker, namespace, handle, and platform-native control material private to the selected provider.
- Define one bounded `prepare -> publish -> activate` lifecycle plus bounded `inspect`, `terminate`, and `abort` outcomes, including exact-scope-empty as the only clean authority-release receipt.
- Define distinct fail-closed outcomes for root exit, authority unavailable, authority uncertain, identity drift, event gap, timeout, and control loss; none of these facts is silently converted to exact-scope-empty.
- Add closed capability negotiation and rollback rules so unknown providers, capabilities, protocol versions, envelope versions, manifest mismatches, and downgrade attempts never activate or mutate authority.
- Add a deterministic provider conformance and mutation harness that future Linux, Windows, and macOS provider Changes must run unchanged alongside their own actual-OS oracles.
- Adapt the existing `ProcessScope`/`ProcessCapsule` boundary to the new common contract without integrating or claiming any operating-system provider in this Change.

## Capabilities

### New Capabilities

- `process-authority-provider`: Platform-neutral provider selection, opaque authority references, bounded lifecycle outcomes, fail-closed negotiation, and reusable conformance obligations for durable process authority.

### Modified Capabilities

None. The existing unarchived ProcessScope/ProcessCapsule work remains historical input; this Change adds the common contract that later platform providers and the resumed closure Change will consume.

## Impact

- Primary implementation surfaces are a new common authority-provider module under `src/core/session-host/`, its deterministic conformance harness under `test/core/session-host/`, and narrow adapters in the current `process-scope.ts` and ProcessCapsule resolver/manifest boundary.
- Linux namespace/cgroup/broker implementation, Windows Job implementation, every macOS architecture/minimum-version/signing decision, frozen Action execution, signer or Run authority, release support claims, and actual-OS runtime acceptance are excluded.
- The foundation is locally terminal from deterministic contract, mutation, migration, static, package, and independent-review evidence. It does not make any platform provider runnable or supported until this child is locally shipped/archived and that provider's separate Change passes its own real-platform gates.
