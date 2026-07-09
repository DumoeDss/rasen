## Context

Final portfolio child. The fork is now functionally independent (chrome-use replaces browse; telemetry goes to the maintainer's Cloudflare Worker) but still identifies as upstream. This change prepares the first independent tgz release per `openspec/office-hours/fork-publish-strategy.md` batch C (tasks 13-21) and locally verifies the tarball. It does NOT tag or publish.

Verified current state:
- `package.json`: `name @fission-ai/openspec`, `version 1.5.0`, `engines.node >=20.19.0`, `bin {openspec}`, `repository`/`homepage` → `github.com/Fission-AI/OpenSpec`, `files` whitelist `dist/bin/schemas/pipelines/scripts/postinstall.js` (+ negations). After A3, no `browse` bin / `build:browse` / `playwright`.
- `LICENSE`: MIT, single line `Copyright (c) 2024 OpenSpec Contributors`.
- `CHANGELOG.md`: changesets-style, top entry `## 1.5.0`.
- `.github/workflows/`: `ci.yml`, `deploy-docs.yml`, `release-prepare.yml` (gated `if: github.repository == 'Fission-AI/OpenSpec'` at :18 — inert in fork). No `release.yml`.
- `README.md`: badges point to `Fission-AI/OpenSpec` (CI, npm, license, discord); no fork declaration; no INSTALL-from-tgz section.
- Telemetry (B2 shipped): `node:https` POST to `https://openspec-telemetry.ws11579.workers.dev`; ignores `HTTP(S)_PROXY`. posthog-node removed. Expert count 19.

## Goals / Non-Goals

**Goals:**
- Reset version to `0.1.0`; dual-copyright LICENSE; fork-declaring README + INSTALL; CHANGELOG baseline; new `release.yml`; verified clean pack inventory.

**Non-Goals (design-deferred to phase 2 or escalated):**
- Renaming the package/bin, publishing to npm, or changing `repository`/`homepage` — phase 2 (fork-publish-strategy line 114-115).
- Creating/pushing the tag or publishing the GitHub Release — escalated to the user (hard boundary).
- Editing `release-prepare.yml` (leave the dead workflow) or the `files` whitelist (verify only).
- Any browse/playwright removal (A3) or telemetry code change (B2).

## Decisions

**D1 — Version bump only in package.json; leave repository/homepage.** Change `version` `1.5.0`→`0.1.0` and nothing else in package.json (browse entries already gone via A3). Per fork-publish-strategy, `repository`/`homepage` change is explicitly bundled with the phase-2 npm publish (line 115), so phase 1 leaves them pointing upstream. This is a deliberate, design-sanctioned inconsistency; noted as an open question so the LEAD can escalate if they want it moved earlier. The Release Action uploads via `GITHUB_REPOSITORY` context, independent of the package.json field, so releases still land in the fork repo.

**D2 — LICENSE: add, don't replace.** Insert `Copyright (c) 2026 DumoeDss` alongside the existing `Copyright (c) 2024 OpenSpec Contributors`; MIT body unchanged. Preserving the upstream line is both legally required (MIT) and the "acknowledge fork of X" norm from the office-hours research.

**D3 — README: fork declaration + fork-facing CI badge + INSTALL; no browse/playwright.** Add the blockquote verbatim at the very top. Repoint the CI badge to the fork's CI (`DumoeDss/OpenSpec/actions/workflows/ci.yml`) since that reflects the fork's actual build (other badges may stay for phase 1). Add an INSTALL section: tgz install command shape (`npm i -g <release-tgz-url>` or download + `npm i -g ./fission-ai-openspec-0.1.0.tgz`), `engines.node >= 20.19.0`, chrome-use prerequisites (Chrome, Node 22+, remote-debugging via `chrome://inspect/#remote-debugging`, first-CDP permission popup), a bin-conflict warning (uninstall upstream `openspec` first — npm global bin is first-installer-wins), and "aligned with upstream v1.5.0". Scrub any browse/playwright mention from touched sections.

**D4 — CHANGELOG: prepend a 0.1.0 fork baseline, retain history.** Add a `## 0.1.0` entry at the top summarizing the fork baseline (browse→chrome-use, telemetry→own CF Worker, independent version/identity prep) above the retained upstream `## 1.5.0` history. Keep the changesets format so future releases fit.

**D5 — New release.yml, not a fork of release-prepare.yml.** Author a fresh workflow: `on: push: tags: ['v*']`; steps = checkout, `pnpm/action-setup`, `actions/setup-node` (node 20.19.0+ with pnpm cache), `pnpm install --frozen-lockfile`, `pnpm build` (the `prepare` build), `npm pack`, then `gh release upload`/`softprops/action-gh-release` of the tgz. No bun, no `build:browse`, no playwright. Leave `release-prepare.yml` untouched (its guard makes it inert; deleting it is out of scope). Rationale: `release-prepare.yml` is upstream-changeset machinery; reusing it would drag its repo gate and changeset assumptions.

**D6 — Pack verification is local and recorded.** `npm pack` then `tar -tzf fission-ai-openspec-0.1.0.tgz` (or `npm pack --dry-run --json`); assert `dist/`, `bin/`, `schemas/`, `pipelines/`, `scripts/` present, and grep the inventory for `browse`/`telemetry-backend`/`playwright` → none. Record the full file list in the change notes (`notes.md`) as evidence for review and for the eventual release. The `files` whitelist already excludes `telemetry-backend/` and `skills/` (verified B1/A1); C only confirms.

**D7 — Hard delivery boundary.** No `git tag`, no `git push --tags`, no `gh release create`. The change ends at a verified-ready working tree; the LEAD escalates the tag + Release publish to the user at run end. Encoded as an explicit spec requirement and a non-task.

## Risks / Trade-offs

- **repository/homepage stay upstream in phase 1** → could confuse users reading package.json; mitigated by README fork declaration + the phase-2 plan. Open question for LEAD.
- **`pnpm build` in CI needs devDependencies** → `pnpm install --frozen-lockfile` installs them by default (no `--prod`); the action must not skip dev deps. Called out in the task.
- **tgz name assumption** (`fission-ai-openspec-0.1.0.tgz`) → derived from the scoped name; the verification task reads the actual `npm pack` output filename rather than hardcoding.
- **CI badge repoint vs. other upstream badges** → repointing only the CI badge (build truth) while leaving npm/license badges is a phase-1 middle ground; fully independent badges are phase-2.
- **Release Action untested without a tag** → D7 forbids tagging here; the workflow is validated by YAML lint + step review, and first real exercise happens at user-initiated delivery.

## Migration Plan

1. `package.json` version → `0.1.0`.
2. LICENSE dual copyright.
3. README fork declaration + CI badge + INSTALL (no browse/playwright).
4. CHANGELOG 0.1.0 baseline.
5. Add `.github/workflows/release.yml`.
6. `npm pack` + `tar -tzf` inventory → record in `notes.md`; assert clean.
7. Run `openspec validate`. Stop. Escalate tag + Release to the user (do not tag/publish).
8. Rollback: revert the touched files + delete `release.yml` (no external state created).

## Open Questions

- Should `repository`/`homepage` move to `DumoeDss/OpenSpec` now instead of phase 2? Design defers to phase 2; flagged for LEAD/user since a fork releasing from its own repo arguably wants them in phase 1.
- Exact INSTALL tgz URL shape (release asset URL pattern) — finalize when the release naming is set; the section can show the download-then-install form to stay URL-agnostic.
