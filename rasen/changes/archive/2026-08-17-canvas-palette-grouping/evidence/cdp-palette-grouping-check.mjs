#!/usr/bin/env node
// Throwaway-CDP verification driver for canvas-palette-grouping task 4.1.
//
// Same safety posture as the sibling drivers (round-one children + round-2
// children 1/2): direct CDP over `localhost` against a throwaway Chrome
// (`--remote-debugging-port` 9348, fresh temp `--user-data-dir`,
// `--window-size=1600,1000`). Never the user's daily browser, never
// cdp-proxy.mjs (hardwires 127.0.0.1). The app server owns 9347
// (`node bin/rasen.js ui --no-open --no-daemon --port 9347` from this
// worktree, serving this worktree's freshly built packages/ui/dist AND the
// freshly rebuilt ROOT dist — bin/rasen.js loads dist/cli, so the kind
// pass-through needed `pnpm run build` at the root, not just packages/ui).
// Ports 9333-9344 were consumed by sibling sessions' checks; child 2 used
// and released 9345/9346; this run probed 9345-9348 free and took 9347/9348.
//
// The gate (task 4.1): the palette renders against the REAL installed skills
// set — the driver fetches the real catalog from the API, computes the
// expected grouping ITSELF (reference implementation), and compares the
// rendered DOM section-by-section:
//   A. the five core skills lead, in pipeline order, ahead of everything;
//   B. experts render in their own VISUALLY DISTINCT section (computed style
//      differs on-screen, not just a class name), after ordinary workflows;
//   C. internals render in their own TRAILING section, after experts;
//   D. NO skill the flat list used to show has disappeared (rendered union
//      == the real catalog's full id set, 40 skills on this machine);
//   E. the real disabled skill (rasen-teacher-advisor) stays listed, visibly
//      disabled, inside its group (bindability unchanged by grouping).
// All verification in-memory (not-found -> "Start assembling"); the canvas
// Save persistence defect stays out of scope.

const DEBUG_HTTP = process.env.CDP_HTTP ?? 'http://localhost:9348';
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://127.0.0.1:9347';
const SPACE_ID = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const CANVAS_PATH = `/p/${SPACE_ID}/pipelines/canvas-palette-grouping-cdp`;
const TOKEN = process.env.RASEN_UI_TOKEN;

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

async function screenshot(name, clipSelector = null) {
  const clip = clipSelector
    ? await evalJS(
        `(() => { const el = document.querySelector(${JSON.stringify(clipSelector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: 1 }; })()`
      )
    : null;
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    ...(clip ? { clip } : {}),
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${EVIDENCE_DIR}${name}`, Buffer.from(r.data, 'base64'));
  console.log(`[shot] ${name}`);
}

// --- the driver-side reference grouping over the REAL catalog ---
const CORE = [
  'rasen-propose',
  'rasen-apply-change',
  'rasen-review-cycle',
  'rasen-ship',
  'rasen-archive-change',
];
function expectedGrouping(catalog) {
  const coreSet = new Set(CORE);
  const seen = new Set();
  const workflows = [];
  const experts = [];
  const internal = [];
  for (const skill of catalog.skills) {
    if (coreSet.has(skill.id)) {
      seen.add(skill.id);
      continue;
    }
    if (skill.kind === 'expert') experts.push(skill.id);
    else if (skill.kind === 'internal') internal.push(skill.id);
    else workflows.push(skill.id);
  }
  return {
    core: CORE.filter((id) => seen.has(id)),
    workflows,
    experts,
    internal,
  };
}

const EVIDENCE_URL = new URL('.', import.meta.url);
const EVIDENCE_DIR = EVIDENCE_URL.pathname.replace(/^\/([A-Za-z]:)/, '$1');

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

// The REAL catalog, straight from the API the page itself consumes.
const catalogResponse = await fetch(`${APP_ORIGIN}/api/v1/pipeline-catalog`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
if (catalogResponse.status !== 200) {
  throw new Error(`catalog fetch failed: ${catalogResponse.status}`);
}
const catalog = await catalogResponse.json();
const expected = expectedGrouping(catalog);
const catalogIds = catalog.skills.map((skill) => skill.id);
const kindsOnWire = new Set(catalog.skills.map((skill) => skill.kind));
console.log(
  `[catalog] ${catalog.skills.length} skills; kinds on the wire: ${[...kindsOnWire].sort().join(', ')}`
);
check(
  'the real catalog wire carries kind for every skill (the pass-through, live)',
  catalog.skills.length > 0 && catalog.skills.every((skill) => typeof skill.kind === 'string'),
  `${catalog.skills.length} skills, kinds: ${[...kindsOnWire].sort().join('/')}`
);

// A. Fresh v2 pipeline: not-found -> Start assembling (in-memory only).
await send('Page.navigate', { url: `${APP_ORIGIN}${CANVAS_PATH}#token=${TOKEN}` });
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-not-found"]')`, 15000, 'not-found surface');
await clickSelector('[data-testid="pipeline-canvas-start-assembling"]');
await waitFor(`!!document.querySelector('[data-testid="pipeline-canvas-save"]')`, 10000, 'editor header');
await waitFor(
  `!!document.querySelector('[data-testid="palette-section-core"]')`,
  15000,
  'the palette core section (catalog fetch + grouping)'
);

// Read the rendered sections from the DOM.
const rendered = await evalJS(
  `(() => {
    const sections = Array.from(document.querySelectorAll('[data-testid^="palette-section-"]'));
    return sections.map((section) => ({
      id: section.getAttribute('data-testid').replace('palette-section-', ''),
      entries: Array.from(section.querySelectorAll('[data-testid^="v2-palette-gesture-stage-"]'))
        .map((entry) => entry.getAttribute('data-testid').replace('v2-palette-gesture-stage-', '')),
    }));
  })()`
);
const renderedIds = rendered.map((section) => section.id);
const flatRendered = rendered.flatMap((section) => section.entries);
const section = (id) => rendered.find((s) => s.id === id);

check(
  'the palette renders exactly the four sections in order core -> workflows -> experts -> internal',
  JSON.stringify(renderedIds) === JSON.stringify(['core', 'workflows', 'experts', 'internal']),
  renderedIds.join(' -> ')
);
check(
  'A. the five core skills lead, in PIPELINE order, ahead of every other skill',
  JSON.stringify(section('core')?.entries) === JSON.stringify(expected.core) &&
    rendered[0]?.id === 'core',
  `rendered [${section('core')?.entries.join(', ')}]; expected [${expected.core.join(', ')}]`
);
check(
  'B. the experts section contains exactly the real expert-kind skills, after the ordinary workflows',
  JSON.stringify(section('experts')?.entries) === JSON.stringify(expected.experts) &&
    renderedIds.indexOf('experts') === renderedIds.indexOf('workflows') + 1,
  `${section('experts')?.entries.length} experts (expected ${expected.experts.length}): ${section('experts')?.entries.slice(0, 4).join(', ')}…`
);
check(
  'C. internals render in their own TRAILING section, after experts',
  JSON.stringify(section('internal')?.entries) === JSON.stringify(expected.internal) &&
    renderedIds.indexOf('internal') === renderedIds.indexOf('experts') + 1 &&
    renderedIds[renderedIds.length - 1] === 'internal',
  `${section('internal')?.entries.length} internals (expected ${expected.internal.length})`
);
check(
  'the workflows section holds the remaining ordinary workflows in stable catalog order',
  JSON.stringify(section('workflows')?.entries) === JSON.stringify(expected.workflows),
  `${section('workflows')?.entries.length} workflows (expected ${expected.workflows.length})`
);
check(
  'D. no skill the flat list used to show has disappeared (rendered union == real catalog set)',
  flatRendered.length === catalogIds.length &&
    [...new Set([...flatRendered, ...catalogIds])].length === catalogIds.length,
  `rendered ${flatRendered.length} / catalog ${catalogIds.length} skills`
);

// B (visual): the experts heading is DISTINCT on screen — computed style
// differs from the workflows heading, not merely a class name. The palette is
// the leftmost column; scroll it into view first so the styles resolve.
const visual = await evalJS(
  `(() => {
    document.querySelector('[data-testid="palette-section-experts"]')?.scrollIntoView({ block: 'center' });
    const experts = document.querySelector('[data-testid="palette-section-experts"] .palette-section__title');
    const workflows = document.querySelector('[data-testid="palette-section-workflows"] .palette-section__title');
    if (!experts || !workflows) return null;
    const e = getComputedStyle(experts);
    const w = getComputedStyle(workflows);
    return {
      expertsColor: e.color,
      workflowsColor: w.color,
      expertsShadow: e.boxShadow,
      expertsText: experts.textContent,
      workflowsText: workflows.textContent,
    };
  })()`
);
check(
  'B (visual). the experts heading renders with a DISTINCT on-screen treatment',
  visual !== null &&
    visual.expertsColor !== visual.workflowsColor &&
    visual.expertsShadow !== 'none',
  `experts color ${visual?.expertsColor} + underline vs workflows ${visual?.workflowsColor}`
);
check(
  'the section headings name their groups on screen',
  visual?.expertsText === 'Experts' && visual?.workflowsText === 'Workflows',
  `${visual?.workflowsText} / ${visual?.expertsText}`
);
await screenshot('01-palette-grouped-full.png');
await screenshot('02-palette-grouped-sections.png', '[data-testid="palette-panel"]');

// E. The real disabled skill stays listed, visibly disabled, INSIDE its group.
const disabledSkill = catalog.skills.find((skill) => !skill.enabled) ?? null;
if (disabledSkill) {
  // Kind -> section id: the panel's sections are plural where kinds are not
  // ('expert' renders in the 'experts' section).
  const sectionId =
    disabledSkill.kind === 'expert' ? 'experts' : (disabledSkill.kind ?? 'workflows');
  const state = await evalJS(`(() => {
    const card = document.querySelector('[data-testid="v2-palette-gesture-stage-${disabledSkill.id}"]');
    if (!card) return null;
    return {
      insideItsGroup: card.closest('[data-testid="palette-section-${sectionId}"]') !== null,
      greyed: card.className.includes('palette-card--disabled'),
      stateLabel: card.querySelector('[data-testid="palette-card-disabled-state"]')?.textContent ?? null,
    };
  })()`);
  check(
    `E. the real disabled skill (${disabledSkill.id}, kind ${disabledSkill.kind}) stays listed, visibly disabled, inside its group`,
    state !== null && state.insideItsGroup && state.greyed && state.stateLabel === 'disabled',
    JSON.stringify(state)
  );
}

// Aliveness: the tab still answers evaluates (the child-1 freeze trap).
const alive = await evalJS(`1 + 1`);
check('tab is alive after the full pass (no listener freeze)', alive === 2);

// --- transcript ---
const { writeFileSync } = await import('node:fs');
const allOk = results.every((r) => r.ok);
const lines = [
  '# Real-browser CDP transcript — canvas-palette-grouping task 4.1',
  '',
  `- Date: ${new Date().toISOString()}`,
  `- App: ${APP_ORIGIN} (in-process \`node bin/rasen.js ui --no-open --no-daemon --port 9347\` from this worktree, serving this worktree's freshly built \`packages/ui/dist\` AND the freshly rebuilt ROOT \`dist\` — \`bin/rasen.js\` loads \`dist/cli\`, so the kind pass-through required \`pnpm run build\` at the root, not only the UI build).`,
  `- Browser: throwaway Chrome 151 headless (\`--remote-debugging-port=9348\` + fresh temp \`--user-data-dir\`, \`--window-size=1600,1000\`). Ports 9333-9344 were consumed by sibling sessions' checks; child 2 used and released 9345/9346; this run probed 9345-9348 free and took 9347 (app) / 9348 (CDP). The user's daily Chrome was never touched.`,
  `- Route: \`${CANVAS_PATH}\` (not-found → "Start assembling" — all verification in-memory; the canvas Save persistence defect is out of scope).`,
  `- Real catalog under test: ${catalog.skills.length} skills; kinds on the wire: ${[...kindsOnWire].sort().join(', ')}; one disabled skill (${disabledSkill?.id ?? 'none this run'}).`,
  `- Driver: this script (direct CDP over localhost). It fetches the REAL catalog from the API, computes the expected grouping itself, and compares the rendered DOM section-by-section — the fixture-free end-to-end proof the jsdom suites cannot give.`,
  '',
  '## Grouped palette against the real installed skills set',
  '',
  ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} — ${r.name}${r.detail ? ` (${r.detail})` : ''}`),
  '',
  '## Rendered section order (live DOM)',
  '',
  ...rendered.map(
    (s) =>
      `- **${s.id}** (${s.entries.length}): ${s.entries.slice(0, 6).join(', ')}${s.entries.length > 6 ? ', …' : ''}`
  ),
  '',
  '## Screenshots',
  '',
  '01-palette-grouped-full.png (full window), 02-palette-grouped-sections.png (the palette panel itself)',
  '',
  `## Result: ${allOk ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'}`,
  '',
];
writeFileSync(`${EVIDENCE_DIR}cdp-transcript.md`, lines.join('\n'));
writeFileSync(
  `${EVIDENCE_DIR}cdp-results.json`,
  JSON.stringify(
    { allOk, results, rendered, expectedCore: expected.core, catalogSize: catalogIds.length },
    null,
    2
  )
);
console.log(allOk ? '[cdp] ALL CHECKS PASSED' : '[cdp] FAILURES PRESENT');
process.exit(allOk ? 0 : 1);
