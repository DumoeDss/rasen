#!/usr/bin/env node
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

switch (mode) {
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
