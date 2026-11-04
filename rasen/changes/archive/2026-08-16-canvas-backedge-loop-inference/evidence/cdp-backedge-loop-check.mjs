#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-backedge-loop-inference task 5.1.
//
// Same safety posture as children 1-2's drivers: direct CDP over `localhost`
// against a throwaway Chrome (`--remote-debugging-port=9339` + fresh temp
// `--user-data-dir`), never the user's daily browser and never cdp-proxy.mjs
// (which hardwires 127.0.0.1, a binding this Chrome refuses). Ports 9333-9338
// were busy with sibling sessions' checks, so this run owns 9339; the app
// server owns 4531.
//
// Phase A (FIRST, per the portfolio's standing order): the m2 box-select
// repeat-probe — several Shift+drag rectangles over KNOWN-contained node
// sets, asserting FULL membership per attempt, with NO Control+click
// correction (this is measurement, not workflow). If the containment miss
// reproduces it is recorded and routed to child 1 — not fixed here.
//
// Phase B: the back-edge flow end-to-end — author lead -> b -> c -> d ->
// finish by palette gestures and real handle-to-handle drags, set definition
// outcomes, draw the back-edge d -> b (a real cycle-closing drag), verify the
// refusal toast AND the loop review with computed region + derived defaults,
// exercise the invalid-iteration block, repair, pick the second exit outcome,
// confirm, and verify the synthesized loop (region gone, externals rewired
// onto the loop's derived ports, loop selected, declaration row, editable
// bound, explicit palette gesture still works). All verification in-memory
// (the canvas Save persistence defect is out of scope).

const DEBUG_HTTP = 'http://localhost:9339';
const APP_ORIGIN = 'http://127.0.0.1:4531';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-backedge-check`;
const TOKEN = process.env.RASEN_UI_TOKEN;
const EVIDENCE_DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

if (!TOKEN) {
  console.error('RASEN_UI_TOKEN env var required (the minted session token).');
  process.exit(2);
}

const results = [];
const probe = { attempts: [], reproduced: false };
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

async function mouseDrag({ from, to, modifiers = 0 }) {
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
      clickCount: 1,
      modifiers,
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
    modifiers,
  });
  await sleep(400);
}

/** Shift+drag box-select (real keydown around the drag — child-1's note). */
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

async function nodeRect(id) {
  return evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`
  );
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

async function nodeCenter(id) {
  return evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  );
}

async function connectNodes(fromId, toId) {
  const from = await evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(fromId)}] .react-flow__handle.source[data-handleid="done"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  );
  const to = await evalJS(
    `(() => { const el = document.querySelector('.react-flow__node[data-id=${JSON.stringify(toId)}] .react-flow__handle.target'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`
  );
  if (!from || !to) throw new Error(`missing handles for ${fromId} -> ${toId}`);
  await mouseDrag({ from, to });
}

/** Forward-edge draw with the fit-view + reachability + landed verification (child-2's retry). */
async function connectWithRetry(fromId, toId, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await clickSelector('.react-flow__controls-fitview');
    await sleep(600);
    const reachable = await evalJS(
      `(() => {
        const src = document.querySelector('.react-flow__node[data-id=${JSON.stringify(fromId)}] .react-flow__handle.source[data-handleid="done"]');
        const dst = document.querySelector('.react-flow__node[data-id=${JSON.stringify(toId)}] .react-flow__handle.target');
        if (!src || !dst) return 'missing-handle';
        const pt = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        const hit = (p) => { const el = document.elementFromPoint(p.x, p.y); return !!el && el.classList.contains('react-flow__handle'); };
        const s = pt(src), d = pt(dst);
        return (hit(s) ? '' : 'src-covered ') + (hit(d) ? '' : 'dst-covered ') || 'ok';
      })()`
    );
    if (reachable !== 'ok') {
      console.log(`[retry] ${fromId}->${toId} attempt ${attempt}: ${reachable}`);
    }
    await connectNodes(fromId, toId);
    await sleep(600);
    const landed = await evalJS(
      `Array.from(document.querySelectorAll('.react-flow__edge')).some(e => e.dataset.id.startsWith(${JSON.stringify(`${fromId}:`)})) && Array.from(document.querySelectorAll('.react-flow__edge')).some(e => e.dataset.id.includes(${JSON.stringify(`->${toId}:`)}))`
    );
    if (landed) {
      if (attempt > 1) console.log(`[retry] ${fromId}->${toId} landed on attempt ${attempt}`);
      return;
    }
    console.log(`[retry] ${fromId}->${toId} did not land (attempt ${attempt})`);
  }
  throw new Error(`could not draw edge ${fromId} -> ${toId} after ${attempts} attempts`);
}

/**
 * The BACK-EDGE draw: identical mechanics, but the edge never lands — the
 * expected outcome is the loop review opening (plus the refusal toast). Retry
 * on the review panel, not on an edge.
 */
async function drawBackedgeWithRetry(fromId, toId, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await clickSelector('.react-flow__controls-fitview');
    await sleep(600);
    const reachable = await evalJS(
      `(() => {
        const src = document.querySelector('.react-flow__node[data-id=${JSON.stringify(fromId)}] .react-flow__handle.source[data-handleid="done"]');
        const dst = document.querySelector('.react-flow__node[data-id=${JSON.stringify(toId)}] .react-flow__handle.target');
        if (!src || !dst) return 'missing-handle';
        const pt = (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
        const hit = (p) => { const el = document.elementFromPoint(p.x, p.y); return !!el && el.classList.contains('react-flow__handle'); };
        const s = pt(src), d = pt(dst);
        return (hit(s) ? '' : 'src-covered ') + (hit(d) ? '' : 'dst-covered ') || 'ok';
      })()`
    );
    if (reachable !== 'ok') {
      console.log(`[backedge] attempt ${attempt}: ${reachable}`);
    }
    await connectNodes(fromId, toId);
    await sleep(600);
    const reviewOpen = await evalJS(
      `!!document.querySelector('[data-testid="v2-loop-review-panel"]')`
    );
    if (reviewOpen) {
      if (attempt > 1) console.log(`[backedge] review opened on attempt ${attempt}`);
      return;
    }
    console.log(`[backedge] review did not open (attempt ${attempt})`);
  }
  throw new Error(`back-edge ${fromId} -> ${toId} did not open the loop review after ${attempts} attempts`);
}

/**
 * One m2 PROBE attempt (measurement only — no correction): a verified
 * rectangle over `targets`, excluding `others`; returns the selection RF
 * actually produced.
 */
async function probeBoxSelect(targets, others, label) {
  await clickSelector('.react-flow__controls-fitview');
  await sleep(600);
  const rects = [];
  for (const id of targets) {
    const rect = await nodeRect(id);
    if (!rect) throw new Error(`probe ${label}: node ${id} missing`);
    rects.push(rect);
  }
  const pad = 4;
  const to = {
    x: Math.max(...rects.map((r) => r.x + r.width)) + pad,
    y: Math.max(...rects.map((r) => r.y + r.height)) + pad,
  };
  let from = { x: Math.min(...rects.map((r) => r.x)) + 10, y: Math.min(...rects.map((r) => r.y)) - 30 };
  for (let tries = 0; tries < 6; tries++) {
    const isPane = await evalJS(
      `(() => { const el = document.elementFromPoint(${from.x}, ${from.y}); return !!el && el.classList.contains('react-flow__pane'); })()`
    );
    if (isPane) break;
    from = { x: from.x, y: from.y - 12 };
  }
  const startsOnPane = (await evalJS(
    `(() => { const el = document.elementFromPoint(${from.x}, ${from.y}); return !!el && el.classList.contains('react-flow__pane'); })()`
  )) === true;
  const othersClear = (
    await Promise.all(
      others.map(async (id) => {
        const rect = await nodeRect(id);
        if (!rect) return true;
        return !(rect.x < to.x && rect.x + rect.width > from.x && rect.y < to.y && rect.y + rect.height > from.y);
      })
    )
  ).every(Boolean);
  await boxSelect(from, to);
  const selected = await evalJS(
    `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n => n.dataset.id)`
  );
  const geometryOk = startsOnPane && othersClear;
  const full = geometryOk && JSON.stringify([...selected].sort()) === JSON.stringify([...targets].sort());
  probe.attempts.push({
    label,
    geometryOk,
    targets: [...targets].sort(),
    selected,
    fullMembership: full,
  });
  if (!full) probe.reproduced = true;
  console.log(
    `[probe] ${label}: geometry=${geometryOk ? 'ok' : 'BAD'} selected=${JSON.stringify(selected)} full=${full}`
  );
  // Clear the selection for the next attempt (pane click).
  await clickAt(await evalJS(
    `(() => { const el = document.querySelector('.react-flow__pane'); const r = el.getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; })()`
  ));
  return full;
}

const selectedNodeIds = `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n => n.dataset.id)`;
const edgeIds = `Array.from(document.querySelectorAll('.react-flow__edge')).map(e => e.dataset.id)`;

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

// 1. Land on a not-yet-existing pipeline and enter the editor.
await send('Page.navigate', { url: `${APP_ORIGIN}${CANVAS_PATH}#token=${TOKEN}` });
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-not-found"]')`, 15000, 'not-found surface');
await screenshot('01-not-found.png');
await clickSelector('[data-testid="pipeline-canvas-start-assembling"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-save"]')`, 10000, 'editor header');

// 2. Author the graph: four stages chained into a finish.
await waitFor(`!!document.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')`, 15000, 'palette stage gesture (catalog fetch)');
for (const id of ['atomic-stage', 'atomic-stage-2', 'atomic-stage-3', 'atomic-stage-4']) {
  await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
  await waitFor(`!!document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')`, 10000, `${id} node`);
}
await clickSelector('[data-testid="v2-palette-gesture-finish"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'finish node');
// The palette gestures UNION every added node into the selection — close the
// summary panel before any coordinate-based interaction (child-2's pitfall).
await clickSelector('button[aria-label="Close selection summary"]');
await sleep(300);
await clickAt(await evalJS(
  `(() => { const el = document.querySelector('.react-flow__pane'); const r = el.getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; })()`
));

// 3. Draw the chain lead -> b -> c -> d -> finish with real handle drags.
await connectWithRetry('atomic-stage', 'atomic-stage-2');
await connectWithRetry('atomic-stage-2', 'atomic-stage-3');
await connectWithRetry('atomic-stage-3', 'atomic-stage-4');
await connectWithRetry('atomic-stage-4', 'finish');
await clickSelector('.react-flow__controls-fitview');
await sleep(600);
let edges = await evalJS(edgeIds);
check(
  'four handle-to-handle drags produced the chained edges',
  edges.length === 4 &&
    edges.some((id) => id.startsWith('atomic-stage-3:') && id.includes('->atomic-stage-4:')) &&
    edges.some((id) => id.startsWith('atomic-stage-4:') && id.includes('->finish:')),
  JSON.stringify(edges)
);
await screenshot('02-authored-chain.png');

// 4. PHASE A — the m2 box-select repeat-probe, FIRST (measurement only).
//    Three verified rectangles over known-contained sets; any miss is
//    recorded and routed to child 1, not fixed here.
await probeBoxSelect(['atomic-stage-2', 'atomic-stage-3'], ['atomic-stage', 'atomic-stage-4', 'finish'], 'middle pair');
await probeBoxSelect(['atomic-stage-3'], ['atomic-stage', 'atomic-stage-2', 'atomic-stage-4', 'finish'], 'singleton');
await probeBoxSelect(['atomic-stage-2', 'atomic-stage-3', 'atomic-stage-4'], ['atomic-stage', 'finish'], 'region triple');
check(
  'm2 repeat-probe ran three verified rectangles',
  probe.attempts.length === 3 && probe.attempts.every((a) => a.geometryOk),
  probe.attempts.map((a) => `${a.label}:full=${a.fullMembership}`).join('; ')
);
if (probe.reproduced) {
  check(
    'm2 CONTAINMENT MISS REPRODUCED — recorded, routed to child 1 (not fixed here)',
    true,
    JSON.stringify(probe.attempts.map((a) => ({ label: a.label, selected: a.selected })))
  );
} else {
  check('m2 repeat-probe: FULL membership on every rectangle (no reproduction this run)', true);
}
await screenshot('03-m2-probe-done.png');

// 5. Give the definition two named outcomes (the exit-outcome select's set).
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="definition-outcomes"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, 'done,archived'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
);
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="definition-outcomes"]'); el.blur(); return true; })()`
);
await sleep(300);

// 6. PHASE B — draw the back-edge d -> b (real cycle-closing drag).
await drawBackedgeWithRetry('atomic-stage-4', 'atomic-stage-2');

// The refusal toast stands (draw-time), byte-identical to the pre-change text.
const toast = await evalJS(`document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`);
check(
  'draw-time refusal toast stands',
  toast === 'Rejected: atomic-stage-4 → atomic-stage-2 would create a cycle',
  String(toast)
);

// The review opened prefilled from the computed region + derivation.
const endpoints = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-endpoints"]')?.textContent ?? null`
);
check('review shows the drawn back-edge endpoints', endpoints !== null && endpoints.includes('atomic-stage-4') && endpoints.includes('atomic-stage-2'), String(endpoints));
const region = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-region"]')?.textContent ?? null`
);
check(
  'review shows the enclosed region (3 stages, endpoints included, finish excluded)',
  region !== null && region.includes('(3)') && ['atomic-stage-2', 'atomic-stage-3', 'atomic-stage-4'].every((id) => region.includes(id)) && !region.includes('finish'),
  String(region)
);
const reviewId = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-id"]')?.value ?? null`
);
check('review defaults the declaration id to "loop-body"', reviewId === 'loop-body', String(reviewId));
const reviewBound = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-max-iterations"]')?.value ?? null`
);
check('review defaults the iteration bound to 3', reviewBound === '3', String(reviewBound));
const exitSelect = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-exit-outcome"]')?.value ?? null`
);
check('review defaults the exit outcome to the first definition outcome', exitSelect === 'done', String(exitSelect));
const derivedOutcome = await evalJS(
  `document.querySelector('[data-testid="v2-loop-review-outcomes"]')?.value ?? null`
);
check('review derived the outcome named after the severed source stage', derivedOutcome === 'atomic-stage-4', String(derivedOutcome));
await screenshot('04-review-open-with-defaults.png');

// 7. The invalid-iteration block (the authoring-draft-errors discipline).
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-loop-review-max-iterations"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
);
await sleep(300);
const boundInvalid = await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-loop-review-max-iterations"]'); return { invalid: el.getAttribute('aria-invalid'), confirm: document.querySelector('[data-testid="v2-loop-review-confirm"]')?.disabled ?? null, error: document.querySelector('[data-testid="integer-contract-error"]')?.textContent ?? null }; })()`
);
check(
  'an invalid bound blocks confirm in the real browser',
  boundInvalid.invalid === 'true' && boundInvalid.confirm === true && /positive integer/.test(boundInvalid.error ?? ''),
  JSON.stringify(boundInvalid)
);
await screenshot('05-invalid-bound-blocks-confirm.png');

// 8. Repair the bound and pick the second exit outcome.
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-loop-review-max-iterations"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '5'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
);
await sleep(300);
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-loop-review-exit-outcome"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, 'archived'); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
);
await sleep(300);

// 9. Confirm. Wait out the draw-time toast's 2500ms clear timer first, so
//    the success toast gets its own clean window (its setTimeout(() =>
//    setToast('')) would otherwise clobber the newer message mid-read).
await sleep(2600);
await clickSelector('[data-testid="v2-loop-review-confirm"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="bounded-loop"]')`, 10000, 'the bounded-loop node');
await sleep(500);

const confirmToast = await evalJS(`document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`);
check('success toast names the loop synthesis', confirmToast !== null && confirmToast.includes("Loop created from back-edge over 3 stages ('loop-body')."), String(confirmToast));
check('review dialog closed after confirm', (await evalJS(`!document.querySelector('[data-testid="v2-loop-review-panel"]')`)) === true);
const remainingNodes = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check(
  'root graph is lead, finish, and one bounded-loop (the region left the root)',
  JSON.stringify(remainingNodes) === JSON.stringify(['atomic-stage', 'finish', 'bounded-loop']),
  JSON.stringify(remainingNodes)
);
let selected = await evalJS(selectedNodeIds);
check('the loop IS the selection after confirm', JSON.stringify(selected) === JSON.stringify(['bounded-loop']), JSON.stringify(selected));
const loopPanelNode = await evalJS(`document.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node') ?? null`);
check('the loop node panel is open', loopPanelNode === 'bounded-loop', String(loopPanelNode));
const panelBound = await evalJS(`document.querySelector('[data-testid="v2-node-panel-max-rounds"]')?.value ?? null`);
check("the loop's properties panel shows the author's repaired bound", panelBound === '5', String(panelBound));

// The loop renders the DERIVED ports the rewire targeted.
const loopTargetHandle = await evalJS(
  `document.querySelector('.react-flow__node[data-id="bounded-loop"] .react-flow__handle.target[data-handleid="atomic-stage-2"]') !== null`
);
check('loop renders the derived input port (named after the severed target stage)', loopTargetHandle === true);
const loopSourceHandle = await evalJS(
  `document.querySelector('.react-flow__node[data-id="bounded-loop"] .react-flow__handle.source[data-handleid="atomic-stage-4"]') !== null`
);
check('loop renders the derived outcome port as its source handle', loopSourceHandle === true);

// The root graph is rewired lead -> loop -> finish; the back-edge is nowhere.
edges = await evalJS(edgeIds);
check(
  'root rewired lead->loop and loop->finish; no back-edge edge exists',
  edges.length === 2 &&
    edges.includes('atomic-stage:done->bounded-loop:atomic-stage-2') &&
    edges.includes('bounded-loop:atomic-stage-4->finish:input') &&
    !edges.some((id) => id.startsWith('atomic-stage-4:done->atomic-stage-2')),
  JSON.stringify(edges)
);
await screenshot('06-loop-synthesized-rewired.png');

// 10. The declarations panel lists the custom row; the explicit palette
//     gesture still works after a synthesis (no capability hole).
const rowProvenance = await evalJS(
  `document.querySelector('[data-testid="declaration-row"][data-declaration-id="loop-body"]')?.getAttribute('data-provenance') ?? null`
);
check('declarations panel lists the loop body as a custom row', rowProvenance === 'custom', String(rowProvenance));
await clickSelector('[data-testid="v2-palette-gesture-loop"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="bounded-loop-2"]')`, 10000, 'second loop node (explicit gesture)');
const afterGesture = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check(
  'the explicit palette loop gesture still mints a BoundedLoop over the body declaration',
  JSON.stringify(afterGesture) === JSON.stringify(['atomic-stage', 'finish', 'bounded-loop', 'bounded-loop-2']),
  JSON.stringify(afterGesture)
);
await screenshot('07-explicit-gesture-still-works.png');

// 11. Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-backedge-loop-inference task 5.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 4531\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\` — chunk \`PipelineCanvasPage-DoKwXOt1.js\`, verified to contain \`v2-loop-review-panel\`)`,
  `- Browser: throwaway Chrome 151 headless (\`--remote-debugging-port=9339\` + fresh temp \`--user-data-dir\`); ports 9333-9338 were busy with sibling sessions' checks, so this run owned 9339. The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## Phase A — m2 box-select repeat-probe (FIRST, per the portfolio standing order)',
  '',
  ...probe.attempts.map(
    (a) =>
      `- ${a.label}: geometry ${a.geometryOk ? 'verified' : 'BAD'}; expected ${JSON.stringify(a.targets)}; got ${JSON.stringify(a.selected)}; full membership ${a.fullMembership ? 'YES' : '**NO**'}`
  ),
  '',
  probe.reproduced
    ? '**The containment miss REPRODUCED.** Recorded here and routed to child 1 (canvas-multi-selection) as a follow-up — NOT fixed in this change, per the standing order. This change\'s back-edge flow does not lean on box-select and proceeded unaffected.'
    : 'No reproduction this run: every verified rectangle selected its full contained set. (Child 2\'s original observation remains a one-run phenomenon pending further reproduction.)',
  '',
  '## Phase B — back-edge loop inference end-to-end',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-not-found.png, 02-authored-chain.png, 03-m2-probe-done.png, 04-review-open-with-defaults.png, 05-invalid-bound-blocks-confirm.png, 06-loop-synthesized-rewired.png, 07-explicit-gesture-still-works.png',
  '',
  `## Result: ${allOk ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} (m2 probe ${probe.reproduced ? 'REPRODUCED — routed to child 1' : 'not reproduced'})`,
  '',
];
writeFileSync(`${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-transcript.md`, lines.join('\n'));
writeFileSync(
  `${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-results.json`,
  JSON.stringify({ allOk, m2Probe: probe, results }, null, 2)
);
console.log(allOk ? '[cdp] ALL CHECKS PASSED' : '[cdp] FAILURES PRESENT');
process.exit(allOk ? 0 : 1);
