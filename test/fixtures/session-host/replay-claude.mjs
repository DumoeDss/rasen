#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  process.stdout.write('2.1.220 (deterministic replay fixture)\n');
  process.exit(0);
}
if (argv.includes('--help')) {
  process.stdout.write([
    '-p, --print',
    '--input-format <format>',
    '--output-format <format>',
    '-r, --resume [value]',
    '',
  ].join('\n'));
  process.exit(0);
}

const resumeIndex = argv.indexOf('--resume');
const sessionId = resumeIndex >= 0 ? argv[resumeIndex + 1] : 'fixture-backend-session-1';
const configPath = path.join(process.cwd(), '.rasen-session-fixture.json');
const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : {};
const outputRoot = process.env.RASEN_SESSION_FIXTURE_OUTPUT ?? config.outputRoot;
const script = process.env.RASEN_SESSION_FIXTURE_SCRIPT ?? config.script ?? 'multi-turn-success';
const delayMs = Number(process.env.RASEN_SESSION_FIXTURE_DELAY_MS ?? config.delayMs ?? '100');
const delayMatch = process.env.RASEN_SESSION_FIXTURE_DELAY_MATCH ?? config.delayMatch;
let initialized = false;
let turn = 0;

function appendFact(value) {
  if (!outputRoot) return;
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.appendFileSync(path.join(outputRoot, 'facts.ndjson'), `${JSON.stringify(value)}\n`, 'utf8');
}

appendFact({
  type: 'spawn',
  script,
  argv,
  cwd: fs.realpathSync.native(process.cwd()),
  pid: process.pid,
  resumed: resumeIndex >= 0,
});

if (script === 'crash-before-init') {
  setTimeout(() => process.exit(31), 5);
}

if (script === 'descendant-process-survival') {
  const descendant = spawn(
    process.execPath,
    ['-e', 'setTimeout(() => process.exit(0), 15000)'],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  descendant.unref();
  appendFact({ type: 'descendant', pid: descendant.pid });
}

function writeEvent(value, fragmented = false) {
  const bytes = Buffer.from(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`, 'utf8');
  if (!fragmented) {
    process.stdout.write(bytes);
    return;
  }
  for (let index = 0; index < bytes.length; index += 3) {
    process.stdout.write(bytes.subarray(index, index + 3));
  }
}

function writeInit() {
  if (initialized) return;
  initialized = true;
  writeEvent({ type: 'system', subtype: 'init', session_id: sessionId });
}

function writeSuccess(text) {
  writeInit();
  writeEvent(
    { type: 'result', session_id: sessionId, result: `fixture-result:${turn}:${text}` },
    true
  );
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write('{malformed}\n');
    return;
  }
  const text = message?.message?.content?.[0]?.text;
  if (typeof text !== 'string') {
    process.stdout.write(`${JSON.stringify({ type: 'result', session_id: sessionId, result: 'invalid-input' })}\n`);
    return;
  }
  turn += 1;
  appendFact({
    type: 'turn',
    turn,
    requestDigest: createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  switch (script) {
    case 'crash-before-init':
      return;
    case 'delayed-result':
      if (delayMatch && !text.includes(delayMatch)) {
        writeSuccess(text);
        return;
      }
      setTimeout(() => writeSuccess(text), Number.isFinite(delayMs) ? delayMs : 100);
      return;
    case 'duplicate-result':
      writeSuccess(text);
      writeEvent({ type: 'result', session_id: sessionId, result: 'duplicate-result' });
      return;
    case 'malformed-event':
      writeEvent('{malformed}');
      return;
    case 'oversized-event':
      writeEvent({ type: 'diagnostic', payload: 'x'.repeat(1024 * 1024) });
      return;
    case 'mismatched-session-id':
      writeInit();
      writeEvent({
        type: 'result',
        session_id: `${sessionId}-mismatch`,
        result: 'mismatched-result',
      });
      return;
    case 'crash-after-init':
      writeInit();
      setImmediate(() => process.exit(32));
      return;
    case 'crash-after-input-acceptance':
      setImmediate(() => process.exit(33));
      return;
    case 'nonzero-exit':
      setImmediate(() => process.exit(34));
      return;
    case 'no-output':
    case 'lost-close':
      return;
    default:
      writeSuccess(text);
  }
});

const shutdown = () => {
  if (script === 'sigterm-resistance' || script === 'lost-close') return;
  input.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
