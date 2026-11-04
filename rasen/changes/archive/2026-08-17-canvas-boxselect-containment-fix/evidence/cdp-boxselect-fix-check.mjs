#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-boxselect-containment-fix
// task 3.1 — the m2 repeat-probe RERUN POST-FIX.
//
// The probe function, its helpers (boxSelect/mouseDrag/nodeRect/clickAt),
// the graph setup, and the chaining (connectWithRetry/connectNodes) are
// copied VERBATIM from the archived child-3 driver
// (rasen/changes/archive/2026-08-16-canvas-backedge-loop-inference/evidence/cdp-backedge-loop-check.mjs)
// — including the 10px left-clip rect construction that failed 3/3 pre-fix.
// The probe's value is that it reproduces the real-world casual gesture;
// do NOT "fix" its rect construction. The ONLY changes vs the archived
// driver: the header/URL/pipeline-name, Phase B (back-edge flow) dropped
// as out of scope, and the Phase A gate inverted — where the archived run
// RECORDED the containment miss, this run REQUIRES full membership on all
// three rectangles plus the singleton selecting its node.
//
// Same safety posture: direct CDP over `localhost` against a throwaway
// Chrome (`--remote-debugging-port` on a FRESH port — 9333-9338 busy with
// sibling sessions — plus fresh temp `--user-data-dir`, and
// `--window-size=1600,1000` so the flow column does not collapse). Never
// the user's daily browser, never cdp-proxy.mjs (which hardwires 127.0.0.1,
// a binding this Chrome refuses).

const DEBUG_HTTP = process.env.CDP_HTTP ?? 'http://localhost:9340';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:4540';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/cdp-boxselect-fix`;
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

// 4. THE m2 box-select repeat-probe — VERBATIM geometry (the 10px left
//    clip that failed 3/3 pre-fix). Post-fix gate: FULL membership is now
//    REQUIRED on all three rectangles.
await probeBoxSelect(['atomic-stage-2', 'atomic-stage-3'], ['atomic-stage', 'atomic-stage-4', 'finish'], 'middle pair');
await probeBoxSelect(['atomic-stage-3'], ['atomic-stage', 'atomic-stage-2', 'atomic-stage-4', 'finish'], 'singleton');
await probeBoxSelect(['atomic-stage-2', 'atomic-stage-3', 'atomic-stage-4'], ['atomic-stage', 'finish'], 'region triple');
check(
  'm2 repeat-probe ran three verified rectangles',
  probe.attempts.length === 3 && probe.attempts.every((a) => a.geometryOk),
  probe.attempts.map((a) => `${a.label}:full=${a.fullMembership}`).join('; ')
);
check(
  'm2 repeat-probe: FULL membership on every rectangle (containment fix verified)',
  probe.attempts.length === 3 && probe.attempts.every((a) => a.fullMembership) && !probe.reproduced,
  JSON.stringify(probe.attempts.map((a) => ({ label: a.label, selected: a.selected })))
);
const singleton = probe.attempts.find((a) => a.label === 'singleton');
check(
  'the singleton rectangle selects its node (overlap, not containment)',
  !!singleton && JSON.stringify(singleton.selected) === JSON.stringify(['atomic-stage-3']),
  singleton ? JSON.stringify(singleton.selected) : 'missing attempt'
);
await screenshot('03-m2-probe-done.png');

// 5. Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-boxselect-containment-fix task 3.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`rasen ui --no-open --no-daemon\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\`)`,
  `- Browser: throwaway Chrome headless (\`--remote-debugging-port\` on a fresh port + fresh temp \`--user-data-dir\`, \`--window-size=1600,1000\`); ports 9333-9338 were busy with sibling sessions' checks, so this run owns ${DEBUG_HTTP.split(':').pop()}. The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Driver: this script — the archived child-3 probe function and setup VERBATIM (same rect construction including the 10px left clip that failed 3/3 pre-fix); the gate inverted to REQUIRE full membership (direct CDP over localhost; cdp-proxy.mjs hardwires 127.0.0.1, which this Chrome does not bind).`,
  '',
  '## The m2 box-select repeat-probe, post-fix',
  '',
  ...probe.attempts.map(
    (a) =>
      `- ${a.label}: geometry ${a.geometryOk ? 'verified' : 'BAD'}; expected ${JSON.stringify(a.targets)}; got ${JSON.stringify(a.selected)}; full membership ${a.fullMembership ? 'YES' : '**NO**'}`
  ),
  '',
  probe.reproduced
    ? '**CONTAINMENT MISS STILL REPRODUCING — the fix did not take.**'
    : '**The containment miss is FIXED**: every verified rectangle — including the 10px-left-clip geometry that dropped its leftmost node 3/3 pre-fix — now selects its full overlapped set, and the singleton selects its node.',
  '',
  '## Checks',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Screenshots',
  '',
  '01-not-found.png, 02-authored-chain.png, 03-m2-probe-done.png',
  '',
  `## Result: ${allOk ? 'ALL CHECKS PASSED (fix verified)' : 'FAILURES PRESENT'}`,
  '',
];
writeFileSync(`${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-transcript.md`, lines.join('\n'));
writeFileSync(
  `${EVIDENCE_DIR.replace(/\\/g, '/')}cdp-results.json`,
  JSON.stringify({ allOk, m2Probe: probe, results }, null, 2)
);
console.log(allOk ? '[cdp] ALL CHECKS PASSED' : '[cdp] FAILURES PRESENT');
process.exit(allOk ? 0 : 1);
