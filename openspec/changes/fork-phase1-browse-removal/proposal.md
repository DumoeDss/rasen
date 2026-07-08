## Why

With chrome-use vendored (A1) and every browser-driving expert re-pointed to it (A2), the `browse` tool is now dead weight — a vendored bun-compiled headless-Chromium package with a Playwright optional dependency, a platform-locked binary, and a global `browse` bin. This change (batch A3, the final A-chain step) deletes all browse entities and their wiring. A2 froze `browse.ts` to be fully self-contained, so removal is a clean excision with no `_shared.ts` cleanup.

## What Changes

- **Delete the vendored tool**: the top-level `browse/` directory (including `bin/remote-slug`, `scripts/build-node-server.sh`, `src/`, `test/`) and its skill mirror `skills/experts/browse/`.
- **Delete the expert template** `src/core/templates/experts/browse.ts` (self-contained after A2).
- **Remove the 4-hop registration + dead skip** in `src/core/`:
  - `experts/index.ts`: the `getBrowseSkillTemplate` re-export.
  - `skill-templates.ts`: the `getBrowseSkillTemplate` re-export.
  - `skill-generation.ts`: the top-level `getBrowseSkillTemplate` import, the `expertSkills` browse entry, and the now-dead `if (workflowId === 'browse') return;` skip in `copySkillSidecars` (plus its browse-referencing doc comment).
- **BREAKING — remove browse from `package.json`**: the `browse` bin entry, the `build:browse` script (which compiled both `browse` and the unregistered `find-browse`), and the `playwright` optionalDependency; regenerate `pnpm-lock.yaml`.
- **Update tests**: drop the expert-count assertions from 20→19 experts (the 4 assertions currently at 41/24/20/21 → 40/23/19/20 in `skill-generation.test.ts`); remove `openspec-browse`/`getBrowseSkillTemplate` from both parity hash maps, `GENERATED_SKILL_FACTORIES`, and the parity test's `functionFactories`; remove/rewrite the browse-specific sidecar tests (the `copySkillSidecars('browse')` skip test and the browse `.ts`-tree assertions in `skill-sidecar-install.test.ts`).
- **Retire the `browse-integration` capability** via a REMOVED delta.
- **Update architecture docs** that describe browse as a live vendored tool (`docs/grill-gstack-absorption.md` and its `docs/zh` mirror) to reflect its replacement by chrome-use.

Explicitly out of scope: INSTALL / fork-declaration README work (batch C); the English-verb "browse" occurrences in `README.md` and `docs/cli.md` (not the tool).

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `browse-integration`: **Retired** — all requirements removed (Browse Directory Inclusion, Browse Binary Availability, Playwright as Optional Dependency, Skill Browser Path Resolution). The browser capability is provided by chrome-use (A1/A2).

## Impact

- **Deleted**: `browse/`, `skills/experts/browse/`, `src/core/templates/experts/browse.ts`.
- **Code**: `src/core/templates/experts/index.ts`, `src/core/templates/skill-templates.ts`, `src/core/shared/skill-generation.ts`.
- **package.json (BREAKING)**: removes the `browse` bin, `build:browse`, and `playwright` optionalDependency; `pnpm-lock.yaml` regenerated. Playwright was optional, so `node_modules` impact is minimal.
- **Tests**: `test/core/shared/skill-generation.test.ts`, `test/core/shared/skill-sidecar-install.test.ts`, `test/core/templates/skill-templates-parity.test.ts`.
- **Docs**: `docs/grill-gstack-absorption.md` + `docs/zh/grill-gstack-absorption.md`.
- **Sequencing**: package.json + lockfile edits are gated on sibling B2 (telemetry-client) having SHIPPED its own package.json change, to avoid clobbering an uncommitted overlap. No `.github/` or `.gitignore` browse references exist (verified).
- **Depends on**: A2 (frozen browse.ts seam). **Unblocks**: batch C (release-prep) pack verification.
