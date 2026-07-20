#!/usr/bin/env node
// Stand-in for a rasen daemon of a DIFFERENT version, used only by
// ui-launch-stale-replace.test.ts (review round 1 M1 — the stale-daemon
// replacement path had zero fixture-loopback coverage). Answers every
// request with rasen identity headers (a fixed, deliberately-stale
// version) and its OWN pid, so a real `killProcessTree(reportedPid)` call
// targets exactly this process's group — never the test runner's.
//
// Usage: node fake-stale-daemon.mjs <port> <version>
// Reacts to SIGTERM by closing and exiting immediately (a well-behaved
// "old daemon" for the fast/normal-case test); does NOT install a
// SIGTERM-resistant handler — that scenario belongs to the real daemon's
// own tests, not this fixture.
import * as http from 'node:http';

const port = Number(process.argv[2]);
const version = process.argv[3] ?? '0.0.1-stale';

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'x-rasen-daemon': version, 'x-rasen-pid': String(process.pid) });
  res.end('{}');
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-stale-daemon listening on ${port} (pid ${process.pid}, version ${version})\n`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
