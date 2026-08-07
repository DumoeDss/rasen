import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  ProcessAuthorityProviderRegistry,
  createProcessAuthorityCoordinator,
  type AuthorityOperationContext,
  type ProcessAuthorityReference,
} from '../../../src/core/session-host/process-authority/index.js';
import {
  decodeProcessAuthorityReferenceForDispatch,
} from '../../../src/core/session-host/process-authority/reference-codec.js';
import {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} from '../../../src/core/session-host/process-authority/linux/contracts.js';
import {
  createLinuxPrimaryNativeAssemblyForTesting,
} from '../../../src/core/session-host/process-authority/linux/native-assembly.js';
import {
  createLinuxPrimaryProcessAuthorityProviderBundleForTesting,
  type LinuxAuthorityNativeTransport,
  type LinuxProcessAuthorityProviderBundle,
} from '../../../src/core/session-host/process-authority/linux/provider.js';
import {
  createLinuxAuthorityPublicationLedger,
} from '../../../src/core/session-host/process-authority/linux/publication-ledger.js';
import {
  decodeLinuxPrivateAuthorityReference,
} from '../../../src/core/session-host/process-authority/linux/private-reference.js';
import type {
  LinuxProcessAuthorityBuildIdentity,
} from '../../../src/core/session-host/process-authority/linux/build-authority.js';

const ACTUAL_WSL = process.platform === 'linux' &&
  process.env.RASEN_ACTUAL_WSL_ORACLE === '1';
const describeActualWsl = ACTUAL_WSL ? describe : describe.skip;
const SOURCE_ROOT = path.resolve('.');

interface ActualBundle {
  readonly bundle: LinuxProcessAuthorityProviderBundle;
  readonly transport: LinuxAuthorityNativeTransport;
  readonly artifactPath: string;
}

function requiredPackageRoot(): string {
  const value = process.env.RASEN_LINUX_PROCESS_AUTHORITY_PACKAGE_ROOT;
  if (!value || !path.isAbsolute(value)) {
    throw new Error('RASEN_LINUX_PROCESS_AUTHORITY_PACKAGE_ROOT is required.');
  }
  return fs.realpathSync(value);
}

function artifactPath(): string {
  return `dist/native/linux-${process.arch}/rasen-linux-process-authority-helper`;
}

async function trustedBuildIdentity(
  packageRoot: string,
  relative: string
): Promise<LinuxProcessAuthorityBuildIdentity> {
  const module = await import(pathToFileURL(path.join(
    packageRoot,
    'dist/core/session-host/process-authority/linux/build-authority.js'
  )).href);
  const identities = module.LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES as
    readonly LinuxProcessAuthorityBuildIdentity[];
  const identity = identities.find((candidate) =>
    candidate.artifactPath === relative && candidate.mode === 'user-pidns');
  if (!identity) throw new Error('Current package omits the exact primary build authority.');
  return identity;
}

function createRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.homedir(), `.rasen-${label}-`));
  fs.chmodSync(root, 0o700);
  for (const child of ['runtime', 'cwd']) {
    const directory = path.join(root, child);
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }
  return root;
}

async function actualBundle(root: string): Promise<ActualBundle> {
  const packageRoot = requiredPackageRoot();
  const relative = artifactPath();
  const assembly = createLinuxPrimaryNativeAssemblyForTesting(
    path.join(root, 'runtime'),
    Object.freeze({ packageRoot, artifactPath: relative, mode: 'user-pidns' }),
    await trustedBuildIdentity(packageRoot, relative)
  );
  return Object.freeze({
    bundle: createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
      transport: assembly.transport,
      runtimeOpener: assembly.runtimeOpener,
      ledger: createLinuxAuthorityPublicationLedger({ root: path.join(root, 'ledger') }),
      artifactIdentity: assembly.artifactIdentity,
    }),
    transport: assembly.transport,
    artifactPath: relative,
  });
}

function registry(
  bundle: LinuxProcessAuthorityProviderBundle,
  relative: string
): ProcessAuthorityProviderRegistry {
  return new ProcessAuthorityProviderRegistry([bundle.provider], {
    manifest: Object.freeze({
      schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
      providers: Object.freeze([Object.freeze({
        ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        artifactPath: relative,
      })]),
    }),
    manifestRoot: requiredPackageRoot(),
  });
}

function context(phase: AuthorityOperationContext['phase'], operationId: string) {
  return Object.freeze({
    phase,
    operationId,
    deadline: Number.MAX_SAFE_INTEGER,
    signal: new AbortController().signal,
  });
}

function dispatch(reference: ProcessAuthorityReference) {
  const decoded = decodeProcessAuthorityReferenceForDispatch(
    String(reference),
    LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR
  );
  if (decoded.state !== 'dispatchable') {
    throw new Error(`Actual WSL reference is not dispatchable: ${decoded.reason}`);
  }
  return decoded;
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path.basename(file)}.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function controller(root: string, window: 'commit-before-ack' | 'ack-before-activate') {
  const barrier = path.join(root, `${window}.barrier`);
  const reference = path.join(root, `${window}.reference`);
  const loader = pathToFileURL(path.join(SOURCE_ROOT, 'test/fixtures/typescript-source-loader.mjs'))
    .href;
  const fixture = path.join(SOURCE_ROOT, 'test/fixtures/linux-process-authority-wsl-controller.mjs');
  let stderr = '';
  const child = spawn(process.execPath, [
    '--no-warnings',
    '--experimental-loader',
    loader,
    fixture,
  ], {
    env: {
      ...process.env,
      RPA_WSL_SOURCE_ROOT: SOURCE_ROOT,
      RPA_WSL_PACKAGE_ROOT: requiredPackageRoot(),
      RPA_WSL_TEST_ROOT: root,
      RPA_WSL_BARRIER: barrier,
      RPA_WSL_REFERENCE: reference,
      RPA_WSL_WINDOW: window,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk: Buffer | string) => { stderr += chunk.toString(); });
  return Object.freeze({ child, barrier, reference, stderr: () => stderr });
}

async function killControllerAtBarrier(value: {
  readonly child: ChildProcess;
  readonly barrier: string;
  readonly stderr: () => string;
}): Promise<void> {
  await waitForFile(value.barrier);
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    value.child.once('error', reject);
    value.child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  expect(value.child.kill('SIGKILL')).toBe(true);
  const result = await exit;
  expect(result, value.stderr()).toMatchObject({ code: null, signal: 'SIGKILL' });
}

async function killAndReapController(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGKILL');
  await exited;
}

async function bestEffortExactAbort(
  root: string,
  reference: ProcessAuthorityReference
): Promise<boolean> {
  try {
    const current = await actualBundle(root);
    const decoded = dispatch(reference);
    const outcome = await current.bundle.provider.abort(
      decoded.providerReference,
      'actual WSL failure cleanup',
      context('abort', 'actual-wsl-failure-cleanup')
    );
    return outcome.state === 'exact-scope-empty';
  } catch {
    return false;
  }
}

async function replacementAbortsPublished(root: string, reference: ProcessAuthorityReference) {
  const current = await actualBundle(root);
  const replacement = current.bundle;
  const decoded = dispatch(reference);
  let operation = 0;
  const replacementCoordinator = createProcessAuthorityCoordinator({
    registry: registry(replacement, current.artifactPath),
    operationId: () => `actual-wsl-replacement-coordinator-${++operation}`,
    operationTimeoutMs: 30_000,
  });
  await expect(replacementCoordinator.inspect(reference)).resolves.toEqual({
    state: 'published-inert',
    reference,
  });
  await expect(replacement.provider.inspect(
    decoded.providerReference,
    context('inspect', 'actual-wsl-replacement-inspect')
  )).resolves.toEqual({ state: 'published-inert' });
  // The native machine must remain publication-blind: `published-inert` above can
  // only come from the authentic ledger, never from a native `Published` journal
  // transition. Asking the same real helper directly must still answer `inert`.
  await expect(current.transport.inspect(
    decodeLinuxPrivateAuthorityReference(decoded.providerReference),
    context('inspect', 'actual-wsl-native-publication-blindness')
  )).resolves.toEqual({ state: 'inert' });
  expect(fs.existsSync(path.join(root, 'workload-marker'))).toBe(false);
  await expect(replacement.provider.abort(
    decoded.providerReference,
    'actual WSL inert replacement reconciliation',
    context('abort', 'actual-wsl-replacement-abort')
  )).resolves.toEqual({ state: 'exact-scope-empty' });
  expect(fs.existsSync(path.join(root, 'workload-marker'))).toBe(false);
  await expect(replacementCoordinator.inspect(reference)).resolves.toEqual({
    state: 'exact-scope-empty',
    reference,
  });
}

describeActualWsl('Linux process authority actual WSL product oracles', () => {
  it('actual_wsl_published_inert_abort_keeps_workload_closed', async () => {
    const root = createRoot('pa');
    let reference: ProcessAuthorityReference | undefined;
    let exactEmpty = false;
    try {
      const current = await actualBundle(root);
      let operation = 0;
      const diagnostics: unknown[] = [];
      const coordinator = createProcessAuthorityCoordinator({
        registry: registry(current.bundle, current.artifactPath),
        operationId: () => `actual-wsl-published-abort-${++operation}`,
        operationTimeoutMs: 30_000,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });
      const prepared = await coordinator.prepare(
        LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
        Object.freeze({
          command: '/usr/bin/touch',
          args: Object.freeze([path.join(root, 'workload-marker')]),
          cwd: path.join(root, 'cwd'),
          env: Object.freeze({ LANG: 'C.UTF-8' }),
        })
      );
      if (prepared.state !== 'prepared-inert') {
        throw new Error(
          `Expected actual prepared authority: ${JSON.stringify({ prepared, diagnostics })}`
        );
      }
      expect(prepared.state).toBe('prepared-inert');
      reference = prepared.reference;
      const published = await prepared.publish(current.bundle.publishAuthority);
      expect(published.state).toBe('published-inert');
      await replacementAbortsPublished(root, prepared.reference);
      exactEmpty = true;
    } finally {
      if (reference && !exactEmpty) exactEmpty = await bestEffortExactAbort(root, reference);
      if (exactEmpty) fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['commit-before-ack', 'actual_wsl_replacement_recovers_commit_before_ack_as_published_inert'],
    ['ack-before-activate', 'actual_wsl_replacement_recovers_ack_before_activate_as_published_inert'],
  ] as const)('%s: %s', async (window) => {
    const root = createRoot(window === 'commit-before-ack' ? 'cba' : 'aba');
    const running = controller(root, window);
    let reference: ProcessAuthorityReference | undefined;
    let exactEmpty = false;
    try {
      await killControllerAtBarrier(running);
      reference = fs.readFileSync(running.reference, 'utf8') as ProcessAuthorityReference;
      expect(fs.statSync(running.reference).mode & 0o7777).toBe(0o600);
      await replacementAbortsPublished(root, reference);
      exactEmpty = true;
    } finally {
      await killAndReapController(running.child);
      if (!reference && fs.existsSync(running.reference)) {
        reference = fs.readFileSync(running.reference, 'utf8') as ProcessAuthorityReference;
      }
      if (reference && !exactEmpty) exactEmpty = await bestEffortExactAbort(root, reference);
      if (exactEmpty) fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
