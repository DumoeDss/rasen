## Why

Rasen currently presents `rasen-freeze` and `rasen-guard` as hard edit
boundaries even though their checker is only a copied skill sidecar and no
install or update path registers it as a host hook.  Safety behavior that must
survive profile selection and missing-skill installs belongs in the base agent
runtime, with honest host-specific enforcement reporting.

## What Changes

- Add a lightweight `rasen agent edit-boundary` runtime capability with
  `set`, `status`, and `clear` transitions, canonical path handling,
  machine-local state, structured output, and a hook-facing check path.
- Model enforcement explicitly as `hard`, `soft`, or `unsupported`; report the
  detected host, capability source, active boundary, and limitations without
  upgrading an unverified host to hard enforcement.
- Register the Rasen-owned checker where a supported host can reject covered
  writes, while keeping the checker and state implementation independent of
  every optional skill directory.
- Update `investigate`, shared fix-loop guidance, navigator/safety references,
  and user docs to introduce the runtime facility and its invocation and
  enforcement semantics.
- **BREAKING** Retire the standalone `freeze`, `guard`, and `unfreeze` experts
  and their templates, sidecars, catalog rows, profile/locale metadata,
  fixtures, parity hashes, documentation, and tests.
- Prune exact previously-installed `rasen-freeze`, `rasen-guard`, and
  `rasen-unfreeze` directories on init/update, remove obsolete
  `freeze-dir.txt` state safely, and tolerate/normalize those retired ids in
  saved selections rather than making upgrades unusable.

## Capabilities

### New Capabilities

- `runtime-edit-boundary`: Agent-facing boundary transitions, state and path
  contract, hook evaluation, install/update integration, enforcement-level
  reporting, and missing-skill/unsupported-host behavior.

### Modified Capabilities

- `runtime-adapter-registry`: Runtime metadata and consumers gain one
  authoritative edit-boundary enforcement classification.
- `profiles`: The retired expert ids disappear from built-in profiles and
  localized catalog surfaces, while persisted legacy selections migrate
  without becoming unreadable.
- `investigate-diagnosing-absorption`: Investigate invokes and explains the
  base runtime boundary instead of probing or writing a sibling freeze skill.
- `navigator-router-skill`: Navigator routes edit-boundary needs to the runtime
  command and no longer advertises the three retired skills.
- `expert-dispatch-contract`: Denied-write honesty uses the runtime boundary
  result and distinguishes hard denial from soft cooperation or unsupported
  hosts.
- `legacy-cleanup`: Init/update prune the three exact retired skill directories
  and obsolete freeze state without prefix-based or unrelated deletion.

## Impact

- Runtime/CLI: `src/commands/agent.ts`, `src/cli/index.ts`, a focused core
  edit-boundary module, `src/core/runtime-adapters.ts`, command completions,
  and exports.
- Host integration and lifecycle: Claude/Codex project hook configuration,
  init/update reconciliation, machine-local state resolution, and legacy
  cleanup.
- Skill/catalog generation: expert templates/exports/registry, profiles,
  localized expert metadata, shared prompt text, investigate and navigator.
- Packaged sources and verification: `skills/experts/freeze/`, workflow
  fixtures, parity/digest/count/install/update/runtime tests, and
  missing-skill plus unsupported-host end-to-end cases.
- Documentation: English, Chinese, Japanese/catalog-facing references, website
  mirrors/manifests where applicable, and historical docs updated only where
  they currently instruct users to invoke the retired skills.
