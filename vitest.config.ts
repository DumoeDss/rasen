import { defineConfig } from 'vitest/config';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function resolveMaxWorkers(): number | undefined {
  // Allow callers (CI/agents) to override without editing config.
  const raw = process.env.VITEST_MAX_WORKERS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  // Vitest v3 defaults to `pool: "forks"` and scales worker processes with CPU.
  // This repo's tests can spawn many Node processes (CLI invocations, temp FS),
  // so cap parallelism to avoid runaway CPU/memory usage in automation.
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.min(4, Math.max(1, cpuCount));
}

interface TestFile {
  path: string;
  size: number;
}

// Fresh Windows runners have no Vitest timing cache. These coarse weights come
// from a representative full CI run and keep the CLI-heavy files from landing
// in one partition. Unknown files use source size as a stable fallback below;
// stale weights can affect balance, never partition completeness.
const KNOWN_SLOW_TEST_WEIGHTS_MS: Record<string, number> = {
  'test/commands/pipeline.test.ts': 229054,
  'test/commands/artifact-workflow.test.ts': 123278,
  'test/commands/store-identity-cli.test.ts': 90384,
  'test/commands/workset.test.ts': 81472,
  'test/commands/store-remote.test.ts': 69621,
  'test/commands/doctor.test.ts': 68181,
  'test/commands/store.test.ts': 63978,
  'test/commands/store-root-selection.test.ts': 47885,
  'test/cli-e2e/basic.test.ts': 43381,
  'test/commands/store-membership-cli.test.ts': 39865,
  'test/cli-e2e/store-lifecycle.test.ts': 29629,
  'test/core/update.test.ts': 29528,
  'test/commands/store-references.test.ts': 26553,
  'test/commands/store-add-project.test.ts': 24960,
  'test/core/init.test.ts': 23643,
  'test/commands/pipeline-store-root-selection.test.ts': 23577,
  'test/core/knowledge-bundle/store-transport.test.ts': 21973,
  'test/commands/declared-store-fallback.test.ts': 21054,
  'test/core/store/bootstrap-obtain.test.ts': 20983,
  'test/commands/agent-wait.test.ts': 19461,
  'test/commands/daemon-lifecycle.test.ts': 19184,
  'test/commands/validate.test.ts': 18895,
  'test/cli-e2e/agent-audit.test.ts': 17820,
  'test/cli-e2e/workset-journey.test.ts': 17306,
  'test/commands/context.test.ts': 15996,
  'test/commands/config.test.ts': 15669,
  'test/commands/legacy-groups-removed.test.ts': 15604,
  'test/core/management-api/workflow-enablement.test.ts': 15371,
  'test/commands/work.test.ts': 14611,
  'test/core/management-api/space-scoping.test.ts': 13318,
  // Real Git worktrees + real filesystem fixtures (store-worktree-bindings-v2,
  // task 6.9): the byte-size heuristic badly underestimates these, because the
  // cost is worktree creation/removal wall-clock time, not source size.
  'test/core/store/workspace-cleanup.test.ts': 166610,
  'test/commands/workspace-cli.test.ts': 166960,
  'test/core/store/workspace-apply.test.ts': 109103,
};

function listTestFiles(directory: string, root: string): TestFile[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTestFiles(absolutePath, root);
    if (!entry.isFile() || !entry.name.endsWith('.test.ts')) return [];
    return [{
      path: path.relative(root, absolutePath).split(path.sep).join('/'),
      size: fs.statSync(absolutePath).size,
    }];
  });
}

export function resolveTestInclude(
  root = process.cwd(),
  partition = process.env.VITEST_FILE_PARTITION
): string[] {
  if (!partition) return ['test/**/*.test.ts'];

  const match = /^(\d+)\/(\d+)$/.exec(partition);
  if (!match) {
    throw new Error('VITEST_FILE_PARTITION must use the format <index>/<count>');
  }

  const index = Number(match[1]);
  const count = Number(match[2]);
  if (index < 1 || count < 1 || index > count) {
    throw new Error('VITEST_FILE_PARTITION index must be between 1 and count');
  }

  const files = listTestFiles(path.join(root, 'test'), root).sort(
    (left, right) => right.size - left.size || left.path.localeCompare(right.path)
  );
  const baseCapacity = Math.floor(files.length / count);
  const extraSlots = files.length % count;
  const partitions = Array.from({ length: count }, (_, partitionIndex) => ({
    capacity: baseCapacity + (partitionIndex < extraSlots ? 1 : 0),
    weight: 0,
    files: [] as string[],
  }));

  for (const file of files) {
    const weight = KNOWN_SLOW_TEST_WEIGHTS_MS[file.path] ?? Math.max(1, file.size / 10);
    const target = partitions
      .map((candidate, partitionIndex) => ({ candidate, partitionIndex }))
      .filter(({ candidate }) => candidate.files.length < candidate.capacity)
      .sort(
        (left, right) =>
          left.candidate.weight - right.candidate.weight ||
          left.partitionIndex - right.partitionIndex
      )[0].candidate;
    target.files.push(file.path);
    target.weight += weight;
  }

  return partitions[index - 1].files.sort();
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: './vitest.setup.ts',
    setupFiles: ['./test/setup-reset-diagnostics.ts'],
    // Tests rely on per-file process isolation (e.g., `process.cwd()` assumptions).
    pool: 'forks',
    maxWorkers: resolveMaxWorkers(),
    include: resolveTestInclude(),
    // `expectTypeOf` is a runtime no-op, and the root tsconfig excludes `test/`,
    // so type-level assertions living in `*.test.ts` cannot fail — nothing in
    // this repository type-checks them. `*.test-d.ts` files are checked instead,
    // under a tsconfig scoped to exactly those files plus `src/`. Disabled by
    // default (so `pnpm test` is unchanged); `pnpm run test:types` enables it.
    typecheck: {
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.typecheck.json',
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'bin/',
        '*.config.ts',
        'build.js',
        'test/**'
      ]
    },
    // CLI-spawning tests slow down under CI parallel load (subprocess startup +
    // FS contention); 10s was too tight and produced spurious timeouts there.
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 3000
  }
});
