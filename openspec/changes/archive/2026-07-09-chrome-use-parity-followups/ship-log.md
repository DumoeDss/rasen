# Ship Log: chrome-use-parity-followups

**Date:** 2026-07-09
**Mode:** local
**Branch:** dev-harness
**Commit:** 38f9d7d7121fb58f9706365a378ab6251d200701
**Tree:** 0aecb31dcf3466b030395a89ba794fb4ecf744d6
**Status:** Committed (delivery deferred to portfolio level — no push, no PR, no tag)

## Pre-Flight Results
- Verification: pass (review-report.md present; reviewer-parity verdict APPROVE, zero open findings)
- Tasks: 25/25 complete

## Test Gate
- Tests: ran green — fresh full run against the current tree (0aecb31).
  - `node --check skills/experts/chrome-use/scripts/cdp-proxy.mjs` OK
  - vitest trio 44/44: skill-generation 37 / skill-templates-parity 6 / skill-sidecar-install 1
- Why re-run rather than cite prior evidence: reviewer-parity's independent full
  gate (pnpm build OK, vitest trio 44/44, node --check OK, openspec validate valid,
  live probes for bare-await /eval and /perf visibility + activate=true fp/fcp/lcp;
  verdict APPROVE) was recorded BEFORE the LEAD's LCP-observer-leak fix. That fix
  (non-author LEAD, delta-re-reviewed RESOLVED by the original reviewer) touches only
  the in-page JS string of /perf and changed the tracked tree, so the recorded green
  evidence no longer fingerprint-matched the current tree. Per the fresh-verification
  gate, re-ran the fast template-parity trio (not the flaky CLI-spawning suite) to
  produce green evidence matching tree 0aecb31. node --check re-verified the proxy
  JS-string change; the reviewer's delta read had already re-confirmed behavior.

## Staging
Staged EXPLICITLY and ONLY (no `git add -A`):
- skills/experts/chrome-use/scripts/cdp-proxy.mjs
- skills/experts/chrome-use/references/cdp-api.md
- src/core/templates/experts/_shared.ts
- src/core/templates/experts/chrome-use.ts
- test/core/templates/skill-templates-parity.test.ts
- openspec/changes/chrome-use-parity-followups/ (proposal, design, specs, tasks,
  planning-context, review-report, README, .openspec.yaml)

Kept out: auto-run.json (git-ignored, not force-added), openspec/handoff/ and
openspec/office-hours/ untracked files.

## Delivery
Local mode — nothing pushed. Delivery deferred to the portfolio/parent level.
