#!/usr/bin/env node

const args = process.argv.slice(2);
const titleIndex = args.indexOf('--title');
const title = titleIndex < 0 ? null : args[titleIndex + 1];

if (title === 'force allocation failure') {
  process.stdout.write(JSON.stringify({
    record: null,
    status: [{
      severity: 'error',
      code: 'issue_identity_allocation_failed',
      message: 'injected allocation failure',
    }],
  }));
  process.exitCode = 1;
} else if (title === 'force indeterminate publication') {
  process.stdout.write(JSON.stringify({
    record: null,
    status: [{
      severity: 'error',
      code: 'issue_publication_indeterminate',
      message: 'Issue record publication outcome is indeterminate.',
      recovery: {
        kind: 'issue-publication-indeterminate',
        identity: {
          uid: '11111111-1111-4111-8111-111111111111',
          key: 'ISS-2XSJ22FNSYD353XC',
        },
        retrySafe: false,
      },
    }],
  }));
  process.exitCode = 1;
} else {
  process.stdout.write(JSON.stringify({ ok: true }));
}
