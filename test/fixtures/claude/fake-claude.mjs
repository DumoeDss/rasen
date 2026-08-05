#!/usr/bin/env node
// Cross-platform fake for Claude print-mode bridge tests. It never contacts a
// service. Behavior is selected by a MODE=<name> token in the stdin prompt.
import * as fs from 'node:fs';

const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => {
  const mode = /MODE=([a-z-]+)/.exec(prompt)?.[1] ?? 'success';
  const resumeAt = args.indexOf('--resume');
  const requestedSessionId = /^SESSION_ID=(\S+)$/m.exec(prompt)?.[1];
  const sessionId =
    resumeAt >= 0
      ? args[resumeAt + 1]
      : (requestedSessionId ?? 'fake-claude-session');
  const markerFile = /^MARKER_FILE=(.+)$/m.exec(prompt)?.[1];
  if (markerFile) {
    fs.writeFileSync(
      markerFile,
      `${JSON.stringify({ pid: process.pid, ppid: process.ppid })}\n`,
      'utf8'
    );
  }

  const writeEnvelope = (structuredOutput, extra = {}) => {
    process.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: sessionId,
        result: 'fixture prose is not authoritative',
        structured_output: structuredOutput,
        ...extra,
      })
    );
  };

  switch (mode) {
    case 'success':
      writeEnvelope({
        status: 'DONE',
        summary: JSON.stringify({ prompt, args, cwd: process.cwd() }),
      });
      break;
    case 'handoff':
      writeEnvelope({
        status: 'HANDOFF',
        summary: 'fixture handoff',
        handoffReason: 'budget',
      });
      break;
    case 'evaluate':
      writeEnvelope({ satisfied: false, gaps: ['fixture gap'], summary: 'checked' });
      break;
    case 'nonzero':
      process.stderr.write('fixture nonzero stderr');
      process.exitCode = 7;
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
        writeEnvelope({ status: 'DONE', summary: 'released fixture writer' });
      }, 20);
      break;
    }
    case 'malformed':
      process.stdout.write('{ definitely-not-json');
      break;
    case 'error-envelope':
      process.stdout.write(
        JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          session_id: sessionId,
          result: 'fixture error detail',
          errors: [{ code: 'fixture-error', message: 'fixture rejected the turn' }],
        })
      );
      break;
    case 'missing-structured':
      process.stdout.write(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          session_id: sessionId,
          result: 'DONE',
        })
      );
      break;
    case 'invalid-contract':
      writeEnvelope({ status: 'MAYBE' });
      break;
    case 'overflow':
      process.stdout.write('x'.repeat(1024 * 1024));
      break;
    default:
      process.stderr.write(`unknown fixture mode: ${mode}`);
      process.exitCode = 9;
  }
});
process.stdin.resume();
