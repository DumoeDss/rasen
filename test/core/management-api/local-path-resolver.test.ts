import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveLocalPath } from '../../../src/core/management-api/local-path-resolver.js';
import { cleanupTempPathAsync } from '../../helpers/temp-cleanup.js';

describe('resolveLocalPath', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.realpathSync.native(
      fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'rasen-resolve-path-'))
    );
    file = path.join(dir, 'package.rasenpkg');
    fs.writeFileSync(file, 'fixture');
  });

  afterEach(() => cleanupTempPathAsync(dir));

  it('canonicalizes directories and returns the native separator', async () => {
    const result = await resolveLocalPath(path.join(dir, '.'), 'directory');
    expect(result).toEqual({
      ok: true,
      response: { path: dir, kind: 'directory', separator: path.sep },
    });
  });

  it('accepts files and file-or-directory kinds', async () => {
    const selectedFile = await resolveLocalPath(file, 'file');
    expect(selectedFile.ok).toBe(true);
    if (selectedFile.ok) expect(selectedFile.response.kind).toBe('file');
    expect((await resolveLocalPath(dir, 'file-or-directory')).ok).toBe(true);
    expect((await resolveLocalPath(file, 'file-or-directory')).ok).toBe(true);
  });

  it('rejects kind mismatches, bad kinds, relative/control paths, and missing paths', async () => {
    const cases = [
      await resolveLocalPath(dir, 'file'),
      await resolveLocalPath(file, 'directory'),
      await resolveLocalPath(dir, 'other'),
      await resolveLocalPath('relative', 'directory'),
      await resolveLocalPath(`${dir}\u0000bad`, 'directory'),
      await resolveLocalPath(`${dir}\tbad`, 'directory'),
      await resolveLocalPath(`${dir}\nbad`, 'directory'),
      await resolveLocalPath(`${dir}\u007fbad`, 'directory'),
      await resolveLocalPath(path.join(dir, 'missing'), 'directory'),
    ];
    expect(cases.every((result) => !result.ok)).toBe(true);
    expect(cases.map((result) => (result.ok ? 0 : result.status))).toEqual([
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      400,
      404,
    ]);
  });

  it('stats the canonical target and fails closed if it disappears after realpath', async () => {
    const canonical = path.join(dir, 'canonical-target');
    const stat = vi.fn().mockRejectedValue(
      Object.assign(new Error('replaced after realpath'), { code: 'ENOENT' })
    );
    const disappeared = await resolveLocalPath(file, 'file', {
      realpath: vi.fn().mockResolvedValue(canonical),
      stat,
    });
    expect(stat).toHaveBeenCalledWith(canonical);
    expect(disappeared).toMatchObject({
      ok: false,
      status: 404,
      code: 'path_not_found',
    });

    const canonicalDirectory = await resolveLocalPath(file, 'directory', {
      realpath: vi.fn().mockResolvedValue(dir),
      stat: vi.fn().mockResolvedValue(fs.statSync(dir)),
    });
    expect(canonicalDirectory).toEqual({
      ok: true,
      response: { path: dir, kind: 'directory', separator: path.sep },
    });
  });

  it.runIf(process.platform === 'win32')(
    'resolves drive-letter case variants to one native path',
    async () => {
      const variant = `${dir[0]?.toLowerCase()}${dir.slice(1)}`;
      const result = await resolveLocalPath(variant, 'directory');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.response.path).toBe(fs.realpathSync.native(dir));
    }
  );
});
