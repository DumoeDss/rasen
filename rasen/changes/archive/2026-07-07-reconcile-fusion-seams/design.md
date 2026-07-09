# Design: reconcile-fusion-seams

## Context

Follow-up to `fuse-methodology-into-opsx` (archived 2026-07-07). LEAD post-review found three cross-system seams; user directed a direct fix and decided seam 3 as "delete design.enhance".

## Decisions

### D1 — domain-modeling: remove, don't patch (user decision 2026-07-07)

The original plan neutralized domain-modeling's repo-root CONTEXT.md/docs-adr teaching with a getter-layer adaptation note. After inspecting the skill, the user judged the conflict structural — the skill's entire working style (inline CONTEXT.md updates, ADR file trees) presumes an artifact system parallel to OpenSpec's change directory — and directed full removal instead. Removal follows the established chain (4 wiring points + source dir + counts + navigator/AGENTS + installed orphan; mirror of the 10-expert removal in `remove-gstack-parallel-lifecycle`). The propose fusion block drops its domain-modeling sentence (both variants).

### D1b — prototype: getter-layer adaptation note

prototype's conflict is narrow (capture location: "commit message, ADR, issue, or NOTES.md beside the prototype") and the skill itself stays valuable. A shared `CHANGE_CONTEXT_CAPTURE_GUIDANCE` constant is appended in its getter — the exact mechanism already used for `STORE_SELECTION_GUIDANCE`. The note scopes itself: change-context invocations capture into the change directory (resolved via `openspec status --change <n> --json` → `changeRoot`); the body's standalone capture locations remain valid for standalone use. codebase-design (read-only advisory) and tdd (tests are the artifact) have no path conflict and get no note.

### D2 — Explore guardrail carve-out, not guardrail removal

The "Don't implement" guardrail is load-bearing for explore's identity. The fix appends the narrowest exception: a throwaway `/prototype` probe whose code MUST be deleted once the answer is captured. Both template variants get identical wording.

### D3 — Delete design.enhance; keep the enhance mechanism

User decision. The unconditional "review and enhance" directive on every design.md is ceremony, and it points at a skill that cannot edit files. The conditional fusion block in propose already covers the design-dense case with correct semantics. The `enhance` schema field, parsing, rendering, and JSON output stay (spec'd in `schema-enhance-field`, which describes the mechanism generically); the spec-driven schema simply ships with no hooks. `methodology-expert-fusion`'s "every enhance value present SHALL name an existing skill" remains vacuously satisfied.

### D4 — Review discipline note

The prior reviewer verified the fusion blocks' own wording but did not cross-check the invoked experts' body teachings — that blind spot produced seams 1-2. This change's verification explicitly includes reading the expert bodies against the new note.

## Risks

- Getter-append lengthens two installed skills slightly (one paragraph each) — negligible.
- explore.ts is parity-whitelisted; hashes recomputed with the test's own recipe (established procedure).
