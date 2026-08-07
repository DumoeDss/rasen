import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  asProcessRef,
  type ProcessPrepareInput,
  type ProcessRef,
} from '../../../src/core/session-host/process-scope.js';
import { createNativeProcessScope } from '../../../src/core/session-host/process-capsule/native-process-scope.js';

function nativePayload(ref: ProcessRef): string {
  return Buffer.from(
    String(ref).slice('rasen-process-scope/1:'.length),
    'base64url',
  ).toString('utf8');
}

function withForeignControllerBirth(ref: ProcessRef): ProcessRef {
  const fields = nativePayload(ref).split('|');
  if (fields.length !== 8 || fields[0] !== 'v2') {
    throw new Error('test expected a v2 native ProcessCapsule ref');
  }
  fields[3] = `${fields[3]}-foreign`;
  return asProcessRef(
    `rasen-process-scope/1:${Buffer.from(fields.join('|'), 'utf8').toString('base64url')}`,
  );
}

const launch: ProcessPrepareInput = {
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
  cwd: process.cwd(),
  env: Object.fromEntries(
    ['HOME', 'TMP', 'TEMP'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []),
  ),
};

describe('macOS ProcessCapsule kernel birth identity', () => {
  it('pins the complete 56-byte proc_uniqidentifierinfo ABI at compile time', () => {
    const source = fs.readFileSync('native/process-capsule/src/main.rs', 'utf8');

    expect(source).toMatch(/struct ProcUniqIdentifierInfo\s*\{/);
    expect(source).toContain('reserve3: u64');
    expect(source).toContain('reserve4: u64');
    expect(source).toMatch(/size_of::<ProcUniqIdentifierInfo>\(\)\s*==\s*56/);
    expect(source).toMatch(/align_of::<ProcUniqIdentifierInfo>\(\)\s*==\s*8/);
    expect(source).toContain('--controller-test-macos-birth-unavailable');
  });

  it.runIf(process.platform === 'darwin')(
    'keeps same-second processes distinct and sends zero signals for a foreign birth',
    async () => {
      const scope = createNativeProcessScope();
      const first = await scope.prepare(launch);
      const second = await scope.prepare(launch);
      try {
        const firstFields = nativePayload(first.ref).split('|');
        const secondFields = nativePayload(second.ref).split('|');
        expect(firstFields[3]).not.toBe(secondFields[3]);

        await expect(scope.terminate(withForeignControllerBirth(first.ref), {
          reason: 'foreign-birth oracle',
          graceMs: 10,
        })).resolves.toMatchObject({
          state: 'uncertain',
          gracefulAttempted: false,
        });
        await expect(scope.inspect(first.ref)).resolves.toMatchObject({
          state: 'prepared',
          controllable: true,
        });
      } finally {
        await first.abort('macOS identity oracle cleanup');
        await second.abort('macOS identity oracle cleanup');
      }
    },
    30_000,
  );

  it.runIf(process.platform === 'darwin')(
    'fails closed before activation when the kernel identity source is unavailable',
    async () => {
      const scope = createNativeProcessScope({
        controllerMode: '--controller-test-macos-birth-unavailable',
        controlTimeoutMs: 2_000,
      });
      await expect(scope.prepare(launch)).rejects.toMatchObject({
        code: 'containment-prepare-failed',
      });
    },
    10_000,
  );
});
