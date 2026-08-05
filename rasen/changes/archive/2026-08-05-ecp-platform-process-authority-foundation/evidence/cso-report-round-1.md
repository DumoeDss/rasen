# CSO security review — round 1

**Change:** `ecp-platform-process-authority-foundation`
**Branch:** `wip/ecp-shared-bounded-loop-lifecycle-resume`
**Mode:** dispatched, report-only, fresh non-author review
**Verdict:** **NOT CLEAN — Blocker: 1, Major: 3, Minor: 0, Trivial: 0**

## Scope and method

Reviewed the exact eight-file common module, the nine named focused tests, both conformance helpers, all Change proposal/design/spec/tasks/evidence/handoff artifacts, and only the surrounding `ProcessScope`, host activation, and native resolver seams needed to evaluate compatibility. The cumulative dirty tree was treated as context, not target attribution.

Threat analysis covered opaque-reference integrity, codec confusion and leakage, provider/manifest dispatch, prepare/publish/activate ordering, retained authority, exact-empty authenticity, timeout/cancellation/late settlement/control loss, replay/rollback, command/path/environment injection, hostile provider values, and forbidden OS/native/signer/Run crossing.

Self-verification was used because dispatched mode forbids subagents. A skeptic pass reapplied every `rasen-cso` hard exclusion and confidence gate. Eight candidates were assessed; four were filtered (the explicitly non-authenticating SHA-256 digest, trusted server-resolved launch input, symlink concerns without a foundation artifact loader, and expected provider-side late effects that remain typed/retained). Four concrete product failure paths remained at confidence 9/10 or higher.

## Attack surface and trust map

- The production registry is empty and this Change adds no network endpoint or OS provider.
- Security-sensitive public seams are provider registration/selection, durable reference encoding and recovery dispatch, publication acknowledgment, exact-empty release discrimination, bounded lifecycle control, and the opt-in `ProcessScope` adapter.
- Provider-owned reference bytes can contain native authority material. The public durable reference is a control capability; provider implementations and the trusted host are separate trust boundaries.
- No Action, Run, signer, EvidenceStore, native helper protocol, Linux/Windows/macOS provider, or support boundary crossed the target module.

## Findings summary

| ID | Native severity | Canonical severity | Confidence | Category | Location |
| --- | --- | --- | --- | --- | --- |
| SEC-PA-001 | CRITICAL | Blocker | 10/10 | Replay / authority-release confusion | `src/core/session-host/process-authority/coordinator.ts:872` |
| SEC-PA-002 | HIGH | Major | 10/10 | Lifecycle control loss | `src/core/session-host/process-authority/process-scope-adapter.ts:180` |
| SEC-PA-003 | HIGH | Major | 10/10 | Provider/manifest integrity bypass | `src/core/session-host/process-authority/registry.ts:95` |
| SEC-PA-004 | HIGH | Major | 9/10 | Authority/native-material disclosure | `src/core/session-host/process-authority/reference-codec.ts:315` |

## SEC-PA-001: A stale exact-empty receipt releases a newly activated reused reference

- **Severity:** CRITICAL → **Blocker**
- **Confidence:** 10/10
- **OWASP:** A04 Insecure Design / A08 Software and Data Integrity Failures
- **Exact locations:** `src/core/session-host/process-authority/coordinator.ts:548`, `coordinator.ts:553`, `coordinator.ts:749`, `coordinator.ts:872`, `coordinator.ts:900`
- **Description:** Exact-empty receipts are cached only by the durable reference string. Preparation does not reject a provider reference that has already reached exact-empty. If the provider later prepares a new scope with the same provider-owned bytes, the second authority receives the same common reference and can activate, but `inspect` and `terminate` return the old cached receipt before dispatching the provider. The receipt remains WeakSet-authentic even though it describes the prior lifecycle.
- **Concrete failure path:**
  1. A provider prepares reference `R`, the host publishes and activates it, and termination returns provider-proven `exact-scope-empty`.
  2. `retainOrRelease` caches the authentic receipt under `String(R)` at `coordinator.ts:548-558`.
  3. Native identity recycling, incomplete generation binding, or a hostile provider value causes a later `prepare` to return the same provider reference. `coordinator.ts:749-768` accepts it and the second workload activates.
  4. `inspect(R)` or `terminate(R)` hits `coordinator.ts:872-873` or `:900-901`, returns the old authentic receipt, and makes zero provider calls.
  5. The adapter/host can now release ownership and capacity while the second workload is live.
- **Impact:** False clean closure, live-workload detachment, lost recursive control, and unsafe authority/capacity reuse.
- **Independent probe:** Two prepare/publish/activate cycles using the same provider reference produced two workload starts. After the first authentic release, the second `inspect` made zero provider calls and returned `exact-scope-empty`; `isExactScopeEmptyReceipt(...)` returned `true`.
- **Recommendation:** Treat durable authority references as non-reusable lifecycle identities. Track prepared/live/tombstoned references and fail closed before publication or activation when a provider returns an already-seen reference. Add an unchanged conformance mutation for provider-reference replay/native-identity recycling. Do not solve this by deleting the old receipt or accepting the second scope: both aliases are ambiguous and require a new provider reference carrying an exact generation identity.
- **Verification:** Self-verified; independent sub-task unavailable by dispatched-mode prohibition.

## SEC-PA-002: Runtime-bridge failure after activation strands a live workload behind a rejected abort

- **Severity:** HIGH → **Major**
- **Confidence:** 10/10
- **OWASP:** A04 Insecure Design
- **Exact locations:** `src/core/session-host/process-authority/process-scope-adapter.ts:176`, `process-scope-adapter.ts:180`, `process-scope-adapter.ts:208`, `src/core/session-host/process-authority/coordinator.ts:770`
- **Description:** The adapter activates provider authority before opening the transport/runtime bridge. If `openRuntime` throws, the workload is already live but `PreparedProcessScope.activate()` rejects without a live handle. The only cleanup method on that prepared value is `abort`; the coordinator rejects it because its state is `live`, so no provider abort/control request occurs.
- **Concrete failure path:**
  1. The host durably publishes the reference and `published.activate()` returns `live` at `process-scope-adapter.ts:176`.
  2. Pipe/channel/runtime setup throws at `process-scope-adapter.ts:180`.
  3. The caller follows the `PreparedProcessScope` failure path and calls `prepared.abort(...)` at `:208-210`.
  4. Coordinator `abort` rejects every state other than `prepared-inert` or `published-inert` at `coordinator.ts:770-773`; the provider receives no cleanup call.
  5. The agent workload continues with no returned `LiveProcessScope`; generic host cleanup retains an unusable prepared capability and can retry the same rejected abort indefinitely.
- **Impact:** A live agent process can continue unobserved/uncontrolled after activation setup failure, including during transport loss or resource/setup faults.
- **Independent probe:** A provider activation incremented the workload-start oracle and returned `live`; `openRuntime` then threw. The subsequent prepared abort returned `uncertain` with `Process-authority abort is not permitted from live`, and provider abort calls remained zero.
- **Recommendation:** Make runtime acquisition part of the inert pre-activation stage, or add an explicit post-activation failure transition that performs bounded terminate/reconciliation through the exact durable reference. The compatibility object must preserve a usable control path after activation timeout, activation control loss, and `openRuntime` failure; add focused tests for all three paths and assert provider control is attempted exactly once without optimistic release.
- **Verification:** Self-verified; independent sub-task unavailable by dispatched-mode prohibition.

## SEC-PA-003: Nonempty provider registries can bypass the closed manifest entirely

- **Severity:** HIGH → **Major**
- **Confidence:** 10/10
- **OWASP:** A08 Software and Data Integrity Failures
- **Exact locations:** `src/core/session-host/process-authority/registry.ts:95`, `registry.ts:100`, `registry.ts:138`, `src/core/session-host/process-authority/coordinator.ts:153`, `coordinator.ts:496`
- **Description:** The manifest binding is optional even for a nonempty registry. The exported coordinator also accepts a raw provider list and constructs such a registry. Therefore descriptor validation can succeed and provider code can prepare/inspect/control authority without any manifest entry, artifact path, or runtime-to-package equality check. This contradicts the closed-manifest requirement that validation occur before every preparation or recovery dispatch.
- **Concrete failure path:**
  1. A provider object claims the required descriptor tuple and semantics but is absent from, substituted for, or incompatible with the packaged provider manifest.
  2. A caller constructs `createProcessAuthorityCoordinator({ providers: [provider] })`.
  3. `coordinator.ts:496` creates `new ProcessAuthorityProviderRegistry(providers)` with no options.
  4. The registry skips the entire manifest block at `registry.ts:138-154` and exact selection succeeds.
  5. `prepare`, recovery `inspect`, or termination dispatches the unmanifested provider.
- **Impact:** Provider substitution/confusion and execution of an unapproved authority implementation under an approved descriptor identity; package rollback or manifest policy can be bypassed at the common seam.
- **Independent probe:** A nonempty coordinator constructed without a manifest dispatched `provider.prepare` and returned `prepared-inert`. The shipped conformance helper also constructs its operational coordinator through this bypass (`test/helpers/process-authority-provider-conformance.ts:70` and `:197`) while validating a separate, unused registry only for one snapshot bit.
- **Recommendation:** Require a validated manifest binding for every nonempty production registry/coordinator. Preserve deterministic tests through an explicitly test-only factory or by supplying their existing deterministic manifest to the same operational registry; do not keep a public raw-provider bypass. Ensure the conformance suite runs all lifecycle operations through the manifest-bound registry it validates.
- **Verification:** Self-verified; independent sub-task unavailable by dispatched-mode prohibition.

## SEC-PA-004: The “log-safe” view exposes the complete control reference and reversibly encoded native material

- **Severity:** HIGH → **Major**
- **Confidence:** 9/10
- **OWASP:** A02 Cryptographic Failures / Information Disclosure
- **Exact locations:** `src/core/session-host/process-authority/reference-codec.ts:149`, `reference-codec.ts:154`, `reference-codec.ts:160`, `reference-codec.ts:310`, `reference-codec.ts:315`
- **Description:** `toProcessAuthorityReferenceView` is documented as log-safe but returns the complete durable control reference. The envelope is JSON encoded with base64url, not encrypted. Anyone who receives a log/list/view can decode `providerReferenceBytes`, and replaying the complete reference is sufficient to select provider control. Provider-owned bytes are allowed to contain all native authority material, including broker locators or authentication material required by a provider threat model.
- **Concrete failure path:**
  1. A provider places a broker capability, native authority locator, or other private control material in its provider reference bytes.
  2. Session/API/UI/log code uses the exported “log-safe” view and emits `JSON.stringify(view)`.
  3. The record contains the complete `rasen-process-authority/1:<base64url>` value.
  4. A log or projection reader base64url-decodes the outer JSON and then `providerReferenceBytes`, recovering the private material, or replays the complete reference to a reachable control seam.
- **Impact:** Disclosure and replay of process-control capability/native authority material to log, API, UI, or registry-projection readers that did not need control authority.
- **Independent probe:** A reference containing `broker-token=secret-capability;native-handle=4242` was passed through the public view. The serialized view contained the full reference, and two base64url decoding steps recovered the original string byte-for-byte.
- **Recommendation:** Remove the `log-safe` claim and replace this view with a redacted identifier such as schema/provider tuple plus a one-way reference digest. Keep the full reference confined to the dedicated durable authority store and control calls. Explicitly classify full references as sensitive control capabilities and add a projection/log test that cannot recover provider bytes or replay material.
- **Verification:** Self-verified; independent sub-task unavailable by dispatched-mode prohibition.

## Validation evidence

- Focused target command over the nine named security-relevant test files: **exit 0; 9 files, 96 tests passed**. Temporary paths were redirected to `E:\rasen-ecp-pa-cso-r1-20260805`.
- Read-only built-module probes reproduced all four findings without modifying product, tests, tasks, runstate, native/OS code, or retained project temp output.
- Passing tests do not cover provider-reference replay, post-activation `openRuntime` failure cleanup, operational manifest enforcement, or reversible disclosure through the full-reference view.

## Explicitly clean boundaries

- No command shell invocation, PATH resolution, or environment inheritance was added by the target common module; launch fields are forwarded to the selected provider and the production provider registry is empty.
- Known/future envelope versions, malformed base64/UTF-8, unknown/duplicate fields, digest mismatches, tuple/reference-version mismatches, and late fulfilled outcomes otherwise fail closed in the reviewed paths.
- Exact-empty shape forgery without a coordinator-minted receipt does not pass `isExactScopeEmptyReceipt`.
- No forbidden signer/Run/Action/EvidenceStore authority, OS provider, native ProcessCapsule integration, PID/PGID fallback, macOS decision, install/signing/entitlement/VM, ship, archive, or support claim appears in the target implementation.

## Canonical counts

- **Blocker:** 1
- **Major:** 3
- **Minor:** 0
- **Trivial:** 0
- **Total reported:** 4
- **Candidates filtered as false positive/out of threat model:** 4

This AI-assisted review is not a substitute for a professional security audit or platform-specific penetration testing. Actual Linux, Windows, and any future macOS provider still require independent real-OS authority, escape, recovery, kill, unavailable, packaging, and authentication review.
