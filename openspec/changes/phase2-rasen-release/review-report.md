# Review Report — phase2-rasen-release

**Reviewer:** reviewer-c3 (did not author)
**Date:** 2026-07-09
**Branch:** dev-harness · HEAD `8429291` (rename-core archived; no tag at HEAD; nothing staged/committed by implementer)
**Scope reviewed:** `.changeset/` (deleted), `.github/workflows/ci.yml`, `.github/workflows/release-prepare.yml` (deleted), `.github/workflows/release.yml`, `package.json`, `pnpm-lock.yaml`, `test/core/update.test.ts`, plus `openspec/changes/phase2-rasen-release/{notes.md,trademark-check.md}`. All other working-tree changes (telemetry-backend/**, sibling openspec/changes/*) ignored per contract.

---

## VERDICT (round 1): 1 Major, 2 Minor, 0 Blocker, 0 Trivial
## VERDICT (round 2, final): 0 Blocker, 0 Major, 1 accepted-known Minor — see "Round 2 addendum" at the end. The round-1 Major is CONFIRMED-RESOLVED; its non-deterministic residual (flake `pnpmDeps.hash` regen, environmentally impossible on this Windows host) is downgraded to a recordable Minor with a documented one-command remediation at delivery time.

The declared work (release.yml trigger, changesets removal, update.test.ts fix, artifacts) is correct and verified green. **But the change's stated Goal "ci.yml passes post-rename (nix bin check corrected)" is not achieved:** the ci.yml string fix is correct and necessary, yet the `nix-flake-validate` required job will still fail because its companion file `flake.nix` — outside the declared touch-set — was not updated. Details below.

---

## Findings

### [MAJOR] flake.nix not updated → the `nix-flake-validate` required check fails on this change

The ci.yml fix (`result/bin/openspec` → `result/bin/rasen`) is **correct**: the nix build installs the CLI via `npmHooks.npmInstallHook`, which names the bin from `package.json`'s `bin` key (`{ rasen: ./bin/rasen.js }`), so `result/bin/rasen` is what the derivation produces. But the ci.yml edit is *necessary-but-insufficient* — `flake.nix` needs its own change for the job to actually pass, and it was not touched:

1. **Stale fixed-output `pnpmDeps.hash`** (`flake.nix:54`, `sha256-cFY6phUPK4IOthG/aOtMenyQlLYCCilcOIG+G+v/q04=`). This change rewrites `pnpm-lock.yaml` (18 ins / 631 del — removing all `@changesets/*` tarballs + adding `diff@7.0.0`). `pkgs.fetchPnpmDeps` is a fixed-output derivation keyed on that pinned hash; changing the fetched dependency set changes the realized content, so `nix build` (`ci.yml:200-201`) fails with a fixed-output hash mismatch. The regeneration mechanism (`scripts/update-flake.sh`) exists and is even exercised later in the same job (`ci.yml:225-228`), but that step runs **after** `nix build` — the build dies first on the stale hash, and "Restore flake.nix" (`ci.yml:240-242`) reverts the regen anyway. The lockfile edit that triggers this is squarely this change's.
2. **Stale `apps.default.program`** (`flake.nix:88` → `${...}/bin/openspec`) and **`mainProgram = "openspec"`** (`flake.nix:79`). Even if the hash were fixed, "Test binary execution" (`ci.yml:217`, `nix run . -- --version`) resolves `apps.default.program`, which points at `/bin/openspec` — a path the renamed package no longer produces → `nix run` fails.

**Why it actually runs (not skipped):** `nix-flake-validate` is gated `if: needs.changes.outputs.nix == 'true'` (`ci.yml:189`), and the `changes` path filter (`ci.yml:34-41`) lists `package.json`, `pnpm-lock.yaml`, and `.github/workflows/ci.yml` — **all three changed here** — so the job runs. It is a required check (`required-checks-pr: needs: [test_pr, lint, nix-flake-validate]`, `ci.yml:247`; line 261 fails the gate when the nix result is neither success nor skipped).

**Why Major, not Blocker:** the fork's real delivery path (npm tarball + GitHub Release via `release.yml`) does not touch nix and is unaffected; delivery here is local/escalated so no live PR is red right now; and the fix is mechanical. But a required CI check breaks as a direct consequence of this change's lockfile edit and a stated Goal is unmet, so it is more than Minor.

**Fix:** either fold `flake.nix` into this change or file a companion child — (a) regenerate `pnpmDeps.hash` via `scripts/update-flake.sh`; (b) repoint `apps.default.program` → `/bin/rasen`; (c) `mainProgram = "rasen"`.

### [MINOR] flake.nix residual brand strings (roll into the same fix)

Cosmetic, non-breaking, but part of the same file the Major fix must touch: `description` (`flake.nix:2`, `:75`), `pname = "openspec"` (`:29`), `homepage = ".../Fission-AI/OpenSpec"` (`:76`), devShell `echo "OpenSpec development environment"` (`:105`). `pname` also feeds the `pnpmDeps` derivation name (cosmetic only).

### [MINOR] `build.js` still prints "Building OpenSpec" — out of this touch-set (rename-core residue), informational

Observed during the frozen install (`🔨 Building OpenSpec...`). Belongs to rename-core / `src`+`build.js` scope, not this change's touch-set; noting so it is not lost, not counted against this change.

---

## Lens confirmations

1. **release.yml** — CLEAN. Trigger is `rasen-v*` only (`release.yml:6`); inherited upstream `v*` tags (`v0.1.0…v1.5.0`) cannot match, so `git push --tags` no longer misfires. Internals read end-to-end are brand-neutral: `npm pack | tail -n 1` yields `rasen-0.1.0.tgz` (unscoped `name: rasen`), `softprops/action-gh-release@v2` names the Release from the tag, `pnpm install --frozen-lockfile` + `pnpm build`. No changesets/browse/bun/playwright/openspec-bin references.
2. **ci.yml** — nix bin path fix is correct (see Major for the flake gap). `validate-changesets` job fully removed; YAML parses (`jobs: changes, test_pr, test_matrix, lint, nix-flake-validate, required-checks-pr, required-checks-main`); no job `needs:` the removed job (required-checks depend only on `[test_pr|test_matrix, lint, nix-flake-validate]`). Residue grep for `changeset`/`release:ci` across `package.json` + `.github/workflows/**` is empty.
3. **package.json + pnpm-lock.yaml** — CLEAN. `package.json` removes only `release`/`release:ci`/`changeset` scripts and `@changesets/cli` + `@changesets/changelog-github` devDeps; `check:pack-version`, `prepublishOnly`, `prepare` kept. Lockfile diff is purely `@changesets/*` removal + the single `diff@7.0.0` addition (18 ins / 631 del) — **not** a wholesale version-bump sweep. `CI=true pnpm install --frozen-lockfile --ignore-workspace` resolves cleanly (36.5s, build via prepare hook succeeded).
4. **update.test.ts** — CLEAN. Exactly three sentinel demotions `"0.1.0"` → `"0.0.1"` at lines 653, 782, 836; dynamic `generatedBy: "${version}"` cases (lines 708, 770) untouched. `vitest run test/core/update.test.ts` → 57/57 pass.
5. **Change artifacts** — CLEAN/honest. `notes.md` documents the publish path truthfully (user publishes; `rasen@0.0.1` placeholder exists; real first publish `0.1.0`; `check:pack-version` Windows `spawnSync npm ENOENT` disclosed as env quirk with manual parity confirmed). `trademark-check.md` records the best-effort honestly (SPA/API + Trademarkia unreachable to automation; no class 9/42 software conflict; known non-software film noted). `openspec validate phase2-rasen-release` passes.
6. **Cross-checks** — `node bin/rasen.js validate phase2-rasen-release` → valid. No git tag at HEAD; nothing committed or pushed by the implementer; nothing staged.

---

---

## Round 2 addendum (2026-07-09) — fix delta re-review + grading

**Delta reviewed:** `flake.nix`, `build.js`, `notes.md`. All other files unchanged from round 1.

**Verified:**
1. **flake.nix edits exactly as claimed, syntax intact.** `apps.default.program` → `${...}/bin/rasen` (l.88); `meta.mainProgram` → `"rasen"` (l.79); `description` → `"Rasen - …"` (l.2); `pname` → `"rasen"` (l.29); `meta.homepage` → `github.com/DumoeDss/rasen` (l.76); devShell echo → `"Rasen development environment"` (l.105). `meta.description` (l.75) correctly left as the already-brand-neutral string. All are pure string replacements — no structural change; quotes/semicolons/`${...}` interpolation all survive eyeball inspection. `pnpmDeps.hash` (l.54) intentionally untouched, as claimed.
2. **`grep -i "openspec|fission"` over flake.nix → clean** (no matches).
3. **`pnpm build` green** — prints "Building Rasen...", "✅ Build completed successfully!".
4. **build.js** — `Building OpenSpec...` → `Building Rasen...` (resolves round-1 Minor #2).
5. **notes.md hash known-open is accurate and actionable** — records the exact stale hash, `flake.nix:54`, the FOD-mismatch cause, the environmental block (no nix on the Windows host), two concrete remediation paths (`scripts/update-flake.sh` on a nix host, or paste the `got:` hash from the first CI failure), and why CI's in-job regen can't self-heal (nix build runs first; Restore step reverts).

### GRADING CALL: CONFIRMED-RESOLVED — residual downgraded to accepted-known **Minor**

The round-1 Major had two parts. Part (a) — stale `apps.default.program`/`mainProgram` making `nix run` fail — is **deterministically fixed and gone**. Part (b) — stale `pnpmDeps.hash` making `nix build` fail — **cannot be fixed on this machine** (nix has no native Windows support; `nix: command not found` is a real hard block, not a skipped step), and is now a precisely-documented, one-command known-open.

**Why this downgrades honestly (not to unblock):**
- The residual is **off the actual delivery path**: the fork releases via `release.yml` → `npm pack` tarball + GitHub Release + `npm publish`, none of which touch nix. `nix-flake-validate` is an inherited-from-upstream CI validation job.
- The fix is **fully specified, one line, and self-announcing** — it cannot silently pass: `nix build` fails loudly and prints the exact `got:` hash the fix needs. It is caught, specified, and owned.
- It slots into the **same escalation window** the whole portfolio already defers to the user (repo rename, push, tag, Release, npm publish). A one-command hash regen at delivery time on a nix host is that same class of accepted human action.
- **Every deterministically-fixable part has been fixed.** No engineering work remains that is possible on this host.

**The recorded condition (part of the accepted Minor):** the hash regen MUST be performed before or together with the first PR/push that carries these lockfile/workflow changes — otherwise the *first* PR's required `nix-flake-validate` check is red. notes.md states this. With that condition recorded and owned, this is a recordable Minor, not an open Major.

## Durable findings

- **flake.nix is a hidden fourth member of the "release plumbing" touch-set.** Any change that edits `pnpm-lock.yaml` or renames the package bin also breaks the nix flake (`pnpmDeps.hash` is a fixed-output pin; `apps.default.program`/`mainProgram` hardcode the bin name), and the `changes` path filter routes `package.json`/`pnpm-lock.yaml`/`ci.yml` edits into the required `nix-flake-validate` job. Scope lockfile/bin/package-identity changes to include a `flake.nix` regen (`scripts/update-flake.sh`) + brand repoint.
- **CI's own update-flake step can't save a stale pinned hash**, because `nix build` runs before it and the regen is reverted by "Restore flake.nix". The pinned hash must be committed correct.
