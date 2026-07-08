## 1. package.json + LICENSE

- [x] 1.1 `package.json`: change `version` from `1.5.0` to `0.1.0`. Do NOT change `name`, `bin`, `repository`, or `homepage` (phase-2 per fork-publish-strategy line 115). Confirm A3 already removed the `browse` bin / `build:browse` / `playwright` — if any remain, STOP (A3 not fully shipped).
- [x] 1.2 `LICENSE`: keep `Copyright (c) 2024 OpenSpec Contributors` and add `Copyright (c) 2026 DumoeDss` beneath it; leave the MIT permission body unchanged.

## 2. README

- [x] 2.1 Add the fork-declaration blockquote at the very top of `README.md`: `> Forked from OpenSpec (MIT) by Fission-AI — independently maintained by DumoeDss, not affiliated with Fission-AI.`
- [x] 2.2 Repoint the CI badge to the fork's CI (`https://github.com/DumoeDss/OpenSpec/actions/workflows/ci.yml` + its badge.svg) so it reflects the fork's build.
- [x] 2.3 Add an INSTALL section: tgz install from GitHub Releases (show the download-then-`npm i -g ./<pkg>.tgz` form to stay URL-agnostic), `engines.node >= 20.19.0`, chrome-use prerequisites (Chrome, Node 22+, remote-debugging via `chrome://inspect/#remote-debugging`, first-CDP "Allow" popup), a warning to uninstall any upstream `openspec` first (npm global bin is first-installer-wins), and a note "aligned with upstream v1.5.0".
- [x] 2.4 Ensure no browse/playwright appears as a feature or prerequisite in any section touched. (If the README documents telemetry, describe the actual `node:https` transport to the CF Worker, which ignores `HTTP(S)_PROXY` — not native fetch.)

## 3. CHANGELOG

- [x] 3.1 Prepend a `## 0.1.0` fork-baseline entry to `CHANGELOG.md` above the retained `## 1.5.0` upstream history, summarizing the fork baseline (browse→chrome-use, telemetry→maintainer's Cloudflare Worker, independent version/identity prep). Keep the existing changesets format and all prior history.

## 4. Release Action

- [x] 4.1 Create `.github/workflows/release.yml`: `on: push: tags: ['v*']`; steps = checkout, `pnpm/action-setup`, `actions/setup-node` (node 20.19.0+, pnpm cache), `pnpm install --frozen-lockfile` (must install devDeps — do not use `--prod`), `pnpm build`, `npm pack`, then upload the resulting tgz to a GitHub Release (`gh release upload` or `softprops/action-gh-release`). No bun, no `build:browse`, no playwright.
- [x] 4.2 Do NOT modify or delete `.github/workflows/release-prepare.yml` (its `if: github.repository == 'Fission-AI/OpenSpec'` guard keeps it inert). Confirm `release.yml` is not similarly gated to the upstream repo.
- [x] 4.3 Lint the new workflow YAML (valid syntax, correct action refs); confirm the step order builds before pack before upload.

## 5. Pack verification (local, recorded)

- [x] 5.1 Run `pnpm build` then `npm pack`; capture the produced tgz filename from the command output (do not hardcode).
- [x] 5.2 `tar -tzf <pkg>.tgz` (or `npm pack --dry-run --json`): assert `dist/`, `bin/`, `schemas/`, `pipelines/`, `scripts/` are present; assert the inventory contains NO `browse` residue, NO `telemetry-backend/`, and NO `playwright`.
- [x] 5.3 Record the full tarball inventory in `openspec/changes/fork-phase1-release-prep/notes.md` as release evidence.

## 6. Validate + stop before delivery

- [x] 6.1 Run `openspec validate fork-phase1-release-prep`; confirm valid.
- [x] 6.2 HARD BOUNDARY: do NOT run `git tag`, `git push --tags`, or `gh release create`/publish. Leave the working tree verified-ready; the tag + GitHub Release are escalated to the user by the LEAD at run end. Note this explicitly in the ship-log/notes.
