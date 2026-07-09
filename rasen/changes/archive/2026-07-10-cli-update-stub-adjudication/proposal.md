## Why

`rasen/specs/cli-update/spec.md` describes a "root-level `AGENTS.md`/`CLAUDE.md` stub" that `rasen update` allegedly creates or refreshes with a managed marker block pointing to `@/rasen/AGENTS.md`. No code in `src/` implements this. The claim was inherited from upstream OpenSpec history (the feature was scaffolded at upstream v0.6.0/v0.7.0 and explicitly removed at upstream v1.0.0, well before this fork's baseline) and was flagged as an out-of-scope follow-up by `fix-brand-residuals` (its design.md F5 finding and Open Questions section). Left uncorrected, the spec asserts observable behavior that never happens, which misleads anyone reading `cli-update/spec.md` as the source of truth for what `rasen update` does.

## What Changes

- Correct 4 scenarios across 4 requirements in `cli-update/spec.md` (`Update Behavior`, `File Handling`, `Tool-Agnostic Updates`, `Core Files Always Updated`) to remove the false "create/refresh a root-level AGENTS.md/CLAUDE.md stub with a managed marker block" clause, while preserving the true `rasen/AGENTS.md`-replacement clause each scenario also makes.
- No implementation change. `src/core/legacy-cleanup.ts` already treats root `AGENTS.md`/`CLAUDE.md` marker blocks purely as legacy artifacts to detect and, on explicit consent inside `rasen migrate`, strip — never to write or refresh. This proposal aligns the spec with that already-correct, already-shipped behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli-update`: the "root-level stub" scenarios in `Update Behavior`, `File Handling`, `Tool-Agnostic Updates`, and `Core Files Always Updated` no longer claim root `AGENTS.md`/`CLAUDE.md` stub creation/refresh; each scenario keeps its true `rasen/AGENTS.md` template-replacement clause.

## Impact

- Affected: `rasen/specs/cli-update/spec.md` only (delta spec in this change).
- Not affected: `src/` (no code implements or ever implemented root-stub writing in the current codebase), `rasen/AGENTS.md` (the real workspace file, unaffected), tool config files like `.claude/CLAUDE.md` (a separate surface, out of scope here).
- Out-of-scope follow-up (ledgered, not fixed here): `rasen/specs/cli-init/spec.md` line 87 makes an adjacent-but-distinct false claim about a per-tool marker mechanism for "Additional AI Tool Initialization" — different requirement, different command, not root-stub language, left for a future change.
