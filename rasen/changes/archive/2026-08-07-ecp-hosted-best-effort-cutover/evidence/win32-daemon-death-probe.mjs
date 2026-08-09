// Real-behaviour probe for the KILL_ON_JOB_CLOSE teardown chain (task 7.2).
//
// Stands in for a rasen daemon: it spawns the REAL packaged ProcessCapsule
// controller, drives the real protocol to start a real workload that itself
// spawns a real descendant, then stays alive holding the controller's stdin.
// The driver kills THIS process without cancelling, which is the only way to
// observe the claimed chain end to end:
//
//   daemon death -> controller stdin EOF -> controller/supervisor exit
//                -> last Job handle closes -> kernel terminates Job members
//
// Nothing here is asserted from source: the driver checks real pids afterwards.
//
// usage: node win32-daemon-death-probe.mjs <helper.exe> <pids.json>

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [helperPath, pidsFile] = process.argv.slice(2);

const PREPARE = 0x01;
const ACTIVATE = 0x02;
const PREPARED = 0x81;
const ACTIVATED = 0x82;
const PROTOCOL_VERSION = 2;

function appendString(parts, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  parts.push(length, bytes);
}

function encodeLaunch(command, args, cwd, env, nonce) {
  const parts = [];
  const protocol = Buffer.allocUnsafe(2);
  protocol.writeUInt16BE(PROTOCOL_VERSION);
  parts.push(protocol);
  appendString(parts, nonce);
  appendString(parts, command);
  appendString(parts, cwd);
  parts.push(Buffer.from([0]));
  const argCount = Buffer.allocUnsafe(4);
  argCount.writeUInt32BE(args.length);
  parts.push(argCount);
  for (const arg of args) appendString(parts, arg);
  const entries = Object.entries(env).sort(([l], [r]) => l.localeCompare(r));
  const envCount = Buffer.allocUnsafe(4);
  envCount.writeUInt32BE(entries.length);
  parts.push(envCount);
  for (const [key, value] of entries) {
    appendString(parts, key);
    appendString(parts, value);
  }
  return Buffer.concat(parts);
}

function frame(kind, payload = Buffer.alloc(0)) {
  const header = Buffer.allocUnsafe(5);
  header[0] = kind;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

// The workload: records its own pid and its descendant's, then both live on.
const WORKLOAD = [
  "const { spawn } = require('node:child_process');",
  "const fs = require('node:fs');",
  'const child = spawn(process.execPath, ',
  '  ["-e", "setInterval(() => {}, 60000)"],',
  '  { stdio: "ignore", windowsHide: true });',
  'fs.writeFileSync(process.env.RASEN_PIDS_FILE,',
  '  JSON.stringify({ workload: process.pid, descendant: child.pid }));',
  'setInterval(() => {}, 60000);',
].join('\n');

const controller = spawn(helperPath, ['--controller'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});

let pending = Buffer.alloc(0);
controller.stdout.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 5) {
    const length = pending.readUInt32BE(1);
    if (pending.length < 5 + length) break;
    const kind = pending[0];
    pending = pending.subarray(5 + length);
    if (kind === PREPARED) {
      controller.stdin.write(frame(ACTIVATE));
    } else if (kind === ACTIVATED) {
      process.stdout.write(`ACTIVATED controller=${controller.pid}\n`);
    }
  }
});

const env = {
  RASEN_PIDS_FILE: pidsFile,
  SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
  TEMP: process.env.TEMP ?? 'C:\\Windows\\Temp',
  TMP: process.env.TMP ?? 'C:\\Windows\\Temp',
};

controller.stdin.write(
  frame(
    PREPARE,
    encodeLaunch(process.execPath, ['-e', WORKLOAD], process.cwd(), env, 'a'.repeat(48))
  )
);

process.stdout.write(`DAEMON ${process.pid}\n`);
// Hold the event loop: the controller's stdin must stay open until this
// process is killed, or the teardown would be triggered by a clean exit
// instead of by daemon death.
setInterval(() => {}, 60000);
fs.writeFileSync; // referenced so the import is not tree-shaken by a bundler
