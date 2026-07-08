# Review Report — phase2-rasen-readme

**Reviewer:** reviewer-readme (did not author this change)
**Scope:** `git diff -- README.md` against the change artifacts (proposal.md, design.md, specs/project-readme/spec.md, tasks.md)
**Date:** 2026-07-09
**Diff:** README.md only — 47 insertions, 217 deletions (full rewrite). `git status` confirms no other product file is touched by this change (the other modified files belong to the concurrent rename-core cohort).

## Verdict

**CLEAN** — 0 Blocker, 0 Major, 0 Minor, 1 Trivial.

The README is factually accurate against the post-rename codebase, carries every required content element, and converts a first-time visitor within the first screen. The one Trivial item is a cosmetic link-target nit, not a defect.

## What was verified against the code (all pass)

| Claim in README | Verified against | Result |
|---|---|---|
| `npm i -g rasen` | package.json `name: rasen`, `bin: {rasen: ./bin/rasen.js}` | OK |
| Node `>=20.19.0` | package.json `engines.node` = `>=20.19.0` | OK |
| Uninstall `@fission-ai/openspec` | base package name was `@fission-ai/openspec`, bin `openspec` | OK — correct old package id |
| `RASEN_TELEMETRY=0` / `DO_NOT_TRACK=1` / auto-off in CI | src/telemetry/index.ts:99,104,109 | OK |
| Privacy contract: command + version + anon UUID + OS + Node only | trackCommand payload src/telemetry/index.ts:155-161 sends exactly `{command, version, distinctId, os, node_version}` | OK — verbatim match, nothing else sent |
| `rasen pipeline show\|list\|classify\|resume` | src/cli/index.ts:591-688 (list, show, classify, resume all registered) | OK |
| `rasen agent context` | src/cli/index.ts:698-718 (agent group, `context`) | OK |
| `/opsx:goal` measure/evaluate/research backends | src/core/templates/workflows/goal-*.ts present | OK |
| chrome-use prereqs (Chrome, Node 22+, `chrome://inspect/#remote-debugging`, first-connection Allow popup) | src/core/templates/experts/chrome-use.ts:33-45 | OK — all four match |
| CI badge → `DumoeDss/rasen/actions/workflows/ci.yml` | .github/workflows/ci.yml exists; badge URL correct | OK |
| MIT dual copyright (2024 OpenSpec Contributors + 2026 DumoeDss) | LICENSE:3-4 | OK |
| No stale `DumoeDss/OpenSpec` references | grep over README + .github/workflows = 0 hits | OK |

## Required content (spec: project-readme) — all present

- Both taglines verbatim: `Rasen — loops that ascend` (line 1, em-dash matches spec) and `「不是循环，是螺旋」` (line 3). Grepped as fixed strings, exact match.
- Four-beat narrative — spec is the origin / loops are the form / each turn ascends (harness) / until it breaks through (goal): lines 16-19, each beat tied to a real capability (design D3).
- Fork lineage + not-affiliated + aligned-with-v1.5.0: line 25.
- MIT dual copyright: line 123. Opt-out instructions: lines 111-119.
- D4 asymmetry (CLI `rasen` creates an `openspec/` workspace, slash commands keep `opsx:`) is explained explicitly at line 48 — not left as an apparent contradiction. This is correct and intentional; not flagged.
- Badges: CI + License only, no npm-version badge (design D5) — confirmed absent.
- Upstream furniture absent: no `openspec_bg`, no `@fission-ai/openspec` npm badge, no Discord/`@0xTab`, no shields.io/npm, no `docs/` deep-link map (grep = 0).

## Link integrity

- `./LICENSE` — target exists. OK.
- CI badge + shields.io License badge — well-formed URLs. OK.
- External links (`github.com/Fission-AI/OpenSpec`, `github.com/DumoeDss/rasen`) — well-formed.

## Quality / first-screen conversion

Strong. The hero delivers the bilingual tagline, a one-line "what it is" (line 10), and the spiral narrative before the fold; lineage (trust) precedes Install (call to action). No claim overpromises versus the actual product — the autonomy, goal-loop, and chrome-use claims all map to shipped code verified above.

## Findings

### [Trivial] README.md:25 — maintainer link points at the repo, not the profile
`independently maintained by [DumoeDss](https://github.com/DumoeDss/rasen)` — the anchor text reads as the maintainer (a person/org) but the href targets the repository `DumoeDss/rasen` rather than the profile `github.com/DumoeDss`. Cosmetic; both URLs are valid. Optional: point it at `https://github.com/DumoeDss` for the maintainer, or leave as-is since the repo is the project home.

## Notes (not defects — verified as intentional per context)

- The `rasen` CLI creating an `openspec/` workspace and `opsx:` slash commands is the fixed D4 asymmetry; the README explains it (line 48). Verified as correct, NOT reported.
- The uninstall command targets `@fission-ai/openspec` because that was the fork's base package/bin id; correct even though the fork was never published (a local-tgz install still registers under that package name).
