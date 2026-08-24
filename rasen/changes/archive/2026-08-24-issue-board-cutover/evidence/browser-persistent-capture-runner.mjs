import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertManagementObservation,
  captureExactStateResponses,
  clearStorageExpression,
  deriveManagementObservation,
  deriveReadOnlySummary,
  invariant as assert,
  verifyCleanup,
  verifyReadOnlySummary,
  verifyStateResponseCapture,
  verifyStorageClear,
  withStorageVerification,
} from './browser-receipt-guards.mjs';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evidenceDir, '..', '..', '..', '..');
const serverPath = path.join(evidenceDir, 'browser-persistent-server.mjs');
const receiptPath = path.join(evidenceDir, 'browser-persistent-readonly-receipt.json');
const proxyOrigin = 'http://localhost:3456';
const curlExecutable = process.platform === 'win32' ? 'curl.exe' : 'curl';
const invocation =
  'node rasen/changes/issue-board-cutover/evidence/browser-persistent-capture-runner.mjs';
const selectedIssue = 'issue-level-review-delivery';

if (process.argv.length > 2) throw new Error(`unexpected arguments; use: ${invocation}`);
process.chdir(repoRoot);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function storeSnapshot(root) {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const statusRaw = git(root, ['status', '--porcelain=v1', '-z']);
  const statusLines = statusRaw.split('\0').filter(Boolean);
  const trackedPaths = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const trackedByteManifest = trackedPaths.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(root, ...relativePath.split('/')));
    return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return {
    head,
    statusLines,
    statusDigest: sha256(Buffer.from(statusRaw, 'utf8')),
    trackedCount: trackedByteManifest.length,
    manifestDigest: sha256(Buffer.from(JSON.stringify(trackedByteManifest), 'utf8')),
    trackedByteManifest,
  };
}

function curlJson(url, { method = 'GET', body } = {}) {
  const args = ['--noproxy', '*', '--silent', '--show-error', '--fail-with-body'];
  if (method !== 'GET') args.push('--request', method);
  if (body !== undefined) {
    args.push('--header', 'Content-Type: application/javascript; charset=utf-8');
    args.push('--data-binary', body);
  }
  args.push(url);
  return JSON.parse(
    execFileSync(curlExecutable, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    })
  );
}

function cdpUrl(pathname, parameters = {}) {
  const url = new URL(pathname, proxyOrigin);
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.href;
}

function cdpGet(pathname, parameters = {}) {
  return curlJson(cdpUrl(pathname, parameters));
}

function cdpPost(pathname, parameters, body) {
  return curlJson(cdpUrl(pathname, parameters), { method: 'POST', body });
}

function controlPost(port, token) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/shutdown',
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Connection: 'close' },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) reject(new Error(body));
          else resolve(JSON.parse(body));
        });
      }
    );
    request.once('error', reject);
    request.end();
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForMetadata(metadataPath, child, stderrPath) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const diagnostic = fs.existsSync(stderrPath)
        ? fs.readFileSync(stderrPath, 'utf8').slice(-8_000)
        : 'stderr unavailable';
      throw new Error(`persistent server exited early (${child.exitCode})\n${diagnostic}`);
    }
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (metadata.managementPort && metadata.controlPort) return metadata;
    } catch {
      // A later read observes the complete metadata file.
    }
    await sleep(100);
  }
  throw new Error('timed out waiting for persistent server metadata');
}

async function waitForExit(child, timeoutMs = 20_000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs).then(() => {
      throw new Error('persistent server did not exit after shutdown');
    }),
  ]);
}

function evalJson(targetId, expression) {
  const response = cdpPost('/eval', { target: targetId }, expression);
  assert(response.error === undefined, `CDP eval failed: ${response.error}`);
  return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
}

function navigate(targetId, url, selector) {
  cdpGet('/navigate', { target: targetId, url });
  try {
    const waited = cdpGet('/wait', { target: targetId, selector, timeout: 120_000 });
    assert(waited.matched === true, `selector did not appear: ${selector}`);
  } catch (error) {
    const info = cdpGet('/info', { target: targetId });
    const body = evalJson(
      targetId,
      `JSON.stringify({ text: document.body?.innerText?.slice(0, 4000) ?? '', html: document.body?.innerHTML?.slice(0, 1000) ?? '' })`
    );
    throw new Error(
      `selector did not appear: ${selector}\ninfo=${JSON.stringify(info)}\nbody=${JSON.stringify(body)}\n${error}`
    );
  }
}

let networkResetGeneration = 0;

function networkSnapshot(targetId, reset) {
  const snapshot = cdpGet('/network/events', {
    target: targetId,
    limit: 1_000,
    include_body: true,
  });
  return { ...snapshot, resetGeneration: reset.generation };
}

function resetNetwork(targetId) {
  const cleared = cdpGet('/network/clear', { target: targetId });
  const generation = ++networkResetGeneration;
  const empty = cdpGet('/network/events', {
    target: targetId,
    limit: 1_000,
    include_body: true,
  });
  const reset = {
    generation,
    cleared: cleared.cleared === true,
    bufferEmptyAfterReset:
      empty.total === 0 && empty.returned === 0 && empty.events.length === 0,
    totalAfterReset: empty.total,
    lastSeqAfterReset: empty.lastSeq,
  };
  assert(reset.cleared, 'CDP network reset was not acknowledged');
  assert(reset.bufferEmptyAfterReset, 'CDP network buffer was not empty after reset');
  assert(reset.lastSeqAfterReset === 0, 'CDP network sequence did not reset');
  return reset;
}

async function waitForManagementObservation(
  targetId,
  origin,
  reset,
  expectedState = null,
  timeoutMs = 120_000
) {
  const deadline = Date.now() + timeoutMs;
  let lastKey = null;
  let stablePolls = 0;
  let snapshot = networkSnapshot(targetId, reset);
  while (Date.now() < deadline) {
    snapshot = networkSnapshot(targetId, reset);
    assert(snapshot.total === snapshot.events.length, 'network event buffer exceeded receipt limit');
    const managementEvents = snapshot.events.filter((event) => {
      try {
        return new URL(event.url).origin === new URL(origin).origin;
      } catch {
        return false;
      }
    });
    for (const event of managementEvents) {
      assert(event.method === 'GET', `non-GET management request observed: ${event.method} ${event.url}`);
      assert(event.failed !== true, `failed management request observed: ${event.url}`);
      assert(
        typeof event.status !== 'number' || (event.status >= 200 && event.status < 400),
        `unsuccessful management status observed: ${event.status} ${event.url}`
      );
      assert(!new URL(event.url).pathname.toLowerCase().includes('invalidat'), `invalidation call observed: ${event.url}`);
    }
    const stateBodiesReady =
      expectedState === null ||
      ['/api/v1/stores/issue-projection', '/api/v1/stores/issue-attention'].every(
        (pathname) =>
          managementEvents.some((event) => {
            const url = new URL(event.url);
            return (
              url.pathname === pathname &&
              event.completed === true &&
              typeof event.response_body === 'string'
            );
          })
      );
    const ready =
      managementEvents.length > 0 &&
      managementEvents.every((event) => event.completed === true) &&
      stateBodiesReady;
    const key = `${snapshot.total}:${snapshot.lastSeq}:${managementEvents.length}`;
    stablePolls = ready && key === lastKey ? stablePolls + 1 : 0;
    lastKey = key;
    if (ready && stablePolls >= 2) {
      const observation = deriveManagementObservation(snapshot, origin, reset);
      const state =
        expectedState === null
          ? null
          : captureExactStateResponses(
              snapshot,
              observation,
              origin,
              expectedState.selector,
              expectedState.issueId
            );
      return { snapshot, observation, state };
    }
    await sleep(100);
  }
  const pending = snapshot.events
    .filter((event) => event.completed !== true)
    .map((event) => `${event.method ?? '<unknown>'} ${event.url ?? '<unknown>'}`);
  throw new Error(
    `management network did not settle after reset ${reset.generation}; pending=${JSON.stringify(pending)}`
  );
}

const boardExpression = String.raw`JSON.stringify((() => ({
  route: location.pathname,
  active: [...document.querySelectorAll('a[aria-current="page"]')].map((entry) => ({
    text: entry.textContent.trim(), path: new URL(entry.href).pathname,
  })),
  lanes: [...document.querySelectorAll('[data-testid="issue-lane"]')].map((lane) => lane.dataset.phase),
  cards: [...document.querySelectorAll('[data-testid="issue-card"]')].map((card) => ({
    issue: card.dataset.issue,
    phase: card.dataset.phase,
    health: card.dataset.health,
    mainPath: new URL(card.querySelector('[data-testid="issue-card-main"]').href).pathname,
  })),
}))())`;

const detailExpression = String.raw`JSON.stringify((() => {
  const entries = [...document.querySelectorAll('[data-testid="issue-provenance-entry"]')].map((entry) => ({
    family: entry.dataset.provenanceFamily,
    id: entry.id,
    kind: entry.dataset.provenanceKind,
    facts: [...entry.querySelectorAll('[data-testid="issue-provenance-fact"]')].map((fact) => ({
      label: fact.querySelector('dt').textContent,
      value: fact.querySelector('dd').textContent,
    })),
  }));
  const link = (element) => {
    const url = new URL(element.href);
    const targets = entries.filter((entry) => entry.id === url.hash.slice(1));
    return {
      testid: element.dataset.testid ?? null,
      text: element.textContent.trim(),
      path: url.pathname,
      hash: url.hash,
      targetCount: targets.length,
      targetFamily: targets[0]?.family ?? null,
      targetKind: targets[0]?.kind ?? null,
      targetFacts: targets[0]?.facts ?? [],
    };
  };
  return {
    route: location.pathname,
    axes: [...document.querySelectorAll('[data-testid="issue-detail-axes"] a')].map(link),
    deliveryLinks: [...document.querySelectorAll('[data-testid="issue-detail-delivery-state"]')].map(link),
    attentionLinks: [...document.querySelectorAll('[data-testid="issue-detail-attention-evidence"]')].map(link),
    actions: [...document.querySelectorAll('[data-testid^="issue-action-"]')].map((entry) => ({
      testid: entry.dataset.testid, text: entry.textContent.trim(), path: new URL(entry.href).pathname,
    })),
    entries,
  };
})())`;

const pageExpression = String.raw`JSON.stringify((() => ({
  route: location.pathname,
  active: [...document.querySelectorAll('a[aria-current="page"]')].map((entry) => ({
    text: entry.textContent.trim(), path: new URL(entry.href).pathname,
  })),
  pageCount: document.querySelectorAll('main > *').length,
}))())`;

function linkByTestId(detail, testId) {
  return detail.axes.find((entry) => entry.testid === testId);
}

function hasFact(link, label, value) {
  return link?.targetFacts?.some(
    (fact) => fact.label === label && fact.value === String(value)
  ) === true;
}

function derivePersistentSemantics(detail, projection) {
  const phase = linkByTestId(detail, 'issue-detail-phase');
  const health = linkByTestId(detail, 'issue-detail-health');
  const progress = linkByTestId(detail, 'issue-detail-progress');
  const nodes = projection?.status?.nodes ?? [];
  const links = [...detail.axes, ...detail.deliveryLinks, ...detail.attentionLinks];
  return {
    doneCarriesResolvedStateAndAcceptanceRecord:
      projection?.status?.phase === 'done' &&
      phase?.targetFamily === 'acceptance-review' &&
      hasFact(phase, 'issue.record.state', projection?.issue?.record?.state) &&
      hasFact(
        phase,
        'acceptance.record.contentSha256',
        projection?.status?.acceptance?.record?.contentSha256
      ),
    healthyCarriesExactNodeInputs:
      hasFact(health, 'status.health', projection?.status?.health) &&
      nodes.every(
        (node) =>
          hasFact(health, `${node.nodeId}.lifecycle`, node.lifecycle) &&
          hasFact(health, `${node.nodeId}.observation`, node.observation)
      ),
    progressCarriesExactCompletionInputs:
      hasFact(progress, 'status.progress.completed', projection?.status?.progress?.completed) &&
      hasFact(progress, 'status.progress.total', projection?.status?.progress?.total) &&
      nodes.every((node) =>
        hasFact(progress, `${node.nodeId}.observation`, node.observation)
      ),
    everyDisplayedDeliveryStateTargetsDeliveryFacts: detail.deliveryLinks.every(
      (link) => link.targetCount === 1 && link.targetFamily === 'delivery'
    ),
    everyStateFragmentResolvesExactlyOnce:
      links.length > 0 &&
      links.every(
        (link) =>
          link.targetCount === 1 &&
          (link.targetKind === 'git' || link.targetKind === 'runtime')
      ),
  };
}

function assertBooleanRecord(record, label) {
  for (const [name, value] of Object.entries(record)) {
    assert(value === true, `${label} failed: ${name}`);
  }
}

function verifyReceipt(receipt) {
  assert(receipt.schemaVersion === 3, 'persistent receipt schema drifted');
  assert(receipt.change === 'issue-board-cutover', 'persistent receipt change drifted');
  const observations = receipt.networkObservations;
  for (const observation of Object.values(observations)) {
    assertManagementObservation(observation);
  }
  verifyReadOnlySummary(receipt.readOnly, observations);
  assert(
    JSON.stringify(receipt.mutationOperationsIssued) ===
      JSON.stringify(receipt.readOnly.mutationOperationsIssued),
    'persistent mutation inventory drifted'
  );
  const decoded = verifyStateResponseCapture(
    receipt.smoke.detail.responseCapture,
    observations.detail,
    receipt.store.selector,
    receipt.smoke.detail.selectedIssue,
    'persistent detail'
  );
  const expectedSemantics = derivePersistentSemantics(receipt.smoke.detail, decoded.projection);
  assert(
    JSON.stringify(receipt.smoke.detail.semanticAssertions) ===
      JSON.stringify(expectedSemantics),
    'persistent semantic assertions drifted from DOM/payload'
  );
  assertBooleanRecord(receipt.smoke.detail.semanticAssertions, 'persistent semantic assertion');
  verifyStorageClear(receipt.storageClear, 'persistent');
  const observationMap = {
    issues: 'issues',
    detail: 'detail',
    operations: 'operations',
    unlinked: 'unlinked',
  };
  for (const [smokeName, observationName] of Object.entries(observationMap)) {
    const smoke = receipt.smoke[smokeName];
    const observation = observations[observationName];
    assert(
      JSON.stringify(smoke.requests) === JSON.stringify(observation.requests),
      `${smokeName} request inventory drifted`
    );
    assert(
      smoke.sameOriginGetOnly === observation.verdict.sameOriginGetOnly,
      `${smokeName} GET-only verdict drifted`
    );
    assert(smoke.sameOriginGetOnly, `${smokeName} smoke was not GET-only`);
  }
  assert(receipt.before.statusLines.length === 0, 'persistent Store was dirty before smoke');
  assert(receipt.after.statusLines.length === 0, 'persistent Store was dirty after smoke');
  const emptyStatusDigest = sha256(Buffer.alloc(0));
  assert(receipt.before.statusDigest === emptyStatusDigest, 'before status digest drifted');
  assert(receipt.after.statusDigest === emptyStatusDigest, 'after status digest drifted');
  assert(
    receipt.before.trackedCount === receipt.trackedByteManifest.length,
    'tracked manifest count drifted'
  );
  assert(
    receipt.before.manifestDigest ===
      sha256(Buffer.from(JSON.stringify(receipt.trackedByteManifest), 'utf8')),
    'tracked manifest digest drifted'
  );
  const expectedEquality = {
    head: receipt.before.head === receipt.after.head,
    status: JSON.stringify(receipt.before.statusLines) === JSON.stringify(receipt.after.statusLines),
    trackedCount: receipt.before.trackedCount === receipt.after.trackedCount,
    manifestDigest: receipt.before.manifestDigest === receipt.after.manifestDigest,
    everyTrackedEntry:
      receipt.before.trackedCount === receipt.after.trackedCount &&
      receipt.before.manifestDigest === receipt.after.manifestDigest,
  };
  assert(
    JSON.stringify(receipt.equality) === JSON.stringify(expectedEquality),
    'persistent equality verdict drifted'
  );
  assertBooleanRecord(receipt.equality, 'persistent Store equality');
  verifyCleanup(
    receipt.cleanup,
    [
      'browserTargetClosed',
      'serverProcessExited',
      'metadataRemoved',
      'temporaryLogsRemoved',
      'stickyProxyLeftRunning',
    ],
    'persistent runner'
  );
  return true;
}

const storeList = JSON.parse(
  execFileSync(process.execPath, ['bin/rasen.js', 'store', 'list', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
);
const store = storeList.stores.find(
  (entry) => entry.type === 'store' && entry.id === 'issue-registry'
);
assert(store?.root && store?.uid, 'registered issue-registry Store was not found');
const storeRoot = path.resolve(store.root);
const before = storeSnapshot(storeRoot);
assert(before.statusLines.length === 0, 'persistent issue-registry Store is dirty before smoke');

const nonce = `${process.pid}-${randomBytes(8).toString('hex')}`;
const metadataPath = path.join(os.tmpdir(), `rasen-g003-persistent-meta-${nonce}.json`);
const stdoutPath = path.join(os.tmpdir(), `rasen-g003-persistent-stdout-${nonce}.log`);
const stderrPath = path.join(os.tmpdir(), `rasen-g003-persistent-stderr-${nonce}.log`);
const stdoutFd = fs.openSync(stdoutPath, 'wx');
const stderrFd = fs.openSync(stderrPath, 'wx');
let child = null;
let metadata = null;
let targetId = null;
let cleanupPromise = null;

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    let browserTargetClosed = targetId === null;
    if (targetId !== null) {
      try {
        const result = cdpGet('/close', { target: targetId });
        browserTargetClosed = result.success === true || result.ok === true || result.closed === true;
      } catch {
        browserTargetClosed = false;
      }
      targetId = null;
    }
    if (metadata !== null && child?.exitCode === null) {
      await controlPost(metadata.controlPort, metadata.controlToken).catch(() => child.kill('SIGTERM'));
    }
    if (child !== null) {
      await waitForExit(child).catch(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        await waitForExit(child, 5_000).catch(() => undefined);
      });
    }
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    for (const temporaryPath of [metadataPath, stdoutPath, stderrPath]) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return {
      browserTargetClosed,
      serverProcessExited:
        child === null || child.exitCode !== null || child.signalCode !== null,
      metadataRemoved: !fs.existsSync(metadataPath),
      temporaryLogsRemoved: !fs.existsSync(stdoutPath) && !fs.existsSync(stderrPath),
      stickyProxyLeftRunning: cdpGet('/health').status === 'ok',
    };
  })();
  return cleanupPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  });
}

let smoke = null;
let observations = null;
let storageClear = null;
let readOnly = null;
let failure = null;
try {
  assert(cdpGet('/health').connected === true, 'CDP permission is unavailable');
  child = spawn(process.execPath, [serverPath, metadataPath], {
    cwd: repoRoot,
    env: { ...process.env },
    stdio: ['ignore', stdoutFd, stderrFd],
    windowsHide: true,
  });
  metadata = await waitForMetadata(metadataPath, child, stderrPath);
  const origin = `http://127.0.0.1:${metadata.managementPort}`;
  const routeUrl = (route, marker) =>
    `${origin}${route}?browser-evidence=${encodeURIComponent(marker)}#token=${metadata.uiToken}`;
  const issuesRoute = `/s/${encodeURIComponent(store.id)}/issues`;
  const detailRoute = `${issuesRoute}/${encodeURIComponent(selectedIssue)}`;
  const storeSelector = `store:${store.id}`;

  targetId = cdpGet('/new', { url: 'about:blank' }).targetId;
  assert(typeof targetId === 'string' && targetId.length > 0, 'CDP did not return a target id');
  cdpGet('/network/enable', { target: targetId, body: true });

  const bootstrapReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(issuesRoute, 'storage-bootstrap'), '[data-testid="issue-board"]');
  const bootstrapObserved = await waitForManagementObservation(
    targetId,
    origin,
    bootstrapReset
  );
  storageClear = withStorageVerification(evalJson(targetId, clearStorageExpression));
  verifyStorageClear(storageClear, 'persistent');

  const issuesReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(issuesRoute, 'issues-reload'), '[data-testid="issue-board"]');
  const issues = evalJson(targetId, boardExpression);
  const issuesObserved = await waitForManagementObservation(targetId, origin, issuesReset);

  const detailReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(detailRoute, 'detail'), '[data-testid="issue-detail"]');
  const detailObserved = await waitForManagementObservation(
    targetId,
    origin,
    detailReset,
    { selector: storeSelector, issueId: selectedIssue }
  );
  const detail = evalJson(targetId, detailExpression);
  const projection = detailObserved.state.normalized.projection;
  const semanticAssertions = derivePersistentSemantics(detail, projection);
  assertBooleanRecord(semanticAssertions, 'persistent browser semantic assertion');

  const operationsReset = resetNetwork(targetId);
  navigate(
    targetId,
    routeUrl(`/s/${encodeURIComponent(store.id)}/operations`, 'operations'),
    '[data-testid="operations-page"]'
  );
  const operations = evalJson(targetId, pageExpression);
  const operationsObserved = await waitForManagementObservation(
    targetId,
    origin,
    operationsReset
  );

  const unlinkedReset = resetNetwork(targetId);
  navigate(
    targetId,
    routeUrl(`/s/${encodeURIComponent(store.id)}/unlinked-changes`, 'unlinked'),
    '[data-testid="unlinked-changes-page"]'
  );
  const unlinked = evalJson(targetId, pageExpression);
  const unlinkedObserved = await waitForManagementObservation(
    targetId,
    origin,
    unlinkedReset
  );

  observations = {
    storageBootstrap: bootstrapObserved.observation,
    issues: issuesObserved.observation,
    detail: detailObserved.observation,
    operations: operationsObserved.observation,
    unlinked: unlinkedObserved.observation,
  };
  readOnly = deriveReadOnlySummary(observations);
  verifyReadOnlySummary(readOnly, observations);
  const responseCapture = {
    exactBodies: detailObserved.state.exactBodies,
    digest: detailObserved.state.digest,
    freshness: detailObserved.state.freshness,
    correspondence: detailObserved.state.correspondence,
  };

  smoke = {
    issues: {
      ...issues,
      requests: observations.issues.requests,
      sameOriginGetOnly: observations.issues.verdict.sameOriginGetOnly,
    },
    detail: {
      selectedIssue,
      ...detail,
      responseCapture,
      semanticAssertions,
      requests: observations.detail.requests,
      sameOriginGetOnly: observations.detail.verdict.sameOriginGetOnly,
    },
    operations: {
      ...operations,
      requests: observations.operations.requests,
      sameOriginGetOnly: observations.operations.verdict.sameOriginGetOnly,
    },
    unlinked: {
      ...unlinked,
      requests: observations.unlinked.requests,
      sameOriginGetOnly: observations.unlinked.verdict.sameOriginGetOnly,
    },
  };
} catch (error) {
  failure = error;
} finally {
  await cleanup();
}

const cleanupResult = await cleanup();
if (failure) throw failure;
const after = storeSnapshot(storeRoot);
const equality = {
  head: before.head === after.head,
  status: JSON.stringify(before.statusLines) === JSON.stringify(after.statusLines),
  trackedCount: before.trackedCount === after.trackedCount,
  manifestDigest: before.manifestDigest === after.manifestDigest,
  everyTrackedEntry:
    JSON.stringify(before.trackedByteManifest) === JSON.stringify(after.trackedByteManifest),
};
assert(Object.values(equality).every(Boolean), 'persistent Store bytes changed during read-only smoke');
assert(cleanupResult.browserTargetClosed, 'persistent browser target was not closed');
assert(cleanupResult.serverProcessExited, 'persistent server did not exit');

const receipt = {
  schemaVersion: 3,
  change: 'issue-board-cutover',
  capturedOn: new Date().toISOString(),
  exactInvocation: invocation,
  scope: 'persistent-store-readonly',
  store: { id: store.id, uid: store.uid, selector: `store:${store.id}`, root: storeRoot },
  redaction: {
    uiToken: 'omitted',
    controlToken: 'omitted',
    requestHeaders: 'omitted',
    cookies: 'omitted',
    urlFragments: 'omitted',
    rawExternalNetworkEvents: 'omitted',
  },
  before: {
    head: before.head,
    statusLines: before.statusLines,
    statusDigest: before.statusDigest,
    trackedCount: before.trackedCount,
    manifestDigest: before.manifestDigest,
  },
  trackedByteManifest: before.trackedByteManifest,
  storageClear,
  smoke,
  after: {
    head: after.head,
    statusLines: after.statusLines,
    statusDigest: after.statusDigest,
    trackedCount: after.trackedCount,
    manifestDigest: after.manifestDigest,
  },
  equality,
  networkObservations: observations,
  readOnly,
  mutationOperationsIssued: readOnly.mutationOperationsIssued,
  cleanup: cleanupResult,
};
verifyReceipt(receipt);
receipt.status = 'ok';
const temporaryReceiptPath = `${receiptPath}.${nonce}.tmp`;
try {
  fs.writeFileSync(temporaryReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  const staged = JSON.parse(fs.readFileSync(temporaryReceiptPath, 'utf8'));
  assert(staged.status === 'ok', 'staged persistent receipt status drifted');
  verifyReceipt(staged);
  fs.copyFileSync(temporaryReceiptPath, receiptPath);
} finally {
  try {
    fs.unlinkSync(temporaryReceiptPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
const written = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
assert(written.status === 'ok', 'written persistent receipt status drifted');
verifyReceipt(written);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    head: after.head,
    trackedCount: after.trackedCount,
    manifestDigest: after.manifestDigest,
    equality,
    cleanup: cleanupResult,
  })}\n`
);
