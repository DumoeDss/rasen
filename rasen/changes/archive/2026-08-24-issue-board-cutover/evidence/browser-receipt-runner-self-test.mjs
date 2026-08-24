import {
  captureExactStateResponses,
  deriveManagementObservation,
  deriveReadOnlySummary,
  digestRecord,
  invariant,
  verifyCleanup,
  verifyReadOnlySummary,
  verifyStateResponseCapture,
  verifyStorageClear,
  withStorageVerification,
} from './browser-receipt-guards.mjs';

const origin = 'http://127.0.0.1:43123';
const selector = 'store:test-store';
const issueId = 'issue-proof';
const reset = {
  generation: 1,
  cleared: true,
  bufferEmptyAfterReset: true,
  totalAfterReset: 0,
  lastSeqAfterReset: 0,
};

function event(seq, pathname, overrides = {}) {
  return {
    seq,
    method: 'GET',
    url: `${origin}${pathname}`,
    status: 200,
    completed: true,
    failed: false,
    response_body: '{}',
    ...overrides,
  };
}

function validEvents() {
  return [
    event(
      1,
      `/api/v1/stores/issue-projection?space=${encodeURIComponent(selector)}&issueId=${issueId}`,
      { response_body: JSON.stringify({ issue: { issueId } }) }
    ),
    event(
      2,
      `/api/v1/stores/issue-attention?issueId=${issueId}&space=${encodeURIComponent(selector)}`,
      {
        response_body: JSON.stringify({
          narrowed: true,
          issueId,
          scanned: [{ issueId }],
          items: [],
        }),
      }
    ),
  ];
}

function snapshot(events = validEvents(), resetGeneration = reset.generation) {
  return {
    resetGeneration,
    total: events.length,
    returned: events.length,
    lastSeq: events.at(-1)?.seq ?? 0,
    events,
  };
}

function validStorage() {
  return withStorageVerification({
    support: {
      localStorage: true,
      sessionStorage: true,
      cacheStorage: true,
      indexedDbDatabases: true,
      serviceWorkers: true,
    },
    errors: [],
    remaining: {
      localStorageCount: 0,
      sessionStorageCount: 0,
      cacheCount: 0,
      indexedDbCount: 0,
      serviceWorkerCount: 0,
    },
  });
}

function expectFailure(name, work) {
  let failed = false;
  try {
    work();
  } catch {
    failed = true;
  }
  invariant(failed, `negative self-test did not fail closed: ${name}`);
  return name;
}

function validCapture() {
  const raw = snapshot();
  const observation = deriveManagementObservation(raw, origin, reset);
  const built = captureExactStateResponses(raw, observation, origin, selector, issueId);
  const capture = {
    exactBodies: built.exactBodies,
    digest: built.digest,
    freshness: built.freshness,
    correspondence: built.correspondence,
  };
  verifyStateResponseCapture(capture, observation, selector, issueId, 'self-test');
  return { raw, observation, capture };
}

const passed = [];

passed.push(
  expectFailure('pending POST', () => {
    const events = [...validEvents(), event(3, '/api/v1/issues', { method: 'POST', completed: false, status: undefined })];
    deriveManagementObservation(snapshot(events), origin, reset);
  })
);
passed.push(
  expectFailure('completed POST', () => {
    const events = [...validEvents(), event(3, '/api/v1/issues', { method: 'POST' })];
    deriveManagementObservation(snapshot(events), origin, reset);
  })
);
passed.push(
  expectFailure('failed status', () => {
    const events = validEvents();
    events[0] = { ...events[0], status: 500 };
    deriveManagementObservation(snapshot(events), origin, reset);
  })
);
passed.push(
  expectFailure('wrong Store query', () => {
    const events = validEvents();
    events[0] = event(
      1,
      `/api/v1/stores/issue-projection?space=store%3Awrong&issueId=${issueId}`,
      { response_body: JSON.stringify({ issue: { issueId } }) }
    );
    const raw = snapshot(events);
    const observation = deriveManagementObservation(raw, origin, reset);
    captureExactStateResponses(raw, observation, origin, selector, issueId);
  })
);
passed.push(
  expectFailure('wrong Issue query', () => {
    const events = validEvents();
    events[1] = event(
      2,
      `/api/v1/stores/issue-attention?space=${encodeURIComponent(selector)}&issueId=wrong`,
      { response_body: JSON.stringify({ narrowed: true, issueId: 'wrong', scanned: [] }) }
    );
    const raw = snapshot(events);
    const observation = deriveManagementObservation(raw, origin, reset);
    captureExactStateResponses(raw, observation, origin, selector, issueId);
  })
);
passed.push(
  expectFailure('stale pre-reset response', () => {
    deriveManagementObservation(snapshot(validEvents(), 0), origin, reset);
  })
);
passed.push(
  expectFailure('payload identity mismatch', () => {
    const events = validEvents();
    events[0] = { ...events[0], response_body: JSON.stringify({ issue: { issueId: 'wrong' } }) };
    const raw = snapshot(events);
    const observation = deriveManagementObservation(raw, origin, reset);
    captureExactStateResponses(raw, observation, origin, selector, issueId);
  })
);
passed.push(
  expectFailure('unsupported storage clear', () => {
    const storage = validStorage();
    storage.support.indexedDbDatabases = false;
    storage.verification = withStorageVerification(storage).verification;
    verifyStorageClear(storage, 'unsupported');
  })
);
passed.push(
  expectFailure('failed storage clear', () => {
    const storage = validStorage();
    storage.errors.push('Cache Storage: denied');
    storage.verification = withStorageVerification(storage).verification;
    verifyStorageClear(storage, 'failed');
  })
);
passed.push(
  expectFailure('invalidation call', () => {
    const events = [...validEvents(), event(3, '/api/v1/stores/invalidate-cache')];
    deriveManagementObservation(snapshot(events), origin, reset);
  })
);
passed.push(
  expectFailure('tampered raw body', () => {
    const { observation, capture } = validCapture();
    capture.exactBodies[0].rawBody = JSON.stringify({ issue: { issueId: 'wrong' } });
    verifyStateResponseCapture(capture, observation, selector, issueId, 'tampered raw body');
  })
);
passed.push(
  expectFailure('tampered canonical preimage', () => {
    const { observation, capture } = validCapture();
    capture.digest.preimage = digestRecord({ tampered: true }).preimage;
    verifyStateResponseCapture(capture, observation, selector, issueId, 'tampered preimage');
  })
);
passed.push(
  expectFailure('tampered digest', () => {
    const { observation, capture } = validCapture();
    capture.digest.sha256 = '0'.repeat(64);
    verifyStateResponseCapture(capture, observation, selector, issueId, 'tampered digest');
  })
);
passed.push(
  expectFailure('cleanup failure', () => {
    verifyCleanup(
      { browserTargetClosed: false, serverProcessExited: true },
      ['browserTargetClosed', 'serverProcessExited'],
      'self-test'
    );
  })
);

{
  const { observation } = validCapture();
  const observations = { detail: observation };
  const summary = deriveReadOnlySummary(observations);
  verifyReadOnlySummary(summary, observations);
  verifyStorageClear(validStorage(), 'valid');
  verifyCleanup(
    { browserTargetClosed: true, serverProcessExited: true },
    ['browserTargetClosed', 'serverProcessExited'],
    'valid'
  );
}

process.stdout.write(`${JSON.stringify({ ok: true, negativeCases: passed })}\n`);
