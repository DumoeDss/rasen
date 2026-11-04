import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { resolveLaunchProjectRef } from '../../../../dist/core/config-api/project-addressing.js';
import { startManagementServer } from '../../../../dist/core/management-api/server.js';

const metadataPath = process.argv[2];
if (!metadataPath) throw new Error('metadata output path argument is required');

const launchProjectRoot = path.resolve(process.cwd());
const uiAssetsDir = path.resolve(launchProjectRoot, 'packages', 'ui', 'dist');
if (!fs.existsSync(path.join(uiAssetsDir, 'index.html'))) {
  throw new Error(`production UI assets are missing at ${uiAssetsDir}`);
}

const uiToken = randomBytes(32).toString('hex');
const controlToken = randomBytes(32).toString('hex');
const launchProjectRef = await resolveLaunchProjectRef(launchProjectRoot);
const management = await startManagementServer({
  context: {
    token: uiToken,
    launchProjectRoot,
    launchProjectRef,
    version: 'issue-board-cutover-persistent-readonly',
    uiAssetsDir,
  },
});

let shuttingDown = false;
let control;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise((resolve) => control.close(() => resolve()));
  await management.stopServer();
  try {
    fs.unlinkSync(metadataPath);
  } catch {
    // The caller may already have removed the ephemeral metadata file.
  }
}

control = http.createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${controlToken}`) {
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end('{"ok":false}');
    return;
  }
  if (request.method === 'POST' && request.url === '/shutdown') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"ok":true}');
    setImmediate(() => {
      void shutdown().finally(() => process.exit(0));
    });
    return;
  }
  response.writeHead(404, { 'Content-Type': 'application/json' });
  response.end('{"ok":false}');
});

await new Promise((resolve, reject) => {
  control.once('error', reject);
  control.listen(0, '127.0.0.1', () => resolve());
});
const controlAddress = control.address();
if (!controlAddress || typeof controlAddress === 'string') {
  throw new Error('control port did not bind');
}

fs.writeFileSync(
  metadataPath,
  `${JSON.stringify(
    {
      processId: process.pid,
      managementPort: management.port,
      controlPort: controlAddress.port,
      uiToken,
      controlToken,
    },
    null,
    2
  )}\n`,
  { encoding: 'utf8', flag: 'wx' }
);

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

await new Promise(() => {});
