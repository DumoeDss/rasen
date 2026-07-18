/**
 * Hermes home resolution.
 *
 * Hermes Agent (Nous Research) persists its config, sessions, and skills
 * under a single home directory (`HERMES_HOME` env override, default
 * `~/.hermes`). Skills are discovered ONLY from this global home
 * (`<home>/skills/<name>/SKILL.md`) — there is no project-local skills
 * mechanism. This is the single resolution point for that path, mirroring
 * `src/core/codex/codex-home.ts`.
 *
 * No version premise constant yet: no local `hermes` binary is available to
 * live-verify runtime behavior (see agent-adapters-hermes design Open
 * Questions). Only the install-layer facts here (home dir, global skills
 * path) are used, which are stated directly in the Nous docs.
 */
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolve the Hermes home directory. Respects the `HERMES_HOME` env var
 * (trimmed), defaulting to `~/.hermes`. Always returns an absolute path.
 */
export function resolveHermesHome(): string {
  const envHome = process.env.HERMES_HOME?.trim();
  return path.resolve(envHome ? envHome : path.join(os.homedir(), '.hermes'));
}
