## Why

Expert skills reference sibling files by relative path — `review` reads `checklist.md`, `qa` reads `references/issue-taxonomy.md` and `templates/qa-report-template.md`, the 0c methodology skills read `DEEPENING.md` / `LOGIC.md` / `ADR-FORMAT.md` / … , and 0d-absorb added `investigate/scripts/hitl-loop.template.sh`. But `openspec init` (and `openspec update`) install **only** `SKILL.md` per skill: the loop writes the generated `SKILL.md` and nothing else. So every one of those relative references is dangling at the install target — the skills silently lose half their content. This is the pre-existing limitation flagged across 0c/0d-absorb; this change fixes it.

## What Changes

### 1. Copy sidecar reference files on install

Extend the skill-install loop (shared by `init.ts` and `update.ts`) so that, after writing each skill's `SKILL.md`, it copies that skill's **sidecar files** from the source skill directory (`skills/gstack/<workflowId>/`) into the installed skill directory, preserving subdirectory structure.

**Copy rule (allowlist):** files ending `.md` (excluding `SKILL.md` itself) and `.sh`, found recursively under the source skill dir (so `references/*.md`, `templates/*.md`, `scripts/*.sh`, `bin/*.sh` are included); `*.tmpl` is excluded. The `browse` skill directory is skipped entirely — it is a vendored bun tool package (`src/` 205 KB + `test/` 252 KB of `.ts`), and its runtime binary is delivered separately via `{{BROWSE_SETUP}}`, not as skill sidecars. The extension allowlist already excludes browse's `.ts` trees by construction; skipping browse is belt-and-suspenders and also avoids copying its pointless build scripts.

This rule is chosen over the two alternatives (see design) because it is the lightest and most self-maintaining: a new `.md`/`.sh` sidecar is picked up automatically with no manifest to update and no exclude-list to keep in sync.

### 2. Centralize the copy + resolve the source like the templates do

Add a shared `copySkillSidecars(workflowId, targetSkillDir)` helper (in `skill-generation.ts`, alongside `getSkillTemplates`) that resolves the source skill dir the same way the expert templates resolve their `SKILL.md` (relative to the package), applies the allowlist, and copies. Both `init.ts` and `update.ts` call it (destructuring `workflowId` from the registry entry, which already carries it). If the source dir is absent, it no-ops gracefully — matching the existing `readFileSync` try/catch in the expert templates.

### 3. update / idempotency / uninstall

`update` runs the same helper, so re-running is idempotent (sidecars are overwritten in place). `removeSkillDirs` already deletes the whole installed skill directory, so uninstall/commands-only paths remove sidecars with it. Upgrading an existing install adds the new sidecar files on the next `init`/`update` — expected and documented.

### Verification includes a real run

A temporary-directory `openspec init` (and a follow-up `openspec update`) asserts that `.claude/skills/openspec-gstack-investigate/scripts/hitl-loop.template.sh` and `.claude/skills/openspec-gstack-review/checklist.md` land, and that `.claude/skills/openspec-gstack-browse/src/` does **not**.

## Flagged: the deeper shipping gap (out of scope, surfaced for a separate decision)

`skills/` is **not** in package.json `files` and `build.js` does not copy it, so it exists at runtime only in a **checkout** — which is exactly how this fork is used (`node bin/openspec.js init` from the repo). The existing expert-template `readFileSync` already depends on this: in a *published* npm package neither `SKILL.md` content nor sidecars would resolve. This change is therefore consistent with current reality (works from a checkout, graceful-skips otherwise) and does not regress anything. Making published installs work is a **separate** concern because naively adding `skills/` to `files` would ship browse's 450 KB `.ts` tree to npm; a proper fix would ship `skills/**/*.{md,sh}` selectively (and the generated `SKILL.md`). Flagged for the LEAD; not done here.

## Behavior change (document for users)

After this change, `openspec init`/`update` write additional files under each installed expert skill directory (the reference `.md`/`.sh` sidecars). Existing installs gain these files on their next update. This is intended — it is what makes the skills' relative references resolve.

## Capabilities

### New Capabilities

- `skill-sidecar-install`: Sidecar reference files are copied alongside `SKILL.md` during init and update, by an `.md`/`.sh` allowlist, excluding the browse package, resolved from the packaged skill source, idempotent and graceful when absent.

## Impact

- `src/core/shared/skill-generation.ts` — new `copySkillSidecars(workflowId, targetSkillDir)` helper (source-dir resolution + allowlist copy)
- `src/core/init.ts` — call the helper in the skill-install loop (destructure `workflowId`)
- `src/core/update.ts` — call the helper in the skill-install loop (destructure `workflowId`)
- `test/core/...` — unit test (sidecars copied, `SKILL.md`/`.tmpl`/browse excluded) + a real-run init/update assertion in a temp dir
- No skill content, registration, or count changes.

Verification: `bun run gen:skill-docs` (no-op for content), TypeScript build, `bun run skill:check` FRESH, new sidecar tests + real-run init/update green, existing vitest suites stay green, `openspec validate --strict`.
