import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineStartInputs } from '../../src/commands/pipeline.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pipeline start internal input-file bridge', () => {
  it('reads a bounded UTF-8 JSON object from a path with spaces and non-ASCII text', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen 输入 bridge '));
    roots.push(root);
    const inputPath = path.join(root, '任务 输入.json');
    writeFileSync(inputPath, JSON.stringify({ taskLoop: { goal: '修复结果' } }), 'utf8');

    const inputs = readPipelineStartInputs(inputPath, root);

    expect(inputs).toEqual({ taskLoop: { goal: '修复结果' } });
    expect(Object.isFrozen(inputs)).toBe(true);
    expect(Object.isFrozen(inputs.taskLoop)).toBe(true);
  });

  it.each([
    ['not-json.json', '{'],
    ['array.json', '[]'],
  ])('rejects invalid bridge content in %s', (filename, content) => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-input-'));
    roots.push(root);
    const inputPath = path.join(root, filename);
    writeFileSync(inputPath, content, 'utf8');

    expect(() => readPipelineStartInputs(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });

  it('rejects a file outside the resolved ephemera root', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-ephemera-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'rasen-outside-'));
    roots.push(root, outside);
    const inputPath = path.join(outside, 'input.json');
    writeFileSync(inputPath, '{}', 'utf8');

    expect(() => readPipelineStartInputs(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });

  it('rejects symlink or junction traversal and non-regular leaves', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-ephemera-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'rasen-outside-'));
    roots.push(root, outside);
    writeFileSync(path.join(outside, 'input.json'), '{}', 'utf8');
    const linked = path.join(root, 'linked');
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => readPipelineStartInputs(path.join(linked, 'input.json'), root))
      .toThrowError(expect.objectContaining({ code: 'invalid_run_request' }));

    const directoryLeaf = path.join(root, 'directory.json');
    mkdirSync(directoryLeaf);
    expect(() => readPipelineStartInputs(directoryLeaf, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });

  it('rejects content above the one-megabyte bridge limit', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-ephemera-'));
    roots.push(root);
    const inputPath = path.join(root, 'large.json');
    writeFileSync(inputPath, `{"value":"${'x'.repeat(1024 * 1024)}"}`, 'utf8');

    expect(() => readPipelineStartInputs(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });
});
