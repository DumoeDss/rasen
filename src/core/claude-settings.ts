/**
 * Claude Code project settings helpers.
 *
 * Rasen's orchestrated `/rasen-auto` and `/rasen-review-cycle` reach their full
 * (Tier A) behavior — the LEAD re-engaging a worker via `SendMessage` by its
 * `agentId` — only when Claude Code's experimental agent-teams flag is on.
 * agent-teams enables agentId-based re-engagement IN GENERAL; it does NOT
 * guarantee a COMPLETED worker is reliably re-addressable for warm re-review (a
 * completed subagent may be unreachable even within the same session), so the
 * orchestration records `agentId` + `transcript` on every dispatch and treats
 * agentId-first re-engagement as "try it, fall back to the transcript
 * warm-seed", never a guarantee. During Claude Code setup we merge that flag
 * into the project's `.claude/settings.json` so the orchestration runs at Tier
 * A out of the box.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const AGENT_TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS';

export type EnsureAgentTeamsResult = 'created' | 'added' | 'already' | 'skipped-invalid';

/**
 * Ensure `<projectRoot>/<claudeDir>/settings.json` enables agent-teams by setting
 * `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"`.
 *
 * - Merges into existing settings, preserving every other key (and other env vars).
 * - Idempotent: returns `already` and writes nothing when the flag is already "1".
 * - Never clobbers a settings.json that is not a valid JSON object: returns
 *   `skipped-invalid` and leaves the file untouched.
 * - Creates the file (and directory) when absent: returns `created`.
 */
export function ensureClaudeAgentTeams(projectRoot: string, claudeDir = '.claude'): EnsureAgentTeamsResult {
  const settingsPath = path.join(projectRoot, claudeDir, 'settings.json');

  let settings: Record<string, unknown> = {};
  let existed = false;

  if (fs.existsSync(settingsPath)) {
    existed = true;
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = raw.trim() ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      } else {
        return 'skipped-invalid';
      }
    } catch {
      return 'skipped-invalid';
    }
  }

  const env =
    settings.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
      ? (settings.env as Record<string, unknown>)
      : {};

  if (env[AGENT_TEAMS_ENV] === '1') {
    return 'already';
  }

  env[AGENT_TEAMS_ENV] = '1';
  settings.env = env;

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');

  return existed ? 'added' : 'created';
}
