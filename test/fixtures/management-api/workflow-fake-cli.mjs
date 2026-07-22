#!/usr/bin/env node
/**
 * Stand-in for `dist/cli/index.js` used only by `workflow-submit.test.ts`,
 * which needs a subprocess whose argv it can inspect and whose success/
 * failure/duration it controls. Mirrors the `workflow <sub> --json` argv and
 * `--json` output shapes closely enough for the bridge's parsing to exercise
 * the same code paths against a fake as against the real CLI.
 *
 * Every success payload echoes the received argv under `_argv`, so a test can
 * assert the exact per-op token construction (single tokens, `--yes` always
 * on delete, `--force` only when flagged) without depending on the real
 * library's side effects.
 *
 * Control tokens keyed on an argv value:
 *   sleep-<ms>       sleeps <ms> ms, then succeeds (timeout/busy tests)
 *   fail-me          exits 1 with a workflow failure JSON on stdout
 *   builtin-locked   exits 1 with the CLI's built-in-deletion refusal shape
 */
const args = process.argv.slice(2); // ['workflow', <sub>, ...]
const sub = args[1];

function printJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  // Match `sleep-<ms>` as a whole token OR as the trailing path segment of an
  // argv token (import/export/init pass it embedded in an absolute path).
  const sleepMatch = args.map((a) => /(?:^|[/\\])sleep-(\d+)$/.exec(a)).find(Boolean);
  if (sleepMatch) {
    await new Promise((resolve) => setTimeout(resolve, Number(sleepMatch[1]) || 0));
  }

  if (args.includes('fail-me')) {
    printJson({ status: [{ severity: 'error', code: 'workflow_in_use', message: 'fake workflow failure' }] });
    process.exitCode = 1;
    return;
  }

  if (args.includes('builtin-locked')) {
    printJson({
      deleted: null,
      forcedReferrers: [],
      status: [{ severity: 'error', code: 'builtin_delete_forbidden', message: 'Built-in workflows cannot be deleted' }],
    });
    process.exitCode = 1;
    return;
  }

  const base = { _argv: args, status: [] };
  if (sub === 'import') {
    printJson({ ...base, imported: ['imported-id'], reused: ['reused-id'], roots: ['imported-id'] });
  } else if (sub === 'init') {
    const outputIdx = args.indexOf('--output');
    printJson({ ...base, workflow: { id: args[2], output: outputIdx >= 0 ? args[outputIdx + 1] : null } });
  } else if (sub === 'export') {
    printJson({ ...base, workflow: { id: args[2], path: args[3] } });
  } else if (sub === 'delete') {
    printJson({ ...base, deleted: args[2], forcedReferrers: [] });
  } else {
    printJson(base);
  }
}

main();
