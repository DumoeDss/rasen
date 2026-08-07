/**
 * Oh My Pi agent-directory resolution.
 *
 * Oh My Pi keeps its settings, credential store, and session journals under an
 * "active agent directory" that three independent knobs can move. This is the
 * single resolution point for that path, mirroring
 * `src/core/hermes/hermes-home.ts` and `src/core/codex/codex-home.ts`, so the
 * session locator has one place to ask and no probe path hardcodes `~/.omp`.
 *
 * Resolution order, live-verified against {@link OMP_CLI_VERSION_PREMISE} with
 * `omp config path` (which prints the active agent directory):
 *
 * 1. A named profile — `OMP_PROFILE`, else `PI_PROFILE` — resolves to
 *    `<configRoot>/profiles/<name>/agent`. `OMP_PROFILE` wins whenever it is
 *    DEFINED, including when it is defined and empty, and `default`/empty/
 *    whitespace all select the default profile.
 * 2. For the default profile only, `PI_CODING_AGENT_DIR` replaces the whole
 *    path. A named profile ignores it — verified:
 *    `OMP_PROFILE=work PI_CODING_AGENT_DIR=/tmp/x omp config path` prints
 *    `~/.omp/profiles/work/agent`, not `/tmp/x`.
 * 3. Otherwise `<configRoot>/agent`.
 *
 * `configRoot` is `<home>/<PI_CONFIG_DIR ?? '.omp'>`. `PI_CONFIG_DIR` is a
 * dirname resolved under the home directory, not a free path: Oh My Pi joins it
 * under home even when it looks absolute (`PI_CONFIG_DIR=/tmp/ompcfg` prints
 * `~/tmp/ompcfg/agent`), which is exactly `path.join`'s own behavior — so the
 * join below reproduces it rather than approximating it.
 */
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * All behavior in `src/core/omp/` is pinned to this Oh My Pi version. Cite this
 * constant wherever a behavioral assumption (agent-directory resolution,
 * session bucket layout, per-message usage shape) could drift on a newer
 * release.
 */
export const OMP_CLI_VERSION_PREMISE = '17.2.10';

/** The default config-root dirname, `CONFIG_DIR_NAME` in Oh My Pi's own tree. */
const DEFAULT_CONFIG_DIR_NAME = '.omp';

/**
 * The active profile name, or `undefined` for the default profile.
 *
 * The parameter is `NodeJS.ProcessEnv` rather than a narrow four-field shape,
 * matching `detectHostRuntime`: an all-optional interface is a weak type, so
 * `process.env` would not be assignable to it.
 *
 * `OMP_PROFILE` is checked for definedness rather than truthiness so an
 * explicitly empty value shadows a `PI_PROFILE` left over in the same shell —
 * the documented precedence, and live-verified: `OMP_PROFILE= PI_PROFILE=legacy`
 * resolves to the DEFAULT agent directory, not `legacy`'s.
 */
function resolveProfile(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  const name = raw?.trim();
  if (name === undefined || name === '' || name === 'default') return undefined;
  return name;
}

/**
 * Resolve Oh My Pi's active agent directory. Always returns an absolute path,
 * built with `path.join`/`path.resolve` so it is correct on every platform.
 */
export function resolveOmpAgentDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir()
): string {
  const profile = resolveProfile(env);
  const configRoot = path.join(homeDir, env.PI_CONFIG_DIR?.trim() || DEFAULT_CONFIG_DIR_NAME);

  if (profile !== undefined) {
    return path.resolve(path.join(configRoot, 'profiles', profile, 'agent'));
  }

  const agentDirOverride = env.PI_CODING_AGENT_DIR?.trim();
  if (agentDirOverride) {
    return path.resolve(agentDirOverride);
  }

  return path.resolve(path.join(configRoot, 'agent'));
}
