# Verification Report: rasen-audit-zed-support

Schema: spec-driven · Verified against proposal / delta specs (`cli-agent-audit`, `workflow-audit-command`) / design / tasks.

## Summary

| Dimension    | Status |
|--------------|--------|
| Completeness | 31/32 tasks complete (1 optional pre-release check outstanding); 7/7 delta requirements implemented |
| Correctness  | 7/7 requirements mapped to implementation + tests; all scenarios covered |
| Coherence    | Follows design D1–D10; 1 spec/impl divergence found and reconciled during verification |

## VERIFY VERDICT: CLEAN — Blocker:0 Major:0 Minor:3 Trivial:0

No Blocker and no Major open → **CLEAN**. Ready for archive; the Minor items below are optional/by-convention and do not block.

## Requirement → implementation → test mapping (Correctness / Completeness)

**cli-agent-audit (ADDED):**
1. Zed runtime support — `src/core/token-audit/audit.ts` (`runZedAudit`, `resolveRuntimeKind`, `validateRuntimeOption`), `zed/database.ts` (`queryThreadFamily`). Tests: `zed/audit.test.ts`, `zed/database.test.ts`, `cli-e2e/agent-audit.test.ts`.
2. Zed session identification by id or first command — `audit.ts` (`resolveZedRootId`, `resolveZedRootByFirstCommand`), `database.ts` (`resolveThreadIdsByPrefix`). Tests: `zed/audit.test.ts` (prefix, `--match` unique/ambiguous/not-found, mutual exclusivity), e2e (`--match`).
3. Zed report presents Zed-appropriate accounting — `types.ts` (`ZedAuditResult`/`ZedThreadRecord`), `audit.ts` build. Tests: `zed/audit.test.ts` (runtime `zed`, honest rawTokens keys, ratio, aggregate entries, title/workingDir/model/first command).
4. Zed data limits disclosed — `audit.ts` (`ZED_CAVEATS`), `zed/decode.ts` (`TranscriptFormatError`), CLI help. Tests: `zed/audit.test.ts` (caveats, fail-soft), `zed/decode.test.ts` (unrecognized `data_type`/non-JSON/missing usage), e2e (help/experimental, absent-db).
5. Zed database access local & cross-platform — `zed/database.ts` (`resolveDefaultZedDbPath`, `openZedDatabase`) + pure-JS deps. Tests: `zed/database.test.ts` (macOS/Linux/Windows path resolution), e2e (`--db`).
6. Zed report rendering in the viewer — `viewer/audit.html` (`renderZed` + dispatch). Tests: `zed/viewer.test.ts` (static wiring/limits assertions).

**workflow-audit-command (ADDED):**
1. Audit skill covers the Zed runtime — `src/core/templates/workflows/audit.ts` (instructions + description + version 1.1). Verified via regeneration (`rasen update`) and `skill-templates-parity.test.ts`.

## Findings

### Resolved during verification (was Major)
- **coherence / spec-impl divergence** — `specs/cli-agent-audit/spec.md`: the "Zed data limits" requirement said reasoning-output/cache-write are "presented as compatibility zeros," but `ZedRawTokens` (`src/core/token-audit/types.ts`) omits those fields entirely (design D2; enforced by `zed/audit.test.ts` asserting `rawTokens` keys are exactly `inputTokens`/`cachedInputTokens`/`outputTokens`). Reconciled the requirement + scenario to the omit-fields behavior that ships (commit `b127056a`). No longer open.

### Minor (non-blocking)
- **test-coverage** — Task 10.3's `.tgz` packed-install smoke (`rasen-npm-pack`) was not run. Packaging is otherwise validated by a clean isolated `nix build` + `nix flake check` (both pass) that resolve `node-sqlite3-wasm`/`fzstd` (incl. the WASM asset), and by the CLI e2e driving the built `dist` against real `node_modules`. Recommendation: run `rasen-npm-pack` as an optional pre-release check.
- **test-coverage** — `viewer/audit.html`'s Zed branch is guarded by static string assertions (`zed/viewer.test.ts`), not a DOM/jsdom render test. This matches the repo convention (the Codex viewer path is likewise not DOM-tested). Recommendation: none required; revisit if a jsdom viewer harness is later added.
- **test-coverage** — The `rasen-audit` skill's Zed guidance is verified via template regeneration + parity, with no dedicated test asserting the Zed prose. This matches how skill bodies are handled repo-wide. Recommendation: none required.

## Final assessment

No critical issues. The one Major divergence was reconciled during verification. Three Minor, by-convention/optional items remain. **Ready for archive.**

Note (out of scope): the full `pnpm test` run has one PRE-EXISTING failure unrelated to this change — `test/specs/source-specs-normalization.test.ts` flags archive-placeholder Purpose text in `rasen/specs/profiles-ui` and `rasen/specs/profile-http-api` (from commit `d9fa24ac`). This branch makes zero `rasen/specs/` changes; it is not a regression of this change.

## TEST EVIDENCE
- command: `pnpm exec vitest run test/core/token-audit test/cli-e2e/agent-audit.test.ts test/core/completions/command-registry.test.ts test/locales/catalog.test.ts test/vocabulary-sweep.test.ts` (plus `pnpm lint`, `pnpm exec tsc --noEmit`, `nix build`, `nix flake check`)
- result: pass
- tree: 3ef76aeff28a41c0901ecf5f42a1a6b4f1b384fb
