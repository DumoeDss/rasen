#!/usr/bin/env node
// Keep this executable fixture LF-only; POSIX launches it through this shebang.
// Stand-in for the real `claude` CLI, used only by supervisor.test.ts and the
// sessions API integration tests. The supervisor always spawns it with a
// fixed argv shape (`-p <prompt> --dangerously-skip-permissions
// --output-format stream-json --verbose`, design D1) — the only thing under
// test control is the prompt/task text, so behavior is selected via a
// `MODE=<name>` token embedded at the start of the task text.
//
// On POSIX, spawned directly (chmod +x, shebang) as the resolved agent-CLI
// path itself, not via `node <path>`. On Windows this file is not directly
// executable, so tests resolve to the sibling `.cmd` wrapper
// (`session-fake-cli.cmd`, `@node "%~dp0session-fake-cli.mjs" %*`) instead —
// that wrapper is what actually gets spawned there, driving the real
// `.cmd`-shim spawn codepath (design D1/D2, `supervisor.ts`'s
// `spawnAgentCli`).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const args = process.argv.slice(2);
const promptIndex = args.indexOf('-p');
const prompt = promptIndex >= 0 ? args[promptIndex + 1] : '';
const modeMatch = /MODE=(\S+)/.exec(prompt);
const mode = modeMatch ? modeMatch[1] : 'fast-exit';

function writeLine(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function initLine(sessionId) {
  writeLine({ type: 'system', subtype: 'init', session_id: sessionId, permissionMode: 'bypassPermissions' });
}

function fixtureMessage(event) {
  const content = event?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('');
}

function appendHostEvent(event) {
  fs.appendFileSync(
    path.join(process.cwd(), 'host-fixture-events.ndjson'),
    `${JSON.stringify(event)}\n`,
    'utf-8'
  );
}

async function writeHostEvent(event, chunked) {
  const line = `${JSON.stringify(event)}\n`;
  if (!chunked || line.length < 4) {
    process.stdout.write(line);
    return;
  }
  const first = Math.max(1, Math.floor(line.length / 3));
  const second = Math.max(first + 1, Math.floor((line.length * 2) / 3));
  process.stdout.write(line.slice(0, first));
  await new Promise((resolve) => setTimeout(resolve, 5));
  process.stdout.write(line.slice(first, second));
  await new Promise((resolve) => setTimeout(resolve, 5));
  process.stdout.write(line.slice(second));
}

function runHostFixture() {
  const resumeIndex = args.indexOf('--resume');
  const sessionId = resumeIndex >= 0 && args[resumeIndex + 1]
    ? args[resumeIndex + 1]
    : 'fake-host-session';
  let firstDelivery = true;
  let resistantInterval;
  let closeOnNextInput = false;

  appendHostEvent({
    type: 'spawn',
    pid: process.pid,
    cwd: fs.realpathSync.native(process.cwd()),
    argv: args,
  });

  process.stdin.on('data', () => {
    if (!closeOnNextInput) return;
    closeOnNextInput = false;
    process.exit(19);
  });

  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  lines.on('line', async (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      process.stderr.write(`invalid fixture input: ${line}\n`);
      return;
    }

    const message = fixtureMessage(event);
    const chunked = message.includes('CHUNKED');
    appendHostEvent({ type: 'delivery', pid: process.pid, message });

    let emitInitAfterResult = false;
    if (firstDelivery) {
      firstDelivery = false;
      if (!message.includes('MISSING_INIT')) {
        if (message.includes('RESULT_BEFORE_INIT')) {
          emitInitAfterResult = true;
        } else {
          await writeHostEvent(
            { type: 'system', subtype: 'init', session_id: sessionId, permissionMode: 'bypassPermissions' },
            chunked
          );
        }
      }
    }

    if (message.includes('LONG_TAIL')) {
      process.stderr.write(`prefix-${'x'.repeat(70 * 1024)}-suffix\n`);
    }
    if (message.includes('MALFORMED')) {
      process.stdout.write('not-json diagnostic\n');
    }
    if (message.includes('UNKNOWN')) {
      await writeHostEvent({ type: 'system', subtype: 'fixture-unknown', value: 1 }, chunked);
    }
    if (message.includes('MIDTURN_LOSS')) {
      setTimeout(() => process.exit(17), 10);
      return;
    }

    const delayMatch = /DELAY_RESULT=(\d+)/.exec(message);
    if (delayMatch) {
      await new Promise((resolve) => setTimeout(resolve, Number(delayMatch[1])));
    }
    if (message.includes('NO_RESULT_WITH_OUTPUT')) {
      setInterval(() => {
        writeLine({ type: 'system', subtype: 'fixture-progress', at: Date.now() });
      }, 30);
      return;
    }
    if (message.includes('NO_RESULT')) return;

    const result = message.includes('LARGE_RESULT')
      ? `large-start:${'r'.repeat(128 * 1024)}:large-end`
      : `result:${message}`;
    await writeHostEvent(
      { type: 'result', subtype: 'success', result, fixture_pid: process.pid },
      chunked
    );

    if (emitInitAfterResult) {
      await writeHostEvent(
        { type: 'system', subtype: 'init', session_id: sessionId, permissionMode: 'bypassPermissions' },
        chunked
      );
    }
    if (message.includes('ARM_CLOSE_DURING_WRITE')) {
      closeOnNextInput = true;
    }

    if (message.includes('IDLE_LOSS')) {
      setTimeout(() => process.exit(18), 20);
    }
    if (message.includes('SIGTERM_RESISTANT')) {
      process.on('SIGTERM', () => {});
      resistantInterval = setInterval(() => {}, 1000);
    }
  });

  lines.on('close', () => {
    if (resistantInterval) return;
    process.exit(0);
  });
}

if (args.includes('--input-format')) {
  runHostFixture();
} else switch (mode) {
  case 'fast-exit': {
    initLine('fake-session-fast-exit');
    writeLine({ type: 'result', result: 'ok' });
    process.exit(0);
    break;
  }
  case 'idle-after-init': {
    // Emits init once, then produces no more output — no-output watchdog fixture.
    initLine('fake-session-idle');
    setInterval(() => {}, 1000);
    break;
  }
  case 'sigterm-resistant': {
    process.on('SIGTERM', () => {
      // Deliberately ignored — only SIGKILL (uncatchable) ends this process.
    });
    initLine('fake-session-resistant');
    setInterval(() => {
      writeLine({ type: 'system', subtype: 'thinking_tokens', delta: 1 });
    }, 50);
    break;
  }
  case 'stream-then-exit': {
    // Prints init, then periodic NDJSON (the watchdog feed), then exits —
    // stream-json-emitting fixture (task 3.1).
    initLine('fake-session-stream');
    let n = 0;
    const interval = setInterval(() => {
      writeLine({ type: 'system', subtype: 'thinking_tokens', delta: n });
      n += 1;
      if (n >= 3) {
        clearInterval(interval);
        writeLine({ type: 'result', result: 'ok' });
        process.exit(0);
      }
    }, 20);
    break;
  }
  case 'garbage-init': {
    // Non-JSON stdout — agentSessionId parse must degrade silently, never fail the session.
    process.stdout.write('not json at all, not even close\n');
    setTimeout(() => process.exit(0), 20);
    break;
  }
  case 'never-exits-ignores-nothing': {
    // Alive but silent forever, and does NOT ignore SIGTERM — a plain kill target.
    setInterval(() => {}, 1000);
    break;
  }
  case 'nonzero-exit': {
    initLine('fake-session-nonzero');
    setTimeout(() => process.exit(3), 10);
    break;
  }
  default: {
    process.exit(1);
  }
}
