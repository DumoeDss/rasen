#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-subgraph-extraction task 5.1.
//
// Same safety posture as child 1's driver (canvas-multi-selection): direct
// CDP over `localhost` against a throwaway Chrome (`--remote-debugging-port`
// + fresh temp `--user-data-dir`), never the user's daily browser and never
// cdp-proxy.mjs (which hardwires 127.0.0.1, a binding this Chrome refuses).
// Ports 9333-9337 were busy with OTHER concurrent sessions' checks, so this
// run owns 9338.
//
// Scripted pass (task 5.1): author upstream -> b -> c -> finish by palette
// gestures and real handle-to-handle edge drags, Shift+drag box-select the
// middle pair, package it into a reusable block, rename the derived outcome
// in the review, confirm, then verify the ref renders with the derived input
// port and the EDITED outcome port, the root graph is rewired
// upstream->ref->finish, the declarations panel lists the custom row, and a
// second insert from that row adds another ref. All verification in-memory
// (the canvas Save persistence defect is out of scope).

const DEBUG_HTTP = 'http://localhost:9338';
const APP_ORIGIN = 'http://127.0.0.1:4524';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-extract-check`;
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

/** Shift+drag box-select (real keydown around the drag — see child-1 notes). */
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

/** Drags a real connection from one node's "done" source handle to another node's first target handle. */
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

/**
 * One handle drag occasionally fails to register when it races the previous
 * edge's re-layout (the first run lost exactly the middle edge this way) or
 * when a stacking layout buries a handle under another element. A human
 * re-fits the view and re-attempts; so does this: fit-view, verify BOTH
 * handle points are actually reachable (elementFromPoint must be the
 * handle), then drag with FRESH coordinates, and verify the edge landed.
 */
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

// 2. Author the graph: three stages chained into a finish.
await waitFor(`!!document.querySelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]')`, 15000, 'palette stage gesture (catalog fetch)');
for (const id of ['atomic-stage', 'atomic-stage-2', 'atomic-stage-3']) {
  await clickSelector('[data-testid="v2-palette-gesture-stage-rasen-propose"]');
  await waitFor(`!!document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')`, 10000, `${id} node`);
}
await clickSelector('[data-testid="v2-palette-gesture-finish"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'finish node');
const nodeCount = await evalJS(`document.querySelectorAll('.react-flow__node').length`);
check('authoring setup produced four nodes', nodeCount === 4, `nodes=${nodeCount}`);
await clickSelector('.react-flow__controls-fitview');
await sleep(600);
// The palette gestures UNION every added node into the selection, so the
// selection summary panel sits open over the right side of the canvas — the
// diagnostic run proved a handle under that panel is unreachable to a real
// drag (elementFromPoint at the handle returns the panel). Close it before
// any handle-to-handle interaction.
await clickSelector('button[aria-label="Close selection summary"]');
await sleep(300);

// 3. Draw the chain upstream -> b -> c -> finish with real handle drags.
await connectWithRetry('atomic-stage', 'atomic-stage-2');
await connectWithRetry('atomic-stage-2', 'atomic-stage-3');
await connectWithRetry('atomic-stage-3', 'finish');
// One connected chain: re-fit before any coordinate-based interaction.
await clickSelector('.react-flow__controls-fitview');
await sleep(600);
let edges = await evalJS(edgeIds);
check(
  'three handle-to-handle drags produced the chained edges',
  edges.length === 3 &&
    edges.filter((id) => id.startsWith('atomic-stage:') && id.includes('->atomic-stage-2:'))
      .length === 1 &&
    edges.filter((id) => id.startsWith('atomic-stage-2:') && id.includes('->atomic-stage-3:'))
      .length === 1 &&
    edges.filter((id) => id.startsWith('atomic-stage-3:') && id.includes('->finish:'))
      .length === 1,
  JSON.stringify(edges)
);
await screenshot('02-authored-chain.png');

// 4. Select the middle pair (the cut). Primary gesture: Shift+drag
//    box-select with geometry computed fresh per attempt (re-layouts move
//    nodes between edges). React Flow's rect-intersection occasionally
//    drops an enclosed node on a synthetic drag (observed twice on this
//    machine), so each attempt VERIFIES the selection and the platform's
//    own augmentation gesture — Control+click, child 1's verified surface —
//    corrects the set to exactly the pair. Every correction is logged.
const PAIR = ['atomic-stage-2', 'atomic-stage-3'];
let selected = [];
let boxAttemptLog = '';
for (let attempt = 1; attempt <= 3 && JSON.stringify(selected) !== JSON.stringify(PAIR); attempt++) {
  await clickSelector('.react-flow__controls-fitview');
  await sleep(600);
  const r1 = await nodeRect('atomic-stage-2');
  const r2 = await nodeRect('atomic-stage-3');
  const pad = 4;
  const to = {
    x: Math.max(r1.x + r1.width, r2.x + r2.width) + pad,
    y: Math.max(r1.y + r1.height, r2.y + r2.height) + pad,
  };
  // The horizontal chain puts the upstream stage in the column to the LEFT,
  // so the box starts INSIDE the pair's x-range, on bare pane ABOVE the
  // nodes — walk upward until the start point really is pane.
  let from = { x: r1.x + 10, y: Math.min(r1.y, r2.y) - 30 };
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
      ['atomic-stage', 'finish'].map(async (id) => {
        const rect = await nodeRect(id);
        if (!rect) return true;
        return !(rect.x < to.x && rect.x + rect.width > from.x && rect.y < to.y && rect.y + rect.height > from.y);
      })
    )
  ).every(Boolean);
  if (attempt === 1) {
    check('box drag starts on the pane, not on a node', startsOnPane);
    check('box rectangle contains the pair and intersects no other node', othersClear,
      `from=(${from.x.toFixed(0)},${from.y.toFixed(0)}) to=(${to.x.toFixed(0)},${to.y.toFixed(0)})`);
  }
  await boxSelect(from, to);
  selected = await evalJS(selectedNodeIds);
  boxAttemptLog += `attempt${attempt}=${JSON.stringify(selected)} `;
  if (JSON.stringify(selected) === JSON.stringify(PAIR)) break;
  if (attempt === 3) {
    // Correct via the platform's own augmentation gesture (verified in
    // child 1's real-browser pass): add missing, remove extra.
    console.log(`[box] rect-intersection dropped nodes across 3 attempts (${boxAttemptLog}); correcting with Control+click`);
    for (const id of PAIR) {
      if (!selected.includes(id)) await ctrlClickAt(await nodeCenter(id));
    }
    for (const id of [...selected]) {
      if (!PAIR.includes(id)) await ctrlClickAt(await nodeCenter(id));
    }
    selected = await evalJS(selectedNodeIds);
    boxAttemptLog += `corrected=${JSON.stringify(selected)}`;
  }
}
check(
  'the middle pair is the selection (box-select, Control+click-corrected when RF dropped a node)',
  JSON.stringify(selected) === JSON.stringify(PAIR),
  boxAttemptLog
);
const packageButton = await evalJS(
  `document.querySelector('[data-testid="v2-selection-panel-package"]')?.textContent ?? null`
);
check('selection panel offers "Package into reusable block"', packageButton !== null && packageButton.includes('Package into reusable block'), packageButton ?? 'missing');
await screenshot('03-pair-selected-package-offered.png');

// 5. Open the review; it shows the derivation defaults.
await clickSelector('[data-testid="v2-selection-panel-package"]');
await waitFor(`!!document.querySelector('[data-testid="v2-extract-review-panel"]')`, 10000, 'review panel');
const reviewId = await evalJS(
  `document.querySelector('[data-testid="v2-extract-review-id"]')?.value ?? null`
);
check('review defaults the declaration id to "block"', reviewId === 'block', String(reviewId));
const summary = await evalJS(
  `document.querySelector('[data-testid="v2-extract-review-summary"]')?.textContent ?? null`
);
check(
  'review summary states stages, internal connections, and the derived cut',
  summary !== null && summary.includes('2 stages') && summary.includes('1 internal connection') && summary.includes('cut: 1 input, 1 outcome'),
  summary ?? 'missing'
);
const derivedOutcome = await evalJS(
  `document.querySelector('[data-testid="v2-extract-review-outcomes"]')?.value ?? null`
);
check('review derived the outcome named after the severed source stage', derivedOutcome === 'atomic-stage-3', String(derivedOutcome));
await screenshot('04-review-open-with-defaults.png');

// 6. Rename the derived outcome (NameListField commits on blur, like the declarations editor).
// el.blur() on a never-focused element is a NO-OP in Chrome (no focusout) —
// focus FIRST, then set, then blur.
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-extract-review-outcomes"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, 'complete'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
);
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="v2-extract-review-outcomes"]'); el.blur(); return true; })()`
);
await sleep(300);

// 7. Confirm.
await clickSelector('[data-testid="v2-extract-review-confirm"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="composite-ref"]')`, 10000, 'the composite ref node');
await sleep(500);

const toast = await evalJS(`document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`);
check('success toast names the declaration', toast !== null && toast.includes("Packaged 2 stages into 'block'."), toast ?? 'missing');
check('review dialog closed after confirm', (await evalJS(`!document.querySelector('[data-testid="v2-extract-review-panel"]')`)) === true);
const remainingNodes = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check(
  'root graph is upstream, finish, and one ref',
  JSON.stringify(remainingNodes) === JSON.stringify(['atomic-stage', 'finish', 'composite-ref']),
  JSON.stringify(remainingNodes)
);
selected = await evalJS(selectedNodeIds);
check('the ref IS the selection after confirm', JSON.stringify(selected) === JSON.stringify(['composite-ref']), JSON.stringify(selected));
const refPanelNode = await evalJS(`document.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node') ?? null`);
check('the ref node panel is open', refPanelNode === 'composite-ref', String(refPanelNode));

// The ref renders the DERIVED input port and the EDITED outcome port.
const refTargetHandle = await evalJS(
  `document.querySelector('.react-flow__node[data-id="composite-ref"] .react-flow__handle.target[data-handleid="atomic-stage-2"]') !== null`
);
check('ref renders the derived input port (named after the severed target stage)', refTargetHandle === true);
const refSourceHandle = await evalJS(
  `document.querySelector('.react-flow__node[data-id="composite-ref"] .react-flow__handle.source[data-handleid="complete"]') !== null`
);
check('ref renders the EDITED outcome port as its source handle', refSourceHandle === true);

// The root graph is rewired upstream -> ref -> finish.
edges = await evalJS(edgeIds);
const upstreamPort = await evalJS(
  `document.querySelector('.react-flow__node[data-id="atomic-stage"] .react-flow__handle.source[data-handleid="done"]') !== null ? 'done' : null`
);
check(
  'root rewired upstream->ref and ref->finish',
  edges.length === 2 &&
    edges.includes(`atomic-stage:${upstreamPort}->composite-ref:atomic-stage-2`) &&
    edges.includes('composite-ref:complete->finish:input'),
  JSON.stringify(edges)
);
await screenshot('05-extracted-rewired.png');

// 8. The declarations panel lists the custom row; its insert action adds a second ref.
const rowProvenance = await evalJS(
  `document.querySelector('[data-testid="declaration-row"][data-declaration-id="block"]')?.getAttribute('data-provenance') ?? null`
);
check('declarations panel lists the extracted block as a custom row', rowProvenance === 'custom', String(rowProvenance));
await clickSelector('[data-testid="declaration-insert-ref"][data-declaration-id="block"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="composite-ref-2"]')`, 10000, 'second ref node');
const afterInsert = await evalJS(`Array.from(document.querySelectorAll('.react-flow__node')).map(n => n.dataset.id)`);
check(
  'insert action added a second ref to the same declaration',
  JSON.stringify(afterInsert) === JSON.stringify(['atomic-stage', 'finish', 'composite-ref', 'composite-ref-2']),
  JSON.stringify(afterInsert)
);
await screenshot('06-second-ref-inserted.png');

// 9. Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-subgraph-extraction task 5.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 4524\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\` — chunk \`PipelineCanvasPage-DdRc9JQM.js\`, verified to contain \`v2-extract-review-panel\`)`,
  `- Browser: throwaway Chrome 151 headless (\`--remote-debugging-port=9338\` + fresh temp \`--user-data-dir\`); ports 9333-9337 were busy with other sessions' checks, so this run owned 9338. The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## Steps',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-not-found.png, 02-authored-chain.png, 03-pair-selected-package-offered.png, 04-review-open-with-defaults.png, 05-extracted-rewired.png, 06-second-ref-inserted.png',
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
