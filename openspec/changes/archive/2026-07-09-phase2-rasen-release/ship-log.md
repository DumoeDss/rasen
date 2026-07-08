# Ship Log: phase2-rasen-release

**Date:** 2026-07-09
**Mode:** local
**Branch:** dev-harness
**Commit:** 78a16d9fa152883a7414183f5187628b6f58737c
**Tree:** c66e4252365fb31d4f8d7d6bf1cda731f5123c2c
**Status:** Committed (delivery deferred to portfolio/parent level — no push, no tag, no PR)

## Pre-Flight Results
- Verification: pass — review-report.md round 2 verdict 0 Blocker / 0 Major / 1 accepted-known Minor (flake.nix `pnpmDeps.hash` stale-hash regen, environmentally unfixable on this Windows host; the round-1 Major that could be fixed deterministically — bin path + mainProgram — is confirmed-resolved).
- Tasks: 8/8 sections complete (tasks.md — all checkboxes `[x]`).

## Test Gate
- Tests: ran green — smoke trio (`test/core/templates/skill-templates-parity.test.ts`, `test/core/shared/skill-generation.test.ts`, `test/core/shared/skill-sidecar-install.test.ts`) → 44/44 pass, run against the current tree state before commit.
- Prior evidence also on record (tasks 4.2 / 7.1 / 7.3 / 5.1): `pnpm build` green post-fix, `pnpm vitest run test/core/update.test.ts` 57/57, `CI=true pnpm install --frozen-lockfile --ignore-workspace` resolves, `npm pack` inventory clean.
- Reasoning: the commit changes `pnpm-lock.yaml` (dependency-graph-relevant) plus CI/release workflow YAML and `flake.nix`/`build.js` brand strings — no application runtime code. Full `pnpm test` was not re-run; the targeted smoke trio was chosen specifically to catch any template/skill-generation/sidecar-install fallout from the lockfile change, on top of the already-green build/update-test/frozen-install evidence. No source under `src/` changed in this commit.

## Known-open (accepted, documented in notes.md)
- `flake.nix:54` `pnpmDeps.hash` is stale after the lockfile rewrite (changesets removal + `diff@7.0.0`). Nix is unavailable on this Windows host (`nix: command not found`), so the fixed-output hash could not be regenerated here. MUST be regenerated (`bash scripts/update-flake.sh` on a nix-capable host, or pasted from the first CI `got:` hash) before or together with the first PR/push carrying these changes, or `nix-flake-validate` will be red on that PR.

## Escalated delivery actions (NOT performed — surfaced for the user, per notes.md)
1. Rename GitHub repo → `DumoeDss/rasen`.
2. Push `dev-harness`.
3. Create + push tag `rasen-v0.1.0` (fires `release.yml`).
4. Publish the GitHub Release notes for `rasen-v0.1.0`.
5. `npm publish` → `rasen@0.1.0`.

Never `git push --tags` — inherited upstream `v*` tags exist locally; push the one tag explicitly.
