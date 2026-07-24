## 1. Dependencies

- [x] 1.1 Finalize the WASM SQLite package (`node-sqlite3-wasm` vs `sql.js`) against the D1 criteria — MIT/Apache-2.0 license, maintained, ESM + Node-20 compatible, WASM asset resolvable from an installed npm package — and record the choice in `design.md` Open Questions. → chose `node-sqlite3-wasm` (MIT, sync, bundled wasm, Uint8Array BLOBs) + `fzstd` (MIT); verified by round-trip smoke test.
- [x] 1.2 Add the chosen SQLite reader and `fzstd` to `package.json` dependencies; run `pnpm install` and commit the updated `pnpm-lock.yaml`.
- [ ] 1.3 Regenerate the Nix hash with `bash scripts/update-flake.sh` and confirm the flake validates (CI parity). → BLOCKED: `nix` is not installed on this machine; must be run on a nix-equipped machine or in CI before release.
- [x] 1.4 Confirm the WASM asset loads under ESM/Node from `node_modules` in a throwaway script (dev smoke) before building on it.

## 2. Zed database read and payload decode

- [x] 2.1 Create `src/core/token-audit/zed/database.ts`: open the SQLite database read-only via the WASM reader, and run a parameterized recursive CTE (root + transitive `parent_id` children). Bind the root id as a parameter — no string interpolation.
- [x] 2.2 Add a thread-id prefix resolver against `threads.id` (exact, else unique prefix; ambiguous → error naming matches).
- [x] 2.3 Create `src/core/token-audit/zed/decode.ts`: read the `data` BLOB, branch on `data_type` (`zstd` → `fzstd`; `json` → as-is; else → `TranscriptFormatError`), UTF-8 decode, `JSON.parse`.
- [x] 2.4 Extract per-thread fields: `cumulative_token_usage` totals, retained `request_token_usage` count, first command, `model`, `version`, and `workingDir` from `folder_paths`; omit (never guess) any absent field.

## 3. Zed report build

- [x] 3.1 Add `ZedRawTokens`, `ZedThreadRecord`, `ZedAuditResult`, the `'zed'` runtime literal, the extended `AuditResult` union, and `isZedAuditResult` to `types.ts`.
- [x] 3.2 Add `runZedAudit(...)` to `audit.ts`: resolve db path, discover the family, decode each thread, map tokens honestly, one aggregate entry per thread, activation-order sort, totals, and `session` header.
- [x] 3.3 Populate `caveats` disclosing the Zed data limits (no reasoning/cache-write; retained-entry counts; descendant-only scope; experimental format).
- [x] 3.4 Reuse the existing `writeReport`/default-`analytics` output path and `--out` handling.

## 4. Session identification (first command)

- [x] 4.1 Implement the `--match <text>` first-command resolver: case-insensitive whitespace-normalized substring; 1 → audit, >1 → error listing id/title/start, 0 → not-found; skip undecodable rows during the scan.
- [x] 4.2 Enforce that a positional id and `--match` are mutually exclusive, with a usage error when both or neither is supplied under `--runtime zed`.

## 5. Runtime dispatch and guards

- [x] 5.1 Add the `zed` runtime to the audit runtime guard. → Refinement: introduced a local `AuditRuntime = TranscriptKind | 'zed'` in `audit.ts` rather than widening `agent-context.ts`'s `TranscriptKind`, because `agent context` has no Zed transcript to probe and must NOT accept `--runtime zed`.
- [x] 5.2 In `resolveRuntimeKind`/`runAudit`, dispatch `kind === 'zed'` to `runZedAudit`; keep bare-id-defaults-to-Claude; detect a `threads.db`/`.db`/`.sqlite` path as zed.

## 6. CLI wiring

- [x] 6.1 Add `--runtime zed`, `--match <text>`, and `--db <path>` to the `audit` command (positional made optional); resolve the per-OS default Zed db path, overridable by `--db`.
- [x] 6.2 Update the `--runtime` help text to include `zed` and state Zed support is experimental.
- [x] 6.3 Add a `zed` branch to `summarizeAuditResult` in `agent.ts`.

## 7. Viewer

- [x] 7.1 Add a `runtime: "zed"` dispatch branch to `viewer/audit.html`: header, totals, per-thread table, and a prominent limits/caveats panel; Claude/Codex rendering unchanged.

## 8. Skill upgrade

- [x] 8.1 Update `AUDIT_INSTRUCTIONS` and the skill `description` in `src/core/templates/workflows/audit.ts`; bump `metadata.version` to `"1.1"`.
- [x] 8.2 Regenerate the skill (`pnpm build` + `rasen update`) and confirm `.claude/skills/rasen-audit/SKILL.md` reflects the Zed guidance and version stamp (dogfooding copy; `.claude/` is gitignored — the tracked deliverable is the template).

## 9. Tests

- [x] 9.1 `test/core/token-audit/zed/database.test.ts` (+ `test/helpers/zed-db.ts`): db read, recursive-CTE family discovery, prefix resolution, BLOB read, per-OS default path.
- [x] 9.2 `test/core/token-audit/zed/audit.test.ts`: honest token mapping, per-thread aggregate entries, cache-hit ratio, caveats, `runtime:"zed"`, output path.
- [x] 9.3 Identification tests (in `audit.test.ts`): id prefix, `--match` unique/ambiguous/not-found, mutual exclusivity, `--match`/`--db` require zed.
- [x] 9.4 CLI e2e (`test/cli-e2e/agent-audit.test.ts`): `--runtime zed` by id and `--match`, `--out`, `--json`, friendly fail-soft on absent db, help lists zed.
- [x] 9.5 Viewer test (`test/core/token-audit/zed/viewer.test.ts`): static assertions guard the zed dispatch, totals, and limits panel (matches the repo's no-jsdom convention; Claude/Codex unaffected).
- [x] 9.6 Confirmed workflow template-parity, digest, and rasen-help/builtins tests still pass — the audit skill body is not hashed into a golden fixture, so no refresh was needed.

## 10. Cross-cutting finalization

- [x] 10.1 Verified no new user-facing strings needed the locale catalogs (`--runtime` help/errors are inline; the locale `audit` entry is runtime-neutral; `invalidRuntime` is pipeline-role scoped). `catalog.test.ts` and `vocabulary-sweep.test.ts` pass.
- [x] 10.2 Verified no `docs/` page references the `agent audit` command, so there is nothing to sync; `local_docs/audit/` is superseded by the shipped runtime.
- [ ] 10.3 Full gate: `pnpm lint` ✓, `pnpm exec tsc --noEmit` ✓, `pnpm test` (running). Packed-install `.tgz` smoke (`rasen-npm-pack`) NOT yet run — packaging is verified by proxy (the CLI e2e drives the built `dist` CLI resolving `node-sqlite3-wasm`/`fzstd` from `node_modules`); a true `.tgz` install remains a recommended pre-release check.
- [x] 10.4 Per-OS Zed db path resolution implemented with cross-platform coverage (macOS confirmed; Linux XDG / Windows LOCALAPPDATA best-effort with `--db` override, per design).
