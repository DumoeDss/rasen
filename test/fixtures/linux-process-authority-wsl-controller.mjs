import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function durableBarrier(file, value) {
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_TRUNC, 0o600);
  try {
    fs.writeFileSync(descriptor, value, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}

async function blockUntilKilled() {
  await new Promise((resolve) => setTimeout(resolve, 2_147_000_000));
}

const sourceRoot = required('RPA_WSL_SOURCE_ROOT');
const packageRoot = required('RPA_WSL_PACKAGE_ROOT');
const testRoot = required('RPA_WSL_TEST_ROOT');
const barrier = required('RPA_WSL_BARRIER');
const referenceFile = required('RPA_WSL_REFERENCE');
const mode = required('RPA_WSL_WINDOW');
const moduleUrl = (relative) => pathToFileURL(path.join(sourceRoot, relative)).href;

const {
  PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
  ProcessAuthorityProviderRegistry,
  createProcessAuthorityCoordinator,
} = await import(moduleUrl('src/core/session-host/process-authority/index.ts'));
const {
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
} = await import(moduleUrl('src/core/session-host/process-authority/linux/contracts.ts'));
const {
  createLinuxPrimaryNativeAssemblyForTesting,
} = await import(moduleUrl('src/core/session-host/process-authority/linux/native-assembly.ts'));
const {
  createLinuxPrimaryProcessAuthorityProviderBundleForTesting,
} = await import(moduleUrl('src/core/session-host/process-authority/linux/provider.ts'));
const {
  createLinuxAuthorityPublicationLedger,
} = await import(moduleUrl('src/core/session-host/process-authority/linux/publication-ledger.ts'));

const artifactPath = `dist/native/linux-${process.arch}/rasen-linux-process-authority-helper`;
const buildAuthorityModule = await import(pathToFileURL(path.join(
  packageRoot,
  'dist/core/session-host/process-authority/linux/build-authority.js'
)).href);
const buildIdentity = buildAuthorityModule.LINUX_PROCESS_AUTHORITY_BUILD_IDENTITIES.find(
  (identity) => identity.artifactPath === artifactPath && identity.mode === 'user-pidns'
);
if (!buildIdentity) throw new Error('Current package omits the exact primary build authority.');
const assembly = createLinuxPrimaryNativeAssemblyForTesting(
  path.join(testRoot, 'runtime'),
  Object.freeze({ packageRoot, artifactPath, mode: 'user-pidns' }),
  buildIdentity
);
const bundle = createLinuxPrimaryProcessAuthorityProviderBundleForTesting({
  transport: assembly.transport,
  runtimeOpener: assembly.runtimeOpener,
  ledger: createLinuxAuthorityPublicationLedger({ root: path.join(testRoot, 'ledger') }),
  artifactIdentity: assembly.artifactIdentity,
});
const registry = new ProcessAuthorityProviderRegistry([bundle.provider], {
  manifest: Object.freeze({
    schema: PROCESS_AUTHORITY_PROVIDER_MANIFEST_SCHEMA,
    providers: Object.freeze([Object.freeze({
      ...LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
      artifactPath,
    })]),
  }),
  manifestRoot: packageRoot,
});
let operation = 0;
const coordinator = createProcessAuthorityCoordinator({
  registry,
  operationId: () => `actual-wsl-controller-${mode}-${++operation}`,
  operationTimeoutMs: 30_000,
});
const marker = path.join(testRoot, 'workload-marker');
const prepared = await coordinator.prepare(
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
  Object.freeze({
    command: '/usr/bin/touch',
    args: Object.freeze([marker]),
    cwd: path.join(testRoot, 'cwd'),
    env: Object.freeze({ LANG: 'C.UTF-8' }),
  })
);
if (prepared.state !== 'prepared-inert') {
  throw new Error(`Controller prepare did not remain inert: ${prepared.state}`);
}
durableBarrier(referenceFile, String(prepared.reference));

if (mode === 'commit-before-ack') {
  await prepared.publish(async (binding, context) => {
    const acknowledgement = await bundle.publishAuthority(binding, context);
    durableBarrier(barrier, 'ledger-committed');
    await blockUntilKilled();
    return acknowledgement;
  });
} else if (mode === 'ack-before-activate') {
  const published = await prepared.publish(bundle.publishAuthority);
  if (published.state !== 'published-inert') {
    throw new Error(`Controller publication did not remain inert: ${published.state}`);
  }
  durableBarrier(barrier, 'acknowledged');
  await blockUntilKilled();
} else {
  throw new Error(`Unknown controller window: ${mode}`);
}
