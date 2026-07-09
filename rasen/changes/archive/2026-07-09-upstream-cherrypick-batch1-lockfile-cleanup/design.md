## Context

Cherry-pick of `8ac624b` into the rasen fork. Pure tooling/packaging chore: remove a dead npm lockfile and single-source the pnpm version. No runtime code. The fork removed changesets and `release-prepare.yml`, so two upstream hunks are dropped.

## Goals / Non-Goals

- **Goals:** eliminate the vestigial `package-lock.json`; make pnpm version single-sourced via `packageManager`; keep CI green.
- **Non-Goals:** no change to `pnpm-lock.yaml` contents; no touch to the Nix job or `flake.nix`; no `deploy-docs`/docs behavior change beyond the pnpm-setup line.

## Decisions

### Hunk-by-hunk plan

**`package-lock.json`** — `git rm package-lock.json`. Our copy is stale (~179 KB, npm-format) and unused; pnpm is the only package manager.

**`package.json`** — add `"packageManager": "pnpm@9.15.9"` after `"type": "module"`. Anchor context (`"type": "module"`, `"publishConfig"`) is intact on the fork; the diverged `author` line is in a different hunk region and is not touched.

**`.gitignore`** — add `/package-lock.json` under the `# Pnpm` block. Our file has `.pnpm-store/` then `result` adjacent (L150-151); upstream inserts `/package-lock.json` between them. Clean.

**`.github/workflows/ci.yml`** — remove the `with:\n  version: 9` two-line block from the 3 `pnpm/action-setup@v4` steps on the fork (jobs `test_pr` ~L57, `test_matrix` ~L113, `lint` ~L152). **Drop** the upstream 4th hunk (changesets-gated setup step — absent on fork). Leave every other line — especially the Nix job — untouched.

**`.github/workflows/deploy-docs.yml`** — remove the same two-line block from its single `pnpm/action-setup@v4` step (~L45).

**`.github/workflows/release-prepare.yml`** — **DROP** entirely; file deleted during fork.

### Interaction with child C (win-flake)
Both edit `ci.yml`; declared serial edge B → C. B strips `version: 9`; C later deletes the `test_pr` job and restructures the matrix. Because C is applied on top of B's result, B's edit to `test_pr`'s pnpm step is simply superseded when C removes that job — no conflict as long as order holds.

## Risks / Trade-offs

- **Very low.** The only behavioral surface is CI provisioning. Local risk: adding `packageManager` could in theory trip `--frozen-lockfile` if pnpm re-resolves — verified it does not (metadata field, not a dependency). If a contributor's local Corepack pins a different pnpm, `packageManager` now governs; that is the intended single-source behavior.

## Simple vs Complex (for adaptive-verify)

**Simple.** No runtime code, no test-logic change. Evidence = `CI=true pnpm install --ignore-workspace` (frozen-lockfile still satisfied) + `pnpm build`. No full vitest run required.

## Migration / Rollout

Local ship only.

## Open Questions
<!-- none -->
