## Why

The fork is launching as an independent product, **rasen**. The current `README.md` is an upstream-derived OpenSpec landing page carrying OpenSpec logos, `@fission-ai/openspec` npm badges, upstream Discord/social links, a tgz-only phase-1 install section, and a large deep-link map into `docs/` that the maintainer is deprecating. It reads as "a fork of OpenSpec," not as rasen. A first-time visitor lands here to decide whether to install; the README must convert that visit. This change replaces `README.md` wholesale with a new-from-scratch rasen README built around the user's fixed brand narrative and taglines.

## What Changes

- **Replace `README.md` entirely** with a new-project rasen README (not a rename of the old text).
- Lead with the user's fixed brand narrative and both taglines (verbatim, non-negotiable):
  - Narrative arc: spec is the origin, loops are the form, each turn ascends (harness), until it breaks through (goal) — the path from openspec to rasen.
  - Taglines: **Rasen — loops that ascend** / **「不是循环，是螺旋」**
- Carry the required sections: fork-lineage & non-affiliation declaration; INSTALL (`npm i -g rasen`, Node `>=20.19.0`, chrome-use prerequisites, uninstall-upstream-`openspec` note); a core-capabilities overview (spec-driven workflow, `opsx` pipeline family, harness autonomous iteration, goal-loop, chrome-use, handoff); telemetry disclosure + opt-out (`RASEN_TELEMETRY=0` / `DO_NOT_TRACK=1` / CI auto-off, with the command+version+anon-UUID+os/node privacy contract); MIT dual-copyright note; "currently aligned with upstream v1.5.0"; and a CI badge (`ci.yml` exists).
- Use rasen brand casing consistently with rename-core (lowercase `rasen` for the package/command/env-var identifiers, `Rasen` as the proper noun in prose).
- Drop upstream-only furniture that does not belong to the fork: OpenSpec logo/dashboard image references, `@fission-ai/openspec` npm/downloads/stars badges, upstream Discord and `@0xTab` social links, and the deprecated `docs/` deep-link map.

## Capabilities

### New Capabilities
- `project-readme`: The content contract for the rasen project README — the brand narrative and taglines it must carry, the fork-lineage declaration, install guidance, capability overview, telemetry disclosure, and licensing/alignment notes a first-time visitor needs to decide to install.

### Modified Capabilities
<!-- None. This change touches only README.md; it does not alter runtime behavior. -->

## Impact

- **Files**: `README.md` only (full rewrite), plus this change's own artifacts.
- **Consistency**: brand identifiers must match `phase2-rasen-rename-core` (bin `rasen`, `RASEN_*` env vars, package `rasen`). This change does not itself perform the code rename — it documents the post-rename state.
- **Out of scope / must NOT touch**: `docs/**` (being deprecated and rewritten by the user), `src/**`, `package.json`, `.github/workflows/**`, assets. No new image assets are added (no rasen logo exists yet; the README is text-first).
