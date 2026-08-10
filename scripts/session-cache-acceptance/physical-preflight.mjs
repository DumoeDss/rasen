import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MAX_HTTP_BYTES = 2 * 1024 * 1024;
const MAX_STATE_BYTES = 64 * 1024;
const FINGERPRINT_CHUNK_BYTES = 1024 * 1024;
export const MAX_EVIDENCE_FINGERPRINT_BYTES = 256 * 1024 * 1024;
// Selected production executables are legitimately far larger than evidence
// documents or built modules. The Claude Code CLI ships a single-file native
// binary that has grown past 256 MiB, so fingerprinting it needs its own
// explicit bound rather than the evidence default. Symlinks, devices, and fifos
// are still refused by regularBoundedFile; the bound stays finite so a runaway
// regular file is refused too.
export const MAX_EXECUTABLE_FINGERPRINT_BYTES = 4 * 1024 * 1024 * 1024;
const CAPACITY_SCHEMA = 'rasen-session-supervisor-capacity-proof/2';
const SHA256 = /^[a-f0-9]{64}$/u;
const LIVE_SESSION_STATES = new Set(['starting', 'running', 'exiting']);
const LIVE_REUSABLE_STATES = new Set(['starting', 'idle', 'waking', 'retiring']);

function regularBoundedFile(filePath, maximumBytes, code) {
  const resolved = path.resolve(filePath);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error(`${code}_symlink`);
  if (!stat.isFile()) throw new Error(`${code}_not_regular`);
  if (stat.size > maximumBytes) throw new Error(`${code}_oversize`);
  if (fs.realpathSync.native(resolved) !== resolved) {
    throw new Error(`${code}_identity`);
  }
  return { resolved, stat };
}

export function sha256File(
  filePath,
  maximumBytes = MAX_EVIDENCE_FINGERPRINT_BYTES
) {
  const { resolved, stat } = regularBoundedFile(
    filePath,
    maximumBytes,
    'fingerprint_file'
  );
  const hash = createHash('sha256');
  const descriptor = fs.openSync(resolved, 'r');
  try {
    const buffer = Buffer.allocUnsafe(FINGERPRINT_CHUNK_BYTES);
    let read = 0;
    for (;;) {
      const chunk = fs.readSync(descriptor, buffer, 0, FINGERPRINT_CHUNK_BYTES, null);
      if (chunk === 0) break;
      read += chunk;
      if (read > maximumBytes) throw new Error('fingerprint_file_oversize');
      hash.update(buffer.subarray(0, chunk));
    }
    if (read !== stat.size) throw new Error('fingerprint_file_size_drift');
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

// The single approved way to fingerprint a selected production executable.
// Call sites must not reach for sha256File directly: a bound chosen per call
// site is exactly how the Claude binary silently outgrew the evidence default.
export function fingerprintSelectedExecutable(filePath) {
  return sha256File(filePath, MAX_EXECUTABLE_FINGERPRINT_BYTES);
}

export function hashExactFileSet(root, relativePaths) {
  const resolvedRoot = fs.realpathSync.native(path.resolve(root));
  const normalized = [...new Set(relativePaths.map((entry) => entry.replace(/\\/gu, '/')))]
    .sort();
  const hash = createHash('sha256');
  for (const relative of normalized) {
    if (
      relative.length === 0
      || path.isAbsolute(relative)
      || relative.split('/').includes('..')
    ) {
      throw new Error('fingerprint_manifest_path_invalid');
    }
    const absolute = path.resolve(resolvedRoot, relative);
    if (
      absolute !== resolvedRoot
      && !absolute.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error('fingerprint_manifest_path_escape');
    }
    const { resolved } = regularBoundedFile(
      absolute,
      MAX_EVIDENCE_FINGERPRINT_BYTES,
      'fingerprint_file'
    );
    hash.update(relative, 'utf8');
    hash.update('\0');
    hash.update(sha256File(resolved), 'utf8');
    hash.update('\0');
  }
  return hash.digest('hex');
}

function requestJson({ port, token, daemon, requestPath }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: 'GET',
        agent: false,
        timeout: 10_000,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
      (response) => {
        if (
          response.headers['x-rasen-daemon'] !== daemon.version
          || Number(response.headers['x-rasen-pid']) !== daemon.pid
        ) {
          response.destroy();
          reject(new Error('daemon_identity_mismatch'));
          return;
        }
        let total = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          total += chunk.byteLength;
          if (total > MAX_HTTP_BYTES) {
            response.destroy();
            reject(new Error('daemon_response_oversize'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`daemon_http_${response.statusCode ?? 'unknown'}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('daemon_response_invalid'));
          }
        });
        response.on('error', reject);
      }
    );
    request.on('timeout', () => request.destroy(new Error('daemon_timeout')));
    request.on('error', reject);
    request.end();
  });
}

function readDaemonState(statePath) {
  const { resolved } = regularBoundedFile(
    statePath,
    MAX_STATE_BYTES,
    'daemon_state'
  );
  const value = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.version !== 'string'
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || !Number.isSafeInteger(value.port)
    || value.port <= 0
    || value.port > 65535
    || typeof value.token !== 'string'
    || value.token.length === 0
  ) {
    throw new Error('daemon_state_schema');
  }
  return value;
}

export function parseWindowsCommandLine(commandLine) {
  const argv = [];
  let argument = '';
  let quoted = false;
  let backslashes = 0;
  let active = false;
  const flushBackslashes = (count = backslashes) => {
    argument += '\\'.repeat(count);
    backslashes = 0;
  };
  for (let index = 0; index <= commandLine.length; index += 1) {
    const character = commandLine[index];
    if (character === '\\') {
      backslashes += 1;
      active = true;
      continue;
    }
    if (character === '"') {
      argument += '\\'.repeat(Math.floor(backslashes / 2));
      if (backslashes % 2 === 0) {
        quoted = !quoted;
      } else {
        argument += '"';
      }
      backslashes = 0;
      active = true;
      continue;
    }
    flushBackslashes();
    if ((character === undefined || /\s/u.test(character)) && !quoted) {
      if (active) {
        argv.push(argument);
        argument = '';
        active = false;
      }
      continue;
    }
    if (character !== undefined) {
      argument += character;
      active = true;
    }
  }
  if (quoted) throw new Error('daemon_process_command_line_invalid');
  return argv;
}

function candidateDaemonEntrypoints(input) {
  const repositoryRoot = fs.realpathSync.native(
    path.resolve(input.repositoryRoot)
  );
  const { resolved: rasenBin } = regularBoundedFile(
    input.rasenBin,
    1024 * 1024,
    'rasen_bin'
  );
  const relativeBin = path
    .relative(repositoryRoot, rasenBin)
    .replace(/\\/gu, '/');
  const compare = (value) =>
    (input.platform ?? process.platform) === 'win32'
      ? value.toLowerCase()
      : value;
  if (compare(relativeBin) !== 'bin/rasen.js') {
    throw new Error('daemon_candidate_binary_mismatch');
  }
  const shim = fs.readFileSync(rasenBin, 'utf8');
  const matches = [
    ...shim.matchAll(
      /^\s*import\s+\{\s*runCli\s*\}\s+from\s+(['"])([^'"]+)\1\s*;/gmu
    ),
  ];
  if (
    matches.length !== 1
    || matches[0][2].replace(/\\/gu, '/') !== '../dist/cli/index.js'
  ) {
    throw new Error('daemon_candidate_shim_invalid');
  }
  const distEntry = path.resolve(path.dirname(rasenBin), matches[0][2]);
  const { resolved: canonicalDistEntry } = regularBoundedFile(
    distEntry,
    16 * 1024 * 1024,
    'daemon_dist_entry'
  );
  if (
    compare(
      path.relative(repositoryRoot, canonicalDistEntry).replace(/\\/gu, '/')
    ) !== 'dist/cli/index.js'
  ) {
    throw new Error('daemon_candidate_binary_mismatch');
  }
  if (
    !Array.isArray(input.binaryFiles)
    || !input.binaryFiles.includes('bin/rasen.js')
    || !input.binaryFiles.includes('dist/cli/index.js')
    || hashExactFileSet(repositoryRoot, input.binaryFiles)
      !== input.binaryFingerprint
  ) {
    throw new Error('daemon_candidate_binary_fingerprint_mismatch');
  }
  return {
    repositoryRoot,
    rasenBin,
    distEntry: canonicalDistEntry,
  };
}

export function verifyCandidateDaemonArgv(input) {
  const entrypoints = candidateDaemonEntrypoints(input);
  const candidates = input.argv
    .filter((argument) => path.isAbsolute(argument))
    .map((argument) => {
      const resolved = path.resolve(argument);
      let stat;
      try {
        stat = fs.lstatSync(resolved);
      } catch {
        return null;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
      const canonical = fs.realpathSync.native(resolved);
      if (canonical !== resolved) return null;
      return canonical;
    })
    .filter(Boolean);
  const normalize = (value) =>
    input.platform === 'win32' ? value.toLowerCase() : value;
  const allowed = new Map([
    [normalize(entrypoints.rasenBin), 'bin-shim'],
    [normalize(entrypoints.distEntry), 'dist-entry'],
  ]);
  const matches = candidates
    .map((candidate) => ({
      path: candidate,
      kind: allowed.get(normalize(candidate)),
    }))
    .filter((candidate) => candidate.kind !== undefined);
  if (matches.length !== 1) {
    throw new Error('daemon_candidate_binary_mismatch');
  }
  return {
    entrypointFingerprint: sha256File(matches[0].path),
    entrypointKind: matches[0].kind,
  };
}

function daemonCommandIdentity(pid, input) {
  let commandLine;
  let argv;
  if (process.platform === 'win32') {
    commandLine = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        maxBuffer: 64 * 1024,
      }
    ).trim();
    argv = parseWindowsCommandLine(commandLine);
  } else {
    argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean);
    commandLine = argv.join(' ');
  }
  if (commandLine.length === 0 || commandLine.length > 32 * 1024) {
    throw new Error('daemon_process_identity_unavailable');
  }
  const entrypoint = verifyCandidateDaemonArgv({
    ...input,
    platform: process.platform,
    argv,
  });
  return {
    commandFingerprint: createHash('sha256')
      .update(commandLine, 'utf8')
      .digest('hex'),
    ...entrypoint,
  };
}

function verifySupervisorBuild(input) {
  const supervisorPath = path.resolve(input.supervisorModule);
  const { resolved } = regularBoundedFile(
    supervisorPath,
    4 * 1024 * 1024,
    'supervisor_module'
  );
  const source = fs.readFileSync(resolved, 'utf8');
  const matches = [
    ...source.matchAll(/(?:const\s+DEFAULT_MAX_CONCURRENT\s*=\s*|options\.maxConcurrent\s*\?\?\s*)(\d+)/gu),
  ];
  const values = matches.map((match) => Number(match[1]));
  if (values.length === 0 || values.some((value) => value !== 3)) {
    throw new Error('supervisor_max_not_proven');
  }
  const moduleFingerprint = sha256File(resolved);
  if (
    input.supervisorModuleFingerprint !== undefined
    && input.supervisorModuleFingerprint !== moduleFingerprint
  ) {
    throw new Error('supervisor_build_fingerprint_mismatch');
  }
  return { maxProcesses: 3, moduleFingerprint };
}

export async function inspectPhysicalCapacity(input) {
  const daemonState = input.readDaemonState?.(input.daemonStatePath)
    ?? readDaemonState(input.daemonStatePath);
  const commandIdentity = input.commandIdentity?.(daemonState.pid, input)
    ?? daemonCommandIdentity(daemonState.pid, input);
  if (
    daemonState.pid !== input.daemon.pid
    || daemonState.port !== input.daemon.port
    || daemonState.version !== input.daemon.version
    || (
      input.daemon.commandFingerprint !== undefined
      && input.daemon.commandFingerprint
        !== commandIdentity.commandFingerprint
    )
    || (
      input.daemon.entrypointFingerprint !== undefined
      && input.daemon.entrypointFingerprint
        !== commandIdentity.entrypointFingerprint
    )
  ) {
    throw new Error('daemon_state_identity_mismatch');
  }
  const supervisor = input.verifySupervisorBuild?.(input)
    ?? verifySupervisorBuild(input);
  const request = input.requestJson ?? requestJson;
  const [status, ordinary, reusable] = await Promise.all([
    request({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/status',
    }),
    request({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/sessions',
    }),
    request({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/reusable-sessions?scope=all',
    }),
  ]);
  if (
    status?.pid !== daemonState.pid
    || status?.version !== daemonState.version
    || !Array.isArray(ordinary?.sessions)
    || reusable?.schema !== 'rasen-reusable-session-api/1'
    || reusable?.ok !== true
    || reusable?.operation !== 'list'
    || !Array.isArray(reusable?.sessions)
  ) {
    throw new Error('daemon_protocol_status_invalid');
  }
  const ordinaryLive = ordinary.sessions.filter((entry) =>
    LIVE_SESSION_STATES.has(entry?.session?.state)
  ).length;
  const reusableLive = reusable.sessions.filter((entry) =>
    LIVE_REUSABLE_STATES.has(entry?.status)
  ).length;
  const liveProcesses = ordinaryLive + reusableLive;
  const availableSlots = supervisor.maxProcesses - liveProcesses;
  const requiredAvailableSlots = input.requiredAvailableSlots ?? 3;
  if (
    !Number.isSafeInteger(requiredAvailableSlots)
    || requiredAvailableSlots <= 0
    || availableSlots < requiredAvailableSlots
  ) {
    throw new Error('daemon_capacity_insufficient');
  }
  return {
    schema: CAPACITY_SCHEMA,
    candidateFingerprint: input.candidate.contentFingerprint,
    daemon: {
      pid: daemonState.pid,
      port: daemonState.port,
      version: daemonState.version,
      commandFingerprint: commandIdentity.commandFingerprint,
      entrypointFingerprint: commandIdentity.entrypointFingerprint,
    },
    supervisor: {
      maxProcesses: supervisor.maxProcesses,
      liveProcesses,
      availableSlots,
      moduleFingerprint: supervisor.moduleFingerprint,
    },
    armIds: [...input.armIds],
    sessionKeys: [...input.sessionKeys],
    observedAt: new Date().toISOString(),
  };
}

/**
 * Reads live capacity from an actual management server without claiming that
 * the server process is the production resident daemon. This is used only by
 * the multiprocess admission contract test: routing, service, registry, and
 * coordinator are real, while no user daemon or physical-retention run is
 * started.
 */
export async function inspectManagementServerCapacity(input) {
  const daemonState = readDaemonState(input.daemonStatePath);
  if (
    daemonState.pid !== input.daemon.pid
    || daemonState.port !== input.daemon.port
    || daemonState.version !== input.daemon.version
  ) {
    throw new Error('management_server_state_identity_mismatch');
  }
  const [status, ordinary, reusable] = await Promise.all([
    requestJson({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/status',
    }),
    requestJson({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/sessions',
    }),
    requestJson({
      port: daemonState.port,
      token: daemonState.token,
      daemon: input.daemon,
      requestPath: '/api/v1/reusable-sessions?scope=all',
    }),
  ]);
  if (
    status?.pid !== daemonState.pid
    || status?.version !== daemonState.version
    || !Array.isArray(ordinary?.sessions)
    || reusable?.schema !== 'rasen-reusable-session-api/1'
    || reusable?.ok !== true
    || reusable?.operation !== 'list'
    || !Array.isArray(reusable?.sessions)
  ) {
    throw new Error('management_server_protocol_status_invalid');
  }
  const ordinaryLive = ordinary.sessions.filter((entry) =>
    LIVE_SESSION_STATES.has(entry?.session?.state)
  ).length;
  const reusableLive = reusable.sessions.filter((entry) =>
    LIVE_REUSABLE_STATES.has(entry?.status)
  ).length;
  const liveProcesses = ordinaryLive + reusableLive;
  const availableSlots = 3 - liveProcesses;
  const requiredAvailableSlots = input.requiredAvailableSlots ?? 1;
  if (
    !Number.isSafeInteger(requiredAvailableSlots)
    || requiredAvailableSlots <= 0
    || availableSlots < requiredAvailableSlots
  ) {
    throw new Error('management_server_capacity_insufficient');
  }
  return {
    schema: 'rasen-session-management-capacity-observation/1',
    pid: daemonState.pid,
    port: daemonState.port,
    version: daemonState.version,
    ordinaryLive,
    reusableLive,
    liveProcesses,
    availableSlots,
    observedAt: new Date().toISOString(),
  };
}

export async function inspectDaemonIdentity(input) {
  const daemonState = readDaemonState(input.daemonStatePath);
  const commandIdentity = daemonCommandIdentity(daemonState.pid, input);
  if (
    daemonState.pid !== input.daemon.pid
    || daemonState.port !== input.daemon.port
    || daemonState.version !== input.daemon.version
    || input.daemon.commandFingerprint !== commandIdentity.commandFingerprint
    || input.daemon.entrypointFingerprint
      !== commandIdentity.entrypointFingerprint
  ) {
    throw new Error('daemon_state_identity_mismatch');
  }
  const status = await requestJson({
    port: daemonState.port,
    token: daemonState.token,
    daemon: input.daemon,
    requestPath: '/api/v1/status',
  });
  if (
    status?.pid !== daemonState.pid
    || status?.version !== daemonState.version
  ) {
    throw new Error('daemon_protocol_status_invalid');
  }
  return {
    pid: daemonState.pid,
    port: daemonState.port,
    version: daemonState.version,
    commandFingerprint: commandIdentity.commandFingerprint,
    entrypointFingerprint: commandIdentity.entrypointFingerprint,
  };
}

export function verifyCapacityProofDocument(proof, input) {
  const exactKeys = (value, keys) =>
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
  if (
    !exactKeys(proof, [
      'schema',
      'candidateFingerprint',
      'daemon',
      'supervisor',
      'armIds',
      'sessionKeys',
      'observedAt',
    ])
    || !exactKeys(proof?.daemon, [
      'pid',
      'port',
      'version',
      'commandFingerprint',
      'entrypointFingerprint',
    ])
    || !exactKeys(proof?.supervisor, [
      'maxProcesses',
      'liveProcesses',
      'availableSlots',
      'moduleFingerprint',
    ])
    || proof?.schema !== CAPACITY_SCHEMA
    || proof?.candidateFingerprint !== input.candidate.contentFingerprint
    || proof?.daemon?.pid !== input.daemon.pid
    || proof?.daemon?.port !== input.daemon.port
    || proof?.daemon?.version !== input.daemon.version
    || !SHA256.test(proof?.daemon?.commandFingerprint ?? '')
    || proof?.daemon?.commandFingerprint !== input.daemon.commandFingerprint
    || !SHA256.test(proof?.daemon?.entrypointFingerprint ?? '')
    || proof?.daemon?.entrypointFingerprint
      !== input.daemon.entrypointFingerprint
    || proof?.supervisor?.maxProcesses !== 3
    || proof?.supervisor?.liveProcesses !== 0
    || proof?.supervisor?.availableSlots !== 3
    || !SHA256.test(proof?.supervisor?.moduleFingerprint ?? '')
    || proof.supervisor.moduleFingerprint !== input.supervisorModuleFingerprint
    || !Array.isArray(proof.armIds)
    || !Array.isArray(proof.sessionKeys)
  ) {
    throw new Error('capacity_proof_invalid');
  }
  return proof;
}

export { CAPACITY_SCHEMA };
