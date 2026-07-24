/**
 * Audit Rasen Workflow Command
 *
 * Guidance layer for `rasen agent audit` (workflow-audit-command spec):
 * helps a user find the session id to audit, runs the command, offers to
 * open the viewer, and helps interpret the report — on both the Claude and
 * Codex runtimes. Diagnostic/optional: registered in BUILT_IN_WORKFLOW_IDS
 * (full profile) but NOT in CORE_WORKFLOW_IDS.
 */
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const AUDIT_INSTRUCTIONS = `Guide the user to a token-spend report for one of their own sessions, using \`rasen agent audit\`. **Experimental**: this command parses Claude Code's, Codex CLI's, or Zed's internal, undocumented session-log/database format — a harness or Zed update can make parsing fail without warning. Say so up front, don't bury it.

Local, pull-model, zero-upload: the user runs the command, the report lands on their own machine under \`~/.rasen/analytics/\` (or wherever \`--out\` points), and nothing is sent anywhere.

${STORE_SELECTION_GUIDANCE} \`rasen agent audit\` is one of those store/project-agnostic commands, same as \`rasen agent context\` — it never takes \`--store\`/\`--project\`; it resolves purely against a session id, a transcript path, (for Codex) \`--runtime codex\` plus a thread id, or (for Zed) \`--runtime zed\` plus a thread id or \`--match <text>\`.

## 1. Identify the session

If the user already gave a session id or a transcript/rollout path, skip to step 2.

Otherwise, help them find one:
- **Current or most recent Claude Code session for this project**: the project's Claude transcripts directory is derived from the cwd (same slugging \`agent context\` uses); the newest \`*.jsonl\` file there (excluding \`agent-*.jsonl\` subagent files) is the one to audit. \`rasen agent context --latest --json\` will report on that same transcript and print its path if you need to confirm which file that is.
- **A Codex CLI session**: if the user mentions Codex, or the current tool is Codex, route to \`--runtime codex\` (see step 2) — Codex rollouts live under \`~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl\` (or \`CODEX_HOME\`), keyed by thread id rather than a Claude session id.
- **A Zed session**: if the user ran the session through Zed's agent panel, route to \`--runtime zed\` (see step 2). Zed sessions live in a local \`threads.db\` (SQLite), keyed by a thread id. The user can identify one **two ways**: by thread id (a prefix is enough), or by their **first command** with \`--match "<text>"\` (a case-insensitive substring of the session's first user message). If \`--match\` matches more than one thread, the command lists the candidates — relay them and ask which one.
- If genuinely unsure which runtime or session, ask the user rather than guessing — a wrong \`--runtime\` guess just produces a resolution error, but confirming first is faster.

## 2. Run the audit

\`\`\`bash
rasen agent audit <sessionId|path>                       # Claude session (default runtime)
rasen agent audit <threadId|path/to/rollout.jsonl> --runtime codex   # Codex session
rasen agent audit <threadId> --runtime zed               # Zed session by thread id
rasen agent audit --runtime zed --match "<first command>"  # Zed session by first command
\`\`\`

Useful flags: \`--projects-dir <dir>\` (override the Claude projects directory a bare id resolves against), \`--out <path>\` (write the report somewhere other than the default \`analytics\` directory), \`--json\` (machine-readable output), \`--open\` (open the shipped viewer pre-loaded with the report — offer this every time; it's the fastest way to actually look at the result). Zed-only: \`--match <text>\` (resolve by first command instead of a thread id) and \`--db <path>\` (override Zed's \`threads.db\` location; the per-OS default is used otherwise).

On success, the command prints the report's file path and a one-line totals summary — relay both to the user.

## 3. Interpreting the report

**Claude report** — talk in these terms:
- **Billed input equivalent**: \`raw input + cache-write × TTL-coefficient + cache-read × 0.1\` — the main session's cache writes cost 2× (1h TTL), a subagent's cost 1.25× (5m TTL). This is what actually drove the bill, not raw token counts.
- **Churn**: cache rewrites, broken down by cause — \`ttl-expiry\` (idle past the tier's TTL), \`rebase\` (a forked conversation branch or an injected message, e.g. SendMessage), \`context-drop\` (compaction/rewind shrank the context), \`unattributed\` (none of those fingerprints matched). This is usually where the "why did this cost so much" answer lives — point the user at whichever cause dominates.
- **Resumes HIT/MISS**: how many request bursts continued warm vs. paid a rewrite.

**Codex report** — different vocabulary, do NOT use Claude's terms here (no billed-input-equivalent, no churn-cause taxonomy — Codex's cache/pricing model has neither):
- **Raw token totals**: input, cached input, output, reasoning output, per agent/turn.
- **Cache hit ratio**: \`cachedInputTokens / inputTokens\` — the health signal Codex offers in place of churn-cause attribution.
- Turns are grouped by \`task_started\`/\`task_complete\` boundaries, tokens attributed by the change in Codex's cumulative usage counter (not by summing every stream update, which would overcount).

**Zed report** — talk in Zed's own honest terms, and lead with its limits (they're in the report's \`caveats\` and the viewer's "Zed data limits" panel — don't let the user over-read the numbers):
- **Stored totals**: uncached input, cached input, and output tokens, per thread and in total. That's all Zed records.
- **Cache hit ratio**: \`cachedInput / (uncachedInput + cachedInput)\` — Zed's cache-effectiveness signal.
- Do NOT use Claude vocabulary (no billed-input-equivalent, no churn-cause) or Codex's per-request/rebuild vocabulary — Zed stores neither. Each thread is one aggregate entry; there is no per-request or per-turn timeline.
- State the limits plainly: Zed does not store reasoning-output or cache-write totals (absent, not zero); request counts are retained entries that can undercount after a compaction; only \`parent_id\`-linked descendant threads are included — a Claude/Codex process Zed launched as an external tool is not, and must be audited separately with its own \`--runtime\`.

If asked for detail beyond the summary, offer \`--open\` (or point at the printed JSON path to drag onto \`viewer/audit.html\` manually) rather than trying to hand-render the full timeline in chat.

## 4. When the command fails

Relay the actual error and next step — do not invent a cause:
- **Ambiguous session id prefix**: the error names the matches; ask the user to supply more of the id, or a direct path.
- **Format-drift** (\`transcript format not recognized\`): this is the experimental-format risk materializing — say so plainly, note the harness (or Zed) may have updated its log/database format since this command was last verified against it, and suggest filing feedback (\`rasen feedback\`) if it keeps happening. Don't attempt to patch or work around the parse failure yourself.
- **No transcript matching**: check the session id and, if relevant, \`--projects-dir\`/\`--runtime\`.
- **Zed: database not found**: the default \`threads.db\` location for the platform had no database — relay the path it looked for and offer \`--db <path>\` if the user's Zed data lives elsewhere.
- **Zed: ambiguous \`--match\`**: the error lists every thread whose first command matched — relay the candidates (id, title, start) and ask the user to pick, or to pass the thread id directly. Never guess one.

## Guardrails

- Disclose the experimental status before or alongside the first command you run — not buried at the end. This applies to Zed too: its \`threads.db\` is an internal, undocumented format that a Zed update can change.
- Never fabricate a dollar cost for a Codex or Zed report; neither has a validated pricing formula the way Claude's TTL model does (see the report's own field names — both report raw totals, not a billed-equivalent).
- For a Zed report, never present the absent reasoning-output/cache-write dimensions as observed zero usage, and never describe it with Claude churn-cause or Codex per-request vocabulary — Zed stores neither.
- If the command fails, relay its message; don't diagnose the transcript/database format yourself.`;

export function getAuditSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-audit',
    description: "Diagnose a Claude Code, Codex CLI, or Zed session's token spend — local, pull-model audit with churn-cause breakdown (Claude), raw totals and cache-hit ratio (Codex), or Zed thread-database totals. Experimental: parses internal transcript/database formats.",
    instructions: AUDIT_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI.',
    metadata: { author: 'rasen', version: '1.1' },
  };
}
