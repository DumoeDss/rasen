# Design: Zed runtime support for `rasen agent audit`

References: `proposal.md` (motivation), `specs/cli-agent-audit/spec.md` and `specs/workflow-audit-command/spec.md` (requirements). Prior art: `local_docs/audit/` (an older-version bash proof of concept — reusable as reference, not as the shipped design).

## Context

`rasen agent audit` (engine in `src/core/token-audit/`, wired through `src/commands/agent.ts` and `src/cli/index.ts`) supports two runtimes today, dispatched by `resolveRuntimeKind` in `audit.ts`:

- **Claude** — reads `*.jsonl` transcripts + a `subagents/` directory; produces `ClaudeAuditResult`.
- **Codex** — reads `rollout-*.jsonl` files + a BFS thread family; produces `CodexAuditResult`.

Both share the schema tag `rasen-token-audit/2` and are rendered by the single shipped `viewer/audit.html`, which dispatches on `session.runtime`. `TranscriptKind = 'claude' | 'codex'` and two `validateRuntime*` guards gate the `--runtime` flag (one in `agent-context.ts`, one in `token-audit/audit.ts`).

Zed stores agent sessions in a local SQLite database (macOS: `~/Library/Application Support/Zed/threads/threads.db`). The `threads` table columns are `id, summary, updated_at, data_type, data (BLOB), parent_id, folder_paths, folder_paths_order, created_at`; `data` is a zstd-compressed JSON payload (`data_type = 'zstd'`) carrying `cumulative_token_usage {input_tokens, output_tokens, cache_read_input_tokens}`, `request_token_usage`, `messages[]` (first user command at `messages[0].User.content`), `model`, and a schema `version`. Descendant (subagent) threads are linked by `parent_id`.

Constraints: TypeScript ESM; Node `>=20.19.0` (below `node:sqlite` at 22.5 and zlib-zstd at 22.15); Windows is in the CI matrix; the reference script's external-tool approach (`sqlite3`/`zstd`/`jq`) is rejected for the shipped path. Two product decisions are already locked by the user: **pure-JS dependencies** for SQLite + zstd, and a **first-class `runtime: "zed"`** report (not the reference's `runtime: "codex"` impersonation).

## Goals / Non-Goals

**Goals:**
- Audit a Zed thread and its descendant threads via `rasen agent audit --runtime zed`, fully local, no external tools.
- Identify a Zed session two ways: by thread id (prefix) or by the session's first command.
- Produce a first-class `runtime: "zed"` report that honestly presents only what Zed stores (uncached input, cached input, output, cache-effectiveness) with one aggregate entry per thread, plus the extra Zed signals (title, working directory, model, first command), and explicit caveats for the rest.
- Render the Zed report in `viewer/audit.html`.
- Upgrade the `rasen-audit` skill to cover Zed identification and interpretation.
- Keep the existing Claude/Codex reports and schema unchanged (purely additive).

**Non-Goals:**
- Reconstructing a per-request or per-turn Zed timeline, churn/rebuild attribution, billed-input-equivalent pricing, or reasoning-output/cache-write totals — Zed does not retain the data.
- Including Claude/Codex processes launched by Zed as external tools (not linked in `threads.db`; audit those separately with their own runtime).
- A "most recent Zed session" (`--latest`) shortcut — out of scope; the two required identification modes are id and first command.
- Writing to or migrating Zed's database (read-only).

## Decisions

### D1. Data access: pure-JS zstd + WASM SQLite (no external tools)
- **zstd decode:** `fzstd` — pure-JS, MIT, decompress-only, tiny, no native build. We only ever decompress, so a decoder-only library is the right surface.
- **SQLite read:** a pure-JS/WASM reader with a synchronous, file-path API. Primary candidate `node-sqlite3-wasm` (MIT, better-sqlite3-like, synchronous, no node-gyp); documented fallback `sql.js` (MIT, mature, loads the file into memory). The exact package + version is finalized in the first implementation task against: commercial-friendly license (MIT/Apache-2.0), maintenance, ESM/Node-20 compatibility, and — critically — that its WASM asset resolves correctly from an installed npm package (see Risks). Native `better-sqlite3` is rejected (node-gyp install friction for an npm-distributed CLI).
- Adding deps requires regenerating the Nix hash (`bash scripts/update-flake.sh`, CI-validated) and updating `pnpm-lock.yaml`.
- *Alternatives considered:* shell out to `sqlite3`/`zstd` (rejected — external tools, Windows-fragile); bump Node to 22.5+ for `node:sqlite`/zlib-zstd (rejected — disruptive to the support matrix); hand-parse the SQLite file format (rejected — high effort, brittle).

### D2. First-class `ZedAuditResult` (new `runtime: "zed"`)
Add to `types.ts`, keeping schema `rasen-token-audit/2` (additive; viewer dispatches on `session.runtime`):

```ts
type Runtime = 'claude' | 'codex' | 'zed';
interface ZedRawTokens { inputTokens: number; cachedInputTokens: number; outputTokens: number; } // Zed-honest subset
interface ZedThreadRecord {
  index: number; threadId: string; parentThreadId: string | null;
  kind: 'main' | 'subagent'; title: string | null;
  workingDir?: string | null; model?: string | null; firstUserCommand?: string | null;
  firstTs: number | null; lastTs: number | null;
  retainedRequests: number;               // retained request_token_usage entries (NOT a complete API count)
  rawTokens: ZedRawTokens; cacheHitRatio: number;
}
interface ZedAuditResult {
  schema: 'rasen-token-audit/2'; generatedAt: string;
  session: { id: string; runtime: 'zed'; mainTranscript: string; /* = db path */
    title?: string | null; workingDir?: string | null; firstUserCommand?: string | null;
    start: number | null; end: number | null; durationMs: number | null; agentCount: number; };
  totals: { retainedRequests: number; rawTokens: ZedRawTokens; cacheHitRatio: number; };
  threads: ZedThreadRecord[];
  source: { dataVersion: string | null; adapter: 'zed-threads-db' };
  caveats: string[];
}
```

- `session.mainTranscript` holds the resolved database path so shared code (summary line, viewer header) needs minimal special-casing.
- Extend `AuditResult` union and add an `isZedAuditResult` type guard beside `isCodexAuditResult` (the discriminant is nested under `session.runtime`, so a guard is required for narrowing).
- Token mapping (honest, differs from the reference's codex-compat fold): `inputTokens = input_tokens` (uncached), `cachedInputTokens = cache_read_input_tokens`, `outputTokens = output_tokens`, `cacheHitRatio = cachedInputTokens / (inputTokens + cachedInputTokens)`. Reasoning-output and cache-write are simply **absent** from the zed shape (not zero-valued fields), so no field can be misread as observed zero; the caveats state they are unavailable.
- Deliberately omit Codex/Claude-only structures: `pricing`, `billedInputEq`, `churn`, per-request `requests` timeline, `rebuildEvents`, `unsupportedDimensions`.

### D3. Runtime selection
- Extend `TranscriptKind` to `'claude' | 'codex' | 'zed'`; both `validateRuntime` (agent-context.ts) and `validateRuntimeOption` (audit.ts) accept `'zed'`; update the `--runtime` help text in `src/cli/index.ts` (two option declarations) from "claude or codex" to include zed.
- In `resolveRuntimeKind`: `--runtime zed` wins outright. A bare id with no `--runtime` still defaults to Claude (unchanged). Optionally (small add), a target path whose basename is `threads.db` or ends in `.db`/`.sqlite` detects as zed, so `rasen agent audit <path/to/threads.db>` works without the flag — see Open Questions.
- `runAudit` dispatches to a new `runZedAudit` for `kind === 'zed'`.

### D4. Zed session identification (id or first command)
- **By id:** positional `<sessionId>` under `--runtime zed` is a thread id; resolve against `threads.id` (exact, else unique prefix; ambiguous prefix errors like the Claude path).
- **By first command:** a `--match <text>` option supplies the first-command target. The resolver decodes each candidate thread's payload, reads `messages[0].User.content`, and matches case-insensitively on normalized whitespace as a substring. Exactly one match → audit it; more than one → exit non-zero listing candidates (id, title, start time); zero → not-found error. `--match` and a positional id are mutually exclusive.
- *Alternatives considered:* overload the positional to sniff UUID-vs-text (rejected — ambiguous, less testable); a dedicated `rasen agent audit zed find` subcommand (rejected — heavier surface than the ask).

### D5. Family discovery (descendants)
Run a parameterized recursive CTE against `threads` (root + transitive children via `parent_id`), binding the resolved root id as a **parameter** (the WASM driver supports bound params — no string interpolation, unlike the reference script which validated a hex UUID then interpolated). Select `id, summary, created_at, updated_at, data_type, parent_id, folder_paths`. Order by `created_at, id`. The root becomes `kind: 'main'`; the rest `subagent`. Activation ordering (sort by `firstTs`) mirrors the Claude/Codex builders.

### D6. Payload decode and field extraction
Per thread: read `data` BLOB → branch on `data_type` (`'zstd'` → `fzstd` decompress; `'json'` → use as-is; anything else → `TranscriptFormatError`, fail-soft) → UTF-8 → `JSON.parse`. Extract:
- totals from `cumulative_token_usage`;
- `retainedRequests` = count of `request_token_usage` entries (disclosed as retained-entry, undercounts after compaction);
- `firstUserCommand` from `messages[0].User.content`;
- `model` from payload `model`; `dataVersion` from payload `version`;
- `workingDir` from the `folder_paths` column (JSON array → primary path). This resolves the "other useful columns" investigation: `folder_paths` yields the working directory, and the decoded payload yields model/version/first-command/title. Any field whose expected shape is absent is omitted, not guessed.

### D7. Errors and fail-soft
- Unrecognized `data_type` or payload shape → `TranscriptFormatError` (reused; `agent.ts`'s existing catch already renders the friendly experimental-format message and the `--json` `{available:false, reason:'format-drift'}` object).
- Missing database, thread not found, ambiguous prefix/first-command match → plain `Error` (surfaces via the CLI's generic catch at exit 1), matching the Codex "no rollout matching" and "ambiguous prefix" patterns.

### D8. Viewer
Add a `zed` branch to `viewer/audit.html`'s runtime dispatch: session header (title, working dir, model, first command, db path), totals (uncached / cached / output, cache-hit ratio), a per-thread table (title, model, tokens, ratio, retained requests, parent link), and a prominent limits/caveats panel. Intentionally simpler than the Codex view — no request-timeline or burst charts, because Zed has no per-request data. The viewer already tolerates absent fields, so Claude/Codex rendering is untouched.

### D9. Skill upgrade (`rasen-audit`)
Edit `AUDIT_INSTRUCTIONS` and the `description` in `src/core/templates/workflows/audit.ts` (the source of truth; `.claude/skills/rasen-audit/SKILL.md` is generated): add a Zed branch to Identify / Run / Interpret, the `--runtime zed` + `--match` usage, Zed's honest vocabulary and limits, and the experimental disclosure. Bump `metadata.version` (`"1.0"` → `"1.1"`). Regenerate via `rasen update`. Any user-facing strings that live in `src/locales/{en,ja,zh-cn}.json` (CLI `--runtime` help, error copy) must be added to all three catalogs to satisfy `test/locales/catalog.test.ts` parity.

### D10. Cross-platform database path
Resolve a per-OS default with `path.join`/`os.homedir` and env (`XDG_DATA_HOME`/`LOCALAPPDATA`), overridable via `--db <path>`:
- macOS: `~/Library/Application Support/Zed/threads/threads.db` (confirmed from reference).
- Linux: `${XDG_DATA_HOME:-~/.local/share}/zed/threads/threads.db` — verify at apply.
- Windows: under `%LOCALAPPDATA%\Zed\...` — verify at apply; may be override-only initially (Zed Windows is preview).

## Risks / Trade-offs

- **Zed internal-format drift** (schema `0.3.0` observed) → fail-soft on unrecognized `data_type`/payload; explicit caveats; experimental disclosure in help + skill. Never silently guess.
- **WASM asset packaging in the published CLI** → the SQLite WASM ships inside its npm dependency (not our `files` list), but ESM + Node-20 WASM loading from an installed package must be verified end-to-end with a packed install (`rasen-npm-pack`) before relying on it. This is the highest-risk item.
- **Loading the DB / full-scan decode for `--match`** → `threads.db` is modest and this is a local one-shot; acceptable. If it becomes slow, `created_at` windowing can bound the scan (future). Documented, not silently capped.
- **Linux/Windows Zed path uncertainty** → `--db` override always works; verify the OS defaults; keep Windows override-only if unconfirmed.
- **Retained-request undercount after compaction** → disclosed as a caveat; the count is labeled a retained-entry count, never "API requests".
- **Two `validateRuntime*` copies drifting** → update both in the same task; a test asserts `--runtime zed` is accepted on both seams.
- **Nix flake hash** → regenerate with `scripts/update-flake.sh`; CI validates the flake.

## Migration Plan

Purely additive — no breaking change. Existing Claude/Codex reports and the `rasen-token-audit/2` schema are unchanged; older reports still render. Rollback = revert the change and remove the two dependencies.

Rollout order (see `tasks.md`): add + finalize deps → Zed core modules (db read, decode, discovery, report build) → `types.ts` + dispatch + runtime guards → CLI flags/help + summary line → viewer branch → skill template + regenerate → tests (unit + e2e + parity + locales + golden hashes) → `update-flake.sh` → docs → packed-install verification.

## Open Questions

- Final WASM SQLite package + version (`node-sqlite3-wasm` vs `sql.js`) — decided in the first implementation task against the D1 criteria and a packed-install smoke test.
- Confirmed Zed database paths on Linux and Windows.
- `--match` semantics — proposed case-insensitive, whitespace-normalized substring on `messages[0].User.content`; confirm exactness (substring vs full-match) during implementation.
- Flag spellings: `--match <text>` (first command) and `--db <path>` (database override) — confirm no collision with existing `agent audit` options at apply.
- Whether to auto-detect a `threads.db`/`.db`/`.sqlite` path as the zed runtime without `--runtime zed` (D3) — low-cost nice-to-have; include only if it stays trivial.
