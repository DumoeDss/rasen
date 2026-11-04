#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-multi-selection task 5.1.
//
// Why not skills/experts/chrome-use/scripts/cdp-proxy.mjs (the repo's usual
// route): that proxy hardwires 127.0.0.1 for both discovery and its
// WebSocket, but this machine's Chrome 151 binds --remote-debugging-port on
// IPv6 ::1 only (127.0.0.1 is refused), so the proxy cannot reach a
// throwaway instance. This driver speaks CDP directly over `localhost`
// with the SAME safety properties the handoff mandates: a throwaway Chrome
// launched with --remote-debugging-port=9333 + a fresh temp
// --user-data-dir. The user's daily browser (stale DevToolsActivePort on
// 9222) is never touched.
//
// Scripted pass (task 5.1): Shift+drag box-select selects several nodes,
// Control+click augments (and toggles off), a follow-up palette add keeps
// the prior selection highlighted, deleting a multi-selection containing a
// parallel pair removes the pair, and the plain Delete key removes a
// deletable multi-selection. All verification stays in-memory — the canvas
// Save persistence defect is out of scope for this change.

const DEBUG_HTTP = 'http://localhost:9333';
const APP_ORIGIN = 'http://127.0.0.1:4523';
const CANVAS_PATH =
  '/p/e2ee72ed-04a1-4395-86aa-7e77d2b83ec7/pipelines/cdp-multi-sel-check';
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
  const path = `${EVIDENCE_DIR.replace(/\\/g, '/')}${name}`;
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  console.log(`[shot] ${name}`);
}

async function mouseDrag({ from, to, modifiers }) {
  const steps = 8;
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
      button: 'left',
      buttons: 1,
      modifiers,
    });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
  await sleep(400);
}

/**
 * Shift+drag box-select. React Flow arms selection-drag from the pane, and
 * its key tracking needs a REAL Shift keydown (a synthetic mouse event's
 * `modifiers` bit alone is not enough) — press the key, drag from a point
 * verified to sit on the pane (a drag that starts on a node is a node
 * drag), then release the key.
 */
async function boxSelect(from, to) {
  await send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 160,
    nativeVirtualKeyCode: 160,
    modifiers: 8,
  });
  await sleep(150);
  await mouseDrag({ from, to, modifiers: 8 });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Shift',
    code: 'ShiftLeft',
    windowsVirtualKeyCode: 160,
    nativeVirtualKeyCode: 160,
  });
  await sleep(200);
}

async function clickAt({ x, y }, modifiers = 0) {
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
  await sleep(400);
}

// React Flow tracks the multi-select key via its own keydown listeners — a
// synthetic mouse event's `modifiers` flag alone never reaches them — so a
// Control+click augment must press and release the real key around the
// click, exactly as a human would.
async function ctrlClickAt(point) {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 162,
    nativeVirtualKeyCode: 162,
    modifiers: 2,
  });
  await clickAt(point, 2);
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 162,
    nativeVirtualKeyCode: 162,
  });
  await sleep(200);
}

async function nodeRect(id) {
  return evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
  );
}

async function pressDeleteKey() {
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Delete',
    code: 'Delete',
    windowsVirtualKeyCode: 46,
    nativeVirtualKeyCode: 46,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Delete',
    code: 'Delete',
    windowsVirtualKeyCode: 46,
    nativeVirtualKeyCode: 46,
  });
  await sleep(400);
}

const selectedNodeIds = `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n => n.dataset.id)`;
const nodeCenter = (id) =>
  evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  );

// --- main ---
const tab = await (await fetch(`${DEBUG_HTTP}/json/new?${new URLSearchParams({ url: 'about:blank' })}`, { method: 'PUT' })).json();
const wsUrl = tab.webSocketDebuggerUrl;
ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
attachMessageHandler();
await send('Runtime.enable');
await send('Page.enable');

console.log(`[cdp] tab: ${tab.id}`);

// 1. Land on a not-yet-existing pipeline and enter the editor.
await send('Page.navigate', { url: `${APP_ORIGIN}${CANVAS_PATH}#token=${TOKEN}` });
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-not-found"]')`, 15000, 'not-found surface');
await screenshot('01-not-found.png');
await clickSelector('[data-testid="pipeline-canvas-start-assembling"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-save"]')`, 10000, 'editor header');

// 2. Author the graph: two stages, a parallel pair over them, a finish.
await waitFor(`!!document.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')`, 15000, 'palette stage gesture (catalog fetch)');
await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="atomic-stage"]')`, 10000, 'atomic-stage node');
await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="atomic-stage-2"]')`, 10000, 'atomic-stage-2 node');
await clickSelector('[data-testid="v2-palette-gesture-parallel"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="fan-out"]')`, 10000, 'fan-out node');
await clickSelector('[data-testid="v2-palette-gesture-finish"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'finish node');
const nodeCount = await evalJS(`document.querySelectorAll('.react-flow__node').length`);
check('authoring setup produced five nodes', nodeCount === 5, `nodes=${nodeCount}`);
// The authoring gestures create ISOLATED nodes (no edges yet), so dagre
// stacks them in one tall column that overflows the viewport — clicking
// React Flow's own fit-view control brings every node on-screen before
// any coordinate-based interaction. (A click at an off-viewport point hits
// nothing: verified with elementFromPoint during diagnosis.)
await clickSelector('.react-flow__controls-fitview');
await sleep(600);
await screenshot('02-authored-graph.png');

// 3. Shift+drag box-select around the two AtomicStages only. React Flow
//    selects every node whose rect INTERSECTS the drawn box, so the box
//    spans the union of the two target node rects (+ padding) while the
//    check asserts no other node rect intersects it. The drag STARTS on
//    bare pane to the left of the node column — a drag that starts on a
//    node is a node drag, never a selection box.
const r1 = await nodeRect('atomic-stage');
const r2 = await nodeRect('atomic-stage-2');
const others = [];
for (const id of ['fan-out', 'join', 'finish']) {
  const rect = await nodeRect(id);
  if (rect) others.push({ id, rect });
}
const pad = 4;
const paneRect = await evalJS(
  `(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
);
const from = {
  x: paneRect.x + 40,
  y: Math.min(r1.y, r2.y) - pad,
};
const to = {
  x: Math.max(r1.x + r1.width, r2.x + r2.width) + pad,
  y: Math.max(r1.y + r1.height, r2.y + r2.height) + pad,
};
const intersects = (rect) =>
  rect.x < to.x && rect.x + rect.width > from.x &&
  rect.y < to.y && rect.y + rect.height > from.y;
check(
  'box rectangle contains the two stage rects and intersects no other node',
  others.every(({ rect }) => !intersects(rect)),
  `from=(${from.x.toFixed(0)},${from.y.toFixed(0)}) to=(${to.x.toFixed(0)},${to.y.toFixed(0)})`
);
check(
  'box drag starts on the pane, not on a node',
  (await evalJS(
    `(() => { const el = document.elementFromPoint(${from.x}, ${from.y}); return !!el && el.classList.contains('react-flow__pane'); })()`
  )) === true
);
await boxSelect(from, to);
let selected = await evalJS(selectedNodeIds);
check('Shift+drag box-select selected exactly the two enclosed nodes', JSON.stringify(selected) === JSON.stringify(['atomic-stage', 'atomic-stage-2']), JSON.stringify(selected));
const counts1 = await evalJS(`document.querySelector('[data-testid="v2-selection-panel-counts"]')?.textContent ?? null`);
check('selection summary reports two nodes', counts1 !== null && counts1.includes('2 nodes'), counts1 ?? 'missing');
await screenshot('03-box-select-two-nodes.png');

// 4. Control+click augments the fan-out into the selection.
await ctrlClickAt(await nodeCenter('fan-out'));
selected = await evalJS(selectedNodeIds);
check('Control+click augmented the selection to three nodes', selected.length === 3 && selected.includes('fan-out'), JSON.stringify(selected));

// 5. Control+click on an already-selected node removes it.
await ctrlClickAt(await nodeCenter('atomic-stage'));
selected = await evalJS(selectedNodeIds);
check('Control+click on a selected node removed it', !selected.includes('atomic-stage') && selected.length === 2, JSON.stringify(selected));
await ctrlClickAt(await nodeCenter('atomic-stage'));
selected = await evalJS(selectedNodeIds);
check('Control+click re-added the node (three again)', selected.length === 3, JSON.stringify(selected));

// 6. A follow-up palette add keeps the prior selection highlighted.
await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="atomic-stage-3"]')`, 10000, 'atomic-stage-3 node');
await sleep(300);
selected = await evalJS(selectedNodeIds);
check(
  'palette add kept the three previously selected nodes selected',
  selected.includes('atomic-stage') &&
    selected.includes('atomic-stage-2') &&
    selected.includes('fan-out') &&
    selected.length === 4,
  JSON.stringify(selected)
);
await screenshot('04-selection-survives-palette-add.png');

// 7. Delete the multi-selection containing the parallel pair (the summary
//    panel's delete action — the Delete key itself cannot remove FanOut/
//    Join, which are deliberately non-deletable nodes).
await clickSelector('[data-testid="v2-selection-panel-delete"]');
await waitFor(`!document.querySelector('.react-flow__node[data-id="fan-out"]')`, 10000, 'fan-out removed');
await sleep(300);
const remaining = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check(
  'deleting the selection removed the pair together (fan-out AND join) plus every selected node',
  JSON.stringify(remaining) === JSON.stringify(['finish']),
  JSON.stringify(remaining)
);
const toastAfterPair = await evalJS(`document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`);
check('pair deletion produced no refusal toast', toastAfterPair === null, toastAfterPair ?? 'none');
const panelAfterDelete = await evalJS(`!document.querySelector('[data-testid="v2-selection-panel"]') && !document.querySelector('[data-testid="v2-node-panel"]')`);
check('emptied selection closed every panel', panelAfterDelete === true);
await screenshot('05-pair-deleted-selection-pruned.png');

// 8. The plain Delete key removes a fully-deletable multi-selection:
//    author one more stage, box-select it together with finish, press Delete.
await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="atomic-stage"]')`, 10000, 'fresh atomic-stage node');
await clickSelector('.react-flow__controls-fitview');
await sleep(600);
const r3 = await nodeRect('atomic-stage');
const rFinish = await nodeRect('finish');
const from2 = { x: paneRect.x + 40, y: Math.min(r3.y, rFinish.y) - pad };
const to2 = {
  x: Math.max(r3.x + r3.width, rFinish.x + rFinish.width) + pad,
  y: Math.max(r3.y + r3.height, rFinish.y + rFinish.height) + pad,
};
await boxSelect(from2, to2);
selected = await evalJS(selectedNodeIds);
check('second box-select gathered the two remaining nodes', selected.length === 2, JSON.stringify(selected));
await pressDeleteKey();
await waitFor(`document.querySelectorAll('.react-flow__node').length === 0`, 10000, 'all nodes removed');
const remainingAfterKey = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check('Delete key removed the whole multi-selection', remainingAfterKey.length === 0, JSON.stringify(remainingAfterKey));
const panelGone = await evalJS(`!document.querySelector('[data-testid="v2-selection-panel"]')`);
check('selection summary closed with the emptied selection', panelGone);
await screenshot('06-delete-key-emptied-canvas.png');

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-multi-selection task 5.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 4523\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\` — verified by the served chunk hash \`PipelineCanvasPage-YNCyb9al.js\` containing \`v2-selection-panel\`)`,
  `- Browser: throwaway Chrome 151 (\`--remote-debugging-port=9333\` + fresh temp \`--user-data-dir\`); the user's daily Chrome and its 9222/3456 proxy were never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over IPv6 localhost; the repo's cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## Steps',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-not-found.png, 02-authored-graph.png, 03-box-select-two-nodes.png, 04-selection-survives-palette-add.png, 05-pair-deleted-selection-pruned.png, 06-delete-key-emptied-canvas.png',
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
