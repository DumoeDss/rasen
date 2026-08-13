import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  startManagementServer,
  type ManagementServerHandle,
} from '../../../src/core/management-api/server.js';
import type { ManagementApiContext } from '../../../src/core/management-api/router.js';
import {
  CANVAS_V2_AUTHORING_DEFINITION,
  CANVAS_V2_AUTHORING_NAME,
} from '../../../packages/ui/test/fixtures/canvas-v2-authoring.js';
import { runPipelineCLIWithAdmission as runCLI } from '../../helpers/pipeline-cli-admission.js';
import { computeCompletionReceiptDigest } from '../../../src/core/change-run/internal/completion.js';
import { buildEvidenceRef } from '../../../src/core/change-run/internal/evidence.js';
import { observeGitWorkspace } from '../../../src/core/change-run/internal/workspace-git.js';
import { deriveWorkspaceRevision } from '../../../src/core/change-run/internal/workspace.js';
import type {
  CompleteRunAction,
  Digest,
  EffectId,
  EvidenceRef,
} from '../../../src/core/change-run/contracts.js';
import { createFilesystemRunStore } from '../../../src/core/change-run/internal/run-store-fs.js';
import { freezeProductionPreparedPipelineRegistry } from '../../../src/core/pipeline-registry/prepared-registry.js';
import { resolveCapabilityBindings } from '../../../src/core/pipeline-registry/profile-resolver.js';
import { provisionTrustedExecutionAdapterCatalog } from '../../../src/core/pipeline-registry/trusted-execution-adapters.js';
import { getGlobalDataDir } from '../../../src/core/global-config.js';
import {
  TEST_ATTESTATION_AUTHORITY,
  attestTestCompletion,
  trustedDescriptor,
} from '../../fixtures/trusted-completion.js';

const TOKEN = 'ecp6-vertical-proof-token';
const CHANGE_ID = 'ecp6-vertical-proof';
const FAILURE_CHANGE_ID = 'ecp6-vertical-proof-required-member-failure';
let trustedRunStoreRoot: string | undefined;

interface HttpResult {
  readonly status: number;
  readonly body: string;
  json(): unknown;
}

function request(
  port: number,
  options: Readonly<{
    method: string;
    path: string;
    body?: string;
  }>
): Promise<HttpResult> {
  return new Promise((resolveRequest, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method,
        path: options.path,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(options.body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolveRequest({
            status: res.statusCode ?? 0,
            body,
            json: () => JSON.parse(body),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    windowsHide: true,
  });
}

function rootSection(view: any): any {
  const section = view.sections.find(
    (candidate: { kind?: string }) => candidate.kind === 'root-dag'
  );
  if (section === undefined) throw new Error('root-dag section missing');
  return section;
}

function section(view: any, kind: string): any | undefined {
  return view.sections.find(
    (candidate: { kind?: string }) => candidate.kind === kind
  );
}

function upload(ref: EvidenceRef, content: Uint8Array) {
  return {
    contentDigest: ref.contentDigest,
    contentBase64: Buffer.from(content).toString('base64'),
  };
}

function completionSubmission(
  view: any,
  action: any,
  projectRoot: string,
  input:
    | Readonly<{
        kind: 'domain-action-result';
        status?: 'succeeded' | 'failed';
        result: unknown;
      }>
    | Readonly<{
        kind: 'effect-observation';
        effectId: EffectId;
        observation: unknown;
      }>
): Readonly<{
  completion: CompleteRunAction;
  uploads: readonly Readonly<{
    contentDigest: string;
    contentBase64: string;
  }>[];
}> {
  const evidenceContent = new TextEncoder().encode(
    JSON.stringify({
      kind: input.kind,
      actionId: action.actionId,
      ...(input.kind === 'effect-observation'
        ? { effectId: input.effectId, observation: input.observation }
        : { result: input.result }),
    })
  );
  if (trustedRunStoreRoot === undefined) {
    throw new Error('Trusted vertical-proof RunStore was not initialized.');
  }
  const record = createFilesystemRunStore(trustedRunStoreRoot).load(view.runId);
  const frozenAction = record.actions[action.actionId]?.action;
  if (frozenAction === undefined) {
    throw new Error(`Trusted vertical-proof Action ${action.actionId} is absent.`);
  }
  return attestTestCompletion({
    change: { projectRoot, changeId: view.change.changeId },
    record,
    action: frozenAction,
    completion: input.kind === 'effect-observation'
      ? {
          kind: input.kind,
          effectId: input.effectId,
          status: 'succeeded',
          observation: input.observation,
        }
      : {
          kind: input.kind,
          status: input.status ?? 'succeeded',
          result: input.result,
        },
    evidenceContent,
  });
}

interface TransitionLedgerEntry {
  readonly process: number;
  readonly command: string;
  readonly exitCode: number | null;
  readonly recordVersion?: number;
  readonly status?: string;
  readonly runId?: string;
  readonly actionIds?: readonly string[];
  readonly effects?: readonly Readonly<{
    effectId: string;
    state: string;
  }>[];
  readonly waits?: readonly Readonly<{ waitId: string; kind: string }>[];
  readonly loop?: Readonly<{
    state: string;
    iteration: number;
    phase: string;
  }>;
  readonly parallel?: Readonly<{
    joinState: string;
    members: readonly Readonly<{ path: string; status: string }>[];
  }>;
}

describe('Canvas-authored v2 loop vertical proof', () => {
  let sandboxRoot: string;
  let projectRoot: string;
  let configHome: string;
  let dataHome: string;
  let originalEnv: NodeJS.ProcessEnv;
  let management: ManagementServerHandle | undefined;
  let activeCliCommands: Set<Promise<unknown>>;

  beforeEach(() => {
    sandboxRoot = mkdtempSync(join(tmpdir(), 'rasen-ecp6-v2-vertical-'));
    projectRoot = resolve(sandboxRoot, 'project');
    configHome = resolve(sandboxRoot, 'config');
    dataHome = resolve(sandboxRoot, 'data');
    mkdirSync(join(projectRoot, 'rasen', 'specs'), { recursive: true });
    mkdirSync(join(projectRoot, 'rasen', 'changes', CHANGE_ID), {
      recursive: true,
    });
    mkdirSync(join(projectRoot, 'rasen', 'changes', FAILURE_CHANGE_ID), {
      recursive: true,
    });
    mkdirSync(configHome, { recursive: true });
    mkdirSync(dataHome, { recursive: true });
    writeFileSync(
      join(projectRoot, 'rasen', 'config.yaml'),
      'schema: spec-driven\nruns:\n  engine: reconciler\n'
    );
    writeFileSync(
      join(projectRoot, 'rasen', 'changes', CHANGE_ID, 'proposal.md'),
      '# ECP-6 vertical proof\n'
    );
    writeFileSync(
      join(projectRoot, 'rasen', 'changes', FAILURE_CHANGE_ID, 'proposal.md'),
      '# ECP-6 required-member failure proof\n'
    );
    writeFileSync(join(projectRoot, 'workspace.txt'), 'baseline\n');
    runGit(projectRoot, ['init']);
    runGit(projectRoot, ['config', 'user.email', 'ecp6@example.invalid']);
    runGit(projectRoot, ['config', 'user.name', 'ECP-6 Test']);
    runGit(projectRoot, ['add', '.']);
    runGit(projectRoot, ['commit', '-m', 'baseline']);

    originalEnv = { ...process.env };
    process.env.RASEN_HOME = '';
    process.env.XDG_CONFIG_HOME = configHome;
    process.env.XDG_DATA_HOME = dataHome;
    process.env.RASEN_AGENT_RUNTIME = 'codex';
    process.env.RASEN_LANG = 'en';
    trustedRunStoreRoot = resolve(dataHome, 'rasen', 'runs');
    activeCliCommands = new Set();
  });

  afterEach(async () => {
    // If Vitest aborts the outer journey, wait for every already-started,
    // individually bounded CLI child before removing its sandbox. This keeps
    // Windows from racing an open process handle and turning the primary
    // timeout into a derivative EPERM teardown failure.
    await Promise.allSettled([...activeCliCommands]);
    await management?.stopServer();
    management = undefined;
    process.env = originalEnv;
    trustedRunStoreRoot = undefined;
    rmSync(sandboxRoot, { recursive: true, force: true });
  });

  function managementContext(): ManagementApiContext {
    return {
      token: TOKEN,
      launchProjectRoot: projectRoot,
      launchProjectRef: {
        projectId: 'ecp6-vertical-project',
        name: 'ecp6-vertical-project',
        root: projectRoot,
      },
      version: '0.2.0-test',
      uiAssetsDir: null,
      hostRuntime: { runtime: 'codex', source: 'env' },
    };
  }

  async function saveThroughManagement(): Promise<any> {
    management = await startManagementServer({ context: managementContext() });
    const validation = await request(management.port, {
      method: 'POST',
      path: '/api/v1/pipeline-validation',
      body: JSON.stringify({ definition: CANVAS_V2_AUTHORING_DEFINITION }),
    });
    expect(validation.status, validation.body).toBe(200);
    expect((validation.json() as any).valid).toBe(true);

    const save = await request(management.port, {
      method: 'POST',
      path: '/api/v1/pipelines',
      body: JSON.stringify({
        op: 'save',
        name: CANVAS_V2_AUTHORING_NAME,
        definition: CANVAS_V2_AUTHORING_DEFINITION,
      }),
    });
    expect(save.status, save.body).toBe(201);

    // Install the public half before any launch freezes its Action authority.
    // The test-only private half stays in this parent process; every CLI child
    // receives only the persisted public descriptor and verifies independently.
    const registry = await freezeProductionPreparedPipelineRegistry(projectRoot);
    const prepared = registry.load(CANVAS_V2_AUTHORING_NAME).prepared;
    const provisional = resolveCapabilityBindings(prepared, registry.catalog);
    const descriptors = new Map(
      provisional.map((binding) => {
        const adapter = {
          id: binding.adapter.id,
          version: binding.adapter.version,
          contentDigest: binding.adapter.contentDigest as Digest,
        };
        return [
          `${adapter.id}\0${adapter.version}\0${adapter.contentDigest}`,
          trustedDescriptor(adapter, TEST_ATTESTATION_AUTHORITY),
        ] as const;
      })
    );
    provisionTrustedExecutionAdapterCatalog(
      getGlobalDataDir(),
      [...descriptors.values()]
    );

    const detail = await request(management.port, {
      method: 'GET',
      path: `/api/v1/pipelines/${CANVAS_V2_AUTHORING_NAME}`,
    });
    expect(detail.status, detail.body).toBe(200);
    const value = detail.json() as any;
    expect(value.definition).toMatchObject({
      version: CANVAS_V2_AUTHORING_DEFINITION.version,
      id: CANVAS_V2_AUTHORING_DEFINITION.id,
      sourceId: CANVAS_V2_AUTHORING_DEFINITION.sourceId,
      name: CANVAS_V2_AUTHORING_DEFINITION.name,
      limits: CANVAS_V2_AUTHORING_DEFINITION.limits,
    });
    expect(
      value.definition.root.nodes
        .map((node: { id: string }) => node.id)
        .sort()
    ).toEqual(
      CANVAS_V2_AUTHORING_DEFINITION.root.nodes
        .map((node) => node.id)
        .sort()
    );
    expect(
      value.definition.root.connections
        .map((connection: { id: string }) => connection.id)
        .sort()
    ).toEqual(
      CANVAS_V2_AUTHORING_DEFINITION.root.connections
        .map((connection) => connection.id)
        .sort()
    );
    await management.stopServer();
    management = undefined;
    return value;
  }

  async function getThroughManagement(path: string): Promise<any> {
    management = await startManagementServer({ context: managementContext() });
    const response = await request(management.port, { method: 'GET', path });
    expect(response.status, response.body).toBe(200);
    const value = response.json();
    await management.stopServer();
    management = undefined;
    return value;
  }

  const cliEnv = () => ({
    RASEN_HOME: '',
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    RASEN_AGENT_RUNTIME: 'codex',
    RASEN_LANG: 'en',
  });

  it('drives the Management-saved loop-plus-parallel definition to success and recovers after process loss', async () => {
    const detail = await saveThroughManagement();
    expect(detail.preparation.digests).toMatchObject({
      source: expect.any(String),
      capability: expect.any(String),
      plan: expect.any(String),
    });
    const ledger: TransitionLedgerEntry[] = [];
    const identities = new Map<string, any>();
    const actionOrder: string[] = [];
    const receiptDigests: string[] = [];
    const evidenceDigests: string[] = [];
    const managementViews: Record<string, any> = {};
    let processOrdinal = 0;
    let payloadOrdinal = 0;

    const failDriver = (reason: string, lastView: unknown): never => {
      throw new Error(
        `ECP-6 bounded driver failed: ${reason}\nlast canonical view:\n${JSON.stringify(lastView, null, 2)}`
      );
    };

    const publicCommand = async (
      label: string,
      args: readonly string[],
      expectedExitCode = 0
    ): Promise<any> => {
      processOrdinal += 1;
      const command = runCLI([...args], {
        cwd: projectRoot,
        env: cliEnv(),
        timeoutMs: 90_000,
      });
      activeCliCommands.add(command);
      let result;
      try {
        result = await command;
      } finally {
        activeCliCommands.delete(command);
      }
      ledger.push({
        process: processOrdinal,
        command: label,
        exitCode: result.exitCode,
      });
      expect(result.exitCode, result.stderr).toBe(expectedExitCode);
      if (expectedExitCode !== 0) {
        expect(result.stderr.trim().length).toBeGreaterThan(0);
      }
      return result.stdout.trim().length === 0
        ? undefined
        : JSON.parse(result.stdout.trim());
    };

    const appendViewToLedger = (label: string, response: any): any => {
      const view = response.view;
      const root = rootSection(view);
      const loop = section(view, 'bounded-loop-lifecycle');
      const parallel = section(view, 'parallel');
      ledger[ledger.length - 1] = {
        process: processOrdinal,
        command: label,
        exitCode: 0,
        recordVersion: view.recordVersion,
        status: view.status,
        runId: view.runId,
        actionIds: root.actions.map((action: any) => action.actionId),
        effects: root.actions.flatMap((action: any) =>
          action.effects.map((effect: any) => ({
            effectId: effect.effectId,
            state: effect.state,
          }))
        ),
        waits: root.waits.map((wait: any) => ({
          waitId: wait.waitId,
          kind: wait.kind,
        })),
        ...(loop === undefined
          ? {}
          : {
              loop: {
                state: loop.state,
                iteration: loop.iteration,
                phase: loop.phase,
              },
            }),
        ...(parallel === undefined
          ? {}
          : {
              parallel: {
                joinState: parallel.joinState,
                members: parallel.members.map((member: any) => ({
                  path: member.path,
                  status: member.status,
                })),
              },
            }),
      };
      for (const action of root.actions) {
        const identity = {
          actionId: action.actionId,
          invocationId: action.invocationId,
          attemptId: action.attemptId,
          nodeId: action.nodeId,
          effectIds: action.effects.map((effect: any) => effect.effectId),
        };
        const existing = identities.get(action.actionId);
        if (existing === undefined) {
          identities.set(action.actionId, identity);
          actionOrder.push(action.capability.id);
        } else {
          expect(identity).toEqual(existing);
        }
      }
      return response;
    };

    const inspect = async (
      label: string,
      changeId = CHANGE_ID
    ): Promise<any> =>
      appendViewToLedger(
        label,
        await publicCommand(label, [
          'pipeline',
          'status',
          changeId,
          CANVAS_V2_AUTHORING_NAME,
          '--json',
        ])
      );

    const assertManagementParity = async (
      phase: string,
      cliStatus: any
    ): Promise<any> => {
      const changeId = cliStatus.view.change.changeId as string;
      const managementView = await getThroughManagement(
        `/api/v1/runs/${encodeURIComponent(changeId)}/${encodeURIComponent(cliStatus.view.runId)}`
      );
      expect(managementView).toEqual(cliStatus.view);
      managementViews[phase] = managementView;
      return managementView;
    };

    const writePayload = (label: string, body: unknown): string => {
      payloadOrdinal += 1;
      const file = resolve(
        sandboxRoot,
        'receipts',
        `${String(payloadOrdinal).padStart(2, '0')}-${label}.json`
      );
      mkdirSync(resolve(sandboxRoot, 'receipts'), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
      return file;
    };

    const resealCompletion = (
      completion: CompleteRunAction,
      patch: Record<string, unknown>
    ): CompleteRunAction => {
      const candidate = { ...completion, ...patch } as CompleteRunAction;
      return {
        ...candidate,
        receiptDigest: computeCompletionReceiptDigest(candidate),
      } as CompleteRunAction;
    };

    const rejectWithoutMutation = async (
      label: string,
      submission: Readonly<{ completion: unknown; uploads: readonly unknown[] }>,
      before: any
    ): Promise<void> => {
      await publicCommand(
        label,
        [
          'pipeline',
          'complete',
          before.view.change.changeId,
          '--run',
          before.view.runId,
          '--from',
          writePayload(label, submission),
          '--json',
        ],
        1
      );
      const after = await inspect(
        `${label}:status`,
        before.view.change.changeId
      );
      expect(after).toEqual(before);
    };

    const mutateAndInspect = async (
      label: string,
      args: readonly string[],
      before: any
    ): Promise<any> => {
      await publicCommand(label, args);
      const after = await inspect(
        `${label}:status`,
        before.view.change.changeId
      );
      if (after.view.recordVersion <= before.view.recordVersion) {
        failDriver(
          `${label} made no progress at Record v${before.view.recordVersion}`,
          after.view
        );
      }
      return after;
    };

    const launched = await publicCommand(
      'start',
      [
        'pipeline',
        'start',
        CHANGE_ID,
        CANVAS_V2_AUTHORING_NAME,
        '--engine',
        'reconciler',
        '--json',
      ]
    );
    expect(launched.engine).toBe('reconciler');
    expect(launched.disposition).toBe('created');
    expect(launched.runId).toMatch(/^run:[0-9a-f]{64}$/);
    expect(launched.actions).toHaveLength(1);
    const runId = launched.runId as string;
    const firstActionId = launched.actions[0].actionId as string;
    console.info(
      '[ecp6-v2-launch]',
      JSON.stringify({ runId, firstActionId })
    );

    const runDirectory = resolve(
      dataHome,
      'rasen',
      'runs',
      runId.replace(/[^a-z0-9]/gi, '_')
    );
    const readPlan = (): any =>
      JSON.parse(readFileSync(resolve(runDirectory, 'plan.json'), 'utf8'));
    const readHead = (): any => {
      const versions = readdirSync(runDirectory)
        .map((file) => /^record-v(\d+)\.json$/.exec(file))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number.parseInt(match[1]!, 10));
      const version = Math.max(...versions);
      return JSON.parse(
        readFileSync(resolve(runDirectory, `record-v${version}.json`), 'utf8')
      );
    };
    const frozenPlan = readPlan();
    expect(frozenPlan).toMatchObject({
      runId,
      pipeline: CANVAS_V2_AUTHORING_NAME,
      planDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      sourceRevisionDigest: `sha256:${detail.preparation.digests.source}`,
      capabilityDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      policyDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      profileDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      executionProfile: {
        format: 'change-run-execution-profile/1',
        profileDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
    });
    expect(frozenPlan.planDigest).not.toBe(
      `sha256:${detail.preparation.digests.plan}`
    );
    const { publicKey: rotatedPublicKey } = generateKeyPairSync('ed25519');
    const rotatedDer = rotatedPublicKey.export({ format: 'der', type: 'spki' });
    const rotatedAuthority = {
      ...TEST_ATTESTATION_AUTHORITY,
      keyVersion: 'rotated-after-run-start',
      publicKey: {
        ...TEST_ATTESTATION_AUTHORITY.publicKey,
        value: Buffer.from(rotatedDer).toString('base64'),
        digest: `sha256:${createHash('sha256').update(rotatedDer).digest('hex')}` as Digest,
      },
    };
    const frozenAdapters = new Map(
      frozenPlan.executionProfile.capabilities.map((binding: any) => [
        `${binding.adapter.id}::${binding.adapter.version}::${binding.adapter.contentDigest}`,
        {
          id: binding.adapter.id,
          version: binding.adapter.version,
          contentDigest: binding.adapter.contentDigest as Digest,
        },
      ])
    );
    const descriptorsFor = (authority: typeof TEST_ATTESTATION_AUTHORITY) =>
      [...frozenAdapters.values()].map((adapter: any) =>
        trustedDescriptor(adapter, authority)
      );
    // Keep the mutable host catalog rotated across fresh status, resume,
    // control and complete processes. Existing Run meaning must come only from
    // plan.json; the original public authority is restored after the first
    // successful completion so the later new failure Run freezes the baseline.
    provisionTrustedExecutionAdapterCatalog(
      getGlobalDataDir(),
      descriptorsFor(rotatedAuthority)
    );

    let current = await inspect('status-after-start');
    expect(current.runId).toBe(runId);
    expect(rootSection(current.view).actions[0].actionId).toBe(firstActionId);
    const repeatedStartStatus = await inspect('status-after-start-repeat');
    expect(repeatedStartStatus).toEqual(current);
    await assertManagementParity('success-running', current);

    await publicCommand('resume-run-idempotent', [
      'pipeline',
      'resume-run',
      CHANGE_ID,
      CANVAS_V2_AUTHORING_NAME,
      '--json',
    ]);
    const afterResume = await inspect('resume-run-idempotent:status');
    expect(afterResume).toEqual(current);
    current = afterResume;

    let writerOrdinal = 0;
    let step = 0;
    let recoveredAfterLoopEffect = false;
    let gateCheckedFailClosed = false;
    let malformedCheckedFailClosed = false;
    let receiptMatrixCheckedFailClosed = false;
    let effectOrderingCheckedFailClosed = false;
    let fanOutRequiredCheckedFailClosed = false;
    let frozenAuthoritySurvivedCatalogRotation = false;
    const MAX_STEPS = 24;

    await rejectWithoutMutation(
      'complete-malformed-body-rejected',
      {
        completion: {
          format: 'change-run-completion/1',
          kind: 'effect-observation',
        },
        uploads: [],
      },
      current
    );
    malformedCheckedFailClosed = true;

    while (current.view.status !== 'completed') {
      step += 1;
      if (step > MAX_STEPS) {
        failDriver(`exceeded max step count ${MAX_STEPS}`, current.view);
      }
      const root = rootSection(current.view);
      const active = root.actions.filter(
        (action: any) => action.deliveryState !== 'closed'
      );

      if (root.waits.length > 0) {
        if (root.waits.length !== 1 || root.waits[0].kind !== 'gate') {
          failDriver('unknown or multiple outstanding waits', current.view);
        }
        const wait = root.waits[0];
        if (managementViews['success-waiting'] === undefined) {
          const waitingView = await assertManagementParity(
            'success-waiting',
            current
          );
          expect(waitingView.status).toBe('waiting');
          expect(section(waitingView, 'bounded-loop-lifecycle')).toBeDefined();
          expect(section(waitingView, 'parallel')).toMatchObject({
            joinState: 'waiting',
            members: [
              {
                path: 'root:atomic-stage',
                required: true,
              },
            ],
          });
          managementViews['success-parallel'] = waitingView;
        }
        if (!gateCheckedFailClosed) {
          const staleBody = {
            control: {
              format: 'change-run-control/1',
              ref: {
                change: { projectRoot, changeId: CHANGE_ID },
                runId,
              },
              expectedRecordVersion: current.view.recordVersion - 1,
              command: {
                kind: 'decision',
                waitId: wait.waitId,
                decisionId: 'approved',
                outcome: 'approved',
              },
            },
          };
          await publicCommand(
            'control-stale-version-rejected',
            [
              'pipeline',
              'control',
              CHANGE_ID,
              '--run',
              runId,
              '--from',
              writePayload('stale-control', staleBody),
              '--json',
            ],
            1
          );
          const afterStale = await inspect('control-stale-version:status');
          expect(afterStale).toEqual(current);

          const unknownWaitBody = {
            control: {
              ...staleBody.control,
              expectedRecordVersion: current.view.recordVersion,
              command: {
                ...staleBody.control.command,
                waitId: `wait:${'f'.repeat(64)}`,
              },
            },
          };
          await publicCommand(
            'control-unknown-wait-rejected',
            [
              'pipeline',
              'control',
              CHANGE_ID,
              '--run',
              runId,
              '--from',
              writePayload('unknown-wait-control', unknownWaitBody),
              '--json',
            ],
            1
          );
          const afterUnknown = await inspect('control-unknown-wait:status');
          expect(afterUnknown).toEqual(current);
          gateCheckedFailClosed = true;
        }

        const controlBody = {
          control: {
            format: 'change-run-control/1',
            ref: {
              change: { projectRoot, changeId: CHANGE_ID },
              runId,
            },
            expectedRecordVersion: current.view.recordVersion,
            command: {
              kind: 'decision',
              waitId: wait.waitId,
              decisionId: 'approved',
              outcome: 'approved',
            },
          },
        };
        current = await mutateAndInspect(
          'control-gate-approved',
          [
            'pipeline',
            'control',
            CHANGE_ID,
            '--run',
            runId,
            '--from',
            writePayload('gate-approved', controlBody),
            '--json',
          ],
          current
        );
        continue;
      }

      if (active.length !== 1) {
        failDriver(
          `expected one granted action, received ${active.length}`,
          current.view
        );
      }
      const action = active[0];
      const admittedEffects = action.effects.filter(
        (effect: any) => effect.state === 'admitted'
      );
      const completedEffects = action.effects.filter(
        (effect: any) => effect.state === 'succeeded'
      );
      if (admittedEffects.length > 0) {
        if (admittedEffects.length !== 1 || action.effects.length !== 1) {
          failDriver('unknown effect shape', current.view);
        }
        if (!receiptMatrixCheckedFailClosed) {
          const probe = completionSubmission(
            current.view,
            action,
            projectRoot,
            {
              kind: 'effect-observation',
              effectId: admittedEffects[0].effectId,
              observation: { probe: 'identity-binding-matrix' },
            }
          );
          const fakeActionId = `action:${'a'.repeat(64)}`;
          const fakeInvocationId = `invocation:${'b'.repeat(64)}`;
          const fakeEffectId = `effect:${'c'.repeat(64)}` as EffectId;
          const completion = probe.completion as any;
          const invalidCompletions: readonly Readonly<{
            label: string;
            completion: CompleteRunAction;
          }>[] = [
            {
              label: 'wrong-action',
              completion: resealCompletion(completion, {
                actionId: fakeActionId,
              }),
            },
            {
              label: 'wrong-invocation',
              completion: resealCompletion(completion, {
                invocationId: fakeInvocationId,
              }),
            },
            {
              label: 'wrong-effect',
              completion: resealCompletion(completion, {
                effectId: fakeEffectId,
              }),
            },
            {
              label: 'wrong-actor-attestation',
              completion: resealCompletion(completion, {
                actorAttestation: {
                  ...completion.actorAttestation,
                  binding: {
                    ...completion.actorAttestation.binding,
                    actionId: fakeActionId,
                  },
                },
              }),
            },
            {
              label: 'wrong-evidence-binding',
              completion: resealCompletion(completion, {
                evidence: [
                  {
                    ...completion.evidence[0],
                    binding: {
                      ...completion.evidence[0].binding,
                      effectId: fakeEffectId,
                    },
                  },
                ],
              }),
            },
            {
              label: 'wrong-receipt-digest',
              completion: {
                ...completion,
                receiptDigest: `sha256:${'0'.repeat(64)}`,
              },
            },
          ];
          for (const invalid of invalidCompletions) {
            await rejectWithoutMutation(
              `complete-${invalid.label}-rejected`,
              { completion: invalid.completion, uploads: probe.uploads },
              current
            );
          }
          receiptMatrixCheckedFailClosed = true;
        }
        if (!effectOrderingCheckedFailClosed) {
          const prematureDomain = completionSubmission(
            current.view,
            action,
            projectRoot,
            {
              kind: 'domain-action-result',
              result: { outcome: 'done', materialChange: true },
            }
          );
          await rejectWithoutMutation(
            'complete-domain-before-effect-rejected',
            prematureDomain,
            current
          );
          effectOrderingCheckedFailClosed = true;
        }
        writerOrdinal += 1;
        const beforeRevision = deriveWorkspaceRevision(
          observeGitWorkspace(projectRoot)
        );
        const workspaceFile = resolve(projectRoot, 'workspace.txt');
        writeFileSync(
          workspaceFile,
          `${readFileSync(workspaceFile, 'utf8')}effect:${action.actionId}\n`
        );
        const afterRevision = deriveWorkspaceRevision(
          observeGitWorkspace(projectRoot)
        );
        expect(afterRevision.treeDigest).not.toBe(beforeRevision.treeDigest);
        const submission = completionSubmission(
          current.view,
          action,
          projectRoot,
          {
            kind: 'effect-observation',
            effectId: admittedEffects[0].effectId,
            observation: {
              path: 'workspace.txt',
              before: beforeRevision,
              after: afterRevision,
            },
          }
        );
        receiptDigests.push(submission.completion.receiptDigest);
        evidenceDigests.push(
          submission.completion.actorAttestation.evidenceDigest,
          ...submission.completion.evidence.map((ref) => ref.evidenceDigest)
        );
        const command = [
          'pipeline',
          'complete',
          CHANGE_ID,
          '--run',
          runId,
          '--from',
          writePayload(`effect-${writerOrdinal}`, submission),
          '--json',
        ];
        if (writerOrdinal === 1) {
          try {
            current = await mutateAndInspect(
              `complete-effect-${writerOrdinal}-with-rotated-current-catalog`,
              command,
              current
            );
            frozenAuthoritySurvivedCatalogRotation = true;
          } finally {
            provisionTrustedExecutionAdapterCatalog(
              getGlobalDataDir(),
              descriptorsFor(TEST_ATTESTATION_AUTHORITY)
            );
          }
        } else {
          current = await mutateAndInspect(
            `complete-effect-${writerOrdinal}`,
            command,
            current
          );
        }
        const observed = rootSection(current.view).actions.find(
          (candidate: any) => candidate.actionId === action.actionId
        );
        expect(observed.effects[0]).toMatchObject({
          effectId: admittedEffects[0].effectId,
          state: 'succeeded',
        });

        if (writerOrdinal === 2) {
          const loop = section(current.view, 'bounded-loop-lifecycle');
          expect(loop).toMatchObject({ bodyKind: 'composite' });
          expect(section(current.view, 'parallel')).toMatchObject({
            joinState: 'not-reached',
          });
          const recoveryStatusOne = await inspect(
            'process-loss-boundary:status-one'
          );
          const recoveryStatusTwo = await inspect(
            'process-loss-boundary:status-two'
          );
          expect(recoveryStatusTwo).toEqual(recoveryStatusOne);
          expect(readPlan()).toEqual(frozenPlan);
          expect(readHead().recordVersion).toBe(
            recoveryStatusTwo.view.recordVersion
          );
          current = recoveryStatusTwo;
          recoveredAfterLoopEffect = true;
        }
        continue;
      }

      if (completedEffects.length !== action.effects.length) {
        failDriver('effect state is neither admitted nor succeeded', current.view);
      }
      let result: unknown;
      if (action.capability.id === 'capability:choice-select') {
        result = { outcome: 'parallel' };
      } else if (action.capability.id === 'capability:parallel-dispatch') {
        if (!fanOutRequiredCheckedFailClosed) {
          for (const invalidResult of [
            { inactiveMembers: [] },
            {
              activeMembers: [],
              inactiveMembers: ['root:atomic-stage'],
            },
          ]) {
            await rejectWithoutMutation(
              `complete-fan-out-required-member-${'activeMembers' in invalidResult ? 'inactive' : 'omitted'}-rejected`,
              completionSubmission(
                current.view,
                action,
                projectRoot,
                {
                  kind: 'domain-action-result',
                  result: invalidResult,
                }
              ),
              current
            );
          }
          fanOutRequiredCheckedFailClosed = true;
        }
        result = {
          activeMembers: ['root:atomic-stage'],
          inactiveMembers: [],
        };
      } else if (action.capability.id === 'skill:rasen-apply-change') {
        result = { outcome: 'done', materialChange: true };
      } else {
        failDriver(
          `unknown granted capability ${action.capability.id}`,
          current.view
        );
      }
      const submission = completionSubmission(
        current.view,
        action,
        projectRoot,
        { kind: 'domain-action-result', result }
      );
      receiptDigests.push(submission.completion.receiptDigest);
      evidenceDigests.push(
        submission.completion.actorAttestation.evidenceDigest,
        ...submission.completion.evidence.map((ref) => ref.evidenceDigest)
      );
      current = await mutateAndInspect(
        `complete-domain-${action.capability.id.replace(/[^a-z0-9]+/gi, '-')}`,
        [
          'pipeline',
          'complete',
          CHANGE_ID,
          '--run',
          runId,
          '--from',
          writePayload(`domain-${step}`, submission),
          '--json',
        ],
        current
      );
    }

    expect(recoveredAfterLoopEffect).toBe(true);
    expect(frozenAuthoritySurvivedCatalogRotation).toBe(true);
    expect(gateCheckedFailClosed).toBe(true);
    expect(malformedCheckedFailClosed).toBe(true);
    expect(receiptMatrixCheckedFailClosed).toBe(true);
    expect(effectOrderingCheckedFailClosed).toBe(true);
    expect(fanOutRequiredCheckedFailClosed).toBe(true);
    expect(writerOrdinal).toBe(3);
    expect(actionOrder).toEqual([
      'skill:rasen-apply-change',
      'skill:rasen-apply-change',
      'capability:choice-select',
      'capability:parallel-dispatch',
      'skill:rasen-apply-change',
    ]);
    expect(section(current.view, 'bounded-loop-lifecycle')).toMatchObject({
      state: 'terminal',
      outcome: { kind: 'completed', disposition: 'exit', value: 'done' },
    });
    expect(section(current.view, 'parallel')).toMatchObject({
      joinState: 'proceeding',
      members: [
        {
          path: 'root:atomic-stage',
          status: 'succeeded',
          required: true,
        },
      ],
    });
    expect(rootSection(current.view).terminal).toEqual({
      kind: 'completed',
      outcome: 'done',
    });
    await assertManagementParity('success-terminal', current);

    const terminalBeforeResume = current;
    await publicCommand('resume-run-after-terminal', [
      'pipeline',
      'resume-run',
      CHANGE_ID,
      CANVAS_V2_AUTHORING_NAME,
      '--json',
    ]);
    current = await inspect('resume-run-after-terminal:status');
    expect(current).toEqual(terminalBeforeResume);
    expect(readPlan()).toEqual(frozenPlan);
    const finalRecord = readHead();
    expect(finalRecord).toMatchObject({
      runId,
      recordVersion: current.view.recordVersion,
      status: 'completed',
      planDigest: frozenPlan.planDigest,
      sourceRevisionDigest: frozenPlan.sourceRevisionDigest,
      capabilityDigest: frozenPlan.capabilityDigest,
      policyDigest: frozenPlan.policyDigest,
      executionProfileDigest: frozenPlan.profileDigest,
    });
    for (const [actionId, identity] of identities) {
      const persistedAction = finalRecord.actions[actionId].action;
      expect({
        actionId: persistedAction.actionId,
        invocationId: persistedAction.invocationId,
        attemptId: persistedAction.attemptId,
        nodeId: persistedAction.nodeId,
        effectIds: persistedAction.effects.map(
          (effect: any) => effect.effectId
        ),
      }).toEqual(identity);
    }
    expect(receiptDigests.every((digest) => /^sha256:[0-9a-f]{64}$/.test(digest))).toBe(true);
    expect(evidenceDigests.every((digest) => /^sha256:[0-9a-f]{64}$/.test(digest))).toBe(true);
    expect(ledger.length).toBeGreaterThan(20);
    expect(new Set(ledger.map((entry) => entry.process)).size).toBe(
      ledger.length
    );

    const failureLaunch = await publicCommand(
      'failure:start',
      [
        'pipeline',
        'start',
        FAILURE_CHANGE_ID,
        CANVAS_V2_AUTHORING_NAME,
        '--engine',
        'reconciler',
        '--json',
      ]
    );
    expect(failureLaunch.disposition).toBe('created');
    const failureRunId = failureLaunch.runId as string;
    expect(failureRunId).toMatch(/^run:[0-9a-f]{64}$/);
    expect(failureRunId).not.toBe(runId);
    let failure = await inspect('failure:status-after-start', FAILURE_CHANGE_ID);
    await assertManagementParity('failure-running', failure);

    let failureStep = 0;
    let failureWriterOrdinal = 0;
    let failureApplyOrdinal = 0;
    const FAILURE_MAX_STEPS = 18;
    while (rootSection(failure.view).terminal === undefined) {
      failureStep += 1;
      if (failureStep > FAILURE_MAX_STEPS) {
        failDriver(
          `failure journey exceeded max step count ${FAILURE_MAX_STEPS}`,
          failure.view
        );
      }
      const root = rootSection(failure.view);
      if (root.waits.length > 0) {
        if (root.waits.length !== 1 || root.waits[0].kind !== 'gate') {
          failDriver('failure journey reached an unknown wait', failure.view);
        }
        const wait = root.waits[0];
        failure = await mutateAndInspect(
          'failure:control-gate-approved',
          [
            'pipeline',
            'control',
            FAILURE_CHANGE_ID,
            '--run',
            failureRunId,
            '--from',
            writePayload('failure-gate-approved', {
              control: {
                format: 'change-run-control/1',
                ref: {
                  change: { projectRoot, changeId: FAILURE_CHANGE_ID },
                  runId: failureRunId,
                },
                expectedRecordVersion: failure.view.recordVersion,
                command: {
                  kind: 'decision',
                  waitId: wait.waitId,
                  decisionId: 'approved',
                  outcome: 'approved',
                },
              },
            }),
            '--json',
          ],
          failure
        );
        continue;
      }

      const active = root.actions.filter(
        (action: any) => action.deliveryState !== 'closed'
      );
      if (active.length !== 1) {
        failDriver(
          `failure journey expected one action, received ${active.length}`,
          failure.view
        );
      }
      const action = active[0];
      const admittedEffects = action.effects.filter(
        (effect: any) => effect.state === 'admitted'
      );
      if (admittedEffects.length > 0) {
        if (admittedEffects.length !== 1 || action.effects.length !== 1) {
          failDriver('failure journey reached unknown effect shape', failure.view);
        }
        failureWriterOrdinal += 1;
        const beforeRevision = deriveWorkspaceRevision(
          observeGitWorkspace(projectRoot)
        );
        const workspaceFile = resolve(projectRoot, 'workspace.txt');
        writeFileSync(
          workspaceFile,
          `${readFileSync(workspaceFile, 'utf8')}failure-effect:${action.actionId}\n`
        );
        const afterRevision = deriveWorkspaceRevision(
          observeGitWorkspace(projectRoot)
        );
        failure = await mutateAndInspect(
          `failure:complete-effect-${failureWriterOrdinal}`,
          [
            'pipeline',
            'complete',
            FAILURE_CHANGE_ID,
            '--run',
            failureRunId,
            '--from',
            writePayload(
              `failure-effect-${failureWriterOrdinal}`,
              completionSubmission(
                failure.view,
                action,
                projectRoot,
                {
                  kind: 'effect-observation',
                  effectId: admittedEffects[0].effectId,
                  observation: {
                    path: 'workspace.txt',
                    before: beforeRevision,
                    after: afterRevision,
                  },
                }
              )
            ),
            '--json',
          ],
          failure
        );
        continue;
      }

      let status: 'succeeded' | 'failed' = 'succeeded';
      let result: unknown;
      if (action.capability.id === 'capability:choice-select') {
        result = { outcome: 'parallel' };
      } else if (action.capability.id === 'capability:parallel-dispatch') {
        result = {
          activeMembers: ['root:atomic-stage'],
          inactiveMembers: [],
        };
      } else if (action.capability.id === 'skill:rasen-apply-change') {
        failureApplyOrdinal += 1;
        if (failureApplyOrdinal === 3) {
          status = 'failed';
          result = {
            code: 'required_member_failed',
            member: 'root:atomic-stage',
          };
        } else {
          result = { outcome: 'done', materialChange: true };
        }
      } else {
        failDriver(
          `failure journey reached unknown capability ${action.capability.id}`,
          failure.view
        );
      }
      failure = await mutateAndInspect(
        `failure:complete-domain-${action.capability.id.replace(/[^a-z0-9]+/gi, '-')}`,
        [
          'pipeline',
          'complete',
          FAILURE_CHANGE_ID,
          '--run',
          failureRunId,
          '--from',
          writePayload(
            `failure-domain-${failureStep}`,
            completionSubmission(failure.view, action, projectRoot, {
              kind: 'domain-action-result',
              status,
              result,
            })
          ),
          '--json',
        ],
        failure
      );
    }

    expect(failureWriterOrdinal).toBe(3);
    expect(failureApplyOrdinal).toBe(3);
    expect(rootSection(failure.view).terminal).toMatchObject({
      kind: 'escalated',
      code: 'failed',
    });
    expect(rootSection(failure.view).terminal).not.toEqual({
      kind: 'completed',
      outcome: 'done',
    });
    expect(
      rootSection(failure.view).actions.filter(
        (action: any) => action.deliveryState !== 'closed'
      )
    ).toHaveLength(0);
    expect(section(failure.view, 'parallel')).toMatchObject({
      joinState: 'failed',
      members: [
        {
          path: 'root:atomic-stage',
          status: 'failed',
          required: true,
        },
      ],
      keyBlockers: ["required member 'root:atomic-stage' failed"],
    });
    await assertManagementParity('failure-terminal', failure);
    const failureBeforeResume = failure;
    await publicCommand('failure:resume-after-terminal', [
      'pipeline',
      'resume-run',
      FAILURE_CHANGE_ID,
      CANVAS_V2_AUTHORING_NAME,
      '--json',
    ]);
    failure = await inspect(
      'failure:resume-after-terminal:status',
      FAILURE_CHANGE_ID
    );
    expect(failure).toEqual(failureBeforeResume);

    const runDirectoryFor = (id: string): string =>
      resolve(dataHome, 'rasen', 'runs', id.replace(/[^a-z0-9]/gi, '_'));
    const failurePlan = JSON.parse(
      readFileSync(resolve(runDirectoryFor(failureRunId), 'plan.json'), 'utf8')
    );
    expect({
      source: failurePlan.sourceRevisionDigest,
      capability: failurePlan.capabilityDigest,
      policy: failurePlan.policyDigest,
      plan: failurePlan.planDigest,
      profile: failurePlan.profileDigest,
    }).toEqual({
      source: frozenPlan.sourceRevisionDigest,
      capability: frozenPlan.capabilityDigest,
      policy: frozenPlan.policyDigest,
      plan: frozenPlan.planDigest,
      profile: frozenPlan.profileDigest,
    });

    const runsResponse = await getThroughManagement('/api/v1/runs');
    const capturePath = process.env.ECP6_VERTICAL_CAPTURE_PATH;
    if (capturePath !== undefined && capturePath.trim().length > 0) {
      mkdirSync(resolve(capturePath, '..'), { recursive: true });
      writeFileSync(
        capturePath,
        `${JSON.stringify(
          {
            format: 'ecp6-vertical-management-capture/1',
            source: {
              definitionExport:
                'packages/ui/test/fixtures/canvas-v2-authoring.ts#CANVAS_V2_AUTHORING_DEFINITION',
              generatedBy:
                'test/core/change-run/canvas-v2-vertical-proof.test.ts',
            },
            views: managementViews,
            runsResponse,
          },
          null,
          2
        )}\n`
      );
    }

    console.info(
      '[ecp6-v2-vertical-proof]',
      JSON.stringify({
        runId,
        failureRunId,
        firstActionId,
        actionIds: [...identities.keys()],
        effectIds: [...identities.values()].flatMap(
          (identity) => identity.effectIds
        ),
        waitIds: ledger.flatMap((entry) =>
          (entry.waits ?? []).map((wait) => wait.waitId)
        ),
        digests: {
          source: frozenPlan.sourceRevisionDigest,
          capability: frozenPlan.capabilityDigest,
          policy: frozenPlan.policyDigest,
          plan: frozenPlan.planDigest,
          profile: frozenPlan.profileDigest,
        },
        processes: processOrdinal,
        transitions: ledger.length,
        sandboxRoot,
      })
    );
  }, 900_000);
});
