#!/usr/bin/env node
/**
 * Stand-in for `dist/cli/index.js` used only by submit.ts's timeout/busy
 * unit tests (which need a subprocess whose duration they control) — every
 * other submit.ts test spawns the real CLI. Mirrors `newChangeCommand`'s
 * `--json` argv and output shapes closely enough for the bridge's parsing
 * logic to exercise the same code paths against a fake as against the real
 * CLI: `new change <name> --proposal=<text> --json`.
 *
 * Behavior keyed on <name>:
 *   sleep-<ms>   sleeps <ms> milliseconds, then succeeds
 *   fail-me      exits 1 with the CLI's failure JSON shape on stdout
 *   (anything else) succeeds immediately
 */
const args = process.argv.slice(2);
const name = args[2];

function printJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  if (name && name.startsWith('sleep-')) {
    const ms = Number(name.slice('sleep-'.length)) || 0;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (name === 'fail-me') {
    printJson({ change: null, status: [{ severity: 'error', code: 'change_error', message: 'fake failure' }] });
    process.exitCode = 1;
    return;
  }

  printJson({
    change: { id: name, path: `/fake/rasen/changes/${name}`, metadataPath: `/fake/.openspec.yaml`, schema: 'spec-driven' },
    root: { path: '/fake', source: 'nearest' },
  });
}

main();
