import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveTestInclude } from '../vitest.config.js';
const repositoryRoot = process.cwd();
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'ci.yml');

function workflowText(): string {
  return fs.readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n');
}

function jobBlock(source: string, job: string, nextJob: string): string {
  const start = source.indexOf(`  ${job}:\n`);
  const end = source.indexOf(`  ${nextJob}:\n`, start + 1);
  expect(start, `missing ${job} job`).toBeGreaterThanOrEqual(0);
  expect(end, `missing ${nextJob} boundary`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function listTestFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTestFiles(absolute);
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) return [];
    return [path.relative(repositoryRoot, absolute).split(path.sep).join('/')];
  }).sort();
}

describe('CI workflow contract', () => {
  it('runs the explicit archive recovery suite at the Node floor on three native hosts', () => {
    const source = workflowText();
    expect(source).toContain('  pull_request:');
    expect(source).toContain('  merge_group:');

    const block = jobBlock(source, 'file_placement_recovery', 'test_pr_required');
    for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
      expect(block).toContain(`- os: ${os}`);
    }
    expect(block).toContain("node-version: '20.19.0'");
    expect(block).toContain('VITEST_MAX_WORKERS: 1');
    for (const file of [
      'test/core/archive-engine.test.ts',
      'test/core/archive-fault-matrix.test.ts',
      'test/core/archive-path-semantics.test.ts',
      'test/core/archive-accounting.test.ts',
      'test/core/archive-ephemera.test.ts',
      'test/core/ephemera-cleaner.test.ts',
    ]) {
      expect(block).toContain(file);
    }
  });

  it('makes every required aggregate depend on general and native recovery matrices', () => {
    const source = workflowText();
    for (const [job, next] of [
      ['test_pr_required', 'lint'],
      ['required-checks-pr', 'required-checks-main'],
      ['required-checks-main', '__end__'],
    ] as const) {
      const block = next === '__end__'
        ? source.slice(source.indexOf(`  ${job}:\n`))
        : jobBlock(source, job, next);
      expect(block).toContain('test_matrix');
      expect(block).toContain('file_placement_recovery');
      expect(block).toContain('needs.file_placement_recovery.result');
    }
  });

  it('partitions the discovered test manifest deterministically with exact disjoint coverage', () => {
    const manifest = listTestFiles(path.join(repositoryRoot, 'test'));
    const partitions = Array.from({ length: 8 }, (_, index) =>
      resolveTestInclude(repositoryRoot, `${index + 1}/8`)
    );
    const flattened = partitions.flat();

    expect([...flattened].sort()).toEqual(manifest);
    expect(new Set(flattened).size).toBe(flattened.length);
    expect(resolveTestInclude(repositoryRoot, '3/8')).toEqual(partitions[2]);
  });

});
