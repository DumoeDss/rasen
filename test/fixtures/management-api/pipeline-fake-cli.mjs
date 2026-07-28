#!/usr/bin/env node
/**
 * Stand-in for `dist/cli/index.js` used only by `pipeline-submit.test.ts`,
 * mirroring `pipeline <sub> --json` argv and `--json` output shapes closely
 * enough for the bridge's parsing to exercise the same code paths against a
 * fake as against the real CLI. Every success payload echoes the received argv
 * under `_argv` so a test can assert exact per-op token construction.
 *
 * Control tokens keyed on an argv value:
 *   sleep-<ms>       sleeps <ms> ms, then succeeds (timeout/busy tests)
 *   fail-me          exits 1 with a pipeline failure JSON on stdout
 *   builtin-locked   exits 1 with the CLI's built-in-deletion refusal shape
 */
const args = process.argv.slice(2); // ['pipeline', <sub>, ...]
const sub = args[1];

function printJson(payload) {
  process.stdout.write(JSON.stringify(payload));
}

async function main() {
  const sleepMatch = args.map((a) => /(?:^|[/\\])sleep-(\d+)$/.exec(a)).find(Boolean);
  if (sleepMatch) {
    await new Promise((resolve) => setTimeout(resolve, Number(sleepMatch[1]) || 0));
  }

  if (args.includes('fail-me')) {
    printJson({ status: [{ severity: 'error', code: 'pipeline_in_use', message: 'fake pipeline failure' }] });
    process.exitCode = 1;
    return;
  }

  if (args.includes('builtin-locked')) {
    printJson({
      status: [{ severity: 'error', code: 'builtin_delete_forbidden', message: 'Built-in pipelines cannot be deleted' }],
    });
    process.exitCode = 1;
    return;
  }

  const base = { _argv: args, status: [] };
  if (sub === 'import') {
    printJson({ ...base, imported: ['imported-pipe'], digests: {} });
  } else if (sub === 'init') {
    const outputIdx = args.indexOf('--output');
    printJson({ ...base, pipeline: { name: args[2], output: outputIdx >= 0 ? args[outputIdx + 1] : null } });
  } else if (sub === 'export') {
    printJson({ ...base, pipeline: { name: args[2], path: args[3] } });
  } else if (sub === 'delete') {
    printJson({ ...base, deleted: args[2] });
  } else if (sub === 'save') {
    const fromIdx = args.indexOf('--from');
    const fromPath = fromIdx >= 0 ? args[fromIdx + 1] : null;
    // Read the scratch file so a test can assert its content (or that it's
    // absent), and echo whether --force was passed, matching how the real
    // savePipeline reports `created` (false only on a forced overwrite).
    let scratchContent = null;
    if (fromPath) {
      try {
        scratchContent = (await import('node:fs')).readFileSync(fromPath, 'utf-8');
      } catch {
        scratchContent = null;
      }
    }
    printJson({
      ...base,
      pipeline: { name: args[2], path: fromPath },
      created: !args.includes('--force'),
      _scratchContent: scratchContent,
    });
  } else {
    printJson(base);
  }
}

main();
