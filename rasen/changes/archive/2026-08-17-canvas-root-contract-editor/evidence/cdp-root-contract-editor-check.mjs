#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-root-contract-editor task 6.1.
//
// Same safety posture as the sibling drivers (children 1-5 + g-003.5): direct
// CDP over `localhost` against a throwaway Chrome (`--remote-debugging-port`
// on a FRESH port — 9333-9344 were consumed by sibling sessions, so this run
// owns 9346 for CDP — plus fresh temp `--user-data-dir`, and
// `--window-size=1600,1000` so the flow column does not collapse). Never the
// user's daily browser, never cdp-proxy.mjs (which hardwires 127.0.0.1, a
// binding this Chrome refuses). The app server owns 9345
// (`rasen ui --no-open --no-daemon --port 9345`), serving this worktree's
// freshly built packages/ui/dist.
//
// The flow (task 6.1, the round-2 live-testing dead end end-to-end):
//   A. Assemble a FRESH pipeline (not-found -> "Start assembling"): a blank
//      v2 definition seeds `outcomes: []`.
//   B. Add two unconnected AtomicStages (both sinks produce `done`).
//   C. Press Validate against the REAL engine: observe the PORT_MISMATCH
//      ("terminal outcome 'done' ... not declared by the owner contract").
//   D. Click the issue: it selects the producing node, whose "Finish here"
//      offer now renders the EMPTY state (no outcomes declared) with the
//      locate action instead of an empty select + disabled confirm — the
//      pre-change dead end.
//   E. Click locate: the definition contract panel is on-screen and its
//      outcomes field is focused.
//   F. Declare `done` in the contract panel (focus, type, BLUR commit).
//   G. Press Validate again: the PORT_MISMATCH is cleared with no other
//      edit; the sink offer's select now offers exactly ['done'].
// No drags anywhere (two UNCONNECTED sinks), so none of the sibling
// drivers' handle-drag pitfalls apply; verification in-memory (the canvas
// Save persistence defect stays out of scope).

const DEBUG_HTTP = process.env.CDP_HTTP ?? 'http://localhost:9346';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:9345';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-root-contract-editor`;
const TOKEN = process.env.RASEN_UI_TOKEN;
const EVIDENCE_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (!TOKEN) {
  console.error('RASEN_UI_TOKEN env var required (the minted session token).');
  process.exit(2);
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- CDP plumbing over native WebSocket (Node 22+) ---
let ws;
let cmdId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++cmdId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 15000);
  });
}
function attachMessageHandler() {
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    }
  };
}

async function evalJS(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (r.exceptionDetails) {
    throw new Error(
      `eval failed: ${JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 500)}`
    );
  }
  return r.result.value;
}

async function waitFor(expression, timeoutMs = 10000, label = expression) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evalJS(expression)) return true;
    await sleep(200);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function clickSelector(selector) {
  const ok = await evalJS(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`
  );
  if (!ok) throw new Error(`missing element to click: ${selector}`);
  await sleep(300);
}

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${EVIDENCE_DIR.replace(/\\/g, '/')}${name}`, Buffer.from(r.data, 'base64'));
  console.log(`[shot] ${name}`);
}

/** Focus -> select -> REAL typed text (Input.insertText). Synthetic
 * `new Event('input')` does NOT reach Preact's onInput in this browser (the
 * first driver run failed exactly there: the DOM value changed while the
 * component state stayed empty, so the blur commit parsed the empty draft);
 * real input events do. Same for blur: a REAL Tab key, not el.blur(). */
async function typeIntoField(selector, text) {
  const ok = await evalJS(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.focus(); el.select?.(); return true; })()`
  );
  if (!ok) throw new Error(`missing element to type into: ${selector}`);
  await sleep(150);
  await send('Input.insertText', { text });
  await sleep(250);
}

/** A real blur: Tab moves focus to the next field natively. */
async function tabBlur() {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await sleep(120);
  }
  await sleep(400);
}

const drawerItems = `Array.from(document.querySelectorAll('[data-testid="issues-drawer-item"]')).map(el => el.textContent)`;
const chipText = `document.querySelector('[data-testid="pipeline-canvas-validation-result"]')?.textContent ?? null`;

// --- main ---
const tab = await (
  await fetch(`${DEBUG_HTTP}/json/new?${new URLSearchParams({ url: 'about:blank' })}`, { method: 'PUT' })
).json();
ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
attachMessageHandler();
await send('Runtime.enable');
await send('Page.enable');

console.log(`[cdp] tab: ${tab.id}`);

// A. Fresh pipeline: not-found -> Start assembling -> the blank v2 draft.
await send('Page.navigate', { url: `${APP_ORIGIN}${CANVAS_PATH}#token=${TOKEN}` });
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-not-found"]')`, 15000, 'not-found surface');
await clickSelector('[data-testid="pipeline-canvas-start-assembling"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-save"]')`, 10000, 'editor header');
const freshOutcomes = await evalJS(
  `document.querySelector('[data-testid="definition-outcomes"]')?.value ?? null`
);
check('the fresh definition declares no outcomes (blank seed)', freshOutcomes === '', JSON.stringify(freshOutcomes));

// B. Two unconnected AtomicStages — both terminal sinks.
await waitFor(
  `!!document.querySelector('[data-testid^="v2-palette-gesture-stage-"]')`,
  15000,
  'palette stage gesture (catalog fetch)'
);
const stageGesture = await evalJS(
  `document.querySelector('[data-testid^="v2-palette-gesture-stage-"]')?.getAttribute('data-testid') ?? null`
);
check('the palette offers a stage gesture', stageGesture !== null, String(stageGesture));
for (const id of ['atomic-stage', 'atomic-stage-2']) {
  await clickSelector(`[data-testid="${stageGesture}"]`);
  await waitFor(`!!document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')`, 10000, `${id} node`);
}
// The palette gesture unions the selection — close the summary panel so it
// cannot occlude coordinate interactions later (child-2's pitfall).
await clickSelector('button[aria-label="Close selection summary"]');
await sleep(250);
const nodeIdsAfterAdd = await evalJS(
  `Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`
);
check('exactly the two unconnected stage sinks are on the canvas', JSON.stringify(nodeIdsAfterAdd) === JSON.stringify(['atomic-stage', 'atomic-stage-2']), JSON.stringify(nodeIdsAfterAdd));
const edgesBefore = await evalJS(`Array.from(document.querySelectorAll('.react-flow__edge')).length`);
check('no connections were drawn (unconnected sinks)', edgesBefore === 0, String(edgesBefore));

// C. Validate against the REAL engine: the PORT_MISMATCH dead end appears.
await clickSelector('[data-testid="pipeline-canvas-validate"]');
await waitFor(`!!document.querySelector('[data-testid="issues-drawer-item"]')`, 10000, 'the issues drawer');
const preIssues = await evalJS(drawerItems);
const portMismatch = preIssues.find((text) => /PORT_MISMATCH/.test(text ?? ''));
check(
  'the real engine raises the PORT_MISMATCH naming terminal outcome done',
  portMismatch !== undefined && /done/.test(portMismatch),
  String(portMismatch)
);
await screenshot('01-port-mismatch.png');

// D. Click the issue: it selects the producing node; the "Finish here" offer
//    renders the EMPTY state with the locate action, not a dead-end select.
const mismatchItemSelect = await evalJS(
  `(() => { const items = Array.from(document.querySelectorAll('[data-testid="issues-drawer-item"]')); const hit = items.find(el => /PORT_MISMATCH/.test(el.textContent ?? '')); return hit ? !!hit.querySelector('[data-testid="issues-drawer-select"]') : false; })()`
);
check('the PORT_MISMATCH issue offers navigation to its target', mismatchItemSelect === true);
await evalJS(
  `(() => { const items = Array.from(document.querySelectorAll('[data-testid="issues-drawer-item"]')); const hit = items.find(el => /PORT_MISMATCH/.test(el.textContent ?? '')); hit.querySelector('[data-testid="issues-drawer-select"]').click(); return true; })()`
);
await sleep(400);
const panelNode = await evalJS(
  `document.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node') ?? null`
);
check('the issue click selects the producing sink node', panelNode === 'atomic-stage' || panelNode === 'atomic-stage-2', String(panelNode));
check(
  'the Finish-here offer renders (empty contract state)',
  (await evalJS(`!!document.querySelector('[data-testid="v2-node-panel-sink-promotion"]')`)) === true
);
check(
  'no dead-end outcome select is rendered',
  (await evalJS(`!document.querySelector('[data-testid="v2-node-panel-sink-outcome"]')`)) === true
);
const emptyText = await evalJS(
  `document.querySelector('[data-testid="v2-node-panel-sink-empty"]')?.textContent ?? null`
);
check('the empty state states that no outcomes are declared', emptyText !== null && /no outcomes/i.test(emptyText), String(emptyText));
await screenshot('02-issue-node-panel-empty-sink.png');

// E. Locate: the contract panel is on-screen and the outcomes field focused.
await clickSelector('[data-testid="v2-node-panel-sink-locate"]');
await sleep(400);
const activeTestid = await evalJS(`document.activeElement?.getAttribute('data-testid') ?? null`);
check('the locate action focuses the definition outcomes field', activeTestid === 'definition-outcomes', String(activeTestid));
const onScreen = await evalJS(
  `(() => { const el = document.querySelector('[data-testid="definition-contract-panel"]'); if (!el) return false; const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight; })()`
);
check('the definition contract panel is on-screen', onScreen === true);
await screenshot('03-locate-focused.png');

// F. Declare `done` through the contract panel: focus, REAL typing, REAL
//    blur (Tab) — the commit-on-blur idiom is what this change installs.
await typeIntoField('[data-testid="definition-outcomes"]', 'done');
await tabBlur();
const committed = await evalJS(
  `document.querySelector('[data-testid="definition-outcomes"]')?.value ?? null`
);
check('the outcomes field commits done on blur', committed === 'done', JSON.stringify(committed));
// The still-open sink offer re-renders as the select, offering exactly the
// declared outcome (pickers read the contract; they create none).
const sinkOptions = await evalJS(
  `Array.from(document.querySelectorAll('[data-testid="v2-node-panel-sink-outcome"] option')).map(o => o.value)`
);
check('the sink offer now offers exactly the declared outcome', JSON.stringify(sinkOptions) === JSON.stringify(['done']), JSON.stringify(sinkOptions));

// G. Validate again: the PORT_MISMATCH is cleared with no other edit. (A
//    stored-profile hygiene warning — "Dropping unknown workflow id(s)" —
//    is unrelated to this definition and may legitimately remain; the check
//    is ZERO ERRORS, and the drawer must not list the PORT_MISMATCH.)
await clickSelector('[data-testid="pipeline-canvas-validate"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-validation-result"]')`, 10000, 'the result chip');
await sleep(400);
const postIssues = await evalJS(drawerItems);
const postMismatch = (postIssues ?? []).find((text) => /PORT_MISMATCH/.test(text ?? ''));
check('the PORT_MISMATCH is gone after the declare', postMismatch === undefined, JSON.stringify(postIssues));
const chip = await evalJS(chipText);
check('the result chip reports zero errors', chip !== null && /0 errors|No issues/i.test(chip), String(chip));
const nodesAfter = await evalJS(
  `Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`
);
check('no other edit was made (the same two nodes, still unconnected)', JSON.stringify(nodesAfter) === JSON.stringify(['atomic-stage', 'atomic-stage-2']) && (await evalJS(`Array.from(document.querySelectorAll('.react-flow__edge')).length`)) === 0, JSON.stringify(nodesAfter));
await screenshot('04-declared-validate-clean.png');

// Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-root-contract-editor task 6.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 9345\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\`)`,
  `- Browser: throwaway Chrome headless (\`--remote-debugging-port=9346\` + fresh temp \`--user-data-dir\`, \`--window-size=1600,1000\`); ports 9333-9344 were consumed by sibling sessions' checks, so this run owned 9345 (app) and 9346 (CDP). The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## The undeclared-terminal-outcome flow end-to-end (real engine)',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-port-mismatch.png, 02-issue-node-panel-empty-sink.png, 03-locate-focused.png, 04-declared-validate-clean.png',
  '',
  `## Result: ${allOk ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'}`,
  '',
];
writeFileSync(`${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-transcript.md`, lines.join('\n'));
writeFileSync(
  `${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-results.json`,
  JSON.stringify({ allOk, results }, null, 2)
);
console.log(allOk ? '[cdp] ALL CHECKS PASSED' : '[cdp] FAILURES PRESENT');
process.exit(allOk ? 0 : 1);
