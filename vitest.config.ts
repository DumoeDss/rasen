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
  // Same class again (fix-store-workspace-pair-transactions, task 1.5): thirteen
  // real-Git scenarios that prepare, tear down, and re-prepare a pair, several
  // of them building three worktrees. 25KB of source implies a 2.5s fallback;
  // measured solo on Windows at 167.8s in this shape, and at 201.7s in an
  // intermediate shape carrying two extra cases. The higher figure is not
  // entered because it is not an observation of the file as it ships; the
  // measured 167.8s is rounded up instead. Do not lower it without re-measuring
  // on a quiesced tree -- under-entering a heavy file skews the whole shard,
  // over-entering only costs balance.
  'test/core/store/workspace-repreparation.test.ts': 169000,
  // Real Git fixture (`createStoreWorkspaceFixture`) driven through both the
  // in-process handlers and a `runCLI` subprocess per test (store-issue-resources).
  'test/core/management-api/stores.test.ts': 199980,
  // Six real-Git Store/Issue/link scenarios, including a daemon route and
  // repeated byte-parity reads (issue-operations-and-unlinked, task 4.4).
  // Measured at ~241s solo wall-clock on Windows (198s test body).
  'test/core/management-api/change-issue-links.test.ts': 241000,
  // Same real-Git fixture class (a two-revision Issue plus a damaged plan
  // revision built per test), the in-process projection handlers, and a
  // `startManagementServer` + six `runCLI` subprocess pairs for the byte-parity
  // witness (issue-read-surface, task 3.4). Measured at ~230s solo on Windows.
  'test/core/management-api/issue-projection.test.ts': 240000,
  // Same fixture class, plus 26 scenario cases that each commit real Git
  // objects (store-issue-resources, task 8.5): a wide relative-size gap from
  // the 38KB source file to this solo wall-clock is expected, not a fluke.
  // Measured TWICE, 1.8x apart on the same machine: 314950ms under task 8.1
  // and 177060ms under task 8.5. The higher observation is entered, for the
  // same reason task 8.5 flags `workspace-cleanup` above as under-entered --
  // a shard planner that underestimates a heavy file skews the whole shard,
  // whereas overestimating it only costs balance. Do not lower this to the
  // faster observation without re-measuring on a quiesced tree.
  'test/core/store/store-aggregate-query.test.ts': 314950,
  // Eleven real-Git legacy flat Stores, several driven through the shipped
  // `store migrate-layout` command handler rather than the Module directly
  // (rehearse-legacy-store-layout-migration, task 4.3). Measured at 91760ms
  // solo on Windows with VITEST_MAX_WORKERS=1; the source-size fallback would
  // have guessed ~1600ms, which is the skew this table exists to prevent.
  'test/core/store/layout-migration-empty-store.test.ts': 92000,
  // `runCLI` subprocess per case, same underestimated class as the two
  // `workspace-*` CLI entries above (store-issue-resources, task 8.5).
  'test/commands/store-issue-cli.test.ts': 76790,
  'test/commands/store-aggregate-cli.test.ts': 62300,
  // Real Git fixture, no CLI subprocess, but still a real worktree/lock
  // read per case (store-issue-resources, task 8.5).
  'test/core/store/store-query-lock-free.test.ts': 52290,
  // Smallest absolute cost of this change's entries, but the worst RELATIVE
  // skew in the table: 5949 bytes of source implies a 595ms fallback, while
  // three of its five cases each build a real second Git worktree, measured
  // twice at 16150ms and 15960ms solo (store-issue-resources, task 8.5). The
  // higher observation is entered deliberately — under-entering is the failure
  // mode the `workspace-cleanup` entry above already demonstrates.
  'test/core/store/store-issue-scope.test.ts': 16150,
  // issue-acceptance-close: three real-Git-fixture suites and one runCLI
  // subprocess-per-case CLI suite, the same underestimated classes as the
  // entries above. The CLI file was measured twice: 145128ms during fix round
  // 1 under a warm tree and 194524ms solo on the reviewer's pass — the
  // HIGHER observation is entered (review round 1, Info-5), for the same
  // reason as `store-aggregate-query` above: underestimating a spawn-heavy
  // file skews the whole shard, overestimating only costs balance.
  'test/core/store/store-issue-acceptance-content.test.ts': 1100,
  'test/core/store/store-issue-acceptance-mutations.test.ts': 24000,
  'test/core/issue-acceptance/issue-acceptance-gate.test.ts': 45000,
  'test/commands/store-issue-acceptance-cli.test.ts': 200000,
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
