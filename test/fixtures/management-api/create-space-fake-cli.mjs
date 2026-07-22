#!/usr/bin/env node
/**
 * Stand-in for `dist/cli/index.js` used by create-space.ts's unit tests, which
 * need a subprocess whose argv, timing, and exit code they control (the
 * end-to-end path against the real CLI is covered by the integration test).
 *
 * Every invocation appends its received argv (JSON, one line) to the file named
 * by `RASEN_FAKE_ARGV_LOG` when set, so a test can assert exact verb selection.
 *
 * Behavior is keyed on markers embedded in the argv (the test bakes them into
 * the target path so no shared env state is needed for control flow):
 *   FAKESLEEP<ms>   sleeps <ms> milliseconds, then succeeds
 *   FAKEFAIL        exits 1 — store commands emit the CLI's `--json` failure
 *                   shape on stdout; `init` (no --json) writes to stderr
 *   (otherwise)     succeeds; store commands print `{ store: { id, root } }`,
 *                   `init` prints nothing (it has no --json)
 */
import * as fs from 'node:fs';

const args = process.argv.slice(2);
const joined = args.join(' ');

const logPath = process.env.RASEN_FAKE_ARGV_LOG;
if (logPath) {
  try {
    fs.appendFileSync(logPath, JSON.stringify(args) + '\n');
  } catch {
    // best-effort logging
  }
}

function printJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  const sleepMatch = joined.match(/FAKESLEEP(\d+)/);
  if (sleepMatch) {
    await new Promise((resolve) => setTimeout(resolve, Number(sleepMatch[1])));
  }

  if (joined.includes('FAKEFAIL')) {
    if (args[0] === 'store') {
      printJson({ store: null, status: [{ severity: 'error', code: 'store_error', message: 'fake store failure' }] });
    } else {
      process.stderr.write('fake init failure\n');
    }
    process.exitCode = 1;
    return;
  }

  if (args[0] === 'store' && args[1] === 'setup') {
    printJson({ store: { id: args[2], root: '/fake/store' } });
    return;
  }
  if (args[0] === 'store' && args[1] === 'register') {
    const idIdx = args.indexOf('--id');
    const id = idIdx >= 0 ? args[idIdx + 1] : 'registered-store';
    printJson({ store: { id, root: '/fake/store' } });
    return;
  }
  // init: succeed silently (no --json).
}

main();
