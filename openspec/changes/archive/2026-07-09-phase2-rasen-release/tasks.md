## 1. Tag scheme (release.yml)

- [x] 1.1 In `.github/workflows/release.yml`, change the tag trigger `- 'v*'` → `- 'rasen-v*'`. Leave the rest of the workflow as-is (internals are already brand-neutral: `npm pack` yields `rasen-<version>.tgz`, the Release is named from the tag).
- [x] 1.2 Re-read the full `release.yml` after editing to confirm no other `openspec`/`v*`/tgz-name/bin assumption remains.

## 2. CI stale-brand fix (ci.yml)

- [x] 2.1 In `.github/workflows/ci.yml` nix job: `result/bin/openspec` → `result/bin/rasen` (the check at ~line 209) and update its error string ("openspec binary not found" → "rasen binary not found").
- [x] 2.2 Update the version echo "OpenSpec version:" → "rasen version:" (~line 218). Do not change `deploy-docs.yml` (its upstream refs are commented-out/disabled; docs deferred).

## 3. Remove changesets

- [x] 3.1 Delete the entire `.changeset/` directory (config.json pinned to `Fission-AI/OpenSpec`, `README.md`, and all pending `*.md` entries).
- [x] 3.2 Delete `.github/workflows/release-prepare.yml` (dead upstream-gated + changesets-coupled).
- [x] 3.3 In `package.json`, remove the `release`, `release:ci`, and `changeset` scripts. Keep `check:pack-version` (standalone guard) and `prepublishOnly`/`prepare`.
- [x] 3.4 In `package.json` devDependencies, remove `@changesets/cli` and `@changesets/changelog-github`.
- [x] 3.5 Run `pnpm install` to re-sync `pnpm-lock.yaml`; then verify `pnpm install --frozen-lockfile` (as CI uses) still resolves. (Regenerated the standalone lockfile with `CI=true pnpm install --ignore-workspace --no-frozen-lockfile` — the repo is captured by a parent pnpm workspace on this machine; see notes.md.)
- [x] 3.6 Grep to confirm no residue: `changeset` / `release:ci` return empty across `package.json` and `.github/workflows/**`. (Also removed the changesets-coupled `validate-changesets` job from `ci.yml` so this grep is clean; it was not a dependency of any required-checks job.)

## 4. Fix pre-existing update.test.ts failure

- [x] 4.1 In `test/core/update.test.ts`, demote the three hardcoded stale sentinels `generatedBy: "0.1.0"` → `"0.0.1"`: line 653 (the "Old version content" fixture), line 782 (the "Cursor with old version" fixture), and line 836 (the `.replace(/generatedBy:.../, 'generatedBy: "0.1.0"')` that makes Claude stale). Leave the dynamic `generatedBy: "${version}"` (line ~770) untouched. Do NOT change the package version.
- [x] 4.2 Run `pnpm vitest run test/core/update.test.ts` → green. (57/57 passed.)

## 5. npm publish preparation (prepare only — user publishes)

- [x] 5.1 Run `npm pack` and `tar -tzf rasen-0.1.0.tgz`; verify: `dist/`, `bin/rasen.js`, `schemas/`, `pipelines/`, `scripts/postinstall.js` present; no browse, no posthog, no `.changeset/`, no `telemetry-backend/` residue; the packaged `README.md` is the new rasen README. Record the inventory in the change directory (e.g., `notes.md`). (443 files, clean; inventory in notes.md; tgz deleted after.)
- [x] 5.2 Optionally run `pnpm run check:pack-version` to confirm the packed CLI `--version` == `0.1.0`. (Guard errors on Windows with `spawnSync npm ENOENT` — env quirk, not a regression; version parity confirmed manually: CLI `--version` and packed package.json both `0.1.0`.)
- [x] 5.3 Document in the change notes: the publish command (`npm publish` with `publishConfig.access: public`), that an npm placeholder `rasen@0.0.1` already exists, and that the real first publish is `0.1.0` (0.1.0 > 0.0.1, no collision). Do NOT run publish. (Documented in notes.md.)

## 6. USPTO trademark recheck

- [x] 6.1 Do a 5-minute `tmsearch.uspto.gov` search for "rasen"; record the result (live marks, classes, any software-category conflicts) in the change directory. Note that the film "Ring 2 / Rasen" is a known same-name non-software work — expected, not a blocker. (USPTO SPA/API + Trademarkia not reachable via automated fetch; search-engine best-effort found no class 9/42 software conflict; only the known non-software film. Recorded in trademark-check.md.)

## 7. Verification

- [x] 7.1 `pnpm build` green.
- [x] 7.2 `pnpm vitest run test/core/update.test.ts` green. (57/57)
- [x] 7.3 `pnpm install --frozen-lockfile` resolves post-changesets-removal. (Standalone lockfile, `--ignore-workspace`.)
- [x] 7.4 `npm pack` + `tar -tzf` inventory clean (task 5.1).
- [x] 7.5 `openspec validate fork-release-preparation --strict` (change validation) passes.
- [x] 7.6 Confirm no push/tag/publish happened; the escalated delivery actions (repo rename, push dev-harness, tag `rasen-v0.1.0`, GitHub Release, `npm publish rasen@0.1.0`) are surfaced for the user, not performed.

## 8. Review round 1 fixes (flake.nix + build.js)

- [x] 8.1 [Major] `flake.nix`: repoint `apps.default.program` → `/bin/rasen` (line 88) and `meta.mainProgram` → `"rasen"` (line 79).
- [x] 8.2 [Major] `flake.nix` `pnpmDeps.hash` (line 54) is stale after the `pnpm-lock.yaml` rewrite. Nix is NOT available on this Windows machine (`nix: command not found`), so the hash was left as-is and documented as a KNOWN-OPEN in notes.md: it MUST be regenerated via `bash scripts/update-flake.sh` (or from the first CI hash-mismatch output) on a nix-capable host before/right after the portfolio push.
- [x] 8.3 [Minor] `flake.nix` residual brand strings: `description` (line 2), `pname` (line 29), `homepage` (line 76), devShell `echo` (line 105) → rasen/DumoeDss. (`meta.description` line 75 already brand-neutral.)
- [x] 8.4 [Minor] `build.js` dev console `Building OpenSpec...` → `Building Rasen...`.
- [x] 8.5 Verify `pnpm build` still green; `flake.nix` Nix syntax intact by eyeball; no residual `openspec`/`fission` in `flake.nix`.
