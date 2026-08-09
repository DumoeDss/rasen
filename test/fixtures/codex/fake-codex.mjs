#!/usr/bin/env node
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';

if (process.env.FAKE_CODEX_CLOSE_STDIN_EARLY === '1') {
  const descendant = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore', windowsHide: true }
  );
  const marker = process.env.FAKE_CODEX_EARLY_EOF_MARKER;
  if (!marker || typeof descendant.pid !== 'number') {
    throw new Error('early-EOF fixture requires a marker and descendant PID');
  }
  fs.writeFileSync(
    marker,
    `${JSON.stringify({ rootPid: process.pid, descendantPid: descendant.pid })}\n`,
    'utf8'
  );
  fs.closeSync(0);
  setInterval(() => {}, 1000);
} else {
  const args = process.argv.slice(2);
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { prompt += chunk; });
  process.stdin.on('end', () => {
  const mode = /MODE=([a-z-]+)/.exec(prompt)?.[1] ?? 'success';
  const requestedId = /^THREAD_ID=(\S+)$/m.exec(prompt)?.[1] ?? 'fake-codex-thread';
  const resume = args[0] === 'exec' && args[1] === 'resume';
  const threadId = resume ? args[2] : requestedId;
  const outputAt = args.indexOf('-o');
  const outputFile = outputAt >= 0 ? args[outputAt + 1] : undefined;
  const schemaAt = args.indexOf('--output-schema');
  const schemaFile = schemaAt >= 0 ? args[schemaAt + 1] : undefined;
  const markerFile = /^MARKER_FILE=(.+)$/m.exec(prompt)?.[1];
  if (markerFile) {
    fs.writeFileSync(markerFile, `${JSON.stringify({ pid: process.pid, ppid: process.ppid })}\n`, 'utf8');
  }

  const eventThreadId = mode === 'thread-mismatch' ? 'wrong-thread-id' : threadId;
  if (!schemaFile) {
    process.stderr.write('fixture did not receive --output-schema');
    process.exitCode = 10;
    return;
  }
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const properties = Object.keys(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  if (properties.some((property) => !required.has(property))) {
    process.stderr.write('invalid_json_schema: required must include every property');
    process.exitCode = 10;
    return;
  }
  for (const field of ['summary', 'handoffReason']) {
    const type = schema.properties?.[field]?.type;
    if (field in (schema.properties ?? {}) && (!Array.isArray(type) || !type.includes('null'))) {
      process.stderr.write(`invalid_json_schema: ${field} must be nullable`);
      process.exitCode = 10;
      return;
    }
  }
  if (mode !== 'missing-thread') {
    process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: eventThreadId })}\n`);
  }
  const writeLast = (value) => {
    if (!outputFile) throw new Error('fixture did not receive -o');
    fs.writeFileSync(outputFile, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  };

  switch (mode) {
    case 'success':
      writeLast({
        status: 'DONE',
        summary: JSON.stringify({ prompt, args, cwd: process.cwd(), eof: true }),
        handoffReason: null,
      });
      break;
    case 'evaluate':
      writeLast({ satisfied: false, gaps: ['fixture gap'], summary: 'checked' });
      break;
    case 'missing-thread':
      writeLast({ status: 'DONE' });
      break;
    case 'thread-mismatch':
      writeLast({ status: 'DONE' });
      break;
    case 'missing-last':
      break;
    case 'malformed-last':
      writeLast('{ not-json');
      break;
    case 'oversized-last':
      writeLast({ status: 'DONE', summary: 'x'.repeat(300 * 1024) });
      break;
    case 'invalid-contract':
      writeLast({ status: 'MAYBE' });
      break;
    case 'nonzero':
      process.stderr.write('fixture failure api_key=secret-value');
      process.exitCode = 7;
      break;
    case 'overflow':
      process.stdout.write('x'.repeat(1024 * 1024));
      break;
    case 'timeout':
      setInterval(() => {}, 1000);
      break;
    case 'hold': {
      const releaseFile = /^RELEASE_FILE=(.+)$/m.exec(prompt)?.[1];
      if (!releaseFile) {
        process.stderr.write('hold mode requires RELEASE_FILE');
        process.exitCode = 9;
        break;
      }
      const interval = setInterval(() => {
        if (!fs.existsSync(releaseFile)) return;
        clearInterval(interval);
        writeLast({ status: 'DONE', summary: 'released fixture writer' });
      }, 20);
      break;
    }
    default:
      process.stderr.write(`unknown fixture mode: ${mode}`);
      process.exitCode = 9;
  }
  });
  process.stdin.resume();
}
