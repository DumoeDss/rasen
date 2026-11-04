## Why

awplanet already implements the accepted `0.3.0` temporal project and CameraRig authority, but it cannot yet capture an exact Timeline/Shot-qualified Preview or execute a bounded, independently verifiable reference-video Render Job. The accepted private `0.4.0` handoff now closes those semantics, so awplanet can implement the real packaged-host adapter without inventing its own scheduler, codec policy, job lifecycle, or provenance authority.

## What Changes

- Verify and install only the three exact private `@scene-bridge/*@0.4.0` archives authorized by accepted envelope `C:\s3c04\accepted-render-handoff-v3.json`; advertise v4 operations, routes, constraints, errors, profiles, and limits only after that gate and the concrete packaged encoder probe pass.
- Add qualified Preview that selects exactly one Timeline tick or Shot-relative tick, calls the existing packaged temporal evaluator directly, waits for two real matching CameraRig frames, captures the real viewport, publishes immutable PNG metadata/provenance, and restores the preceding viewport atomically. It MUST NOT compose seek with legacy Preview, and legacy Preview plus all v1-v3 behavior remain unchanged.
- Add one provider-local asynchronous Render Job runtime with short idempotent admission, immutable starting authority, a pure 48,000-tick reduced-rational frame schedule, exact half-open ownership, monotonic polling, explicit cancellation, bounded receipts/jobs/artifacts/bytes/retention, late-completion fencing, and persistent-authority invalidation.
- Render every scheduled frame through the real packaged Electron host and existing temporal evaluator/CameraRig authority, encode exactly `reference-webm-vp9-v1` (WebM, VP9, yuv420p, 8-bit 4:2:0, no alpha, no audio), and fail closed on encoder/profile/codec/container/rate/dimension/bitrate substitution.
- Keep video bytes out of ordinary JSON IPC: the target owns bounded staging and authenticated binary download, while installed `scenectl` verifies the accepted video metadata/probe relations and performs atomic no-replace publication to the client-owned path.
- Extend fixed host/broker dispatch, dependency verification, real packaged-host conformance, installed-CLI workflows, decoder/probe evidence, fault/race/restart/cancel/publish/cleanup tests, package smoke, and evidence validation without widening the default-off Bridge or Phone Pilot surface.
- Treat the current private `MediaRecorder` recording/export path only as compatibility input and regression scope; it is not public schedule, job, codec, artifact, or provenance authority.

## Capabilities

### New Capabilities

- `awplanet-reference-video-rendering`: Provider-local qualified capture and reference-video Render Job execution, exact packaged scheduling/evaluation, packaged encoder authority, cancellation/retention, target-owned staging, immutable artifacts, and decoded-media proof.

### Modified Capabilities

- `awplanet-temporal-runtime`: Allow qualified capture and Render Jobs to consume the existing packaged evaluator and transient CameraRig arbitration without creating playback controllers or a second temporal implementation.
- `awplanet-revision-bound-preview`: Add exact time/Shot-qualified real-viewport capture with two-frame temporal binding and failure-atomic viewport restoration while preserving legacy persistent-Camera Preview unchanged.
- `awplanet-scene-bridge-adapter`: Consume the exact accepted v4 registries, validate qualified Preview/job requests and results through package exports, and expose no local contract authority.
- `awplanet-native-project-lifecycle`: Bind Render Jobs to immutable starting Project authority and serialize invalidation/publication against apply, History, import, replacement, teardown, and rollback without persisting job state.
- `awplanet-scene-bridge-host`: Add only the four packaged qualified Preview/render-job routes and fixed broker kinds, authentication-first bounded bodies, binary artifact delivery, and teardown-safe provider cleanup.
- `awplanet-scene-bridge-e2e`: Require unchanged v1-v3 regressions plus real packaged-host v4 conformance, installed accepted archives/CLI, independent decoder/profile/probe evidence, and adversarial failure/race/restart/cancel/publication/cleanup proof.

## Impact

- Immutable dependency authority: `C:\s3c04\accepted-render-handoff-v3.json`, 268223 bytes, SHA-256 `8a94a11b7b961a8469b1616b560eda03cbfbd61f97e1ce638d09015ccfd43572`; source A `b8bbdcb4fe685ee9357b500abced69d2233e7dce` / tree `eb2ce46c22bcaebefa372ff41538059ceed8e24a`; direct provenance B `3f9d536278313eafd57ba75a070763a9a8f7f071` / tree `a187dcf44fe472d59abd53c8068209faa8746e4d`; terminal 137-file fingerprint `2c3453f664fa24d47c2da135991992708026cda22841921c5ae1c7ae8eeab96f` with terminal review CLEAN.
- Exact archive tuples: `@scene-bridge/protocol@0.4.0` / `scene-bridge-protocol-0.4.0.tgz` / 184358 bytes / SHA-256 `87b80e83b6fd1dc8917bc50bb885510ba61eb16013bf469f5c1c5bcaabdd2f2d`; `@scene-bridge/conformance@0.4.0` / `scene-bridge-conformance-0.4.0.tgz` / 155998 bytes / SHA-256 `4f19c2bdca4a8692e754d05ad9960e7921d919725d9317ef6b03cf1150a73ee5`; `@scene-bridge/cli@0.4.0` / `scene-bridge-cli-0.4.0.tgz` / 45841 bytes / SHA-256 `788e4012cf76e6808cecd5fd97320d3d073ad572a7ae6c7abebd7a7779fea943`. All remain `private: true`, `UNLICENSED`; awplanet's PolyForm terms grant no redistribution, publication, commercial-use, or sublicensing right to them.
- Runtime/code: `EngineProvider` temporal/runtime services, CameraRig and renderer observer/barrier, Scene Bridge adapter/projector/coordinator, Electron server/broker/preload/capture/artifact storage, encoder child-process ownership, and controlled packaged-target launchers.
- Product/package: exact accepted vendor archives and lockfile, a pinned distributable encoder binary plus its license/hash/probe, Electron Forge packaging/ASAR/resource inspection, and target-private bounded render staging. Capability availability is false if the exact packaged encoder cannot be selected and probed.
- Verification: dependency and rights gates; installed archive resolution with no workspace/environment fallback; unit/integration/fault/race/restart tests; lint/build/rig/default-off/package smoke; real packaged-host conformance; installed CLI workflow; independent WebM/VP9 decode/probe/content verification; evidence validation. No push, PR, public package publication, Unity work, agent-skill work, audio/NLE, or cloud/headless render is included.
