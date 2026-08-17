#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-sink-finish-inference task 4.1.
//
// Same safety posture as children 1-4's drivers: direct CDP over `localhost`
// against a throwaway Chrome (`--remote-debugging-port=9344` + fresh temp
// `--user-data-dir`, `--window-size=1600,1000`), never the user's daily
// browser and never cdp-proxy.mjs (which hardwires 127.0.0.1, a binding this
// Chrome refuses). Per the portfolio census ports 9333-9341 were consumed by
// sibling sessions, so this run owns 9344 for CDP; the app server owns 9342.
//
// The flow, end-to-end:
//   A. Stage sink: author S -> end with palette gestures and a real
//      handle-to-handle drag; select `end` — its properties panel offers the
//      endpoint-naming section (default = first definition outcome); the
//      wired `S` gets no section; pick the SECOND outcome and confirm — the
//      Finish appears wired (end:done->finish:input) and SELECTED with its
//      own panel open, the stage's capability binding is untouched, and the
//      now-wired `end` no longer offers the section.
//   B. Barrier sink via child 4's offer: draw the second branch so the
//      fan-out/reconverge sandwich completes at the promoted Finish, take
//      child 4's offer, confirm the review (pair synthesized, join ->
//      finish wired), then delete the trailing Finish (select + Backspace —
//      the page arms deleteKeyCode ['Backspace','Delete'] in edit mode) so
//      the BARRIER is the terminal node; select the join — the section is
//      offered on its panel; confirm — a Finish is appended after the
//      barrier on its rendered proceed port and the barrier stays a Join.
//   C. The explicit palette Finish gesture still works beside the promoted
//      ones (no capability hole): finish-2, unwired, first-outcome default.
// Disciplines carried from the sibling digests: close the selection summary
// panel before any coordinate interaction, focus-before-blur on inputs,
// re-fit-view before every drag. All verification in-memory (the canvas Save
// persistence defect is out of scope).

const DEBUG_HTTP = 'http://localhost:9344';
const APP_ORIGIN = 'http://127.0.0.1:9342';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-sink-finish-check`;
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

async function selectNode(id) {
  // Two occlusion pitfalls compound for center clicks: the right-column
  // properties panel covers right-side node cards (child 2's handle-drag
  // pitfall, here for clicks — elementFromPoint at such a center hits the
  // panel) and, once the graph grows past the viewport, the target card can
  // sit off-screen where the clamped click lands on the pane and DESELECTS.
  // So: close any open panel, re-fit-view, click, and VERIFY the flag landed
  // before proceeding — retrying a couple of times instead of failing late.
  for (let attempt = 1; attempt <= 3; attempt++) {
    await evalJS(
      `(() => { document.querySelector('button[aria-label="Close node properties"]')?.click(); return true; })()`
    );
    await sleep(250);
    await clickSelector('.react-flow__controls-fitview');
    await sleep(600);
    await clickAt(await nodeCenter(id));
    const landed = await evalJS(
      `document.querySelector('.react-flow__node[data-id=${JSON.stringify(id)}]')?.classList.contains('selected') ?? false`
    );
    if (landed) {
      if (attempt > 1) console.log(`[select] ${id} landed on attempt ${attempt}`);
      return;
    }
    console.log(`[select] ${id} click did not select (attempt ${attempt})`);
  }
  throw new Error(`could not select node ${id} after 3 attempts`);
}

async function pressBackspace() {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    });
    await sleep(150);
  }
  await sleep(400);
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

async function selectOutcome(selector, value) {
  await evalJS(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`
  );
  await sleep(300);
}

const selectedNodeIds = `Array.from(document.querySelectorAll('.react-flow__node.selected')).map(n => n.dataset.id)`;
const edgeIds = `Array.from(document.querySelectorAll('.react-flow__edge')).map(e => e.dataset.id)`;
const panelNode = `document.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-node') ?? null`;
const sinkSection = `document.querySelector('[data-testid="v2-node-panel-sink-promotion"]')`;

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

// 2. Author the graph: three stages (S, end, b2).
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
// The palette gestures UNION every added node into the selection — close the
// summary panel before any coordinate-based interaction (child-2's pitfall).
await clickSelector('button[aria-label="Close selection summary"]');
await sleep(300);
await clickAt(await evalJS(
  `(() => { const el = document.querySelector('.react-flow__pane'); const r = el.getBoundingClientRect(); return { x: r.x + 8, y: r.y + 8 }; })()`
));

// 3. Give the definition two named outcomes (the section's select set).
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="definition-outcomes"]'); el.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, 'done,archived'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`
);
await evalJS(
  `(() => { const el = document.querySelector('[data-testid="definition-outcomes"]'); el.blur(); return true; })()`
);
await sleep(300);

// 4. Draw the chain S -> end.
await connectWithRetry('atomic-stage', 'atomic-stage-2');

// 5. The terminal stage's panel offers the endpoint-naming section.
await selectNode('atomic-stage-2');
check('selecting the terminal stage opens its properties panel', (await evalJS(panelNode)) === 'atomic-stage-2', String(await evalJS(panelNode)));
let section = await evalJS(`!!(${sinkSection})`);
check('the endpoint-naming section is offered for the terminal stage', section === true);
const outcomeDefault = await evalJS(
  `document.querySelector('[data-testid="v2-node-panel-sink-outcome"]')?.value ?? null`
);
const outcomeOptions = await evalJS(
  `Array.from(document.querySelectorAll('[data-testid="v2-node-panel-sink-outcome"] option')).map(o => o.value)`
);
check('the section defaults to the first definition outcome', outcomeDefault === 'done', String(outcomeDefault));
check('the section offers exactly the definition outcomes', JSON.stringify(outcomeOptions) === JSON.stringify(['done', 'archived']), JSON.stringify(outcomeOptions));
const stageCapabilityBefore = await evalJS(
  `document.querySelector('[data-testid="v2-node-panel-capability"]')?.value ?? null`
);
await screenshot('02-stage-sink-panel-offer.png');

// 6. The wired source gets no section.
await selectNode('atomic-stage');
check('the wired source opens a panel without the section', (await evalJS(panelNode)) === 'atomic-stage' && (await evalJS(`!(${sinkSection})`)) === true, String(await evalJS(panelNode)));

// 7. Name the terminal stage's outcome (the SECOND definition outcome) and confirm.
await selectNode('atomic-stage-2');
await selectOutcome('[data-testid="v2-node-panel-sink-outcome"]', 'archived');
await clickSelector('[data-testid="v2-node-panel-sink-confirm"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'the promoted finish node');
await sleep(500);

const promoteToast = await evalJS(`document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`);
check('confirm surfaces the plain success toast', promoteToast !== null && promoteToast.includes('Finish added'), String(promoteToast));
let selected = await evalJS(selectedNodeIds);
check('the Finish IS the selection after confirm', JSON.stringify(selected) === JSON.stringify(['finish']), JSON.stringify(selected));
check('the Finish panel is open with the picked outcome', (await evalJS(panelNode)) === 'finish' && (await evalJS(`document.querySelector('[data-testid="v2-node-panel-outcome"]')?.value ?? null`)) === 'archived');
let edges = await evalJS(edgeIds);
check(
  'the promotion wired exactly one edge on the rendered handle ids',
  edges.length === 2 && edges.includes('atomic-stage:done->atomic-stage-2:input') && edges.includes('atomic-stage-2:done->finish:input'),
  JSON.stringify(edges)
);
// The offer never re-offers itself: the promoted Finish is not a promotable sink.
check('the Finish panel carries no endpoint-naming section', (await evalJS(`!(${sinkSection})`)) === true);
await screenshot('03-promoted-finish-selected.png');

// 8. The stage's own settings are untouched by the promotion.
await selectNode('atomic-stage-2');
const stageCapabilityAfter = await evalJS(
  `document.querySelector('[data-testid="v2-node-panel-capability"]')?.value ?? null`
);
check('the terminal stage keeps its capability binding verbatim', stageCapabilityAfter === stageCapabilityBefore && stageCapabilityBefore !== null, `${stageCapabilityBefore} -> ${stageCapabilityAfter}`);
check('the now-wired stage no longer offers the section', (await evalJS(`!(${sinkSection})`)) === true);

// 9. Barrier sink via child 4's offer: draw the second branch so the
//    fan-out/reconverge sandwich completes at the promoted Finish.
await clickSelector('button[aria-label="Close node properties"]');
await sleep(200);
await connectWithRetry('atomic-stage', 'atomic-stage-3');
await connectWithRetry('atomic-stage-3', 'finish');
const offerToast = await evalJS(
  `document.querySelector('[data-testid="pipeline-canvas-toast"]')?.textContent ?? null`
);
const offerAction = await evalJS(
  `document.querySelector('[data-testid="pipeline-canvas-toast-action"]')?.textContent ?? null`
);
check(
  'the completing reconverge surfaces child 4 offer (children compose)',
  offerToast !== null && offerToast.includes('parallel frontier') && offerAction === 'Run in parallel',
  String(offerToast)
);
await screenshot('04-frontier-offer.png');
await clickSelector('[data-testid="pipeline-canvas-toast-action"]');
await waitFor(`!!document.querySelector('[data-testid="v2-parallel-review-panel"]')`, 10000, 'parallel review panel');
await clickSelector('[data-testid="v2-parallel-review-confirm"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="fan-out"]')`, 10000, 'the fan-out node');
await sleep(500);
edges = await evalJS(edgeIds);
check(
  'the frontier synthesis wired the pair incl. join -> finish',
  edges.includes('join:done->finish:input') && edges.includes('atomic-stage:done->fan-out:input'),
  JSON.stringify(edges)
);
await screenshot('05-frontier-synthesized.png');

// 10. Delete the trailing Finish (select + Backspace; the page arms
//     deleteKeyCode ['Backspace','Delete'] in edit mode) — the BARRIER
//     becomes the terminal node.
await selectNode('finish');
selected = await evalJS(selectedNodeIds);
check('the finish node is selected for deletion', JSON.stringify(selected) === JSON.stringify(['finish']), JSON.stringify(selected));
await pressBackspace();
await waitFor(`!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'finish removed');
edges = await evalJS(edgeIds);
check('deleting the finish dropped the join -> finish edge with it', !edges.includes('join:done->finish:input'), JSON.stringify(edges));

// 11. The barrier sink: its panel offers the section; confirm appends a
//     Finish after it on the rendered proceed port, barrier stays a Join.
await selectNode('join');
check('selecting the terminal barrier opens its properties panel', (await evalJS(panelNode)) === 'join', String(await evalJS(panelNode)));
const joinPanelKind = await evalJS(`document.querySelector('[data-testid="v2-node-panel"]')?.getAttribute('data-kind') ?? null`);
check('the barrier panel is the Join kind', joinPanelKind === 'Join', String(joinPanelKind));
section = await evalJS(`!!(${sinkSection})`);
check('the endpoint-naming section is offered for the terminal barrier', section === true);
await screenshot('06-barrier-sink-panel.png');
await selectOutcome('[data-testid="v2-node-panel-sink-outcome"]', 'done');
await clickSelector('[data-testid="v2-node-panel-sink-confirm"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish"]')`, 10000, 'the barrier-promoted finish node');
await sleep(500);
selected = await evalJS(selectedNodeIds);
check('the barrier-promoted Finish IS the selection', JSON.stringify(selected) === JSON.stringify(['finish']), JSON.stringify(selected));
edges = await evalJS(edgeIds);
check(
  'the barrier promotion wired join -> finish on the proceed VALUE port',
  edges.includes('join:done->finish:input'),
  JSON.stringify(edges)
);
const barrierStillJoin = await evalJS(
  `(() => { const join = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.dataset.id === 'join'); return join !== undefined; })()`
);
check('the barrier itself still exists as a node (appended, never converted)', barrierStillJoin === true);
await screenshot('07-barrier-promoted.png');

// 12. The explicit palette Finish gesture still works beside the promoted
//     ones (no capability hole): finish-2, unwired, first-outcome default.
await clickSelector('button[aria-label="Close node properties"]');
await sleep(200);
await clickSelector('[data-testid="v2-palette-gesture-finish"]');
await waitFor(`!!document.querySelector('.react-flow__node[data-id="finish-2"]')`, 10000, 'second finish (explicit gesture)');
edges = await evalJS(edgeIds);
check(
  'the gesture Finish is unwired (exactly addFinishNode behavior)',
  !edges.some((id) => id.startsWith('finish-2:')) && !edges.some((id) => id.includes('->finish-2:')),
  JSON.stringify(edges)
);
await selectNode('finish-2');
check(
  'the gesture Finish carries the first-outcome default',
  (await evalJS(panelNode)) === 'finish-2' && (await evalJS(`document.querySelector('[data-testid="v2-node-panel-outcome"]')?.value ?? null`)) === 'done'
);
await screenshot('08-explicit-gesture-still-works.png');

// 13. Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-sink-finish-inference task 4.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon --port 9342\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\`)`,
  `- Browser: throwaway Chrome headless (\`--remote-debugging-port=9344\` + fresh temp \`--user-data-dir\`, \`--window-size=1600,1000\`); ports 9333-9341 were consumed by sibling sessions' checks, so this run owned 9342 (app) and 9344 (CDP). The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## The sink-promotion flow end-to-end',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-not-found.png, 02-stage-sink-panel-offer.png, 03-promoted-finish-selected.png, 04-frontier-offer.png, 05-frontier-synthesized.png, 06-barrier-sink-panel.png, 07-barrier-promoted.png, 08-explicit-gesture-still-works.png',
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
