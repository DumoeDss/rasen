# Release Notes / Records — phase2-rasen-release

## npm pack inventory (task 5.1)

`npm pack` produced **`rasen-0.1.0.tgz`** — 443 files. Verified contents:

- **Present (whitelisted):** `package/bin/rasen.js` (CLI entry), `package/dist/**` (compiled JS + d.ts, incl. `dist/telemetry/*` = the shipped *client* telemetry, legitimate), `package/schemas/spec-driven/**`, `package/pipelines/**` (7 pipelines), `package/scripts/postinstall.js`, `package/README.md` (the new rasen README — `<h1>Rasen — loops that ascend</h1>`), `package/LICENSE`, `package/package.json` (`name: rasen`, `version: 0.1.0`).
- **Residue scan — clean:** no `browse`, no `posthog`, no `.changeset/`, no `telemetry-backend/` in the tarball (grep over the file list returned empty).
- **Version parity:** `node bin/rasen.js --version` → `0.1.0`; packed `package.json` version → `0.1.0`. Match.

> `pnpm run check:pack-version` (task 5.2, optional) fails on this Windows box with `spawnSync npm ENOENT` — the guard spawns bare `npm` without `shell:true`, and on Windows npm is `npm.cmd`. This is an environment/tooling quirk, NOT a regression from this change, and it does not affect Linux CI. Version parity was confirmed manually instead (above).

The tgz was deleted after verification (not committed).

## Publish path (task 5.3 — documented, NOT executed)

- First real publish command (run by the user, from the repo root, after checkout on the release commit):
  ```
  npm publish
  ```
  `package.json` sets `publishConfig.access: public`, so no `--access public` flag is needed. `prepublishOnly: pnpm run build` rebuilds before publishing.
- An npm **placeholder `rasen@0.0.1`** already exists (reserved by the user). The real first publish is **`0.1.0`**, which is `> 0.0.1` — **no version collision**.
- Release tag/GitHub Release are escalated (see below); `release.yml` fires only on `rasen-v*` tags.

## Escalated delivery actions (NOT performed here — for the user)

This child is local-commit-only. The following are surfaced for human action at run end:
1. Rename GitHub repo → `DumoeDss/rasen`.
2. Push `dev-harness` (nothing pushed by this change).
3. Create + push tag **`rasen-v0.1.0`** (fires `release.yml` → builds + attaches `rasen-0.1.0.tgz`).
4. Publish the GitHub Release notes for `rasen-v0.1.0`.
5. `npm publish` → `rasen@0.1.0`.

> Never `git push --tags`: inherited upstream `v*` tags exist locally. The `rasen-v*` trigger means a stray `git push --tags` no longer fires `release.yml`, but the standing rule stands — push the one tag explicitly.

## Lockfile regeneration note (task 3.5)

Removing `@changesets/*` desynced `pnpm-lock.yaml`. The repo sits inside a parent pnpm workspace on the maintainer's machine (`…/VibeCodingProjects/pnpm-workspace.yaml`), so a plain `pnpm install` from the repo is captured by that workspace and does NOT touch the repo's local lockfile. The lockfile CI actually uses is the **standalone** one (GitHub Actions checks out only this repo). Regenerated it with `CI=true pnpm install --ignore-workspace --no-frozen-lockfile`; `--frozen-lockfile` then resolves. The regen also corrected a pre-existing drift (`diff@^7.0.0` was declared in devDeps but missing from the standalone lockfile, for the same workspace-capture reason) — needed for CI's `pnpm install --frozen-lockfile` to pass.

## flake.nix (review round 1 — Major + Minors)

Deterministic fixes applied (nix syntax verified by eyeball; `pnpm build` still green):
- `apps.default.program`: `…/bin/openspec` → `…/bin/rasen` (line 88).
- `meta.mainProgram`: `"openspec"` → `"rasen"` (line 79).
- Brand strings: top-level `description` `"OpenSpec - …"` → `"Rasen - …"` (line 2), `pname` `"openspec"` → `"rasen"` (line 29), `meta.homepage` `Fission-AI/OpenSpec` → `DumoeDss/rasen` (line 76), devShell `echo` `"OpenSpec development environment"` → `"Rasen development environment"` (line 105). (`meta.description` at line 75 was already brand-neutral — matches package.json — left as-is.)
- `build.js`: dev-only console `Building OpenSpec...` → `Building Rasen...`.

### KNOWN-OPEN — `pnpmDeps.hash` MUST be regenerated before/right after the portfolio push

`flake.nix:54` still holds the **stale** fixed-output hash `sha256-cFY6phUPK4IOthG/aOtMenyQlLYCCilcOIG+G+v/q04=`. This change rewrote `pnpm-lock.yaml` (removed `@changesets/*`, added `diff@7.0.0`), so `pkgs.fetchPnpmDeps` — a fixed-output derivation keyed on that hash — will fail `nix build` with a hash mismatch until it is regenerated.

**This was NOT regenerated here: nix is not installed on this Windows maintainer machine** (`nix: command not found`). Regenerating requires computing the fixed-output hash on a nix-capable host. Do ONE of the following on a nix-capable environment (Linux/macOS/CI) before or immediately after the portfolio push:
- Run `bash scripts/update-flake.sh` (sets a placeholder hash, runs `nix build`, extracts the `got:` hash, writes it back, and verifies) — the canonical path; commit the resulting one-line `flake.nix:54` change.
- Or read the correct hash from the first `nix-flake-validate` CI failure's `error: hash mismatch … got: sha256-…` output and paste it into `flake.nix:54`.

Note: CI's own in-job `update-flake.sh` step (`ci.yml:225`) canNOT self-heal this, because `nix build` (`ci.yml:200`) runs first and dies on the stale hash, and the later "Restore flake.nix" step reverts any regen. The pinned hash must be committed correct.
