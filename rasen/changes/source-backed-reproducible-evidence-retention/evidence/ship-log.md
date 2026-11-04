# Ship Log: source-backed-reproducible-evidence-retention

**Date:** 2026-10-29T18:02:45Z
**Mode:** pr
**Branch:** change/source-backed-reproducible-evidence-retention
**Commit:** 93897d3b8c8f7d8db25118d18035acd65869ebfe
**Tree:** 6da8ae62ad42181938625878ed0c38ffddd8d1df
**Base:** dev/0.1.8
**PR:** https://github.com/DumoeDss/rasen/pull/191
**Status:** PR Created

Delivery: pushed the topic branch to `origin` (`pashifika/rasen`), then created the open, non-draft PR against `upstream` (`DumoeDss/rasen`). Fresh fetch and merge of `upstream/dev/0.1.8` reported already up to date at `f0ae20d19a30c265ad3f3ffaaa5bb3cd148d12dd`.

## Pre-Flight Results

- Verification: CLEAN — Blocker:0 Major:0 Minor:0 Trivial:2, both Trivial findings accepted-known.
- Tasks: 17/17 complete; 15 active requirements and 49 scenarios assessed.
- Review: three bounded rounds; fixes and explicit delta-retirement encoding independently confirmed. See `review-cycle-report.md`.
- No selected ship log existed before delivery; no reserved heading was present or authored.
- Unrelated unstaged changes to `.claude/skills/rasen-npm-pack/scripts/pack-dev-local.mjs` and `rasen/config.yaml` were preserved and excluded from delivery. `local_docs/` remains an independent repository.

## Test Gate

Fresh local gates passed on macOS arm64, Node `v24.18.0`: build, TypeScript, lint, 17 Vitest files / 140 tests, and strict Change validation. The delivered source matches the tested tree; the unrelated unstaged paths above are not part of that content fingerprint. This ship log is documentation-only delivery bookkeeping.

TEST EVIDENCE
- scope: generation/installation, template composition, file placement, archive consumers, source-byte hygiene, TypeScript, lint, strict Change validation
- rationale: shared generated guidance and delivery contracts changed; archive engine/parser, dependencies, CI, and runtime persistence did not
- command: `pnpm run build && pnpm exec tsc --noEmit && pnpm lint && env -u ZSH pnpm exec vitest run test/core/templates test/core/shared/skill-generation.test.ts test/core/shared/skill-sidecar-install.test.ts test/core/workflow-generation-integration.test.ts test/core/file-placement.test.ts test/core/workflow-chain.test.ts test/core/archive-consumer-integration.test.ts test/source-byte-hygiene.test.ts && env RASEN_LANG=en RASEN_TELEMETRY=0 node bin/rasen.js validate source-backed-reproducible-evidence-retention --strict`
- result: pass
- tree: 6da8ae62ad42181938625878ed0c38ffddd8d1df

Actual isolated CLI and synthetic retention observations are recorded once in `verification-report.md`. Their disposable files were removed. No browser performance result or automatic recipe execution is claimed.

The earlier CI run and macOS hosted-runner cancellations are recorded in that report and the PR body. Those results belong to the earlier commit, not this tested tree. Final PR CI completion is unobserved; this delivery does not claim all CI green.

## Deployment

Status: Not requested. Merge is unobserved and unconfirmed. No merge, approval, or auto-merge action was performed.

## Lifecycle

The Change remains active under `on-merge` timing. Retention is a handoff only: `rasen-retain source-backed-reproducible-evidence-retention`. Merge approval, canonical-spec synchronization, and any later archive action remain with the upstream owner. No archive command or live MadoPilot mutation was performed in this delivery.
