# Planning context

## User intent

> `$rasen-auto small-feature 开始实现codex到claude的调用，并把版本号改为0.1.6，完成后提pr到0.1.6`

Implement supported Codex-host to Claude-worker invocation, change the release
version to 0.1.6, and deliver a pull request targeting `dev/0.1.6`.

## Established evidence

- The worktree is based on the latest `origin/dev/0.1.6` commit
  `2430d2e24b00fc889094f5e1f26906e253f1ea0b`.
- `package.json` still declares version `0.1.5`.
- `src/core/runtime-adapters.ts` currently maps Codex host -> Claude target to
  `unsupported`.
- `src/core/pipeline-registry/execution-validation.ts` rejects that route
  before dispatch with `pipeline_runtime_route_unsupported`.
- The same route, preflight, and documentation blobs are unchanged from the
  `rasen-v0.1.5` tag.
- A minimal preflight reproduction failed deterministically twice with
  `Unsupported runtime route codex -> claude`.
- Existing host-aware documentation explicitly describes this asymmetry.
- `feat/hybrid-session-workers` contains later 0.2.0-oriented research and
  design material, but it is not a shipped 0.1.6 implementation.

## Constraints

- Target branch for delivery: `dev/0.1.6`.
- Preserve existing Claude-native, Claude->Codex exec-bridge, and Codex-native
  behavior.
- Add a real, testable Codex->Claude dispatch lifecycle rather than merely
  removing the preflight guard.
- Cover launch, structured result capture, failure reporting, and any supported
  resume/continuation semantics.
- Keep command construction and tests cross-platform, including Windows.
- Tests must not require a real remote Claude invocation; use controlled CLI
  shims/fixtures at the appropriate seam.
- Update user-facing route documentation and all release-version surfaces that
  are required for a consistent 0.1.6 package.
- The final PR must target `dev/0.1.6`.

## Pipeline

`small-feature`: propose -> apply -> verify -> review-loop -> ship -> archive.
The host is Codex and all pipeline workers resolve to Codex-native dispatch.
Global gate policy is off, so gate stages are auto-approved and recorded.

## Durable planning decisions

- The 0.1.6 implementation is a bounded, one-process-per-turn Claude print
  bridge exposed through a machine-oriented `rasen agent dispatch` command.
  The long-lived stream-JSON SessionHost/daemon design remains 0.2.0 scope.
- Bridge prompts are read from a file and delivered through child stdin with
  EOF; prompt text never enters argv. This is required for multiline/CJK
  fidelity, command-line length, and Windows `.cmd` safety.
- Dispatch routes carry an explicit bridge identity: `codex-exec` for
  Claude-host -> Codex and `claude-print` for Codex-host -> Claude. Preflight
  probes only the bridge CLI actually required by the final plan.
- Claude exec-bridge workers have a durable `sessionId` plus `cwd`; they do not
  reuse native Claude `agentId` or Codex `threadId` semantics. Continuation is
  by exact session id, in the recorded cwd, with one active writer.
- Claude and Codex bridges share one runtime-neutral leaf/evaluate structured
  result contract. Claude completion is accepted only from a successful result
  envelope whose `structured_output` validates against that contract.
- The 0.1.6 release bump is lockstep across the root CLI manifest and
  `packages/ui/package.json`, with a matching non-empty changelog section;
  historical 0.1.5 examples and archived records remain historical.
