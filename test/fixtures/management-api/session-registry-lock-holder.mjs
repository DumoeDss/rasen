#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';

const [lockPath, readyPath, holdMillisecondsText = '10000'] = process.argv.slice(2);
if (!lockPath || !readyPath) process.exit(2);

fs.mkdirSync(path.dirname(lockPath), { recursive: true });
const token = [
  `pid: ${process.pid}`,
  `bornAt: ${new Date().toISOString()}`,
  'holder: spawned-session-registry-test',
  `nonce: ${'a'.repeat(32)}`,
  '',
].join('\n');
fs.writeFileSync(lockPath, token, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
fs.writeFileSync(readyPath, `${process.pid}\n`, 'utf-8');

const timer = setTimeout(() => {
  try {
    if (fs.readFileSync(lockPath, 'utf-8') === token) fs.rmSync(lockPath);
  } catch {
    // The test owner may have cleaned its temporary run already.
  }
  process.exit(0);
}, Number(holdMillisecondsText));
timer.unref?.();

process.on('SIGTERM', () => {
  clearTimeout(timer);
  try {
    if (fs.readFileSync(lockPath, 'utf-8') === token) fs.rmSync(lockPath);
  } catch {
    // Best-effort fixture cleanup only.
  }
  process.exit(0);
});

setInterval(() => {}, 1000);
