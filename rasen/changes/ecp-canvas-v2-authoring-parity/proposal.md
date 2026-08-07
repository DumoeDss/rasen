## Why

Definition v2 is now the default authored Change-level language, but Canvas still exposes only a partial v2 editor: FanOut/Join remain read-only, AtomicStage execution and Gate dispositions cannot be authored, bounded-loop limits/exits/lifecycle are mostly display-only, and declaration diagnostics cannot be located precisely. Users can therefore preserve many valid v2 fields without being able to create or repair them, leaving the default blank-v2 path short of a complete product authoring loop.

## What Changes

- Complete Canvas create/edit/delete/connect support for the first supported v2 root vocabulary: `AtomicStage`, `CompositeRef`, `BoundedLoop`, `Choice`, `FanOut`, `Join`, `Gate`, and `Finish`.
- Expose the typed authoring contracts that make those nodes meaningful: exact capability revision and AtomicStage execution policy, Composite declaration/body contracts, typed outcomes, loop limits and domain exits, the complete shared bounded-loop lifecycle policy, FanOut membership/conditions/cap/budget/join reference, Join membership/outcomes, Gate target/decisions/dispositions, and Finish outcome.
- Keep the browser-safe blank-v2 factory aligned with the canonical core factory while using the existing v2 wire model, declaration CRUD, graph mutations, server validation, and canonical save/export serializer rather than introducing a second model or writer.
- Map server diagnostics to definition fields, root nodes/connections, declarations, declaration body nodes/connections, and nested loop/parallel/lifecycle controls so invalid drafts remain understandable and repairable in Canvas.
- Prove that definitions authored through the real Canvas affordances survive validate, save, detail reload, duplicate, export/import, and canonical preparation without semantic, capability, or plan-digest drift beyond an intentional edit; unexposed extension fields remain lossless.
- Preserve existing authored v1 editing, save, and duplicate behavior as a compatibility path. Opening or duplicating v1 never silently migrates it to v2.
- Keep `pipelines/auto-decompose/pipeline.yaml` byte-identical authored v1 and outside this Change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipelines-ui`: Canvas advances from partial v2 rendering/editing to complete authoring parity for the supported Definition v2 vocabulary, with nested diagnostic locator parity and lossless round trips while retaining authored-v1 compatibility.

## Impact

- **Canvas model and wire contract:** `packages/ui/src/api/types.ts`, `packages/ui/src/canvas/draft.ts`, layout/port derivation, and their unit tests must represent the complete already-supported v2 node, execution, lifecycle, and graph fields without replacing unknown fields.
- **Canvas authoring surfaces:** the root palette, node properties, declarations/body editor, issues drawer, and page orchestration gain structured controls for the missing v2 contracts and safe coupled mutations such as FanOut/Join membership and Gate target/disposition updates.
- **HTTP/save integration:** the existing pipeline detail, validation, save, duplicate, export, and import seams are exercised as one round-trip path; no browser filesystem access or UI-local executable-profile inference is added.
- **Compatibility and safety:** authored v1 behavior, canonical blank-v2 parity, server-authoritative diagnostics/preparation, deterministic cross-platform serialization, and exact capability pins remain intact. Final blank-Canvas-to-real-Run dogfood belongs to the following vertical-proof Change; Session execution, release closure, Issue/Dispatch/portfolio semantics, and `auto-decompose` migration remain excluded.
