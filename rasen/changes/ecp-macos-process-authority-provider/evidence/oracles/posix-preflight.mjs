// POSIX pre-flight oracles for the macOS best-effort process scope.
//
// NON-ACCEPTANCE EVIDENCE. Running this on Linux/WSL exercises POSIX
// setsid/process-group semantics on the wrong kernel. It never satisfies the
// real-macOS acceptance gate (tasks 7.1-7.6); it only pre-flights the protocol
// against a real kernel before a macOS host is available.
//
// Usage: node <repo>/rasen/changes/ecp-macos-process-authority-provider/evidence/oracles/posix-preflight.mjs <repoRoot>
//
// It imports the COMPILED PRODUCTION MODULE from dist/ (no reimplementation),
// and for each mutation receipt it writes a one-line-patched copy of that same
// compiled module beside it so relative imports still resolve.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.argv[2] ?? process.cwd();
const capsuleDir = path.join(repoRoot, 'dist', 'core', 'session-host', 'process-capsule');
const productionModule = path.join(capsuleDir, 'darwin-best-effort-scope.js');

const MUTATIONS = {
  'leader-exit-keyed-escalation': {
    from: 'groupObservedEmpty = await pollGroupEmpty(groupId, intent.graceMs);',
    to: 'groupObservedEmpty = (await pollGroupEmpty(groupId, intent.graceMs)) || Boolean(state.rootExit);',
    describes: 'escalation keyed to leader exit instead of whole-group emptiness',
  },
  'leader-only-kill': {
    from: 'kill(-groupId, signal);',
    to: 'kill(groupId, signal);',
    describes: 'signals delivered to the leader alone instead of the whole group',
  },
};

const scratch = [];

function loadMutant(name) {
  const mutation = MUTATIONS[name];
  const source = fs.readFileSync(productionModule, 'utf8');
  if (!source.includes(mutation.from)) {
    throw new Error(`mutation anchor missing for ${name}: ${mutation.from}`);
  }
  const mutantPath = path.join(capsuleDir, `oracle-mutant-${name}.js`);
  fs.writeFileSync(mutantPath, source.replace(mutation.from, mutation.to), 'utf8');
  scratch.push(mutantPath);
  return import(pathToFileURL(mutantPath).href);
}

function loadProduction() {
  return import(pathToFileURL(productionModule).href);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function waitFor(predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function workspace(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(root);
  return root;
}

function leaderScript(factsPath, readyPath, options) {
  const descendantScript = options.descendant
    ? [
        options.descendantTrapsSigterm ? "process.on('SIGTERM', () => {});" : '',
        // Readiness is written only after the handler is installed, so the
        // oracle never races a not-yet-booted descendant with group SIGTERM.
        `require('node:fs').writeFileSync(${JSON.stringify(readyPath)}, '1');`,
        'setInterval(() => {}, 1000);',
      ].join('')
    : '';
  return [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    options.descendant
      ? [
          `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], {`,
          `  detached: ${options.descendantEscapes ? 'true' : 'false'}, stdio: 'ignore' });`,
          'child.unref();',
          `fs.writeFileSync(${JSON.stringify(factsPath)}, JSON.stringify({ leader: process.pid, descendant: child.pid }));`,
        ].join('')
      : `fs.writeFileSync(${JSON.stringify(factsPath)}, JSON.stringify({ leader: process.pid }));`,
    options.leaderTrapsSigterm ? "process.on('SIGTERM', () => {});" : '',
    options.leaderExitCode !== undefined
      ? `setTimeout(() => process.exit(${options.leaderExitCode}), 30);`
      : '',
    options.leaderSelfSignal
      ? `setTimeout(() => process.kill(process.pid, '${options.leaderSelfSignal}'), 30);`
      : '',
    'setInterval(() => {}, 1000);',
  ].join('');
}

async function startScope(factory, leaderOptions) {
  const root = workspace('rasen-posix-preflight-');
  const factsPath = path.join(root, 'facts.json');
  const readyPath = path.join(root, 'descendant-ready');
  const scope = factory({ finalObservationMs: 1_500, pollIntervalMs: 20 });
  const prepared = await scope.prepare({
    command: process.execPath,
    args: ['-e', leaderScript(factsPath, readyPath, leaderOptions)],
    cwd: root,
    env: { HOME: process.env.HOME ?? root, PATH: process.env.PATH ?? '/usr/bin' },
  });
  const live = await prepared.activate();
  const seen = await waitFor(() => fs.existsSync(factsPath));
  if (!seen) throw new Error('workload never reported its facts');
  if (leaderOptions.descendant) {
    const ready = await waitFor(() => fs.existsSync(readyPath));
    if (!ready) throw new Error('descendant never reported readiness');
  }
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  return { scope, prepared, live, facts };
}

function cleanupPids(facts) {
  for (const pid of Object.values(facts)) {
    if (typeof pid === 'number' && alive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* test-owned pid */
      }
    }
  }
}

const results = [];

function report(id, label, expectation, observed, pass) {
  results.push({ id, label, expectation, observed, pass });
}

// 6.1 - leader exits instantly, real descendant survives.
async function oracle61(factory, variant) {
  const { scope, live, facts } = await startScope(factory, {
    descendant: true,
    descendantTrapsSigterm: true,
    leaderExitCode: 0,
  });
  await waitFor(() => !alive(facts.leader), 5_000);
  const receipt = await scope.terminate(live.ref, {
    reason: 'posix-preflight-6.1',
    graceMs: 300,
  });
  const descendantGone = await waitFor(() => !alive(facts.descendant), 3_000);
  cleanupPids(facts);
  return { receipt, descendantGone, variant };
}

// 6.2 - descendant traps SIGTERM and forces escalation.
async function oracle62(factory, variant) {
  const { scope, live, facts } = await startScope(factory, {
    descendant: true,
    descendantTrapsSigterm: true,
    leaderTrapsSigterm: true,
  });
  const receipt = await scope.terminate(live.ref, {
    reason: 'posix-preflight-6.2',
    graceMs: 300,
  });
  const descendantGone = await waitFor(() => !alive(facts.descendant), 3_000);
  const leaderGone = await waitFor(() => !alive(facts.leader), 3_000);
  cleanupPids(facts);
  return { receipt, descendantGone, leaderGone, variant };
}

// 6.3 - the flagship escape demonstration.
async function oracle63(factory) {
  const { scope, live, facts } = await startScope(factory, {
    descendant: true,
    descendantEscapes: true,
  });
  const receipt = await scope.terminate(live.ref, {
    reason: 'posix-preflight-6.3',
    graceMs: 300,
  });
  const escapeeAlive = alive(facts.descendant);
  const settled = await live.closed;
  cleanupPids(facts);
  return { receipt, escapeeAlive, settled };
}

// 6.4 - natural completion, exact root exit code and exact terminating signal.
async function oracle64(factory) {
  const exitCase = await startScope(factory, { leaderExitCode: 23 });
  const exitedRoot = await exitCase.live.rootExited;
  const exitedTerminal = await exitCase.live.closed;
  cleanupPids(exitCase.facts);

  const signalCase = await startScope(factory, { leaderSelfSignal: 'SIGTERM' });
  const signalledRoot = await signalCase.live.rootExited;
  const signalledTerminal = await signalCase.live.closed;
  cleanupPids(signalCase.facts);

  return { exitedRoot, exitedTerminal, signalledRoot, signalledTerminal };
}

async function main() {
  const production = await loadProduction();
  const productionFactory = (options) =>
    production.createDarwinBestEffortProcessScope(options);

  const correct61 = await oracle61(productionFactory, 'correct');
  report(
    '6.1-correct',
    'leader exits instantly, surviving descendant',
    'group SIGKILL at grace expiry removes the descendant; terminal emptiness-unproven',
    {
      descendantGone: correct61.descendantGone,
      forced: correct61.receipt.unproven?.forced,
      emptiness: correct61.receipt.unproven?.emptiness,
      outcome: correct61.receipt.unproven?.outcome,
    },
    correct61.descendantGone === true &&
      correct61.receipt.unproven?.forced === true &&
      correct61.receipt.unproven?.emptiness === 'unproven'
  );

  const mutantA = await loadMutant('leader-exit-keyed-escalation');
  const mutated61 = await oracle61(
    (options) => mutantA.createDarwinBestEffortProcessScope(options),
    'mutant'
  );
  report(
    '6.1-mutant',
    `MUTATION: ${MUTATIONS['leader-exit-keyed-escalation'].describes}`,
    'the guard must go RED: the descendant is left alive and no force happens',
    {
      descendantGone: mutated61.descendantGone,
      forced: mutated61.receipt.unproven?.forced,
      groupObservedEmpty: mutated61.receipt.unproven?.groupObservedEmpty,
    },
    mutated61.descendantGone === false && mutated61.receipt.unproven?.forced === false
  );

  const correct62 = await oracle62(productionFactory, 'correct');
  report(
    '6.2-correct',
    'descendant traps SIGTERM and forces escalation',
    'group SIGKILL removes both the trapping leader and the trapping descendant',
    {
      descendantGone: correct62.descendantGone,
      leaderGone: correct62.leaderGone,
      forced: correct62.receipt.unproven?.forced,
    },
    correct62.descendantGone === true &&
      correct62.leaderGone === true &&
      correct62.receipt.unproven?.forced === true
  );

  const mutantB = await loadMutant('leader-only-kill');
  const mutated62 = await oracle62(
    (options) => mutantB.createDarwinBestEffortProcessScope(options),
    'mutant'
  );
  report(
    '6.2-mutant',
    `MUTATION: ${MUTATIONS['leader-only-kill'].describes}`,
    'the guard must go RED: the descendant survives a completed cancel',
    { descendantGone: mutated62.descendantGone, leaderGone: mutated62.leaderGone },
    mutated62.descendantGone === false
  );

  const escape = await oracle63(productionFactory);
  const receiptText = JSON.stringify(escape.receipt);
  const claimsProof =
    /scope-empty/.test(receiptText) ||
    escape.receipt.state === 'closed' ||
    escape.receipt.unproven?.emptiness !== 'unproven' ||
    escape.settled.emptiness !== 'unproven';
  report(
    '6.3-escape-demo',
    'descendant leaves the group via setsid() and survives a completed cancel',
    'group observes empty, escapee lives, record still says emptiness-unproven and never proven-empty',
    {
      escapeeAlive: escape.escapeeAlive,
      groupObservedEmpty: escape.receipt.unproven?.groupObservedEmpty,
      emptiness: escape.receipt.unproven?.emptiness,
      settledOutcome: escape.settled.outcome,
      receiptText,
      claimsProof,
    },
    escape.escapeeAlive === true &&
      escape.receipt.unproven?.groupObservedEmpty === true &&
      escape.receipt.unproven?.emptiness === 'unproven' &&
      claimsProof === false
  );

  const natural = await oracle64(productionFactory);
  report(
    '6.4-natural-empty',
    'natural completion reports the exact root exit',
    'exact exit code XOR exact terminating signal; completion terminal still emptiness-unproven',
    {
      exitedRoot: natural.exitedRoot,
      exitedTerminal: {
        outcome: natural.exitedTerminal.outcome,
        emptiness: natural.exitedTerminal.emptiness,
      },
      signalledRoot: natural.signalledRoot,
      signalledTerminal: {
        outcome: natural.signalledTerminal.outcome,
        emptiness: natural.signalledTerminal.emptiness,
      },
    },
    natural.exitedRoot.code === 23 &&
      natural.exitedRoot.signal === null &&
      natural.exitedTerminal.emptiness === 'unproven' &&
      natural.signalledRoot.signal === 'SIGTERM' &&
      natural.signalledRoot.code === null &&
      natural.signalledTerminal.emptiness === 'unproven'
  );

  const provenance = {
    platform: process.platform,
    release: os.release(),
    node: process.version,
    host: os.hostname(),
    ranAt: new Date().toISOString(),
    acceptance: false,
    acceptanceNote:
      'NON-ACCEPTANCE (wrong OS). Real macOS receipts are required for tasks 7.1-7.6.',
  };
  console.log(JSON.stringify({ provenance, results }, null, 2));
  const failed = results.filter((entry) => !entry.pass);
  if (failed.length > 0) {
    console.error(`FAILED ORACLES: ${failed.map((entry) => entry.id).join(', ')}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const item of scratch) {
      try {
        fs.rmSync(item, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });
