#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const leasePath = process.argv[2];
if (!leasePath || !path.isAbsolute(leasePath)) process.exit(2);
fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
const token = {
  version: 1,
  pid: process.pid,
  nonce: randomBytes(16).toString('hex'),
  createdAt: new Date().toISOString(),
};
const handle = fs.openSync(leasePath, 'wx', 0o600);
try {
  fs.writeFileSync(handle, `${JSON.stringify(token)}\n`, 'utf8');
  fs.fsyncSync(handle);
} finally {
  fs.closeSync(handle);
}
process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid })}\n`);

// Exit without unlinking on signal to model a writer process that dies after
// publishing its complete owner token.
const stop = () => process.exit(0);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
setInterval(() => undefined, 1000);
