import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { ephemeraDir } from '../../../../src/core/file-placement.js';
import { startManagementServer } from '../../../../src/core/management-api/server.js';
import { writeRunState, type RunState } from '../../../../src/core/pipeline-registry/run-state.js';
import { serializeArchiveV2 } from '../../../../src/core/store/finalization-v2.js';
import {
  deriveWorkspacePairId,
  deriveWorktreeInstanceId,
} from '../../../../src/core/store/planning-identity.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../../src/core/store/issues/index.js';
import { createStoreWorkspaceFixture } from '../../../../test/helpers/store-workspace-fixture.js';

const PROJECT = 'browser-app';
const LINE = 'main';
const ISSUE = 'browser-proof';
const ACTIVE_CHANGE = 'active-change';
const DELIVERED_CHANGE = 'delivered-change';
const NOW = '2026-08-24T02:00:00.000Z';

const metadataPath = process.argv[2];
if (!metadataPath) throw new Error('metadata output path argument is required');

const fixture = await createStoreWorkspaceFixture({
  prefix: 'rasen-g003-browser-',
  projects: [PROJECT],
  lines: [{ id: LINE, storeRef: 'refs/heads/main', codeRefs: { [PROJECT]: 'refs/heads/main' } }],
});

const originalEnv = { ...process.env };
delete process.env.RASEN_HOME;
for (const [key, value] of Object.entries(fixture.env)) {
  if (value !== undefined) process.env[key] = value;
}

function commitStore(message: string): string {
  fixture.git(fixture.storeRoot, ['add', '-A']);
  fixture.git(fixture.storeRoot, ['commit', '-m', message]);
  return fixture.git(fixture.storeRoot, ['rev-parse', 'HEAD']).trim();
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(value)}\n`);
}

const issues = new StoreIssuesModule({
  dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
});
const scope = {
  store: fixture.storeId,
  startPath: fixture.storeRoot,
  globalDataDir: fixture.globalDataDir,
};

fixture.write(path.join(fixture.storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
commitStore('add fixture planning root');

const delivered = fixture.seedChange({
  root: fixture.storeRoot,
  projectId: PROJECT,
  targetLineId: LINE,
  changeId: DELIVERED_CHANGE,
  instanceSeed: 'd1'.repeat(16),
});
const deliveredEvidence = '{"browser":"delivery-proof","status":"landed"}\n';
fixture.write(path.join(delivered.directory, 'evidence', 'browser-proof.json'), deliveredEvidence);
commitStore('seed delivered change evidence');

const planningWorktreeInstanceId = deriveWorktreeInstanceId({
  repositoryIdentity: 'fixture-store-repository',
  worktreeIdentity: 'fixture-planning-worktree',
});
const executionWorktreeInstanceId = deriveWorktreeInstanceId({
  repositoryIdentity: 'fixture-code-repository',
  worktreeIdentity: 'fixture-execution-worktree',
});
const workspacePairId = deriveWorkspacePairId({
  changeInstanceId: delivered.instanceId,
  planningWorktreeInstanceId,
  executionWorktreeInstanceId,
});
const archiveEntry = `2026-08-24-${DELIVERED_CHANGE}--${delivered.instanceId.slice(3, 15)}`;
const archiveDirectory = fixture.at(
  'rasen',
  'projects',
  PROJECT,
  'changes',
  'archive',
  LINE,
  archiveEntry,
);
fs.mkdirSync(path.dirname(archiveDirectory), { recursive: true });
fs.renameSync(delivered.directory, archiveDirectory);
const codeCommit = fixture.refOid(fixture.projectRoot(PROJECT), 'refs/heads/main');
fixture.write(
  path.join(archiveDirectory, 'archive.json'),
  serializeArchiveV2({
    schemaVersion: 2,
    implementation: 'code',
    storeUid: fixture.storeUid,
    projectId: PROJECT,
    targetLineId: LINE,
    changeId: DELIVERED_CHANGE,
    changeInstanceId: delivered.instanceId,
    workspacePairId,
    outcome: 'landed',
    reason: null,
    supersededBy: null,
    planning: {
      worktreeInstanceId: planningWorktreeInstanceId,
      sourceRef: `refs/heads/change/${DELIVERED_CHANGE}`,
      sourceHead: fixture.refOid(fixture.storeRoot, 'refs/heads/main'),
      targetRef: 'refs/heads/main',
    },
    codeMerge: {
      repoUid: 'fixture-code-repository',
      worktreeInstanceId: executionWorktreeInstanceId,
      targetRef: 'refs/heads/main',
      commit: codeCommit,
      reachable: true,
    },
    specSync: { applied: true, actions: [] },
    evidence: [{ path: 'evidence/browser-proof.json', sha256: sha256(deliveredEvidence) }],
    missing: [],
    archivedAt: NOW,
  }),
);
commitStore('archive delivered change with structured evidence');

const active = fixture.seedChange({
  root: fixture.storeRoot,
  projectId: PROJECT,
  targetLineId: LINE,
  changeId: ACTIVE_CHANGE,
  instanceSeed: 'a2'.repeat(16),
});
const activeEvidence = '{"browser":"runtime-proof","status":"active"}\n';
fixture.write(path.join(active.directory, 'evidence', 'runtime-proof.json'), activeEvidence);
commitStore('seed active change evidence');

await issues.create({ ...scope, issueId: ISSUE, title: 'Browser provenance proof' });
await issues.publishPlan({
  ...scope,
  issueId: ISSUE,
  nodes: [
    {
      nodeId: 'g-delivery',
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: delivered.instanceId,
      changeAlias: DELIVERED_CHANGE,
      dependsOn: [],
    },
    {
      nodeId: 'g-runtime',
      kind: 'change',
      projectId: PROJECT,
      targetLineId: LINE,
      changeInstanceId: active.instanceId,
      changeAlias: ACTIVE_CHANGE,
      dependsOn: ['g-delivery'],
    },
  ],
});
const acceptance = await issues.publishAcceptance({
  ...scope,
  issueId: ISSUE,
  conditions: [
    {
      id: 'browser-evidence',
      requirement: 'Every displayed state links to exact Git or runtime evidence.',
      verification: 'Inspect the production-built provenance map.',
    },
  ],
});
const initialHead = commitStore('publish browser proof Issue, plan, and acceptance conditions');

const runtimeDirectory = ephemeraDir(fixture.projectRoot(PROJECT), ACTIVE_CHANGE);
const transcriptPath = path.join(runtimeDirectory, 'agent-browser-fixture.jsonl');
fixture.write(transcriptPath, '{"type":"fixture-transcript","stage":"apply"}\n');
const runtimeState: RunState = {
  pipeline: 'small-feature',
  stages: {
    propose: {
      status: 'done',
      worker: {
        runtime: 'claude',
        role: 'planner',
        sessionId: 'fixture-session-001',
        transcript: transcriptPath,
      },
    },
    apply: {
      status: 'escalated',
      worker: {
        runtime: 'codex',
        role: 'implementer',
        threadId: 'fixture-thread-001',
        transcript: transcriptPath,
      },
    },
    verify: { status: 'pending', worker: 'reviewer' },
  },
};
writeRunState(runtimeDirectory, runtimeState);

const uiToken = randomBytes(32).toString('hex');
const controlToken = randomBytes(32).toString('hex');
const uiAssetsDir = path.resolve(process.cwd(), 'packages', 'ui', 'dist');
if (!fs.existsSync(path.join(uiAssetsDir, 'index.html'))) {
  throw new Error(`production UI assets are missing at ${uiAssetsDir}`);
}

const management = await startManagementServer({
  context: {
    token: uiToken,
    launchProjectRoot: fixture.projectRoot(PROJECT),
    launchProjectRef: {
      projectId: PROJECT,
      name: PROJECT,
      root: fixture.projectRoot(PROJECT),
    },
    version: 'issue-board-cutover-browser-fixture',
    uiAssetsDir,
  },
  hostStateRoot: fixture.globalDataDir,
});

let mutated = false;
let shuttingDown = false;
let control: http.Server | null = null;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  if (control !== null) {
    const server = control;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await management.stopServer();
  fixture.cleanup();
  process.env = originalEnv;
  try {
    fs.unlinkSync(metadataPath);
  } catch {
    // The caller may already have removed the ephemeral metadata file.
  }
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0));
});

control = http.createServer((request, response) => {
  void (async () => {
    if (request.headers.authorization !== `Bearer ${controlToken}`) {
      writeJson(response, 401, { ok: false });
      return;
    }
    if (request.method === 'POST' && request.url === '/mutate') {
      if (!mutated) {
        const next = await issues.publishAcceptance({
          ...scope,
          issueId: ISSUE,
          conditions: [
            {
              id: 'browser-evidence',
              requirement: 'Every displayed state links to freshly committed evidence.',
              verification: 'The second production rebuild reads acceptance revision 0002.',
            },
          ],
        });
        const head = commitStore('mutate committed acceptance evidence for freshness proof');
        mutated = true;
        writeJson(response, 200, {
          ok: true,
          head,
          revisionId: next.revision.revisionId,
          contentSha256: next.revision.contentSha256,
        });
        return;
      }
      writeJson(response, 200, { ok: true, alreadyMutated: true });
      return;
    }
    if (request.method === 'POST' && request.url === '/shutdown') {
      writeJson(response, 200, { ok: true });
      setImmediate(() => {
        void shutdown().finally(() => process.exit(0));
      });
      return;
    }
    writeJson(response, 404, { ok: false });
  })().catch((error) => {
    writeJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  });
});

await new Promise<void>((resolve, reject) => {
  control.once('error', reject);
  control.listen(0, '127.0.0.1', () => resolve());
});
const controlAddress = control.address();
if (!controlAddress || typeof controlAddress === 'string') throw new Error('control port did not bind');

fixture.write(
  metadataPath,
  `${JSON.stringify({
    processId: process.pid,
    managementPort: management.port,
    controlPort: controlAddress.port,
    uiToken,
    controlToken,
    storeId: fixture.storeId,
    storeUid: fixture.storeUid,
    issueId: ISSUE,
    projectId: PROJECT,
    fixtureRoot: fixture.tempDir,
    storeRoot: fixture.storeRoot,
    projectRoot: fixture.projectRoot(PROJECT),
    initialHead,
    acceptanceRevisionId: acceptance.revision.revisionId,
    acceptanceContentSha256: acceptance.revision.contentSha256,
    codeCommit,
    deliveredEvidenceSha256: sha256(deliveredEvidence),
    runtimeEvidenceSha256: sha256(activeEvidence),
    transcriptPath,
  }, null, 2)}\n`,
);

await new Promise<void>(() => {});
