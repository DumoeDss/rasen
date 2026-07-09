## Context

rename-core is fully applied in the working tree: `package.json` is `name: rasen`, `bin: { rasen: ./bin/rasen.js }`, version `0.1.0`. The remaining phase-1 release scaffolding is now inconsistent:
- `release.yml` triggers on `v*`. The fork inherited every upstream tag (`v0.1.0…v1.5.0`), so `v*` both collides with `v0.1.0` and turns `git push --tags` into a mass-trigger footgun.
- `release-prepare.yml` is gated `if: github.repository == 'Fission-AI/OpenSpec'` (dead in the fork) and is changesets-driven.
- `.changeset/config.json` points at `Fission-AI/OpenSpec`; several pending changeset entries exist; `package.json` still has `release`/`release:ci`/`changeset` scripts and `@changesets/*` devDeps.
- `ci.yml`'s nix job checks `result/bin/openspec` and echoes "OpenSpec version" — both stale after the bin rename; the job would fail.
- `test/core/update.test.ts` uses `generatedBy: "0.1.0"` as an intentionally-stale sentinel, chosen when upstream was 1.5.x. The fork version is now exactly `0.1.0`, so "stale" == "current" and the version-diff tests break.

LEAD decisions #1 (tag scheme `rasen-v*`) and #2 (remove changesets) are fixed. This child is local-delivery only.

## Goals / Non-Goals

**Goals:**
- The release workflow fires only on `rasen-v*`, isolated from inherited upstream tags.
- Changesets are gone; releasing is simple semver + a hand-written GitHub Release, with a working local pack guard.
- `ci.yml` passes post-rename (nix bin check corrected).
- `update.test.ts` goes green without touching the package version.
- A verified, residue-free `rasen-0.1.0.tgz` and a documented (not executed) publish path.

**Non-Goals:**
- No README/docs edits (C2/deferred), no `src/**` brand changes (rename-core), no telemetry endpoint (C4).
- No tagging, pushing, or `npm publish` — those are escalated to the user at run end.
- No version bump. `0.1.0` stays the baseline.

## Decisions

### D1 — `rasen-v*` trigger, minimal workflow surgery
`release.yml` needs only its trigger changed (`v*` → `rasen-v*`). Its internals are already brand-neutral: `npm pack | tail -n1` now yields `rasen-0.1.0.tgz` automatically (unscoped `name: rasen`), and `softprops/action-gh-release` names the Release from the tag (`rasen-v0.1.0`). No tgz-name hardcode, no `openspec` bin assumption, no browse/bun/playwright steps remain. Verified by reading the file end-to-end. So the change is one line of trigger plus nothing else in that file.

### D2 — Delete `release-prepare.yml` rather than repoint it
It is both dead (upstream repo gate) and changesets-coupled (its whole job is the changesets version-PR + `release:ci` publish). Repointing it to the fork would mean re-adopting changesets, which #2 rejects. Removal is correct: it is dead code whose only purpose is the process we are deleting. Alternative (keep + neuter the gate) rejected — leaves a changesets workflow we don't use.

### D3 — Changesets removal scope
Delete the `.changeset/` directory (config + `README.md` + pending `*.md` entries). In `package.json`: remove `release`, `release:ci`, and `changeset` scripts (all changesets-coupled — `release:ci` is `check:pack-version && changeset publish`), and remove `@changesets/cli` + `@changesets/changelog-github` from devDependencies. **Keep** `check:pack-version` and `scripts/pack-version-check.mjs` — that guard is not changesets-specific (it packs and verifies CLI `--version` parity) and is exactly what the pre-publish verification task wants; it's already rebranded (`Packing rasen@…`). Removing the devDeps requires re-running `pnpm install` to re-sync `pnpm-lock.yaml`; that lockfile update is part of implementation, and `pnpm install --frozen-lockfile` in CI must still succeed afterward.

### D4 — Post-changesets release process
Going forward: bump `version` in `package.json` by hand (semver), commit, then push a `rasen-v<version>` tag, which fires `release.yml` to build + attach the tgz; the maintainer writes GitHub Release notes manually and runs `npm publish` (or lets the workflow attach the tgz and publishes locally). This child documents that flow; it does not automate publish. The `prepublishOnly: pnpm run build` hook stays, so a manual `npm publish` still builds first.

### D5 — `ci.yml` nix bin-check fix belongs here
`ci.yml` is in this child's `.github/workflows/**` touch-set (rename-core's scope was `package.json`/`src`/`LICENSE`/tests, not workflows). The nix job's `result/bin/openspec` → `result/bin/rasen` and the two echo strings are corrected here so CI is green post-rename. `deploy-docs.yml` contains only commented-out, disabled upstream references and is left untouched (docs are deferred; nothing tag/changeset-coupled).

### D6 — `update.test.ts` sentinel demotion (decision #9)
Three hardcoded stale sentinels — line 653 ("Old version content"), line 782 ("Cursor with old version"), and line 836 (the `.replace(…, 'generatedBy: "0.1.0"')` that "makes Claude stale") — are demoted `"0.1.0"` → `"0.0.1"` so "stale" is strictly less than the live `0.1.0`. The dynamic `generatedBy: "${version}"` at line 770 (an intentionally *current* tool) is left alone. The package version is not touched. This is a test-correctness fix with no user-facing behavior change, so it carries a task but no spec requirement.

### D7 — Trademark recheck is a recorded task, not a spec requirement
The USPTO search is one-time due diligence; its output is a note in the change directory, not a system behavior. Same for the pack-inventory record. Both are tasks; neither becomes a `SHALL`.

## Risks / Trade-offs

- **Removing `@changesets/*` desyncs the lockfile** → run `pnpm install` and confirm `pnpm install --frozen-lockfile` (as CI uses) still resolves; `pnpm build` green.
- **A stray `git push --tags` still fires nothing** now that the workflow only matches `rasen-v*` — but the inherited `v*` tags still exist locally; the standing rule "never `git push --tags`" remains (documented). This child pushes nothing.
- **Missing a brand-coupled spot in a workflow** → the change enumerates every `.github/workflows/**` file and greps for `openspec`/`fission-ai` after editing.
- **`release:ci` referenced elsewhere** (e.g., by `release-prepare.yml`) → both are removed together, so no dangling reference; a post-edit grep for `changeset` / `release:ci` across `package.json` + workflows must be empty.
- **npm placeholder is `rasen@0.0.1`** while the real publish is `0.1.0` → documented; no version collision because 0.1.0 > 0.0.1.

## Migration Plan

Local delivery (commit only, with a pathspec-scoped `git commit -- <touch-set>` per the shared-worktree rule). Rollback is `git revert`. The escalated external actions (repo rename, push `dev-harness`, tag `rasen-v0.1.0`, GitHub Release, `npm publish rasen@0.1.0`) are surfaced to the user at run end, not performed here.

## Open Questions

None blocking. (Whether to keep `check:pack-version` is decided: keep — it is a useful standalone guard, not changesets-coupled.)
