import path from 'node:path';

export function npmInvocationForPlatform(
  platform = process.platform,
  nodeExecutable = process.execPath,
) {
  if (platform !== 'win32') return { command: 'npm', argsPrefix: [] };

  return {
    command: nodeExecutable,
    argsPrefix: [
      path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ],
  };
}
