/**
 * `store-planning-worktree-bindings` task 1.2 — RETROSPECTIVE baseline.
 *
 * The task as written captures behavior "before anything moves". The
 * production code has already moved, so a literal before-snapshot is no longer
 * possible and reconstructing the old resolver into a test would assert code
 * that no longer ships. Following the shape child 3 used for its own 1.2, this
 * suite is retrospective: it captures what the pre-change paths STILL do — the
 * behavior this change deliberately preserves — and the current truth where the
 * task's original wording has been overtaken.
 *
 * The task named three things. Here is what each one became:
 *
 *   1. "the marker-only planning-worktree acceptance" — PRESERVED, and asserted
 *      here. A pair assembled by hand, with nothing but a marker and live Git,
 *      still authorizes a project mutation: none of this change's machinery
 *      (a plan, a token, an index entry, an execution association) is required
 *      to reach the gate. What this change DID narrow is asserted beside it, so
 *      the suite states the tightening rather than implying nothing changed.
 *   2. "the `planning_worktree_required` refusal from an integration checkout" —
 *      PRESERVED, and asserted here by code name, with the integration checkout
 *      byte-identical afterwards.
 *   3. "the absence of any target-line writer" — ENDED BY THIS CHANGE, so it is
 *      NOT asserted. Asserting it would be asserting something now false. The
 *      current truth is asserted instead: which surfaces write a target-line
 *      catalog, and that no others do.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StoreTargetLinesModule } from '../../../src/core/store/target-lines.js';
import { runCLI, type RunCLIResult } from '../../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE = 'line-0.2';
const CHANGE = 'baseline-change';
const BASELINE_TIMEOUT_MS = 60_000;

function parseJson(result: RunCLIResult): any {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Could not parse JSON.\nCommand: ${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${String(error)}`
    );
  }
}

function expectOk(result: RunCLIResult): RunCLIResult {
  expect(
    result.exitCode,
    `${result.command}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  ).toBe(0);
  return result;
}

/** Every working-tree file under `root`, excluding `.git`. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      out[path.relative(root, absolute).split(path.sep).join('/')] = fs
        .readFileSync(absolute)
        .toString('base64');
    }
  };
  walk(root);
  return out;
}

describe('workspace baseline: what this change preserved, and what it changed', () => {
  let f: StoreWorkspaceFixture;
  let planningRoot: string;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-workspace-baseline-',
      projects: [PROJECT],
      storeBranches: ['release/0.2'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
    // A planning worktree assembled BY HAND, exactly as an operator would have
    // had to before this change existed: `git worktree add` plus a marker. No
    // plan, no token, no index entry, no execution association.
    planningRoot = f.beside('hand-assembled-planning');
    f.git(f.storeRoot, [
      'worktree',
      'add',
      '-b',
      'planning-line-0-2',
      planningRoot,
      'refs/heads/release/0.2',
    ]);
    planningRoot = fs.realpathSync.native(planningRoot);
  });

  afterEach(() => {
    f.cleanup();
  });

  function writeMarker(fields: Record<string, unknown>): void {
    f.write(
      path.join(planningRoot, '.rasen', 'planning-line.json'),
      `${JSON.stringify({ version: 1, ...fields }, null, 2)}\n`
    );
  }

  function healthyMarker(): void {
    writeMarker({
      storeUid: f.storeUid,
      storeId: f.storeId,
      projectId: PROJECT,
      targetLineId: LINE,
    });
  }

  function newChange(cwd: string, changeId = CHANGE): Promise<RunCLIResult> {
    return runCLI(
      [
        'new',
        'change',
        changeId,
        '--json',
        '--store',
        f.storeId,
        '--project',
        PROJECT,
        '--target-line',
        LINE,
      ],
      { cwd, env: f.env }
    );
  }

  function machineRoot(): string {
    return path.join(f.globalDataDir, 'planning-workspaces');
  }

  // ---- 1. the marker path still authorizes, unaided ----------------------

  it(
    'still accepts a hand-assembled marker-only planning worktree, with none of this change machinery',
    async () => {
      healthyMarker();
      // Nothing this change adds exists yet: no plan, no index, no lock.
      expect(fs.existsSync(machineRoot())).toBe(false);
      expect(
        fs.existsSync(path.join(planningRoot, '.rasen', 'planning-binding.json'))
      ).toBe(false);

      const created = expectOk(await newChange(planningRoot));

      // The mutation was authorized by the marker plus live Git alone, and the
      // Change landed in the planning worktree's own project partition.
      expect(parseJson(created).change.path).toBe(
        path.join(planningRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE)
      );
      // No plan was ever produced: the machinery is available, not required.
      expect(fs.existsSync(path.join(machineRoot(), 'plans'))).toBe(false);
    },
    BASELINE_TIMEOUT_MS
  );

  it(
    'indexes the hand-assembled pair on first use, from what is already true on disk',
    async () => {
      healthyMarker();
      expectOk(await newChange(planningRoot));

      const indexPath = path.join(
        machineRoot(),
        'index',
        `${f.planningScopeId(PROJECT, LINE)}.json`
      );
      expect(fs.existsSync(indexPath), `expected an index entry at ${indexPath}`).toBe(true);
      const document = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as {
        entries: Array<{
          changeId: string;
          changeInstanceId?: string;
          workspacePairId?: string;
          planning: { root: string; ref: string };
          execution: { root: string };
        }>;
      };
      const entry = document.entries.find((candidate) => candidate.changeId === CHANGE);
      // Every recorded fact was already true on disk before the entry existed.
      expect(entry?.planning.root).toBe(planningRoot);
      expect(entry?.planning.ref).toBe('refs/heads/planning-line-0-2');
      expect(entry?.changeInstanceId).toMatch(/^ci_[0-9a-f]{64}$/u);
      // Nothing invented an execution side: there is no execution checkout in
      // scope, so it stays empty and the pair identity stays incomplete.
      expect(entry?.execution.root).toBe('');
      expect(entry?.workspacePairId).toBeUndefined();
    },
    BASELINE_TIMEOUT_MS
  );

  // ---- 2. what this change deliberately narrowed -------------------------

  it(
    'now refuses a marker that does not declare the resolved project and line',
    async () => {
      // This is the tightening, stated rather than implied: marker PRESENCE was
      // sufficient before this change and is not any more. It is a refusal, not
      // a repair, and it writes nothing.
      //
      // The code is `planning_worktree_required`, not `workspace_marker_conflict`,
      // and the distinction is deliberate: a marker that declares NOTHING about
      // the scope contributes no evidence, so the worktree is simply not
      // verified for the scope the command resolved. `workspace_marker_conflict`
      // is reserved for a marker that declares something CONTRADICTORY, which
      // `workspace-binding.test.ts` and `workspace-pairing.test.ts` cover.
      writeMarker({ storeUid: f.storeUid, storeId: f.storeId });

      const refused = await newChange(planningRoot);

      expect(refused.exitCode).toBe(1);
      expect(parseJson(refused).status[0].code).toBe('planning_worktree_required');
      expect(
        fs.existsSync(path.join(planningRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE))
      ).toBe(false);
    },
    BASELINE_TIMEOUT_MS
  );

  it(
    'now refuses a marker whose target line names no commit in the Store',
    async () => {
      // The other half of the tightening: a marker may not authorize a line
      // that does not resolve. The catalog is re-pointed at a ref that does not
      // exist, so the line the marker names is unresolvable.
      healthyMarker();
      f.writeTargetLine({
        id: LINE,
        storeRef: 'refs/heads/never-created',
        codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
      });
      f.git(f.storeRoot, ['add', '.']);
      f.git(f.storeRoot, ['commit', '-m', 'repoint the line at a ref that does not exist']);
      f.git(planningRoot, ['merge', '--ff-only', 'main']);

      const refused = await newChange(planningRoot);

      expect(refused.exitCode).toBe(1);
      expect(parseJson(refused).status[0].code).toBe('planning_worktree_required');
      expect(
        fs.existsSync(path.join(planningRoot, 'rasen', 'projects', PROJECT, 'changes', CHANGE))
      ).toBe(false);
    },
    BASELINE_TIMEOUT_MS
  );

  // ---- 3. the integration checkout is still never authorized -------------

  it(
    'still refuses a project mutation from the Store integration checkout, by name',
    async () => {
      healthyMarker();
      const before = snapshot(f.storeRoot);

      const refused = await newChange(f.storeRoot);

      expect(refused.exitCode).toBe(1);
      expect(parseJson(refused).status[0].code).toBe('planning_worktree_required');
      // The integration checkout is byte-identical and gained no partition.
      expect(snapshot(f.storeRoot)).toEqual(before);
      expect(
        fs.existsSync(path.join(f.storeRoot, 'rasen', 'projects', PROJECT, 'changes'))
      ).toBe(false);
    },
    BASELINE_TIMEOUT_MS
  );

  // ---- 4. the target-line writer, as it is NOW ---------------------------

  it(
    'has a target-line writer now, which is the fact this change changed',
    async () => {
      // Task 1.2 asked for "the absence of any target-line writer". That
      // absence is what this change ended, so the assertion here is the
      // current truth: the writer exists, it writes exactly one catalog at the
      // layout-contract path, and it stages nothing.
      const catalogPath = f.at('.rasen-store', 'target-lines', 'line-0.3.yaml');
      expect(fs.existsSync(catalogPath)).toBe(false);

      const record = await new StoreTargetLinesModule(f.dependencies).add({
        store: f.storeId,
        startPath: f.storeRoot,
        globalDataDir: f.globalDataDir,
        targetLineId: 'line-0.3',
        storeRef: 'refs/heads/main',
      });

      expect(record.path).toBe(catalogPath);
      expect(fs.readFileSync(catalogPath, 'utf8')).toContain('storeRef: refs/heads/main');
      expect(f.git(f.storeRoot, ['diff', '--cached', '--name-only'])).toBe('');
    },
    BASELINE_TIMEOUT_MS
  );

  it('has exactly two target-line catalog writers in the whole tree', () => {
    // Every catalog write goes through the Foundation serializer, so its call
    // sites are the writer set. (A hand-rolled YAML writer would evade this;
    // the catalog contract exists precisely so that nobody writes one.)
    const srcRoot = path.join(process.cwd(), 'src');
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(absolute);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        const text = fs.readFileSync(absolute, 'utf8');
        const calls = text
          .split('\n')
          .filter(
            (line) =>
              line.includes('serializeStoreTargetLineCatalogV1(') &&
              !line.includes('export function') &&
              !line.trimStart().startsWith('import') &&
              !line.trimStart().startsWith('*')
          );
        if (calls.length > 0) {
          callers.push(
            `${path.relative(process.cwd(), absolute).split(path.sep).join('/')} x${calls.length}`
          );
        }
      }
    };
    walk(srcRoot);

    expect(callers.sort()).toEqual([
      // Child 3's layout migration, which writes the catalogs named by the
      // committed mapping file. This was the ONLY writer before this change.
      'src/core/store/layout-migration/plan.ts x1',
      // This change's explicit authoring surface: `add` and `set-ref`.
      'src/core/store/target-lines.ts x2',
    ]);
  });
});
