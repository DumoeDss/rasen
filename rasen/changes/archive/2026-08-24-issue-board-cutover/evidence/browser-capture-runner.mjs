import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertManagementObservation,
  canonicalPreimage,
  captureExactStateResponses,
  clearStorageExpression,
  deriveManagementObservation,
  deriveReadOnlySummary,
  digestRecord,
  invariant as assert,
  verifyCleanup,
  verifyDigestRecord,
  verifyReadOnlySummary,
  verifyStateResponseCapture,
  verifyStorageClear,
  withStorageVerification,
} from './browser-receipt-guards.mjs';

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evidenceDir, '..', '..', '..', '..');
const receiptPath = path.join(evidenceDir, 'browser-disposable-receipt.json');
const fixturePath = path.join(evidenceDir, 'browser-fixture.ts');
const loaderPath = path.join(evidenceDir, 'browser-ts-loader.mjs');
const proxyOrigin = 'http://localhost:3456';
const curlExecutable = process.platform === 'win32' ? 'curl.exe' : 'curl';
const exactInvocation =
  'node rasen/changes/issue-board-cutover/evidence/browser-capture-runner.mjs';

if (process.argv.length > 2) {
  throw new Error(`unexpected arguments; exact invocation is: ${exactInvocation}`);
}

process.chdir(repoRoot);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function curlJson(url, { method = 'GET', body } = {}) {
  const args = ['--noproxy', '*', '--silent', '--show-error', '--fail-with-body'];
  if (method !== 'GET') args.push('--request', method);
  if (body !== undefined) {
    args.push('--header', 'Content-Type: application/javascript; charset=utf-8');
    args.push('--data-binary', body);
  }
  args.push(url);
  const output = execFileSync(curlExecutable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(output);
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

function controlPost(port, token, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Connection: 'close' },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`control ${pathname} returned ${response.statusCode}: ${body}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.once('error', reject);
    request.end();
  });
}

async function waitForMetadata(metadataPath, child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const diagnostic = fs.existsSync(stderrPath)
        ? fs.readFileSync(stderrPath, 'utf8').slice(-8_000)
        : 'stderr was unavailable';
      throw new Error(
        `browser fixture exited before publishing metadata (${child.exitCode})\n${diagnostic}`
      );
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (parsed.managementPort && parsed.controlPort && parsed.uiToken && parsed.controlToken) {
        return parsed;
      }
    } catch {
      // The fixture writes metadata atomically enough for a later poll to win.
    }
    await sleep(100);
  }
  throw new Error('timed out waiting for browser fixture metadata');
}

async function waitForChildExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(timeoutMs).then(() => {
      throw new Error('fixture process did not exit after shutdown');
    }),
  ]);
}

function evalJson(targetId, expression) {
  const response = cdpPost('/eval', { target: targetId }, expression);
  assert(response.error === undefined, `CDP eval failed: ${response.error}`);
  return typeof response.value === 'string' ? JSON.parse(response.value) : response.value;
}

function waitForSelector(targetId, selector) {
  const response = cdpGet('/wait', { target: targetId, selector, timeout: 20_000 });
  assert(response.matched === true, `selector did not appear: ${selector}`);
}

function navigate(targetId, url, selector) {
  cdpGet('/navigate', { target: targetId, url });
  waitForSelector(targetId, selector);
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

const captureBoardExpression = String.raw`JSON.stringify((() => {
  const href = (element) => {
    const url = new URL(element.href);
    return { path: url.pathname, hash: url.hash };
  };
  return {
    route: location.pathname,
    active: [...document.querySelectorAll('a[aria-current="page"]')].map((entry) => ({
      text: entry.textContent.trim(),
      ...href(entry),
    })),
    lanes: [...document.querySelectorAll('[data-testid="issue-lane"]')].map((lane) => lane.dataset.phase),
    cards: [...document.querySelectorAll('[data-testid="issue-card"]')].map((card) => ({
      issue: card.dataset.issue,
      phase: card.dataset.phase,
      health: card.dataset.health,
      links: [...card.querySelectorAll('a')].map((entry) => ({
        testid: entry.dataset.testid ?? null,
        text: entry.textContent.trim(),
        ...href(entry),
      })),
    })),
  };
})())`;

const captureDetailExpression = String.raw`JSON.stringify((() => {
  const href = (element) => {
    const url = new URL(element.href);
    return { path: url.pathname, hash: url.hash };
  };
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
    const targetId = new URL(element.href).hash.slice(1);
    const targets = entries.filter((entry) => entry.id === targetId);
    return {
      testid: element.dataset.testid ?? null,
      text: element.textContent.trim(),
      ...href(element),
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
      testid: entry.dataset.testid,
      text: entry.textContent.trim(),
      ...href(entry),
    })),
    entries,
  };
})())`;

const capturePageExpression = String.raw`JSON.stringify((() => ({
  route: location.pathname,
  active: [...document.querySelectorAll('a[aria-current="page"]')].map((entry) => ({
    text: entry.textContent.trim(),
    path: new URL(entry.href).pathname,
  })),
  pageCount: document.querySelectorAll('main > *').length,
}))())`;

function hasFact(entry, label, expected) {
  return entry?.targetFacts?.some(
    (fact) => fact.label === label && fact.value === String(expected)
  ) === true;
}

function factsContain(entry, label, expected) {
  return entry?.facts?.some(
    (fact) => fact.label === label && fact.value === String(expected)
  ) === true;
}

function deriveSemanticAssertions(detail, projection, attention) {
  const byTestId = new Map(detail.axes.map((entry) => [entry.testid, entry]));
  const state = byTestId.get('issue-detail-state');
  const phase = byTestId.get('issue-detail-phase');
  const health = byTestId.get('issue-detail-health');
  const progress = byTestId.get('issue-detail-progress');
  const runState = byTestId.get('issue-detail-run-state');
  const links = [...detail.axes, ...detail.deliveryLinks, ...detail.attentionLinks];
  const nodes = projection?.status?.nodes ?? [];
  const topAttention = attention.items[0];
  const attentionLink = detail.attentionLinks[0];
  const attentionNode = nodes.find((node) => node.nodeId === topAttention?.nodeId);
  const deliveryEntries = detail.entries.filter((entry) => entry.family === 'delivery');
  const deliveryEntry = deliveryEntries[0];
  return {
    everyLinkResolvesExactlyOnce: links.every((link) => link.targetCount === 1),
    everyTargetHasClosedKind: links.every(
      (link) => link.targetKind === 'git' || link.targetKind === 'runtime'
    ),
    stateCarriesExactIssueInput: hasFact(
      state,
      'issue.record.state',
      projection?.issue?.record?.state
    ),
    phaseCarriesIssueAndNodeInputs:
      hasFact(phase, 'status.phase', projection?.status?.phase) &&
      hasFact(phase, 'issue.record.state', projection?.issue?.record?.state) &&
      nodes.every(
        (node) =>
          hasFact(phase, `${node.nodeId}.lifecycle`, node.lifecycle) &&
          hasFact(phase, `${node.nodeId}.observation`, node.observation)
      ),
    healthCarriesProjectedAndRuntimeInputs: hasFact(
      health,
      'status.health',
      projection?.status?.health
    ),
    progressCarriesExactCompletionInputs:
      hasFact(progress, 'status.progress.completed', projection?.status?.progress?.completed) &&
      hasFact(progress, 'status.progress.total', projection?.status?.progress?.total) &&
      nodes.every(
        (node) =>
          hasFact(progress, `${node.nodeId}.lifecycle`, node.lifecycle) &&
          hasFact(progress, `${node.nodeId}.observation`, node.observation)
      ),
    runStateCarriesExecutionRoot: hasFact(
      runState,
      'runStateVisibility.executionRoot',
      projection?.status?.runStateVisibility?.executionRoot
    ),
    runtimeAttentionCarriesExactNodeAndLocator:
      topAttention !== undefined &&
      attentionLink !== undefined &&
      attentionLink.targetKind === 'runtime' &&
      attentionNode !== undefined &&
      hasFact(attentionLink, 'attention.kind', topAttention.kind) &&
      hasFact(attentionLink, 'attention.nodeId', topAttention.nodeId) &&
      hasFact(
        attentionLink,
        `support.${attentionNode.nodeId}.observation`,
        attentionNode.observation
      ) &&
      hasFact(
        attentionLink,
        `support.${attentionNode.nodeId}.runStatePath`,
        attentionNode.runStatePath
      ),
    deliveryCarriesEveryExactNodeState:
      deliveryEntries.length === 1 &&
      nodes
        .filter((node) => node.delivery !== null)
        .every((node) =>
          factsContain(deliveryEntry, `${node.nodeId}.delivery.state`, node.delivery.state)
        ),
  };
}

function assertBooleanRecord(record, label) {
  for (const [name, value] of Object.entries(record)) {
    assert(value === true, `${label} failed: ${name}`);
  }
}

async function waitForManagementObservation(
  targetId,
  managementOrigin,
  reset,
  expectedState = null,
  timeoutMs = 20_000
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
        return new URL(event.url).origin === new URL(managementOrigin).origin;
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
      const observation = deriveManagementObservation(snapshot, managementOrigin, reset);
      const state =
        expectedState === null
          ? null
          : captureExactStateResponses(
              snapshot,
              observation,
              managementOrigin,
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

async function captureDetail(targetId, managementOrigin, reset, selector, issueId) {
  const observed = await waitForManagementObservation(
    targetId,
    managementOrigin,
    reset,
    { selector, issueId }
  );
  const detail = evalJson(targetId, captureDetailExpression);
  return {
    detail,
    observation: observed.observation,
    responses: observed.state,
    domDigest: digestRecord(detail),
  };
}

function verifyReceipt(receipt) {
  assert(receipt.schemaVersion === 3, 'disposable receipt schema drifted');
  assert(receipt.change === 'issue-board-cutover', 'disposable receipt change drifted');
  const observations = receipt.networkObservations;
  for (const observation of Object.values(observations)) {
    assertManagementObservation(observation);
  }
  verifyReadOnlySummary(receipt.readOnly, observations);
  assert(
    JSON.stringify(receipt.mutationOperationsIssued) ===
      JSON.stringify(receipt.readOnly.mutationOperationsIssued),
    'top-level mutation inventory drifted'
  );
  const expectedSelector = receipt.fixture.storeSelector;
  const issueId = receipt.fixture.issueId;
  const beforeResponses = verifyStateResponseCapture(
    receipt.rebuild.before.responseCapture,
    observations.detailBaseline,
    expectedSelector,
    issueId,
    'before'
  );
  const afterClearResponses = verifyStateResponseCapture(
    receipt.rebuild.afterClear.responseCapture,
    observations.detailAfterClear,
    expectedSelector,
    issueId,
    'after-clear'
  );
  const afterMutationResponses = verifyStateResponseCapture(
    receipt.controlledEvidenceMutation.after.responseCapture,
    observations.detailAfterMutation,
    expectedSelector,
    issueId,
    'after-mutation'
  );
  for (const [label, capture] of [
    ['before DOM', receipt.rebuild.before.dom],
    ['after-clear DOM', receipt.rebuild.afterClear.dom],
    ['after-mutation DOM', receipt.controlledEvidenceMutation.after.dom],
  ]) {
    verifyDigestRecord(capture, JSON.parse(capture.preimage), label);
  }
  const beforeDetail = JSON.parse(receipt.rebuild.before.dom.preimage);
  const expectedSemantics = deriveSemanticAssertions(
    beforeDetail,
    beforeResponses.projection,
    beforeResponses.attention
  );
  assert(
    JSON.stringify(receipt.provenance.semanticAssertions) === JSON.stringify(expectedSemantics),
    'semantic assertions drifted from captured DOM/payload'
  );
  assertBooleanRecord(receipt.provenance.semanticAssertions, 'semantic assertion');
  assert(
    canonicalPreimage(beforeResponses) === canonicalPreimage(afterClearResponses),
    'cache-cleared decoded response data changed without evidence change'
  );
  assert(
    canonicalPreimage(beforeResponses) !== canonicalPreimage(afterMutationResponses),
    'decoded response data did not change after committed evidence mutation'
  );
  assert(
    receipt.rebuild.before.dom.sha256 === receipt.rebuild.afterClear.dom.sha256,
    'cache-cleared DOM digest changed without evidence change'
  );
  assert(
    receipt.rebuild.before.responseCapture.digest.sha256 ===
      receipt.rebuild.afterClear.responseCapture.digest.sha256,
    'cache-cleared response digest changed without evidence change'
  );
  assert(
    receipt.rebuild.before.dom.sha256 !== receipt.controlledEvidenceMutation.after.dom.sha256,
    'DOM digest did not change after committed evidence mutation'
  );
  assert(
    receipt.rebuild.before.responseCapture.digest.sha256 !==
      receipt.controlledEvidenceMutation.after.responseCapture.digest.sha256,
    'response digest did not change after committed evidence mutation'
  );
  assert(
    receipt.rebuild.afterClear.equivalent ===
      (receipt.rebuild.before.dom.sha256 === receipt.rebuild.afterClear.dom.sha256 &&
        receipt.rebuild.before.responseCapture.digest.sha256 ===
          receipt.rebuild.afterClear.responseCapture.digest.sha256),
    'equivalence verdict drifted'
  );
  assert(receipt.rebuild.afterClear.equivalent, 'cache-cleared rebuild was not equivalent');
  assert(
    receipt.controlledEvidenceMutation.domChanged ===
      (receipt.rebuild.before.dom.sha256 !== receipt.controlledEvidenceMutation.after.dom.sha256),
    'DOM change verdict drifted'
  );
  assert(receipt.controlledEvidenceMutation.domChanged, 'DOM did not change after evidence mutation');
  assert(
    receipt.controlledEvidenceMutation.responseChanged ===
      (receipt.rebuild.before.responseCapture.digest.sha256 !==
        receipt.controlledEvidenceMutation.after.responseCapture.digest.sha256),
    'response change verdict drifted'
  );
  assert(receipt.controlledEvidenceMutation.responseChanged, 'response did not change after evidence mutation');
  assert(
    receipt.controlledEvidenceMutation.noInvalidationCall ===
      observations.detailAfterMutation.verdict.noInvalidationCall,
    'mutation rebuild invalidation verdict drifted'
  );
  assert(receipt.controlledEvidenceMutation.noInvalidationCall, 'mutation rebuild issued invalidation');
  verifyStorageClear(receipt.rebuild.storageClear, 'first');
  verifyStorageClear(receipt.controlledEvidenceMutation.storageClear, 'second');
  for (const [name, navigation] of Object.entries(receipt.navigation)) {
    if (navigation.sameOriginGetOnly !== undefined) {
      const key =
        name === 'issues'
          ? 'issues'
          : name === 'operations'
            ? 'operations'
            : name === 'unlinked'
              ? 'unlinked'
              : 'detailBaseline';
      assert(
        navigation.sameOriginGetOnly === observations[key].verdict.sameOriginGetOnly,
        `${name} GET-only verdict drifted`
      );
      assert(navigation.sameOriginGetOnly, `${name} navigation was not read-only`);
      assert(
        JSON.stringify(navigation.requests) === JSON.stringify(observations[key].requests),
        `${name} request inventory drifted`
      );
    }
  }
  assert(
    JSON.stringify(receipt.rebuild.afterClear.requests) ===
      JSON.stringify(observations.detailAfterClear.requests),
    'after-clear request inventory drifted'
  );
  assert(
    JSON.stringify(receipt.controlledEvidenceMutation.requests) ===
      JSON.stringify(observations.detailAfterMutation.requests),
    'after-mutation request inventory drifted'
  );
  verifyCleanup(
    receipt.cleanup,
    [
      'browserTargetClosed',
      'fixtureProcessExited',
      'fixtureRootRemoved',
      'metadataRemoved',
      'temporaryLogsRemoved',
      'stickyProxyLeftRunning',
    ],
    'disposable runner'
  );
  return true;
}

const nonce = `${process.pid}-${randomBytes(8).toString('hex')}`;
const metadataPath = path.join(os.tmpdir(), `rasen-g003-browser-meta-${nonce}.json`);
const stdoutPath = path.join(os.tmpdir(), `rasen-g003-browser-stdout-${nonce}.log`);
const stderrPath = path.join(os.tmpdir(), `rasen-g003-browser-stderr-${nonce}.log`);
const stdoutFd = fs.openSync(stdoutPath, 'wx');
const stderrFd = fs.openSync(stderrPath, 'wx');

let child = null;
let metadata = null;
let targetId = null;
let cleanupPromise = null;

async function cleanup() {
  if (cleanupPromise !== null) return cleanupPromise;
  cleanupPromise = (async () => {
    let browserTargetClosed = targetId === null;
    if (targetId !== null) {
      try {
        const result = cdpGet('/close', { target: targetId });
        browserTargetClosed =
          result.closed === true || result.ok === true || result.success === true;
      } catch {
        browserTargetClosed = false;
      }
      targetId = null;
    }

    if (metadata !== null && child?.exitCode === null) {
      try {
        await controlPost(metadata.controlPort, metadata.controlToken, '/shutdown');
      } catch {
        child.kill('SIGTERM');
      }
    }
    if (child !== null) {
      try {
        await waitForChildExit(child);
      } catch {
        if (child.exitCode === null) child.kill('SIGTERM');
        await waitForChildExit(child, 5_000).catch(() => undefined);
      }
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
      fixtureProcessExited:
        child === null || child.exitCode !== null || child.signalCode !== null,
      fixtureRootRemoved:
        metadata === null || !fs.existsSync(path.resolve(metadata.fixtureRoot)),
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

let receipt = null;
let failure = null;
try {
  const health = cdpGet('/health');
  assert(health.connected === true, 'CDP proxy does not have Chrome permission');

  child = spawn(
    process.execPath,
    [
      '--experimental-transform-types',
      '--loader',
      pathToFileURL(loaderPath).href,
      fixturePath,
      metadataPath,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    }
  );
  metadata = await waitForMetadata(metadataPath, child);

  const managementOrigin = `http://127.0.0.1:${metadata.managementPort}`;
  const routeUrl = (route, reloadMarker = null) =>
    `${managementOrigin}${route}${
      reloadMarker === null ? '' : `?browser-evidence=${encodeURIComponent(reloadMarker)}`
    }#token=${metadata.uiToken}`;
  const issuesRoute = `/s/${encodeURIComponent(metadata.storeUid)}/issues`;
  const detailRoute = `${issuesRoute}/${encodeURIComponent(metadata.issueId)}`;
  const operationsRoute = `/s/${encodeURIComponent(metadata.storeUid)}/operations`;
  const unlinkedRoute = `/s/${encodeURIComponent(metadata.storeUid)}/unlinked-changes`;
  const storeSelector = `store:${metadata.storeUid}`;

  const opened = cdpGet('/new', { url: 'about:blank' });
  targetId = opened.targetId;
  assert(typeof targetId === 'string' && targetId.length > 0, 'CDP did not return a target id');
  cdpGet('/network/enable', { target: targetId, body: true });

  const issuesReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(issuesRoute), '[data-testid="issue-board"]');
  const board = evalJson(targetId, captureBoardExpression);
  const issuesObserved = await waitForManagementObservation(
    targetId,
    managementOrigin,
    issuesReset
  );

  const detailBaselineReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(detailRoute, 'baseline'), '[data-testid="issue-detail"]');
  const before = await captureDetail(
    targetId,
    managementOrigin,
    detailBaselineReset,
    storeSelector,
    metadata.issueId
  );
  const beforeProjection = before.responses.normalized.projection;
  const beforeAttention = before.responses.normalized.attention;
  const semantics = deriveSemanticAssertions(before.detail, beforeProjection, beforeAttention);
  assertBooleanRecord(semantics, 'browser semantic assertion');

  const operationsReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(operationsRoute), '[data-testid="operations-page"]');
  const operations = evalJson(targetId, capturePageExpression);
  const operationsObserved = await waitForManagementObservation(
    targetId,
    managementOrigin,
    operationsReset
  );

  const unlinkedReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(unlinkedRoute), '[data-testid="unlinked-changes-page"]');
  const unlinked = evalJson(targetId, capturePageExpression);
  const unlinkedObserved = await waitForManagementObservation(
    targetId,
    managementOrigin,
    unlinkedReset
  );

  const storage = withStorageVerification(evalJson(targetId, clearStorageExpression));
  verifyStorageClear(storage, 'first');
  const detailAfterClearReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(detailRoute, 'after-clear'), '[data-testid="issue-detail"]');
  const afterClear = await captureDetail(
    targetId,
    managementOrigin,
    detailAfterClearReset,
    storeSelector,
    metadata.issueId
  );

  const mutation = await controlPost(metadata.controlPort, metadata.controlToken, '/mutate');
  assert(mutation.ok === true && mutation.revisionId === '0002', 'controlled mutation did not publish revision 0002');
  const secondStorageClear = withStorageVerification(
    evalJson(targetId, clearStorageExpression)
  );
  verifyStorageClear(secondStorageClear, 'second');
  const detailAfterMutationReset = resetNetwork(targetId);
  navigate(targetId, routeUrl(detailRoute, 'after-mutation'), '[data-testid="issue-detail"]');
  const afterMutation = await captureDetail(
    targetId,
    managementOrigin,
    detailAfterMutationReset,
    storeSelector,
    metadata.issueId
  );

  const productionBundle = fs
    .readFileSync(path.join(repoRoot, 'packages', 'ui', 'dist', 'index.html'), 'utf8')
    .match(/assets\/index-[^"']+\.js/)?.[0];
  assert(productionBundle !== undefined, 'production bundle name was not found');

  const observations = {
    issues: issuesObserved.observation,
    detailBaseline: before.observation,
    operations: operationsObserved.observation,
    unlinked: unlinkedObserved.observation,
    detailAfterClear: afterClear.observation,
    detailAfterMutation: afterMutation.observation,
  };
  const readOnly = deriveReadOnlySummary(observations);
  verifyReadOnlySummary(readOnly, observations);
  const receiptCapture = (capture) => ({
    exactBodies: capture.exactBodies,
    digest: capture.digest,
    freshness: capture.freshness,
    correspondence: capture.correspondence,
  });

  receipt = {
    schemaVersion: 3,
    change: 'issue-board-cutover',
    captureTarget: 'production-built-working-tree-for-next-commit',
    exactInvocation,
    capturedOn: new Date().toISOString(),
    fixture: {
      kind: 'disposable-real-git-store-and-runtime',
      storeUid: metadata.storeUid,
      storeSelector,
      issueId: metadata.issueId,
      initialHead: metadata.initialHead,
      productionBundle,
    },
    redaction: {
      uiToken: 'omitted',
      controlToken: 'omitted',
      requestHeaders: 'omitted',
      cookies: 'omitted',
      urlFragments: 'omitted',
      rawExternalNetworkEvents: 'omitted',
    },
    normalization: {
      canonicalJson: 'objects sorted recursively by key; arrays retain payload/DOM order; compact JSON; UTF-8',
      dom: 'route, state links with resolved target facts, action links, and all provenance entries/facts',
      responses: 'complete parsed bodies of the exact issue-projection and narrowed issue-attention responses',
      digest: 'SHA-256 over the exact committed preimage string stored beside each digest',
    },
    navigation: {
      issues: {
        ...board,
        requests: observations.issues.requests,
        sameOriginGetOnly: observations.issues.verdict.sameOriginGetOnly,
      },
      detail: {
        route: before.detail.route,
        axes: before.detail.axes,
        actions: before.detail.actions,
        entryCount: before.detail.entries.length,
        requests: observations.detailBaseline.requests,
        sameOriginGetOnly: observations.detailBaseline.verdict.sameOriginGetOnly,
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
    },
    provenance: {
      entries: before.detail.entries,
      semanticAssertions: semantics,
    },
    rebuild: {
      storageClear: storage,
      before: {
        dom: before.domDigest,
        responseCapture: receiptCapture(before.responses),
      },
      afterClear: {
        dom: afterClear.domDigest,
        responseCapture: receiptCapture(afterClear.responses),
        requests: observations.detailAfterClear.requests,
        equivalent:
          before.domDigest.sha256 === afterClear.domDigest.sha256 &&
          before.responses.digest.sha256 === afterClear.responses.digest.sha256,
      },
    },
    controlledEvidenceMutation: {
      mutation: {
        head: mutation.head,
        revisionId: mutation.revisionId,
        contentSha256: mutation.contentSha256,
      },
      storageClear: secondStorageClear,
      after: {
        dom: afterMutation.domDigest,
        responseCapture: receiptCapture(afterMutation.responses),
      },
      domChanged: before.domDigest.sha256 !== afterMutation.domDigest.sha256,
      responseChanged: before.responses.digest.sha256 !== afterMutation.responses.digest.sha256,
      noInvalidationCall: observations.detailAfterMutation.verdict.noInvalidationCall,
      requests: observations.detailAfterMutation.requests,
    },
    networkObservations: observations,
    readOnly,
    mutationOperationsIssued: readOnly.mutationOperationsIssued,
  };
} catch (error) {
  failure = error;
} finally {
  await cleanup();
}

const cleanupResult = await cleanup();
if (failure !== null) {
  throw failure;
}
receipt.cleanup = cleanupResult;
verifyReceipt(receipt);
receipt.status = 'ok';
const temporaryReceiptPath = `${receiptPath}.${nonce}.tmp`;
try {
  fs.writeFileSync(temporaryReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  const staged = JSON.parse(fs.readFileSync(temporaryReceiptPath, 'utf8'));
  assert(staged.status === 'ok', 'staged receipt status drifted');
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
assert(written.status === 'ok', 'written receipt status drifted');
verifyReceipt(written);
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    receipt: path.relative(repoRoot, receiptPath).replaceAll('\\', '/'),
    domSha256: written.rebuild.before.dom.sha256,
    responseSha256: written.rebuild.before.responseCapture.digest.sha256,
    cleanup: written.cleanup,
  })}\n`
);
