import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FROZEN_COMMON_INPUTS = Object.freeze({
  // Rebaselined 05257eb1... -> 359db6d9...: commit 2961848b replaced the archived
  // Purpose placeholder in the accepted spec (docs-only edit; committed bytes
  // re-hashed via `git show`). LEAD-authorized rebaseline, 2026-08-08.
  'rasen/specs/process-authority-provider/spec.md':
    'e376f5a77f8934a0ada5e07213c495f377b3279d6b1e76d7d1c101dfa0f69430',
  'test/helpers/process-authority-provider-conformance.ts':
    'b9d8bd4fb63910ed1626c0d9f2bda258803a8f3a191f98c57509e837cc58d2f0',
});

const LEGACY_PROCESS_CAPSULE_INPUTS = Object.freeze({
  'native/process-capsule/src/main.rs':
    '79dc1ad0f19e5f1d087083707c5307d8523002c557995a6658146c64f0f41c8d',
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
  'src/core/session-host/process-capsule/native-process-scope.ts':
    '3e74b2c25bfde89a9db300301b7010f2a7c9521be37283ed73169be4f111b828',
  'test/core/session-host/process-capsule-package.test.ts':
    '3ed5945c5b17b711c783534281c4288242ab9b680e498135db3f344528a759e1',
  'test/core/session-host/process-capsule-posix-replacement.test.ts':
    '894a5119e480f4f904f6a5265adb82c48e83f2a31bc79f1b27b14f2f0e64e047',
});

function sha256(relativePath: string): string {
  const bytes = fs.readFileSync(path.resolve(relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Linux process-authority implementation boundary guards', () => {
  it('consumes the accepted common spec and shared conformance suite byte-for-byte', () => {
    expect(Object.fromEntries(
      Object.keys(FROZEN_COMMON_INPUTS).map((file) => [file, sha256(file)])
    )).toEqual(FROZEN_COMMON_INPUTS);
  });

  it('keeps the legacy ProcessCapsule protocol-v2 PGID implementation unchanged', () => {
    expect(Object.fromEntries(
      Object.keys(LEGACY_PROCESS_CAPSULE_INPUTS).map((file) => [file, sha256(file)])
    )).toEqual(LEGACY_PROCESS_CAPSULE_INPUTS);

    const resolver = fs.readFileSync(
      path.resolve('src/core/session-host/process-capsule/resolver.ts'),
      'utf8'
    );
    const helper = fs.readFileSync(path.resolve('native/process-capsule/src/main.rs'), 'utf8');
    expect(resolver).toContain('PROCESS_CAPSULE_PROTOCOL_VERSION = 2');
    expect(resolver).toContain("artifact.capabilities.includes('pidfd')");
    expect(resolver).toContain("artifact.capabilities.includes('process-group')");
    expect(helper).toContain('const PROTOCOL_VERSION: u16 = 2;');
    expect(helper).toContain('process-group empty observation timed out');
    expect(helper).not.toContain('rasen.linux.user-pidns');
    expect(helper).not.toContain('rasen.linux.broker-pidns-cgroupv2');
  });
});
