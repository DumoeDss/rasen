/**
 * Codex home resolution and version premise.
 *
 * Codex CLI persists its config, auth, prompts, and session rollouts under a
 * single home directory (`CODEX_HOME` env override, default `~/.codex`). This
 * is the single resolution point for that path — previously duplicated
 * privately in the command-generation codex adapter, which now imports it
 * from here (design D1).
 */
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * All behavior in `src/core/codex/` is pinned to this codex-cli version,
 * live-verified against the `docs/codex-parity/` dossier. Cite this constant
 * in doc comments wherever a behavioral assumption (stdin handling, event
 * shapes, `prompts/*.md` rejection, `ultra` auto-delegation, etc.) could
 * drift on a newer Codex CLI release.
 */
export const CODEX_CLI_VERSION_PREMISE = '0.144.1';

/**
 * Resolve the Codex home directory. Respects the `CODEX_HOME` env var
 * (trimmed), defaulting to `~/.codex`. Always returns an absolute path.
 */
export function resolveCodexHome(): string {
  const envHome = process.env.CODEX_HOME?.trim();
  return path.resolve(envHome ? envHome : path.join(os.homedir(), '.codex'));
}
