import {
  resolveAgentCliBinary,
  spawnAgentCliSync,
} from '../agent-cli-process.js';

export interface ClaudeAvailabilityProbeOptions {
  resolveBinary?: () => string | null;
  runVersion?: (binary: string) => {
    status: number | null;
    error?: Error;
    signal?: NodeJS.Signals | null;
  };
}

/**
 * Non-throwing `claude --version` availability probe. Both resolution and
 * execution are injectable so automated tests never need the real CLI.
 */
export function probeClaudeAvailability(
  options: ClaudeAvailabilityProbeOptions = {}
): boolean {
  try {
    const binary = options.resolveBinary
      ? options.resolveBinary()
      : resolveAgentCliBinary({ envVar: 'RASEN_CLAUDE_BIN', binaryName: 'claude' });
    if (!binary) return false;
    const result = options.runVersion
      ? options.runVersion(binary)
      : spawnAgentCliSync(binary, ['--version'], {
          timeout: 3000,
          stdio: 'ignore',
          windowsHide: true,
        });
    return !result.error && result.status === 0 && result.signal == null;
  } catch {
    return false;
  }
}
