import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const SCRIPT = path.resolve('scripts/build-windows-process-authority.mjs');
const WORKFLOW = path.resolve('.github/workflows/windows-process-authority.yml');
const CRATE = path.resolve('native/windows-process-authority');
const HELPER_RELATIVE = 'dist/native/win32-x64/rasen-windows-process-authority-helper.exe';

/**
 * The Linux crate's source digest, as currently recorded by **its own Change**.
 * The digest is recomputed here rather than trusted, because a stale value would
 * let a modification pass unnoticed.
 *
 * **This pin does not assert the Linux tree is immutable, and it never did.** It
 * asserts that *this* Change contributes no byte to it. The Linux crate is owned
 * by `ecp-linux-process-authority-provider`, and that Change re-froze it under an
 * authorised Section 12 wave:
 *
 *   087d87a5948c74ae770233f15bb1dce845557d8bcc66dc23fa12642cf615ad59  (superseded)
 *   89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643  (current, 26 files)
 *
 * So the value below moves only when the owning Change authorises a move, and
 * every such move must land here **with its lineage**. A bare constant swap would
 * turn this test green while the sentence it used to mean — "nothing changed" —
 * became false, which is the failure mode this Change's own Section 9 exists to
 * catch. Anything else that moves this digest is drift, and it fails here.
 */
const LINUX_CRATE_SOURCE_DIGEST =
  '89f6c1d5270c3ad301f84edde1ae1f67541ac81ca271eb8eaef7871715aba643';

const LEGACY_PROCESS_CAPSULE_INPUTS = Object.freeze({
  // Rebaselined 79dc1ad0... -> a4c80875...: PR 147's cross-platform
  // CI follow-up added exact native process-birth probing, POSIX owned-ref
  // replacement termination, zombie reaping, and a stable leaked-Job-handle
  // mutation oracle. These are shared ProcessCapsule correctness fixes, not
  // reinterpretation by the Windows provider. Committed bytes re-hashed via
  // `git show d20a2fce:<path>`. LEAD-authorized rebaseline, 2026-08-09.
  // Rebaselined a4c80875... -> f6c00b73...: PR 147's CI fix-forward makes
  // the leaked-Job-handle mutation an acknowledged protocol step. The
  // supervisor validates its remotely duplicated handle against the kernel
  // before the controller publishes PREPARED, removing the full-suite race.
  // This remains shared ProcessCapsule correctness, not Windows-provider
  // reinterpretation. Staged LF delivery bytes re-hashed via `git show
  // :<path>`. LEAD-authorized rebaseline, 2026-08-09.
  'native/process-capsule/src/main.rs':
    'f6c00b734c769eb210c5b6e13fc6c46295c0f976ebb98bd26f44f186ca0e3c1c',
  'native/process-capsule/Cargo.lock':
    'f00e64114e06f06b623880947c4ec4d33953218d901abdba3b2b2f1d32db8793',
  'scripts/build-process-capsule.mjs':
    '4117b109bbe524ccd9423e9e4ef1da8f52cfc1a27e818871ae71c653f599ef92',
  'src/core/session-host/process-capsule/resolver.ts':
    'a1df4e2ed63167231c0207dbd4d5a5d8c8aa5bb4e44665e7b4cbe3d5624bbf91',
  // Rebaselined 0848c77b... -> a070733c...: review round 1 finding F1 (RC-004
  // parser containment) wrapped the one-shot probe's stdout callback so a
  // malformed frame becomes typed uncertainty instead of a throw escaping an
  // EventEmitter callback. The cutover Change made that path production-
  // reachable via design D4, which is why the parked finding came due here.
  // TypeScript adapter only - the Rust crate and every other pinned digest in
  // this list are unchanged. Committed bytes re-hashed via
  // `git show 8e48ce45:<path>`. LEAD-authorized rebaseline, 2026-08-08.
  // Rebaselined a070733c... -> 3e74b2c2...: closure task 12.8 (RC-005
  // clients-map retention lifecycle) added the shared scope-retention sweep
  // call into the native adapter's prepare(). TypeScript adapter only - the
  // Rust crate and every other pinned digest in this list are unchanged.
  // Committed bytes re-hashed via `git show efe834ba:<path>`. Second
  // LEAD-authorized rebaseline of this file, 2026-08-08.
  // Rebaselined 3e74b2c2... -> fd3b3840...: the same PR 147 follow-up
  // classifies pre-PREPARED native errors by phase and restricts orphan-group
  // termination to the exact locally owned ref. Committed bytes re-hashed via
  // `git show d20a2fce:<path>`. LEAD-authorized rebaseline, 2026-08-09.
  // Rebaselined fd3b3840... -> d485c503...: the final CI correction removes
  // the same-request owned-ref fallback after controller loss because it
  // erased the required typed uncertainty receipt. LF delivery bytes
  // re-hashed by the LEAD, 2026-08-09.
  'src/core/session-host/process-capsule/native-process-scope.ts':
    'd485c50313ea2791fc6e777865b0484c0dcff37ed8d235beed7cb3cea561466f',
});

const FROZEN_COMMON_INPUTS = Object.freeze({
  // Rebaselined 05257eb1... -> 359db6d9...: commit 2961848b replaced the archived
  // Purpose placeholder in the accepted spec (docs-only edit; committed bytes
  // re-hashed via `git show`). LEAD-authorized rebaseline, 2026-08-08.
  'rasen/specs/process-authority-provider/spec.md':
    'e376f5a77f8934a0ada5e07213c495f377b3279d6b1e76d7d1c101dfa0f69430',
  'test/helpers/process-authority-provider-conformance.ts':
    'b9d8bd4fb63910ed1626c0d9f2bda258803a8f3a191f98c57509e837cc58d2f0',
});

function posix(relativePath: string): string {
  return relativePath.split(path.sep).join('/');
}

function sourceFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path.join(directory, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(posix(relative));
    }
  }
  return files;
}

/** The build script's convention, including the trailing NUL after each file. */
function crateSourceDigest(crate: string, roots: readonly string[]): string {
  const files = [...roots, ...sourceFiles(path.join(crate, 'src'), 'src')].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(crate, ...file.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sha256File(relativePath: string): string {
  return createHash('sha256').update(fs.readFileSync(path.resolve(relativePath))).digest('hex');
}

function runScript(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('Windows process-authority build script', () => {
  it('plans an explicitly non-runtime artifact for each supported target', () => {
    for (const [target, arch, directory] of [
      ['x86_64-pc-windows-msvc', 'x64', 'win32-x64'],
      ['aarch64-pc-windows-msvc', 'arm64', 'win32-arm64'],
    ] as const) {
      const result = runScript(['--plan', '--target', target]);
      expect(result.status, result.stderr).toBe(0);
      const plan = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(plan).toMatchObject({
        platform: 'win32',
        arch,
        target,
        artifactPath: `dist/native/${directory}/rasen-windows-process-authority-helper.exe`,
        runtimeAccepted: false,
      });
      expect(plan.evidenceClassification).toMatch(/non-runtime$/u);
    }
  });

  it('computes the source digest with the trailing NUL after each file', () => {
    const plan = JSON.parse(runScript(['--plan']).stdout) as { sourceSha256: string };
    // Recomputed independently. The sibling build script's convention appends a
    // NUL after the path *and* after the contents; a recomputation that omits
    // either disagrees with every digest the script has emitted.
    expect(plan.sourceSha256).toBe(
      crateSourceDigest(CRATE, ['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY.md'])
    );
    expect(plan.sourceSha256).not.toBe(
      crateSourceDigest(CRATE, ['Cargo.lock', 'Cargo.toml'])
    );
  });

  it('reports whether third-party accounting is present rather than assuming it', () => {
    const plan = JSON.parse(runScript(['--plan']).stdout) as { thirdPartyAccounting: boolean };
    expect(typeof plan.thirdPartyAccounting).toBe('boolean');
    expect(plan.thirdPartyAccounting).toBe(fs.existsSync(path.join(CRATE, 'THIRD_PARTY.md')));
  });

  it('refuses a target outside the supported Windows set', () => {
    for (const target of [
      'x86_64-unknown-linux-gnu',
      'aarch64-apple-darwin',
      'x86_64-pc-windows-gnu',
      'not-a-target',
    ]) {
      const result = runScript(['--plan', '--target', target]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not a supported explicit Windows target/u);
    }
  });

  it('refuses more than one operation and an unknown argument', () => {
    expect(runScript(['--plan', '--check-only']).stderr)
      .toMatch(/only one operation may be selected/u);
    expect(runScript(['--publish']).stderr).toMatch(/unknown argument/u);
  });

  it('refuses a build-affecting environment override', () => {
    try {
      process.env.RUSTFLAGS = '-Copt-level=0';
      expect(runScript(['--check-only']).stderr)
        .toMatch(/build-affecting environment override is forbidden: RUSTFLAGS/u);
    } finally {
      delete process.env.RUSTFLAGS;
    }
  });

  it('pins the linker flag that makes the artifact byte-reproducible', () => {
    // Without /Brepro two builds of identical source differ by the COFF
    // TimeDateStamp, its debug-directory copies, and the CodeView GUID — at
    // identical length. Recorded as a guard so a later simplification that
    // drops it is a regression rather than a cleanup.
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).toContain('-Clink-arg=/Brepro');
  });
});

describe('Windows process-authority package shape', () => {
  it('includes the Windows helper tree through the packaged dist root', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      files: string[];
      scripts: Record<string, string>;
    };
    expect(manifest.files).toContain('dist');
    const exclusions = manifest.files.filter((entry) => entry.startsWith('!'));
    for (const exclusion of exclusions) {
      expect(HELPER_RELATIVE.startsWith('dist/')).toBe(true);
      expect(exclusion).not.toMatch(/windows-process-authority/u);
    }
    expect(manifest.scripts['build:windows-authority'])
      .toBe('node scripts/build-windows-process-authority.mjs');
    expect(manifest.scripts['check:windows-authority-target'])
      .toContain('--check-only --target aarch64-pc-windows-msvc');
  });

  it('packages the guardian under the exact filename the helper resolves', () => {
    // The helper finds its guardian by `current_exe().parent().join(NAME)` —
    // no compiled-in path, no env var, no PATH search. That makes the packaged
    // guardian's filename a load-bearing cross-component invariant held between
    // two files with different owners. Today it holds by agreement; this guard
    // makes a rename break the build instead of the runtime.
    const cli = fs.readFileSync(path.resolve(CRATE, 'src/cli.rs'), 'utf8');
    const declared = /GUARDIAN_EXECUTABLE:\s*&str\s*=\s*"([^"]+)"/u.exec(cli);
    expect(declared, 'crate no longer declares GUARDIAN_EXECUTABLE').not.toBeNull();
    const script = fs.readFileSync(SCRIPT, 'utf8');
    const packaged = /^const guardianName = '([^']+)';$/mu.exec(script);
    expect(packaged, 'build script no longer names the packaged guardian').not.toBeNull();
    expect(packaged![1]).toBe(declared![1]);
  });

  it('never enables a native mutation switch from the provider', () => {
    // The shipped helper deliberately carries runtime mutation switches so the
    // discrimination REDs run against the artifact that ships rather than a
    // test-only twin. This layer must never be able to reach one.
    const windowsSourceRoot = path.resolve('src/core/session-host/process-authority/windows');
    const sources = fs.readdirSync(windowsSourceRoot)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.resolve(windowsSourceRoot, name));
    for (const file of [...sources, SCRIPT]) {
      const text = fs.readFileSync(file, 'utf8');
      const code = text
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
        .join('\n');
      expect(code, `${path.basename(file)} references a mutation switch`)
        .not.toMatch(/--mutate|duplicate-job-into-root/u);
    }
  });

  it('does not change the legacy ProcessCapsule package shape', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['build']).toBe('node build.js');
    expect(manifest.scripts['build:windows-authority']).not.toContain('process-capsule');
    const script = fs.readFileSync(SCRIPT, 'utf8');
    expect(script).not.toContain('process-capsule');
    expect(script).not.toContain('linux-process-authority');
  });
});

describe('Windows process-authority CI contract', () => {
  it('builds natively and runs the non-interactive matrix on a Windows runner', () => {
    const workflow = parse(fs.readFileSync(WORKFLOW, 'utf8')) as {
      jobs: Record<string, { 'runs-on': string; steps: { name: string; run?: string }[] }>;
    };
    const jobs = Object.keys(workflow.jobs).sort();
    expect(jobs).toEqual([
      'windows-arm64-cross-shape',
      'windows-job-object-policy',
      'windows-provider-actual-kernel',
      'windows-provider-build',
    ]);
    for (const job of Object.values(workflow.jobs)) {
      expect(job['runs-on']).toBe('windows-latest');
    }
    const build = workflow.jobs['windows-provider-build']!;
    expect(build.steps.some((step) =>
      step.run?.includes('scripts/build-windows-process-authority.mjs') === true &&
      step.run.includes('--target x86_64-pc-windows-msvc'))).toBe(true);
  });

  it('reports a runner-policy restriction as an open gate rather than a pass', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    const workflow = parse(text) as {
      jobs: Record<string, { if?: string; steps: { name: string; if?: string; run?: string }[] }>;
    };
    const gate = workflow.jobs['windows-provider-actual-kernel']!;
    expect(gate.if).toBe(
      "needs.windows-job-object-policy.outputs.state == 'available'"
    );
    expect(JSON.stringify(gate)).not.toMatch(/actual-kernel-gate\.json|exit 1/);
    expect(text).toContain('## OPEN: Windows Job Object policy gate');
    expect(text).toContain('## OPEN: Windows arm64 runtime gate');
  });

  it('keeps arm64 evidence labelled non-runtime', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    expect(text).toContain('--check-only --target aarch64-pc-windows-msvc');
    expect(text).not.toMatch(/build-windows-process-authority\.mjs --target aarch64/u);
  });

  it('classifies Job Object policy by real construction, not by ambient membership', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf8');
    expect(text).toContain('CreateJobObjectW');
    expect(text).toContain('job-object-creation-denied');
    // Ambient Job membership is not an unavailability verdict, because nested
    // Jobs are supported. A probe that concluded from membership alone would
    // repeat the sibling's "verdict from a narrow probe" method failure.
    expect(text).not.toContain('IsProcessInJob');
  });
});

describe('Windows Change boundary guards', () => {
  it('consumes the accepted common spec and shared conformance suite byte-for-byte', () => {
    expect(Object.fromEntries(
      Object.keys(FROZEN_COMMON_INPUTS).map((file) => [file, sha256File(file)])
    )).toEqual(FROZEN_COMMON_INPUTS);
  });

  it('contributes no byte to the Linux native tree, which stands at its own Change’s digest', () => {
    expect(crateSourceDigest(
      path.resolve('native/linux-process-authority'),
      ['Cargo.lock', 'Cargo.toml', 'THIRD_PARTY.md']
    )).toBe(LINUX_CRATE_SOURCE_DIGEST);
  });

  it('pins the authorized shared ProcessCapsule follow-up inputs', () => {
    expect(Object.fromEntries(
      Object.keys(LEGACY_PROCESS_CAPSULE_INPUTS).map((file) => [file, sha256File(file)])
    )).toEqual(LEGACY_PROCESS_CAPSULE_INPUTS);
    const resolver = fs.readFileSync(
      path.resolve('src/core/session-host/process-capsule/resolver.ts'),
      'utf8'
    );
    // The legacy Windows capability gate stays exactly where it was; this
    // Change adds an authority, it does not reinterpret the legacy one.
    expect(resolver).toContain("artifact.capabilities.includes('unnamed-job-kill-on-close')");
    expect(resolver).toContain('PROCESS_CAPSULE_PROTOCOL_VERSION = 2');
    expect(resolver).not.toContain('rasen.windows.job-object');
  });

  it('touches no file under the frozen Linux provider or its Change directory', () => {
    const forbidden = [
      'src/core/session-host/process-authority/linux',
      'rasen/changes/ecp-linux-process-authority-provider',
    ];
    const windowsSources = fs.readdirSync(
      path.resolve('src/core/session-host/process-authority/windows')
    ).map((name) => path.resolve('src/core/session-host/process-authority/windows', name));
    for (const file of [SCRIPT, WORKFLOW, ...windowsSources]) {
      const text = fs.readFileSync(file, 'utf8');
      for (const needle of forbidden) {
        expect(text, `${path.basename(file)} references ${needle}`).not.toContain(needle);
      }
    }
  });
});
