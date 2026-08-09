// The owning daemon for the daemon-lifetime production oracle.
//
// A real, separate Node process that creates a scope through the shipped Linux transport and then
// blocks forever. Nothing here is special-cased: the daemon-lifetime endpoint is created, held and
// inherited entirely by `native-assembly`'s own code. Killing this process is the whole trigger.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

const sourceRoot = required('RPA_DL_SOURCE_ROOT');
const packageRoot = required('RPA_DL_PACKAGE_ROOT');
const testRoot = required('RPA_DL_TEST_ROOT');
const markers = required('RPA_DL_MARKERS');
const ready = required('RPA_DL_READY');
const escapeSeconds = process.env.RPA_DL_ESCAPE_SECONDS ?? '6';
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
  operationId: () => `daemon-lifetime-${++operation}`,
  operationTimeoutMs: 30_000,
});

const prepared = await coordinator.prepare(
  LINUX_PRIMARY_PROCESS_AUTHORITY_DESCRIPTOR,
  Object.freeze({
    command: fs.realpathSync(process.execPath),
    args: Object.freeze([
      path.join(sourceRoot, 'test/fixtures/linux-process-authority-daemon-lifetime-workload.mjs'),
    ]),
    cwd: path.join(testRoot, 'cwd'),
    env: Object.freeze({
      LANG: 'C.UTF-8',
      RPA_DL_MARKERS: markers,
      RPA_DL_ESCAPE_SECONDS: escapeSeconds,
    }),
  })
);
if (prepared.state !== 'prepared-inert') {
  throw new Error(`Daemon prepare did not remain inert: ${prepared.state}`);
}

// `activate` lives on the published authority, and the guardian refuses to activate a scope whose
// runtime bridge is not open (`primary.rs` handle_control, Activate arm). The daemon therefore
// walks publish -> open runtime -> activate, which is exactly the order production uses in
// `process-scope-adapter.ts`. Skipping the bridge yields a guardian refusal that the control client
// reports as `reference-invalid`, which names the reference rather than the missing bridge.
const published = await prepared.publish(bundle.publishAuthority);
if (published.state !== 'published-inert') {
  throw new Error(`Daemon publication did not remain inert: ${published.state}`);
}
const runtime = bundle.openRuntime(prepared.reference);
// The bridge is held for the scope's whole life, as the adapter holds it. Nothing here consumes
// the workload's output, so the streams are drained and every terminal promise is settled
// locally: an unhandled rejection would kill this daemon and forge the very teardown under test.
runtime.stdout.resume();
runtime.stderr.resume();
runtime.rootExited.catch(() => {});
runtime.exactScopeEmpty.catch(() => {});
const live = await published.activate();
if (live.state !== 'live') {
  throw new Error(`Daemon activate did not reach live: ${JSON.stringify(live)}`);
}

fs.writeFileSync(ready, String(process.pid), 'utf8');

// A pending promise is not an event-loop handle, so `await new Promise(() => {})` alone lets this
// daemon exit 13 - silently - as soon as its last handle goes. That is not hypothetical here: the
// runtime bridge tears its own helper down on an inactivity timeout, and a daemon that dies with it
// forges exactly the teardown this oracle is meant to observe. The daemon therefore owns a handle
// that depends on nothing else. Only the test's SIGKILL ends this process.
const held = setInterval(() => {}, 1_000);
held.ref();
await new Promise(() => {});
