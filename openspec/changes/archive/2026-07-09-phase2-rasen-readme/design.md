## Context

The current `README.md` (295 lines) is an upstream OpenSpec landing page lightly patched for the fork: it keeps the OpenSpec logo (`assets/openspec_bg.png`), `@fission-ai/openspec` npm/downloads/stars badges, upstream Discord + `@0xTab` links, a phase-1 tgz-only "Install (fork release)" section that still tells users to run `openspec init`, and a ~20-link `docs/` map. The maintainer is deprecating `docs/`, publishing to npm as `rasen`, and wants the README to read as a product in its own right. The brand narrative and both taglines are fixed user decisions (see planning-context "C2b").

This change is documentation-only; it depends conceptually on `phase2-rasen-rename-core` (the code rename that makes `npm i -g rasen` and the `rasen` command real) but shares no files with it, so it runs in the parallel cohort.

## Goals / Non-Goals

**Goals:**
- A first-time visitor understands what rasen is, why the spiral metaphor, and installs — in one scroll before the fold does the persuading.
- Every fixed content requirement from planning-context is present and greppable (taglines verbatim, lineage declaration, install, capabilities, telemetry, license, alignment note, CI badge).
- Brand identifiers are consistent with rename-core and correct post-rename (`npm i -g rasen`, `rasen init`, `RASEN_TELEMETRY=0`).

**Non-Goals:**
- No `docs/**` edits and no deep-links into `docs/` (being deprecated). The README is self-contained.
- No new image assets (no rasen logo exists; adding one is out of scope and outside the README-only touch-set). Text-first.
- No code, `package.json`, workflow, or release changes. The README documents the post-rename state; it does not create it.
- Not a zh-primary README. A separate localized README can follow later.

## Decisions

### D1 — Structure optimized for install-conversion, not a feature dump
Order top-to-bottom by what converts a visitor: (1) tagline banner + one-line "what it is" + the narrative arc; (2) fork-lineage declaration (trust: honest about being a fork, not affiliated); (3) Install (the call to action, kept high); (4) a compact "what you get" capability overview; (5) a short in-action snippet; (6) telemetry disclosure; (7) license + upstream-alignment footer. Rationale: the narrative earns the name, lineage earns trust, install is reachable without scrolling past a wall of features. The old README buried install under philosophy and badges.

### D2 — Language: English-primary with the bilingual tagline
The README is English-primary (npm/GitHub discovery default) but carries **both** taglines prominently at the top: `Rasen — loops that ascend` and `「不是循环，是螺旋」`. `docs/zh` exists, so a Chinese audience is real — the Chinese tagline is not decoration, it is a fixed user string and is placed in the hero. A full zh README is deferred (non-goal). Alternative (zh-primary) rejected: hurts first-install discovery for the broader npm audience.

### D3 — The spiral narrative is the spine, mapped to real features
Render the fixed arc as the product's mental model, each beat tied to a concrete capability so the metaphor is not empty:
- **spec is the origin** → spec-driven workflow (`/opsx:propose → apply → archive`, the `openspec/` workspace).
- **loops are the form** → the `opsx` pipeline family (small-feature / bug-fix / full-feature / auto-decompose).
- **each turn ascends (harness)** → autonomous iteration: `/opsx:auto` LEAD orchestration, review-cycle, handoff/relay, context sensing.
- **until it breaks through (goal)** → `/opsx:goal` goal-driven iteration (measure / evaluate / research backends, repeat until the gate is met).
Plus the standalone differentiators: chrome-use (drive real Chrome via CDP) and handoff/session-relay. Capability copy is adapted from the accurate descriptions already in the current README's "What this fork adds" section, rebranded — those are correct and vetted, so reuse the substance, not the upstream framing.

### D4 — Preserve the workspace-directory truth
Even though the brand is rasen, the on-disk workspace stays `openspec/` and slash commands stay `opsx:` (rename-core preserve-list). The README must show `rasen init` (the CLI command) creating an `openspec/` workspace and `/opsx:propose` slash commands — do not "correct" these to `rasen/` or `raspx:`. This is the one place brand-consistency and technical-accuracy diverge; get it right so the README doesn't contradict the tool.

### D5 — Drop upstream furniture; repoint what remains to the fork
Remove: OpenSpec logo/dashboard images, `@fission-ai/openspec` npm/downloads/stars/contributors badges, upstream Discord + `@0xTab` social block, the `docs/` link map, and the "most loved spec framework" upstream marketing. Keep and repoint: CI badge → `github.com/DumoeDss/rasen/actions/workflows/ci.yml`; License badge → `./LICENSE`; issue/feedback link → `github.com/DumoeDss/rasen`. A version/npm badge for `rasen` is optional and only correct after publish — omit or mark it aspirational to avoid a broken badge on day one (decision: omit the npm-version badge until published; CI + License badges only).

### D6 — Install reflects the npm-publish direction, honestly
Primary install is `npm i -g rasen`. Node `>=20.19.0`; chrome-use needs Node 22+ and a Chrome started with remote debugging (carry the accurate prerequisite list from the current README). Include the uninstall-upstream note: because rename-core renames the binary to `rasen`, there is no longer a bin collision with upstream `openspec` — so the note is softened to "if you previously installed this fork under the old `openspec` binary, remove it" rather than the old first-installer-wins warning. Keep it truthful to the post-rename reality.

## Risks / Trade-offs

- **README claims outrun the actual publish state** (npm `rasen` not yet published; repo not yet renamed) → the README documents the intended install; the taglines/lineage/capabilities are all true today. Badges that would 404 pre-publish (npm version) are omitted (D5). The publish itself is a portfolio-level external action surfaced at run end.
- **Brand-vs-workspace contradiction** (`rasen` command creating an `openspec/` dir) → D4 makes this explicit so a reviewer doesn't "fix" it into an inconsistency.
- **Capability copy drift from reality** → reuse the already-vetted descriptions from the current README's fork section rather than inventing new claims.
- **Losing useful upstream content by rewriting wholesale** → intentional; the user asked for a from-scratch README and is abandoning `docs/`. The in-action snippet and capability substance are carried over; only upstream branding/furniture is dropped.

## Migration Plan

Single-file replace of `README.md`, local delivery (commit only). Rollback is `git revert`. No runtime or user-data impact.

## Open Questions

None blocking. (npm-version badge inclusion is decided: omit until publish. A future zh-primary README is out of scope.)
