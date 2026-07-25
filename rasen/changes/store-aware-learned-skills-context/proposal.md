## Why

Learned-skill ownership is currently inferred from the nearest planning root and
current working directory. That is unsafe once planning can live in a store:
the change's planning root may be `store:S` while the knowledge still belongs
to `project:P`, and a store may relate to several projects.

## What Changes

- Add a deterministic learned-skill execution context that carries the planning
  root separately from the typed knowledge owner.
- Extend `rasen knowledge` with explicit, mutually exclusive project/store
  selectors and resolve one authoritative owner before list, show, apply, or
  retire operates.
- Freeze the resolved knowledge context in retain/codify invocation state so a
  resumed run cannot change owner because its launch directory or planning-root
  selector changed.
- Reject absent, contradictory, stale, or ambiguous owner evidence instead of
  guessing from candidate-declared IDs, model output, or cwd.
- Preserve today's unambiguous in-repo project behavior and global operations.
- Establish the context contract consumed by the later scope and
  materialization changes; this slice does not add store persistence or combine
  project/store/global records.

## Capabilities

### New Capabilities

- `learned-skill-knowledge-context`: Deterministic separation and selection of
  planning roots, execution roots, and typed learned-skill owners across direct
  knowledge commands and retain/codify runs.

### Modified Capabilities

- `store-project-namespace`: The `rasen knowledge` command group joins the
  typed `--store`/`--project` selector contract while preserving namespace
  identity and mutual exclusion.

## Impact

- Code: knowledge command registration and context construction, learned-skill
  public context/types, store/project registry lookup, retain/codify workflow
  instructions, and pipeline run-state migration/validation.
- Data: additive versioned run-state context; existing run-state remains
  readable and is resolved conservatively.
- Compatibility: existing learned-skill candidate and manifest v1 formats are
  unchanged in this slice.
- Tests/docs: selector parsing, planning-root/owner divergence, ambiguity and
  stale identity refusal, retain resume stability, JSON diagnostics, locale
  parity, and cross-platform canonical path behavior.
