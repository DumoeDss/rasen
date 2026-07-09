# Review Report — fork-phase1-release-prep

**Reviewer:** reviewer-c (independent; did not author)
**Date:** 2026-07-08
**Branch:** dev-harness
**Verdict:** ✅ **PASS / APPROVE** — no blocking issues. 3 informational notes below.

---

## Scope of diff reviewed (working tree vs HEAD)

| File | Change | Status |
| --- | --- | --- |
| `package.json` | `version` `1.5.0`→`0.1.0` **only** (verified: no other field touched) | ✅ |
| `LICENSE` | `+ Copyright (c) 2026 DumoeDss` (original line + MIT body intact) | ✅ |
| `README.md` | fork-declaration blockquote, CI badge repoint, INSTALL section, chrome-use prereqs | ✅ |
| `CHANGELOG.md` | `## 0.1.0` fork-baseline entry above retained `## 1.5.0` | ✅ |
| `.github/workflows/release.yml` | **NEW** tag-triggered build+upload workflow | ✅ |
| `.github/workflows/release-prepare.yml` | **UNTOUCHED** (confirmed: not in `git status`) | ✅ |

---

## Dimension 1 — Spec conformance (all 7 requirements)

1. **Fork-Baseline Version** — `version` is `0.1.0`; `name` (`@fission-ai/openspec`) and `bin` (`openspec`) unchanged. Diff is a single-line version bump, nothing else. ✅
2. **Dual-Copyright License** — contains both `Copyright (c) 2024 OpenSpec Contributors` and `Copyright (c) 2026 DumoeDss` under unchanged MIT terms. ✅
3. **Fork Declaration + Install Guide in README** — blockquote declares fork of OpenSpec (MIT), independently maintained by DumoeDss, "not affiliated with Fission-AI"; INSTALL section covers tgz-from-Releases, `engines.node >=20.19.0`, chrome-use prereqs, bin-conflict warning, "aligned with upstream v1.5.0". No browse/Playwright as feature/prereq. ✅
4. **CHANGELOG Fork Baseline** — `## 0.1.0` entry tops retained `## 1.5.0` history. ✅
5. **Tag-Triggered Release Workflow** — `on: push: tags: ['v*']`; checkout → pnpm → node → frozen-lockfile install → build → pack → upload; no bun/build:browse/playwright; not gated to upstream repo. ✅
6. **Verified Clean Pack Inventory** — reproduced locally (see evidence); `dist/bin/schemas/pipelines/scripts` present, zero browse/telemetry-backend/playwright residue; inventory recorded in notes.md. ✅
7. **Release Delivery Is Escalated, Not Automated** — no tag/Release created; notes.md task 6.2 confirms hard boundary honored. ✅

## Dimension 2 — LICENSE legal exactness

MIT-compliant. Original copyright line preserved **verbatim**; new maintainer line added beneath; permission body unchanged (diff = +1 line only). Standard dual-copyright convention. ✅

## Dimension 3 — README truthfulness

- Fork declaration wording matches design verbatim, including "not affiliated with Fission-AI". ✅
- INSTALL is executable: download-then-`npm i -g ./fission-ai-openspec-0.1.0.tgz` (filename matches real pack output), `engines.node >=20.19.0` matches package.json, Node 22+ called out for chrome-use, bin-conflict uninstall warning present. ✅
- chrome-use prereqs complete: Chrome + Node 22+ + remote-debugging (`chrome://inspect/#remote-debugging`) + first-CDP "Allow" popup. ✅
- Zero browse/Playwright in changed sections. The only "browse" anywhere in README is line 211 "Browse the catalog" — English verb in pre-existing unrelated prose, not the removed tool. ✅
- No telemetry paragraph added to README (acceptable — CHANGELOG carries the truthful `node:https`/CF-Worker/opt-out description instead). ✅

## Dimension 4 — release.yml correctness (highest-risk artifact)

- **Trigger** `v*` tags. ✅
- **Permissions** `contents: write` — sufficient for release creation/asset upload. ✅
- **`gh release upload`-no-existing-release failure mode does NOT apply.** The workflow uses `softprops/action-gh-release@v2`, which **creates the Release for the tag if none exists** and uploads `files:` in one step. This is the robust choice the design left open; it avoids the `gh release upload` fail-if-absent trap. ✅
- **GITHUB_TOKEN wiring** — `softprops/action-gh-release@v2` uses `github.token` by default; with `contents: write` present, no explicit `env:` needed. ✅
- **Install-before-build** — `pnpm install --frozen-lockfile` (no `--prod`, devDeps present) runs before `pnpm build`. ✅
- **tgz name robustness** — `tgz="$(npm pack | tail -n 1)"` reads the actual filename dynamically. **Verified locally:** the prepare-build banner prints first, npm prints the filename as the final stdout line, so `tail -n 1` yields `fission-ai-openspec-0.1.0.tgz` correctly and remains correct across version bumps. ✅
- **No bun / build:browse / playwright** anywhere. ✅
- Node `20.19.0` satisfies `engines.node >=20.19.0`. ✅

## Dimension 5 — CHANGELOG

`## 0.1.0` entry accurately covers all three batches (browse→chrome-use, telemetry→maintainer CF Worker with opt-out preserved, independent identity/version prep) and the "aligned with upstream v1.5.0" note; truthfully documents the `node:https` transport and its `HTTP(S)_PROXY` limitation. ✅

## Dimension 6 — Version-string blast radius

- `grep -rn '1\.5\.0' src/ test/` → **zero hits**; version is read dynamically from package.json. ✅
- `node build.js` → build **green**. ✅
- `node bin/openspec.js --version` → **`0.1.0`**. ✅

## Dimension 7 — notes.md inventory cross-check

Independently reproduced via `npm pack --dry-run --json --ignore-scripts`:
- **Total files: 443** (matches notes.md exactly). ✅
- Filename `fission-ai-openspec-0.1.0.tgz` (matches). ✅
- Top-level: `dist 426, bin 1, schemas 5, pipelines 7, scripts 1` + LICENSE/README/package.json (matches notes.md table exactly). ✅
- browse: 0 · telemetry-backend: 0 · playwright: 0 (matches). ✅
- Telemetry client IS packed (`dist/telemetry/{index,config}.{js,d.ts}`), no posthog — matches notes.md. ✅
- **No `.tgz` left in repo root** after my verification runs (confirmed clean). ✅

---

## Informational notes (non-blocking)

- **[INFO] Redundant build in workflow.** `npm pack` re-runs the `prepare` script (`pnpm run build`) after the explicit `pnpm build` step, so the project builds twice per release. Harmless, ~wastes one build cycle. Could add `--ignore-scripts` to `npm pack` since dist is already built, but not required.
- **[INFO] pnpm major mismatch (low risk).** Workflow pins `pnpm/action-setup@v4` version `9`; the committed `pnpm-lock.yaml` is `lockfileVersion: '9.0'` (locally generated by pnpm 10.33.2). lockfileVersion 9.0 is shared by pnpm 9 and 10, so `--frozen-lockfile` under pnpm 9 works today. If the lockfile is ever regenerated with pnpm-10-only semantics, the CI frozen install could break — consider adding a `packageManager` field or bumping the action to pnpm 10 to keep CI and dev in lockstep.
- **[INFO] Version-specific tgz filename in README.** The INSTALL example hardcodes `fission-ai-openspec-0.1.0.tgz`; correct for 0.1.0 but will need updating each release. Design deliberately chose the download-then-install form to stay URL-agnostic; acceptable.

## Design-sanctioned inconsistencies (verified intentional, not defects)

- `repository`/`homepage` in package.json still point to `Fission-AI/OpenSpec` — deferred to phase 2 per design D1; Release Action uploads via `GITHUB_REPOSITORY` context so releases still land in the fork.
- Only the CI badge is repointed to `DumoeDss/OpenSpec`; npm/license/discord badges stay upstream — phase-1 middle ground per design D3.

---

**Final verdict: PASS.** All 7 requirements conform; LICENSE is legally exact; README is truthful and executable; release.yml is correct and avoids the no-existing-release failure mode via `softprops/action-gh-release`; CHANGELOG is accurate; version blast radius is clean (`--version` → 0.1.0); notes.md inventory reproduces exactly (443 files, zero residue). Ready for the escalated tag + Release step.
