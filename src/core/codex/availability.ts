import { spawnSync } from 'node:child_process';

/**
 * Bound on how long the availability probe waits for `codex --version` before
 * treating the binary as unavailable. Keeps a wedged/misbehaving install from
 * hanging a pipeline preflight.
 */
const CODEX_PROBE_TIMEOUT_MS = 3000;

/**
 * Probes whether the codex CLI is available on this machine, at a
 * `codex --version` level. Non-throwing: a missing binary (ENOENT), a
 * non-zero exit, or a timeout all resolve to `false` rather than propagating.
 * `shell: true` is used so a Windows `.cmd`/`.ps1` shim resolves the same way
 * a user's own shell would; there is no untrusted input in the invocation.
 *
 * This is the single real implementation — callers that need this to be
 * testable without a codex binary should inject a fake in its place rather
 * than mocking this function.
 */
export function probeCodexAvailability(): boolean {
  try {
    const result = spawnSync('codex', ['--version'], {
      timeout: CODEX_PROBE_TIMEOUT_MS,
      shell: true,
      stdio: 'ignore',
    });
    if (result.error) {
      return false;
    }
    return result.status === 0;
  } catch {
    return false;
  }
}
