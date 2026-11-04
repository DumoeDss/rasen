// Driver for the task 7.2 KILL_ON_JOB_CLOSE receipt. Starts the probe daemon,
// verifies the real workload tree is alive, kills the daemon WITHOUT cancelling,
// then re-checks every pid. Every verdict below is a real liveness check on a
// real pid, never an inference from source.
//
// usage: node win32-daemon-death-driver.mjs <helper.exe>

import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const helperPath = process.argv[2];
const pidsFile = path.join(os.tmpdir(), `rasen-job-close-${process.pid}.json`);
const probe = path.join(import.meta.dirname, 'win32-daemon-death-probe.mjs');

function alive(pid) {
  // tasklist is the OS's own answer; process.kill(pid, 0) would report a
  // zombie handle as alive on Windows.
  const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
    encoding: 'utf8',
  });
  return out.includes(String(pid));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const daemon = spawn(process.execPath, [probe, helperPath, pidsFile], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
daemon.stdout.on('data', (c) => {
  out += String(c);
});
daemon.stderr.on('data', (c) => {
  out += String(c);
});

for (let i = 0; i < 200 && !fs.existsSync(pidsFile); i += 1) await sleep(50);
if (!fs.existsSync(pidsFile)) {
  console.log('FAILED: workload never reported its pids');
  console.log(out);
  daemon.kill();
  process.exit(1);
}
await sleep(300);
const pids = JSON.parse(fs.readFileSync(pidsFile, 'utf8'));
const controllerPid = /controller=(\d+)/.exec(out)?.[1];

console.log(`daemon pid          : ${daemon.pid}`);
console.log(`capsule controller  : ${controllerPid ?? '(not reported)'}`);
console.log(`workload leader pid : ${pids.workload}`);
console.log(`descendant pid      : ${pids.descendant}`);
console.log('--- before daemon death ---');
console.log(`workload alive      : ${alive(pids.workload)}`);
console.log(`descendant alive    : ${alive(pids.descendant)}`);
if (controllerPid) console.log(`controller alive    : ${alive(controllerPid)}`);

// Daemon death, not a cancel: no TERMINATE frame is ever sent.
console.log('--- killing the daemon with /F (no cancel, no TERMINATE frame) ---');
execFileSync('taskkill', ['/F', '/PID', String(daemon.pid)], { encoding: 'utf8' });

for (let i = 0; i < 100; i += 1) {
  await sleep(100);
  if (!alive(pids.workload) && !alive(pids.descendant)) break;
}
await sleep(500);

console.log('--- after daemon death ---');
const workloadAlive = alive(pids.workload);
const descendantAlive = alive(pids.descendant);
console.log(`daemon alive        : ${alive(daemon.pid)}`);
if (controllerPid) console.log(`controller alive    : ${alive(controllerPid)}`);
console.log(`workload alive      : ${workloadAlive}`);
console.log(`descendant alive    : ${descendantAlive}`);
console.log(
  `VERDICT             : ${!workloadAlive && !descendantAlive ? 'JOB TORN DOWN' : 'SURVIVORS REMAIN'}`
);

fs.rmSync(pidsFile, { force: true });
// Leave nothing behind if the chain did not hold.
for (const pid of [pids.workload, pids.descendant]) {
  if (alive(pid)) {
    try {
      execFileSync('taskkill', ['/F', '/PID', String(pid)]);
      console.log(`cleanup: force-killed surviving pid ${pid}`);
    } catch {
      console.log(`cleanup: could not kill ${pid}`);
    }
  }
}
