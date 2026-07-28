import path from 'node:path';

export function npmInvocationForPlatform(
  platform = process.platform,
  nodeExecutable = process.execPath,
) {
  if (platform !== 'win32') return { command: 'npm', argsPrefix: [] };

  // Compute the Windows npm-cli.js path with win32 semantics regardless of the
  // host platform: `path.dirname('C:\\node\\node.exe')` returns '.' on POSIX
  // (backslash is not a separator there), which produced a wrong, host-dependent
  // argsPrefix and failed the release-contract test on Linux/macOS CI.
  return {
    command: nodeExecutable,
    argsPrefix: [
      path.win32.join(path.win32.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ],
  };
}
