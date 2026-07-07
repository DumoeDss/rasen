# Proposal: reconcile-fusion-seams

## Why

A LEAD review of the `fuse-methodology-into-opsx` change (archived 2026-07-07) against the pre-fusion system found three seams where the fused methodology layer and the OPSX workflow layer give an agent contradictory instructions ("two systems fighting"):

1. **Expert bodies contradict the fusion capture guidance.** The fusion blocks direct durable output into the change directory, but `domain-modeling` teaches creating a repo-root `CONTEXT.md` + `docs/adr/` tree, and `prototype` teaches capturing verdicts in "commit message, ADR, issue, or a NOTES.md next to the prototype". An agent following the longer, operational expert text will strand artifacts outside the change directory.
2. **`/opsx:explore` self-contradicts.** The fusion added "Prototype to Settle a Stuck Question" (write running code), but the Guardrails section still said "**Don't implement** - Never write code" with no carve-out.
3. **`design.enhance: codebase-design` fired unconditionally with mismatched semantics** ("review and enhance" on every design.md, pointing at a read-only advisory skill).

User decisions (2026-07-07): fix directly; **delete `design.enhance` entirely** (seam 3); and — after inspecting domain-modeling — **remove the `domain-modeling` skill entirely** rather than patching it with an adaptation note: its CONTEXT.md/ADR-centric working style is judged to conflict with the OpenSpec change-directory flow (seam 1a becomes a removal; seam 1b, prototype, keeps the adaptation-note treatment).

## What Changes

- **Remove `domain-modeling`** (roster 20 → 19): expert getter + all 4 wiring points, `skills/gstack/domain-modeling/` source dir (incl. ADR-FORMAT.md / CONTEXT-FORMAT.md sidecars), AGENTS.md row, navigator vocabulary entry (tmpl edit + re-render), propose fusion block reference (both variants), installed orphan dir, count assertions (4 places).
- `schemas/spec-driven/schema.yaml`: remove `enhance: codebase-design` from the design artifact (schema now ships with zero enhance hooks; the mechanism stays, dormant and spec'd).
- `src/core/templates/workflows/explore.ts`: amend the "Don't implement" guardrail (both variants) with an explicit `/prototype` exception — throwaway probe only, code deleted once the answer is captured.
- New shared constant `CHANGE_CONTEXT_CAPTURE_GUIDANCE` (`src/core/templates/workflows/change-context.ts`), appended at the expert-getter layer (same mechanism as `STORE_SELECTION_GUIDANCE`) to `prototype`: change-context invocations capture the verdict into the change directory (changeRoot-resolved); standalone capture locations (ADR / NOTES.md) are standalone-use-only.
- `docs/review-cycle-workflow-design.md`: planning-review line updated (no domain-modeling, no enhance hook).
- Parity hashes: explore + propose are parity-whitelisted — recompute their function/content hashes.

## Capabilities

### Modified

- `methodology-expert-fusion`: propose consult re-specified for codebase-design only (REMOVED+ADDED rename); prototype change-context adaptation ADDED; explore guardrail carve-out scenario; standalone-invokable roster narrowed to three.
- `add-grill-expert-skills`: narrowed from four grill skills to three (domain-modeling removed); stale one-time count-assertion requirement REMOVED.
- `methodology-skill-tool-scoping`: domain-modeling scoping requirement REMOVED (no live subject).
- `navigator-router-skill`: vocabulary layer now codebase-design only; domain-modeling added to the must-not-reference set.

## Impact

- Files: schema.yaml, explore.ts, propose.ts, change-context.ts (new), experts/{index.ts,prototype.ts}, skill-templates.ts, skill-generation.ts, deleted experts/domain-modeling.ts, deleted skills/gstack/domain-modeling/, navigator tmpl + regenerated SKILL.md, AGENTS.md, docs/review-cycle-workflow-design.md, skill-generation.test.ts (counts 20→19), skill-templates-parity.test.ts (explore + propose hashes), installed skills via `openspec update --force` + manual orphan removal.
- NOTE for archive: deltas do not carry Purpose lines, so THREE main-spec Purposes go stale and need hand-editing during archive sync: `methodology-expert-fusion` ("four methodology experts" → three, no domain-modeling), `add-grill-expert-skills` ("four grill methodology expert skills — domain-modeling, …" and the count-assertions mention → three skills, count requirement removed), `methodology-skill-tool-scoping` ("…and domain-modeling (writes CONTEXT.md and ADRs) keeps its write tools…" → codebase-design only).
