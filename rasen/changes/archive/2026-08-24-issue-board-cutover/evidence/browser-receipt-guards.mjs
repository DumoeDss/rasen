import { createHash } from 'node:crypto';

const DIGEST_ALGORITHM = 'sha256(utf8(canonical-json-v1))';
const STATE_ENDPOINTS = new Map([
  ['/api/v1/stores/issue-projection', 'projection'],
  ['/api/v1/stores/issue-attention', 'attention'],
]);
const REQUIRED_STORAGE_SUPPORT = [
  'localStorage',
  'sessionStorage',
  'cacheStorage',
  'indexedDbDatabases',
  'serviceWorkers',
];
const REQUIRED_STORAGE_COUNTS = [
  'localStorageCount',
  'sessionStorageCount',
  'cacheCount',
  'indexedDbCount',
  'serviceWorkerCount',
];

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

export function canonicalPreimage(value) {
  return JSON.stringify(canonical(value));
}

export function digestRecord(value) {
  const preimage = canonicalPreimage(value);
  return {
    algorithm: DIGEST_ALGORITHM,
    preimage,
    sha256: sha256(preimage),
  };
}

export function verifyDigestRecord(record, value, label) {
  invariant(record?.algorithm === DIGEST_ALGORITHM, `${label} algorithm drifted`);
  const expectedPreimage = canonicalPreimage(value);
  invariant(record.preimage === expectedPreimage, `${label} preimage does not match canonical data`);
  invariant(record.sha256 === sha256(expectedPreimage), `${label} digest does not match canonical data`);
}

function exactOrigin(urlValue, expectedOrigin) {
  try {
    return new URL(urlValue).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

function requestSummary(event, resetGeneration) {
  invariant(Number.isInteger(event.seq) && event.seq >= 1, 'network event has no positive sequence');
  const url = new URL(event.url);
  return {
    seq: event.seq,
    resetGeneration,
    method: event.method ?? null,
    path: `${url.pathname}${url.search}`,
    status: typeof event.status === 'number' ? event.status : null,
    completed: event.completed === true,
    failed: event.failed === true,
    error: event.error ?? null,
  };
}

function derivedObservationVerdict(reset, requests) {
  const mutationOperationsIssued = requests
    .filter((request) => request.method !== 'GET')
    .map(({ seq, method, path, completed, failed, status }) => ({
      seq,
      method,
      path,
      completed,
      failed,
      status,
    }));
  return {
    allObservedAfterReset:
      reset.cleared === true &&
      reset.bufferEmptyAfterReset === true &&
      reset.totalAfterReset === 0 &&
      reset.lastSeqAfterReset === 0 &&
      requests.every(
        (request) => request.resetGeneration === reset.generation && request.seq >= 1
      ),
    allCompleted: requests.every((request) => request.completed === true),
    noFailedEvents: requests.every((request) => request.failed === false),
    successfulStatuses: requests.every(
      (request) =>
        request.status === null || (request.status >= 200 && request.status < 400)
    ),
    sameOriginGetOnly: requests.every((request) => request.method === 'GET'),
    noInvalidationCall: requests.every(
      (request) => !request.path.toLowerCase().includes('invalidat')
    ),
    mutationOperationsIssued,
  };
}

export function deriveManagementObservation(snapshot, expectedOrigin, reset) {
  invariant(reset?.generation >= 1, 'network reset generation is missing');
  invariant(snapshot?.resetGeneration === reset.generation, 'stale pre-reset network snapshot');
  invariant(snapshot.total === snapshot.events.length, 'network snapshot omitted buffered events');
  invariant(snapshot.returned === snapshot.total, 'network snapshot was truncated');
  invariant(snapshot.lastSeq === (snapshot.events.at(-1)?.seq ?? 0), 'network lastSeq drifted');
  const requests = snapshot.events
    .filter((event) => exactOrigin(event.url, expectedOrigin))
    .map((event) => requestSummary(event, reset.generation));
  const observation = {
    reset: { ...reset },
    requests,
    verdict: derivedObservationVerdict(reset, requests),
  };
  assertManagementObservation(observation);
  return observation;
}

export function assertManagementObservation(observation) {
  invariant(observation?.requests?.length > 0, 'no management-origin request was observed');
  const derived = derivedObservationVerdict(observation.reset, observation.requests);
  invariant(
    JSON.stringify(observation.verdict) === JSON.stringify(derived),
    'management observation verdict does not match its requests'
  );
  invariant(derived.allObservedAfterReset, 'management request was not observed after the reset');
  invariant(derived.allCompleted, 'unfinished management-origin request was observed');
  invariant(derived.noFailedEvents, 'failed management-origin request was observed');
  invariant(derived.successfulStatuses, 'unsuccessful management-origin status was observed');
  invariant(derived.sameOriginGetOnly, 'non-GET management-origin request was observed');
  invariant(derived.noInvalidationCall, 'client invalidation request was observed');
  invariant(derived.mutationOperationsIssued.length === 0, 'domain mutation inventory is not empty');
}

function exactStateQuery(url, expectedSelector, expectedIssueId) {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === 2 &&
    url.searchParams.getAll('space').length === 1 &&
    url.searchParams.get('space') === expectedSelector &&
    url.searchParams.getAll('issueId').length === 1 &&
    url.searchParams.get('issueId') === expectedIssueId
  );
}

function decodeResponseBody(event) {
  invariant(typeof event.response_body === 'string', `response body missing for ${event.url}`);
  return event.response_body_base64
    ? Buffer.from(event.response_body, 'base64').toString('utf8')
    : event.response_body;
}

function payloadMatches(name, payload, expectedIssueId) {
  if (name === 'projection') return payload?.issue?.issueId === expectedIssueId;
  return (
    payload?.narrowed === true &&
    payload?.issueId === expectedIssueId &&
    Array.isArray(payload.scanned) &&
    payload.scanned.every((entry) => entry?.issueId === expectedIssueId)
  );
}

function validateStateBody(body, expectedSelector, expectedIssueId) {
  invariant(body?.name === 'projection' || body?.name === 'attention', 'unknown state body name');
  invariant(body.method === 'GET', `${body.name} response was not produced by GET`);
  invariant(body.status === 200, `${body.name} response status was not 200`);
  invariant(body.completed === true && body.failed === false, `${body.name} response did not complete cleanly`);
  invariant(body.observedAfterReset === true, `${body.name} response was stale`);
  const url = new URL(body.path, 'http://receipt.invalid');
  invariant(
    STATE_ENDPOINTS.get(url.pathname) === body.name,
    `${body.name} response pathname drifted`
  );
  invariant(
    exactStateQuery(url, expectedSelector, expectedIssueId),
    `${body.name} response Store/Issue query drifted`
  );
  let payload;
  try {
    payload = JSON.parse(body.rawBody);
  } catch (error) {
    throw new Error(`${body.name} response body is not JSON: ${error}`);
  }
  invariant(
    payloadMatches(body.name, payload, expectedIssueId),
    `${body.name} decoded payload identity drifted`
  );
  invariant(body.payloadIdentity === true, `${body.name} payload identity flag drifted`);
  return payload;
}

export function captureExactStateResponses(
  snapshot,
  observation,
  expectedOrigin,
  expectedSelector,
  expectedIssueId
) {
  invariant(
    snapshot.resetGeneration === observation.reset.generation,
    'state responses came from a stale reset generation'
  );
  const stateEvents = snapshot.events.filter((event) => {
    if (!exactOrigin(event.url, expectedOrigin)) return false;
    return STATE_ENDPOINTS.has(new URL(event.url).pathname);
  });
  const grouped = new Map([
    ['projection', []],
    ['attention', []],
  ]);
  for (const event of stateEvents) {
    const url = new URL(event.url);
    const name = STATE_ENDPOINTS.get(url.pathname);
    invariant(exactStateQuery(url, expectedSelector, expectedIssueId), `${name} request Store/Issue query drifted`);
    const request = observation.requests.find((candidate) => candidate.seq === event.seq);
    invariant(request !== undefined, `${name} response is absent from the complete request inventory`);
    const rawBody = decodeResponseBody(event);
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (error) {
      throw new Error(`${name} response body is not JSON: ${error}`);
    }
    const payloadIdentity = payloadMatches(name, payload, expectedIssueId);
    const body = {
      name,
      seq: request.seq,
      resetGeneration: request.resetGeneration,
      method: request.method,
      path: request.path,
      status: request.status,
      completed: request.completed,
      failed: request.failed,
      observedAfterReset:
        observation.verdict.allObservedAfterReset &&
        request.resetGeneration === observation.reset.generation,
      payloadIdentity,
      rawBody,
    };
    validateStateBody(body, expectedSelector, expectedIssueId);
    grouped.get(name).push({ body, payload });
  }
  for (const name of ['projection', 'attention']) {
    invariant(grouped.get(name).length === 1, `expected exactly one fresh ${name} response`);
  }
  const projection = grouped.get('projection')[0];
  const attention = grouped.get('attention')[0];
  const normalized = {
    projection: projection.payload,
    attention: attention.payload,
  };
  const digest = digestRecord(normalized);
  const exactBodies = [projection.body, attention.body];
  const freshness = {
    projection:
      projection.body.observedAfterReset && projection.body.resetGeneration === observation.reset.generation,
    attention:
      attention.body.observedAfterReset && attention.body.resetGeneration === observation.reset.generation,
  };
  const correspondence = {
    rawBodiesDecodeToDigestPreimage:
      digest.preimage === canonicalPreimage(normalized),
    digestMatchesCanonicalBodies: digest.sha256 === sha256(canonicalPreimage(normalized)),
  };
  return { exactBodies, normalized, digest, freshness, correspondence };
}

export function verifyStateResponseCapture(
  capture,
  observation,
  expectedSelector,
  expectedIssueId,
  label
) {
  assertManagementObservation(observation);
  invariant(Array.isArray(capture?.exactBodies) && capture.exactBodies.length === 2, `${label} state body count drifted`);
  const names = capture.exactBodies.map((body) => body.name).sort();
  invariant(names.join(',') === 'attention,projection', `${label} state body names drifted`);
  const normalized = {};
  for (const body of capture.exactBodies) {
    const request = observation.requests.find((candidate) => candidate.seq === body.seq);
    invariant(request !== undefined, `${label} ${body.name} body is absent from request inventory`);
    invariant(request.resetGeneration === body.resetGeneration, `${label} ${body.name} reset generation drifted`);
    invariant(request.method === body.method, `${label} ${body.name} method drifted`);
    invariant(request.path === body.path, `${label} ${body.name} path drifted`);
    invariant(request.status === body.status, `${label} ${body.name} status drifted`);
    invariant(request.completed === body.completed, `${label} ${body.name} completion drifted`);
    invariant(request.failed === body.failed, `${label} ${body.name} failure flag drifted`);
    normalized[body.name] = validateStateBody(body, expectedSelector, expectedIssueId);
  }
  const expectedFreshness = {
    projection: capture.exactBodies.find((body) => body.name === 'projection').observedAfterReset,
    attention: capture.exactBodies.find((body) => body.name === 'attention').observedAfterReset,
  };
  invariant(
    JSON.stringify(capture.freshness) === JSON.stringify(expectedFreshness),
    `${label} freshness flags drifted`
  );
  invariant(Object.values(capture.freshness).every(Boolean), `${label} contains a stale state response`);
  const ordered = { projection: normalized.projection, attention: normalized.attention };
  verifyDigestRecord(capture.digest, ordered, `${label} state responses`);
  const expectedCorrespondence = {
    rawBodiesDecodeToDigestPreimage:
      capture.digest.preimage === canonicalPreimage(ordered),
    digestMatchesCanonicalBodies:
      capture.digest.sha256 === sha256(canonicalPreimage(ordered)),
  };
  invariant(
    JSON.stringify(capture.correspondence) === JSON.stringify(expectedCorrespondence),
    `${label} response correspondence flags drifted`
  );
  invariant(Object.values(capture.correspondence).every(Boolean), `${label} response correspondence failed`);
  return ordered;
}

function flattenObservations(observations) {
  return Object.values(observations).flatMap((observation) => observation.requests);
}

export function deriveReadOnlySummary(observations) {
  const entries = Object.values(observations);
  for (const observation of entries) assertManagementObservation(observation);
  const requests = flattenObservations(observations);
  const mutationOperationsIssued = requests
    .filter((request) => request.method !== 'GET')
    .map(({ seq, resetGeneration, method, path, status, completed, failed }) => ({
      seq,
      resetGeneration,
      method,
      path,
      status,
      completed,
      failed,
    }));
  return {
    observationCount: entries.length,
    requestCount: requests.length,
    allObservedAfterReset: entries.every(
      (observation) => observation.verdict.allObservedAfterReset
    ),
    allCompleted: requests.every((request) => request.completed),
    noFailedEvents: requests.every((request) => !request.failed),
    successfulStatuses: requests.every(
      (request) => request.status === null || (request.status >= 200 && request.status < 400)
    ),
    managementOriginGetOnly: requests.every((request) => request.method === 'GET'),
    noInvalidationCall: requests.every(
      (request) => !request.path.toLowerCase().includes('invalidat')
    ),
    mutationOperationsIssued,
  };
}

export function verifyReadOnlySummary(summary, observations) {
  const expected = deriveReadOnlySummary(observations);
  invariant(JSON.stringify(summary) === JSON.stringify(expected), 'read-only summary drifted from observations');
  invariant(summary.observationCount === Object.keys(observations).length, 'observation count drifted');
  invariant(summary.requestCount === flattenObservations(observations).length, 'request count drifted');
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'boolean') invariant(value, `read-only assertion failed: ${key}`);
  }
  invariant(summary.mutationOperationsIssued.length === 0, 'mutation inventory is not empty');
}

export function deriveStorageClearVerification(storage) {
  const supported = REQUIRED_STORAGE_SUPPORT.every((key) => storage?.support?.[key] === true);
  const noErrors = Array.isArray(storage?.errors) && storage.errors.length === 0;
  const emptyAfterClear = REQUIRED_STORAGE_COUNTS.every(
    (key) => storage?.remaining?.[key] === 0
  );
  return {
    everyRequiredStorageApiSupported: supported,
    everyClearCompletedWithoutError: noErrors,
    everyStoreEmptyAfterClear: emptyAfterClear,
    ok: supported && noErrors && emptyAfterClear,
  };
}

export function verifyStorageClear(storage, label) {
  const expected = deriveStorageClearVerification(storage);
  invariant(
    JSON.stringify(storage?.verification) === JSON.stringify(expected),
    `${label} storage verification drifted`
  );
  invariant(Object.values(expected).every(Boolean), `${label} storage clear was incomplete`);
}

export function withStorageVerification(storage) {
  return { ...storage, verification: deriveStorageClearVerification(storage) };
}

export function verifyCleanup(cleanup, requiredFields, label) {
  for (const field of requiredFields) {
    invariant(cleanup?.[field] === true, `${label} cleanup failed: ${field}`);
  }
}

export const clearStorageExpression = String.raw`(async () => JSON.stringify(await (async () => {
  const errors = [];
  const support = {
    localStorage: typeof localStorage !== 'undefined',
    sessionStorage: typeof sessionStorage !== 'undefined',
    cacheStorage: typeof caches !== 'undefined',
    indexedDbDatabases: typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function',
    serviceWorkers: 'serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function',
  };
  try { if (support.localStorage) localStorage.clear(); } catch (error) { errors.push('localStorage: ' + String(error)); }
  try { if (support.sessionStorage) sessionStorage.clear(); } catch (error) { errors.push('sessionStorage: ' + String(error)); }
  try {
    if (support.cacheStorage) {
      for (const name of await caches.keys()) {
        if (!(await caches.delete(name))) errors.push('Cache Storage: failed to delete ' + name);
      }
    }
  } catch (error) { errors.push('Cache Storage: ' + String(error)); }
  try {
    if (support.indexedDbDatabases) {
      for (const database of await indexedDB.databases()) {
        if (database.name) await new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(database.name);
          request.onsuccess = () => resolve();
          request.onerror = () => { errors.push('IndexedDB: ' + String(request.error)); resolve(); };
          request.onblocked = () => { errors.push('IndexedDB: deletion blocked for ' + database.name); resolve(); };
        });
      }
    }
  } catch (error) { errors.push('IndexedDB: ' + String(error)); }
  try {
    if (support.serviceWorkers) {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        if (!(await registration.unregister())) errors.push('service workers: unregister returned false');
      }
    }
  } catch (error) { errors.push('service workers: ' + String(error)); }
  return {
    support,
    errors,
    remaining: {
      localStorageCount: support.localStorage ? localStorage.length : null,
      sessionStorageCount: support.sessionStorage ? sessionStorage.length : null,
      cacheCount: support.cacheStorage ? (await caches.keys()).length : null,
      indexedDbCount: support.indexedDbDatabases ? (await indexedDB.databases()).length : null,
      serviceWorkerCount: support.serviceWorkers ? (await navigator.serviceWorker.getRegistrations()).length : null,
    },
  };
})()))()`;
