import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  caseInsensitiveCollisions,
  copyTree,
  verifyTree,
  moveTreeVerified,
  renderSuggestedCommit,
  readAdoptionsManifest,
  upsertAdoptionEntry,
  removeAdoptionEntry,
} from '../../../src/core/store/migration.js';

describe('migration engine', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-migration-'));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects case-insensitive collisions on all platforms', () => {
    expect(caseInsensitiveCollisions(['Billing', 'auth'], ['billing', 'users'])).toEqual(['Billing']);
    expect(caseInsensitiveCollisions(['new'], ['old'])).toEqual([]);
  });

  it('copies then verifies a tree by count and size', async () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a.md'), 'hello');
    fs.writeFileSync(path.join(src, 'nested', 'b.md'), 'world!!');

    const dest = path.join(tempDir, 'dest');
    await copyTree(src, dest);
    const verify = await verifyTree(src, dest);
    expect(verify.ok).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'nested', 'b.md'), 'utf-8')).toBe('world!!');
  });

  it('verify fails on a size mismatch', async () => {
    const src = path.join(tempDir, 'src');
    const dest = path.join(tempDir, 'dest');
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.md'), 'hello');
    fs.writeFileSync(path.join(dest, 'a.md'), 'hi');
    const verify = await verifyTree(src, dest);
    expect(verify.ok).toBe(false);
    expect(verify.problems.join(' ')).toMatch(/size mismatch/);
  });

  it('moveTreeVerified deletes the source only after a passing verify', async () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'a.md'), 'content');
    const dest = path.join(tempDir, 'dest');
    await moveTreeVerified(src, dest);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(path.join(dest, 'a.md'), 'utf-8')).toBe('content');
  });

  it('renders a pathspec-scoped commit command without executing it', () => {
    const cmd = renderSuggestedCommit('/repo path', ['rasen'], 'chore: adopt', 'Source repo');
    expect(cmd).not.toBeNull();
    expect(cmd!.command).toContain('git -C');
    expect(cmd!.command).toContain('"/repo path"');
    expect(cmd!.command).toContain('add rasen');
    expect(renderSuggestedCommit('/repo', [], 'm', 'p')).toBeNull();
  });

  it('round-trips the adoption manifest', async () => {
    const storeRoot = tempDir;
    fs.mkdirSync(path.join(storeRoot, '.rasen-store'), { recursive: true });
    await upsertAdoptionEntry(storeRoot, 'pid-1', {
      specs: ['billing'],
      changes: ['add-thing'],
      sourcePath: '/some/repo',
      timestamp: new Date().toISOString(),
    });
    const manifest = await readAdoptionsManifest(storeRoot);
    expect(manifest?.adoptions['pid-1'].specs).toEqual(['billing']);

    await removeAdoptionEntry(storeRoot, 'pid-1');
    const after = await readAdoptionsManifest(storeRoot);
    expect(after?.adoptions['pid-1']).toBeUndefined();
  });
});
