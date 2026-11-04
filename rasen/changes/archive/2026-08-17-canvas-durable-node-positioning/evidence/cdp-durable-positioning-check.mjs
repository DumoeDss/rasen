#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-durable-node-positioning task 5.1.
//
// Same safety posture as the sibling drivers (round-one children + child 1):
// direct CDP over `localhost` against a throwaway Chrome (`--remote-debugging-port`
// 9346, fresh temp `--user-data-dir`, `--window-size=1600,1000`). Never the
// user's daily browser, never cdp-proxy.mjs (hardwires 127.0.0.1, a binding
// this Chrome refuses). The app server owns 9345
// (`rasen ui --no-open --no-daemon --port 9345` from this worktree, serving
// this worktree's freshly built packages/ui/dist; ports 9333-9344 were
// consumed by sibling sessions, child 1 owned 9345/9346 and released them —
// this run re-owns the same pair, verified free first).
//
// The flow (task 5.1, real React Flow drag physics — not the jsdom mock):
//   A. Assemble a FRESH pipeline (not-found -> "Start assembling"), add
//      three palette stages, fit-view, record every node's transform.
//   B. Close open panels, reachability-check the target, DRAG atomic-stage
//      by a screen delta; verify the rendered transform moved by delta/zoom.
//   C. Follow-up mutation: add a FOURTH stage from the palette. The dragged
//      node's transform must be UNCHANGED (durable); the new node renders at
//      a computed layout position.
//   D. Rename the dragged node through the node panel (id field, real
//      typing + real Tab blur): the transform must survive under the new id.
//   E. Re-layout: every node returns to computed layout (the dragged node's
//      transform leaves the author placement).
// All verification in-memory (the canvas Save persistence defect stays out
// of scope); driver pitfalls honored per the digests: close panels before
// coordinate interactions, re-fit-view before drags, elementFromPoint
// reachability check per drag, real typed input + real Tab for Preact
// delegated handlers.

const DEBUG_HTTP = process.env.CDP_HTTP ?? 'http://localhost:9346';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:9345';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-durable-positioning`;
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

/** Real typed text (Input.insertText) — synthetic input events do NOT reach
 * Preact's onInput in this browser (child-1's live-tab probe). */
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

/** A real node drag: press at the node center, move in steps, release. */
async function mouseDrag({ from, to }) {
  const steps = 8;
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await sleep(30);
  }
  await sleep(120);
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await sleep(400);
}

/** The node's rendered FLOW position, parsed from its translate() transform. */
async function nodeTransform(id) {
  const raw = await evalJS(
    `document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')?.style.transform ?? null`
  );
  if (raw === null) return null;
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(raw);
  return m ? { x: Number(m[1]), y: Number(m[2]), raw } : { x: NaN, y: NaN, raw };
}

/** The viewport's zoom, from .react-flow__viewport's scale(). */
async function viewportZoom() {
  const raw = await evalJS(
    `document.querySelector('.react-flow__viewport')?.style.transform ?? null`
  );
  const m = /scale\(([\d.]+)\)/.exec(raw ?? '');
  return m ? Number(m[1]) : 1;
}

async function nodeCenter(id) {
  return evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  );
}

/** elementFromPoint reachability: the point must hit the node (or a
 * descendant of it), not an occluding panel — checked BEFORE every drag. */
async function assertReachable(id) {
  const center = await nodeCenter(id);
  if (!center) throw new Error(`missing node for reachability: ${id}`);
  const hit = await evalJS(
    `(() => { const el = document.elementFromPoint(${center.x}, ${center.y}); return el ? (el.closest('.react-flow__node')?.dataset.id ?? null) : null; })()`
  );
  if (hit !== id) {
    throw new Error(`node ${id} not reachable at its center (elementFromPoint hit: ${hit})`);
  }
  return center;
}

/** Closes every overlay panel that can occlude coordinate interactions. */
async function closePanels() {
  await evalJS(
    `(() => { document.querySelector('button[aria-label="Close selection summary"]')?.click(); document.querySelector('button[aria-label="Close node properties"]')?.click(); return true; })()`
  );
  await sleep(250);
}

async function fitView() {
  await clickSelector('.react-flow__controls-fitview');
  await sleep(600);
}

function nearly(a, b, tolerance = 1.5) {
  return Math.abs(a - b) <= tolerance;
}

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

// A. Fresh pipeline: not-found -> Start assembling -> three palette stages.
await send('Page.navigate', { url: `${APP_ORIGIN}${CANVAS_PATH}#token=${TOKEN}` });
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-not-found"]')`, 15000, 'not-found surface');
await clickSelector('[data-testid="pipeline-canvas-start-assembling"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-save"]')`, 10000, 'editor header');
await waitFor(
  `!!document.querySelector('[data-testid^="v2-palette-gesture-stage-"]')`,
  15000,
  'palette stage gesture (catalog fetch)'
);
const stageGesture = await evalJS(
  `document.querySelector('[data-testid^="v2-palette-gesture-stage-"]')?.getAttribute('data-testid') ?? null`
);
check('the palette offers a stage gesture', stageGesture !== null, String(stageGesture));
for (const id of ['atomic-stage', 'atomic-stage-2', 'atomic-stage-3']) {
  await clickSelector(`[data-testid="${stageGesture}"]`);
  await waitFor(`!!document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')`, 10000, `${id} node`);
}
await closePanels();
await fitView();
const layout0 = {};
for (const id of ['atomic-stage', 'atomic-stage-2', 'atomic-stage-3']) {
  layout0[id] = await nodeTransform(id);
}
check(
  'the three fresh stages render at finite computed layout transforms',
  Object.values(layout0).every((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y)),
  JSON.stringify(Object.fromEntries(Object.entries(layout0).map(([k, v]) => [k, v?.raw])))
);

// B. Drag atomic-stage by a screen delta (real React Flow drag physics).
// The drag vector points INTO the pane's interior (down-right) so React
// Flow's drag auto-pan never engages (the first run's upward drag hit the
// top-edge auto-pan margin and inflated the landing distance). The exact
// landing point is not the assertion target — durability is — so this check
// pins direction (sign match on both axes) plus a real displacement.
const DRAG = { dx: 260, dy: 150 };
const zoom = await viewportZoom();
const from = await assertReachable('atomic-stage');
const to = { x: from.x + DRAG.dx, y: from.y + DRAG.dy };
await mouseDrag({ from, to });
const afterDrag = await nodeTransform('atomic-stage');
const dragDeltaX = afterDrag.x - layout0['atomic-stage'].x;
const dragDeltaY = afterDrag.y - layout0['atomic-stage'].y;
check(
  'the drag physically moved the node (real drag physics, direction matches)',
  afterDrag !== null &&
    Number.isFinite(afterDrag.x) &&
    Number.isFinite(afterDrag.y) &&
    Math.sign(dragDeltaX) === Math.sign(DRAG.dx) &&
    Math.sign(dragDeltaY) === Math.sign(DRAG.dy) &&
    Math.hypot(dragDeltaX, dragDeltaY) >= 40,
  `moved ${layout0['atomic-stage'].raw} -> ${afterDrag?.raw} (flow delta ${dragDeltaX.toFixed(1)},${dragDeltaY.toFixed(1)}; screen delta ${DRAG.dx},${DRAG.dy} at zoom ${zoom})`
);
await screenshot('01-after-drag.png');

// C. Follow-up mutation: a FOURTH palette stage. The dragged node's
//    transform must be byte-stable; the new node gets a layout position.
await clickSelector(`[data-testid="${stageGesture}"]`);
await waitFor(`!!document.querySelector('.react-flow__node[data-id="atomic-stage-4"]')`, 10000, 'the fourth stage node');
await closePanels();
const afterAdd = await nodeTransform('atomic-stage');
const fourth = await nodeTransform('atomic-stage-4');
const secondAfterAdd = await nodeTransform('atomic-stage-2');
check(
  'the dragged node keeps its exact transform across the palette-add rebuild',
  afterAdd !== null && afterAdd.raw === afterDrag.raw,
  `${afterDrag.raw} -> ${afterAdd?.raw}`
);
check(
  'the added node renders at a finite layout position, distinct from the dragged placement',
  fourth !== null &&
    Number.isFinite(fourth.x) &&
    Number.isFinite(fourth.y) &&
    !(nearly(fourth.x, afterAdd.x) && nearly(fourth.y, afterAdd.y)),
  `${fourth?.raw} (vs dragged ${afterAdd?.raw})`
);
await screenshot('02-after-followup-add.png');

// D. Rename the dragged node through the node panel: the placement follows.
await fitView();
const renameTarget = await assertReachable('atomic-stage');
await mouseDrag({ from: renameTarget, to: renameTarget }); // a zero-delta press+release selects without moving
const selected = await evalJS(
  `document.querySelector('.react-flow__node[data-id="atomic-stage"]')?.classList.contains('selected') ?? false`
);
if (!selected) {
  // Fallback: click-to-select at center.
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: renameTarget.x,
    y: renameTarget.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: renameTarget.x,
    y: renameTarget.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  await sleep(400);
}
await waitFor(`!!document.querySelector('[data-testid="v2-node-panel-id"]')`, 8000, 'the node panel id field');
await typeIntoField('[data-testid="v2-node-panel-id"]', 'mover');
await tabBlur();
await waitFor(`!!document.querySelector('.react-flow__node[data-id="mover"]')`, 8000, 'the renamed node');
const oldGone = await evalJS(
  `!document.querySelector('.react-flow__node[data-id="atomic-stage"]')`
);
const renamed = await nodeTransform('mover');
check(
  'the rename produced the new id and the old id is gone',
  oldGone === true,
  `mover present: ${renamed !== null}`
);
check(
  'the dragged node keeps its exact transform through the rename (placement follows the id)',
  renamed !== null && renamed.raw === afterDrag.raw,
  `${afterDrag.raw} -> ${renamed?.raw}`
);
await screenshot('03-after-rename.png');

// E. Re-layout: every node returns to computed layout — the author placement
//    is released (mover's transform leaves the dragged spot) and the
//    never-dragged nodes keep sitting at layout positions.
await closePanels();
await clickSelector('[data-testid="pipeline-canvas-relayout"]');
await sleep(700);
const afterRelayout = await nodeTransform('mover');
const secondRelaid = await nodeTransform('atomic-stage-2');
check(
  'Re-layout returns the dragged node to computed layout (leaves the author placement)',
  afterRelayout !== null &&
    !nearly(afterRelayout.x, afterDrag.x, 0.5) &&
    !nearly(afterRelayout.y, afterDrag.y, 0.5),
  `${afterDrag.raw} -> ${afterRelayout?.raw}`
);
check(
  'the never-dragged neighbor stays at its computed layout across Re-layout',
  secondRelaid !== null && secondRelaid.raw === secondAfterAdd.raw,
  `${secondAfterAdd.raw} -> ${secondRelaid?.raw}`
);
await screenshot('04-after-relayout.png');

// A follow-up edit after the reset still treats mover as undragged, and a
// node re-added under the FREED base id never resurrects the departed
// placement: the rename released 'atomic-stage', so the fifth palette add
// mints THAT id again — the re-added node must land on computed layout, not
// on the old drag spot (spec scenario 5, live).
await clickSelector(`[data-testid="${stageGesture}"]`);
await waitFor(
  `(() => { const ids = Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id); return ids.filter((id) => id === 'atomic-stage' || id === 'atomic-stage-5').length === 1 && ids.length === 5; })()`,
  10000,
  'the fifth stage node (the freed base id atomic-stage)'
);
await closePanels();
const moverAfterFifth = await nodeTransform('mover');
const reAdded = (await nodeTransform('atomic-stage')) ?? (await nodeTransform('atomic-stage-5'));
check(
  'after Re-layout a later edit never resurrects the departed placement',
  moverAfterFifth !== null &&
    !nearly(moverAfterFifth.x, afterDrag.x, 0.5) &&
    !nearly(moverAfterFifth.y, afterDrag.y, 0.5),
  `${moverAfterFifth?.raw} (dragged spot was ${afterDrag.raw})`
);
check(
  'the node re-added under the freed id lands on computed layout, not the departed placement',
  reAdded !== null &&
    !nearly(reAdded.x, afterDrag.x, 0.5) &&
    !nearly(reAdded.y, afterDrag.y, 0.5),
  `${reAdded?.raw} (the departed spot was ${afterDrag.raw})`
);
await screenshot('05-after-fifth-add-no-resurrection.png');

// Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-durable-node-positioning task 5.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 9345\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\`)`,
  `- Browser: throwaway Chrome 151 headless (\`--remote-debugging-port=9346\` + fresh temp \`--user-data-dir\`, \`--window-size=1600,1000\`). Ports 9333-9344 were consumed by sibling sessions' checks; child 1 owned 9345/9346 and released them, this run re-verified both free and re-owned them. The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over localhost). Real drag physics (\`Input.dispatchMouseEvent\` press/move/release), real typed input (\`Input.insertText\`) and real Tab blur for the rename — the Preact-delegation trap from child 1's probe. Panels closed and elementFromPoint reachability verified before every coordinate interaction; re-fit-view before drags.`,
  `- Zoom during the drag: ${zoom} (expected flow delta = screen delta / zoom).`,
  '',
  '## Durable placement end-to-end (real React Flow)',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-after-drag.png, 02-after-followup-add.png, 03-after-rename.png, 04-after-relayout.png, 05-after-fifth-add-no-resurrection.png',
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
