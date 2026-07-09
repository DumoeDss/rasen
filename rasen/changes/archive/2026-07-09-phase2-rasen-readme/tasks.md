## 1. Replace README.md

- [x] 1.1 Overwrite `README.md` in full with a new-from-scratch rasen README (do not patch the old text). Touch only `README.md` — no `docs/**`, `src/**`, `package.json`, workflows, or assets.

## 2. Hero & narrative (spec: Brand hero and spiral narrative)

- [x] 2.1 Open with the two taglines verbatim: `Rasen — loops that ascend` and `「不是循环，是螺旋」`, plus a one-line "what rasen is".
- [x] 2.2 Render the spiral narrative arc: spec is the origin → loops are the form → each turn ascends (harness) → breaks through (goal), as rasen's mental model (design D3 maps each beat to a real capability).
- [x] 2.3 Use brand casing: lowercase `rasen` for package/command/env identifiers, `Rasen` as the proper noun in prose.

## 3. Lineage & trust (spec: Fork lineage and non-affiliation declaration)

- [x] 3.1 State: forked from OpenSpec (MIT) by Fission-AI, independently maintained by DumoeDss, not affiliated with Fission-AI.

## 4. Install (spec: Install instructions)

- [x] 4.1 Primary install `npm i -g rasen`; Node.js `>=20.19.0`.
- [x] 4.2 chrome-use prerequisites: Google Chrome, Node 22+, Chrome launched with remote debugging (`chrome://inspect/#remote-debugging` or `--remote-debugging-port`), first-connection "Allow" prompt (carry the accurate list from the current README's chrome-use section).
- [x] 4.3 Note to remove any prior install of this fork under the old `openspec` binary (post-rename there is no upstream bin collision — phrase per design D6, not the old first-installer-wins warning).
- [x] 4.4 Init example uses the `rasen` command (`rasen init`) but shows the created workspace as `openspec/` and slash commands with the `opsx:` prefix — do NOT rename these (design D4).

## 5. Capabilities overview (spec: Core capabilities overview)

- [x] 5.1 Concise overview covering: spec-driven workflow (`/opsx:propose → apply → archive`), the `opsx` pipeline family (small-feature / bug-fix / full-feature / auto-decompose), harness autonomous iteration (`/opsx:auto` LEAD orchestration + review-cycle), goal-loop (`/opsx:goal`), chrome-use (drive real Chrome via CDP), and handoff/session-relay. Adapt the vetted copy from the current README's "What this fork adds" section, rebranded.
- [x] 5.2 Optionally include a short in-action snippet (explore → propose → apply → archive) rebranded to rasen.

## 6. Telemetry disclosure (spec: Telemetry disclosure and opt-out)

- [x] 6.1 Disclose the privacy contract (command + version + anonymous UUID + OS/Node version only; no paths/args/project data) and opt-out via `RASEN_TELEMETRY=0` / `DO_NOT_TRACK=1` / auto-off under CI.

## 7. License, alignment & badges (spec: License, alignment, and CI status)

- [x] 7.1 MIT dual-copyright note (`OpenSpec Contributors` + `DumoeDss`) and "currently aligned with upstream v1.5.0".
- [x] 7.2 CI badge pointing at `github.com/DumoeDss/rasen/actions/workflows/ci.yml`; License badge → `./LICENSE`. Omit the npm-version badge until publish; drop all upstream `@fission-ai/openspec` npm/downloads/stars/contributors badges, the OpenSpec logo/dashboard images, and the upstream Discord/`@0xTab` social block and `docs/` link map (design D5).

## 8. Verification

- [x] 8.1 Grep the rendered `README.md` for the fixed strings: both taglines verbatim, `npm i -g rasen`, `RASEN_TELEMETRY`, `DumoeDss`, `Fission-AI`, `v1.5.0`, and the `ci.yml` badge URL under `DumoeDss/rasen`.
- [x] 8.2 Confirm absence of upstream furniture: no `@fission-ai/openspec` badge, no `assets/openspec_bg.png` / dashboard image, no `docs/` deep-link map, no upstream Discord/`@0xTab` links.
- [x] 8.3 Confirm no non-README files changed (`git status` shows only `README.md` plus this change's artifacts).
- [x] 8.4 `openspec validate project-readme --strict` (change validation) passes.
