import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readAgentTurnInputManifest } from '../../src/commands/pipeline.js';

const roots: string[] = [];
const candidateId = `candidate:${'a'.repeat(64)}`;

function manifest(candidates: unknown): string {
  return JSON.stringify({ format: 'agent-turn-input-manifest/1', candidates });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pipeline admit private agent turn-input manifest', () => {
  it('reads exact multibyte prompt text keyed by a candidate identity', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-agent-input-'));
    roots.push(root);
    const inputPath = path.join(root, 'agent-turn-input.json');
    const prompt = 'trusted prompt\n雪';
    writeFileSync(inputPath, manifest([{ candidateId, prompt }]), 'utf8');

    expect(readAgentTurnInputManifest(inputPath, root)).toEqual(
      new Map([[candidateId, prompt]])
    );
  });

  it.each([
    ['invalid JSON', '{'],
    ['array top level', '[]'],
    ['wrong format', JSON.stringify({ format: 'other/1', candidates: [] })],
    ['unknown top-level key', JSON.stringify({ format: 'agent-turn-input-manifest/1', candidates: [], extra: true })],
    ['unknown entry key', manifest([{ candidateId, prompt: 'x', extra: true }])],
    ['malformed candidate', manifest([{ candidateId: 'candidate:wrong', prompt: 'x' }])],
    ['empty prompt', manifest([{ candidateId, prompt: '' }])],
  ])('rejects %s without accepting prompt authority', (_name, content) => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-agent-input-'));
    roots.push(root);
    const inputPath = path.join(root, 'agent-turn-input.json');
    writeFileSync(inputPath, content, 'utf8');

    expect(() => readAgentTurnInputManifest(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });

  it('rejects duplicate candidate identities as stale authority', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-agent-input-'));
    roots.push(root);
    const inputPath = path.join(root, 'agent-turn-input.json');
    writeFileSync(
      inputPath,
      manifest([
        { candidateId, prompt: 'first' },
        { candidateId, prompt: 'second' },
      ]),
      'utf8'
    );

    expect(() => readAgentTurnInputManifest(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'candidate_stale' })
    );
  });

  it('rejects files outside ephemera and symlink or directory leaves', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-agent-ephemera-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'rasen-agent-outside-'));
    roots.push(root, outside);
    const outsideFile = path.join(outside, 'agent-turn-input.json');
    writeFileSync(outsideFile, manifest([{ candidateId, prompt: 'x' }]), 'utf8');

    expect(() => readAgentTurnInputManifest(outsideFile, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );

    const linked = path.join(root, 'linked');
    symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() =>
      readAgentTurnInputManifest(path.join(linked, 'agent-turn-input.json'), root)
    ).toThrowError(expect.objectContaining({ code: 'invalid_run_request' }));

    const directoryLeaf = path.join(root, 'directory.json');
    mkdirSync(directoryLeaf);
    expect(() => readAgentTurnInputManifest(directoryLeaf, root)).toThrowError(
      expect.objectContaining({ code: 'invalid_run_request' })
    );
  });

  it('rejects a manifest above the two-megabyte transport bound', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rasen-agent-input-'));
    roots.push(root);
    const inputPath = path.join(root, 'agent-turn-input.json');
    writeFileSync(
      inputPath,
      manifest([{ candidateId, prompt: 'x'.repeat(2 * 1024 * 1024) }]),
      'utf8'
    );

    expect(() => readAgentTurnInputManifest(inputPath, root)).toThrowError(
      expect.objectContaining({ code: 'input_too_large' })
    );
  });
});
