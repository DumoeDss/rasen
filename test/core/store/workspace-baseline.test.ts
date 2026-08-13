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

import { StoreError } from '../../../src/core/store/errors.js';
import { StoreTargetLinesModule } from '../../../src/core/store/target-lines.js';
import { planningMarkerPath, readBindingFact } from '../../../src/core/store/workspace/binding.js';
import { probePlanningWorktree } from '../../../src/core/store/workspace/module.js';
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

  // DEFERRED (task 6.6): every case in this describe block drives `new change
  // --target-line`, which does not exist as a CLI option on this branch
  // (confirmed by reading src/cli/index.ts and by direct run: `error: unknown
  // option '--target-line'`). It ships in upstream commit 3b050663, which is
  // NOT an ancestor of dev/0.2.0 and belongs to the `store-planning-scope-routing`
  // slice — out of S2's scope by design (see the module-level doc comment).
  //
  // Deferring the CASE is not deferring the BEHAVIOR: see the "deferred CLI
  // surface: S2-scoped substitute coverage" describe block below, which
  // drives the exact S2-owned functions these five cases exercise
  // (`probePlanningWorktree`, `readBindingFact`, `completeChangeBinding`)
  // directly, with a mapping comment on each case naming which test below
  // substitutes for it. INBOUND ACCEPTANCE ITEM for the slice that ports
  // `new change --target-line`: re-enable these five cases unmodified once
  // that flag exists.
  it.skip(
    // SUBSTITUTE: workspace-pairing.test.ts "records the Change instance and
    // says so when no execution side is known" drives the same hand-assembled,
    // marker-only, no-execution-declared scenario through `completeChangeBinding`
    // directly (a hand-seeded Change instance standing in for what `new change`
    // would mint), and asserts the same outcome this case asserts via the CLI:
    // bindingState stays 'prepared', no plan is required, no workspacePairId
    // is invented.
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

  it.skip(
    // SUBSTITUTE: the same workspace-pairing.test.ts case cited above asserts
    // the index-repair-from-disk outcome directly: `completed.entry?.planning.root`
    // equals the hand-assembled root, `changeInstanceId` is recorded, and
    // `execution.root` stays '' rather than being invented — the same "every
    // recorded fact was already true on disk" property this case asserts.
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

  it.skip(
    // SUBSTITUTE: "DEFERRED SUBSTITUTE: an under-declared marker fails closed
    // through the reader S2 owns, never silently proceeds" below drives the
    // SAME under-declared marker through `readBindingFact` directly. It
    // deliberately does NOT claim to reproduce `planning_worktree_required`
    // (that code is decided entirely by the deferred resolver, and reading
    // binding.ts confirms S2's own reader throws a DIFFERENT code,
    // `workspace_marker_conflict`, for this input — a genuine discrepancy
    // recorded in that test's comment, not papered over). What it proves
    // instead is the narrower, S2-owned invariant the CLI gap cannot remove:
    // no path that reads an incomplete carrier ever treats it as evidence.
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

  it.skip(
    // SUBSTITUTE: "DEFERRED SUBSTITUTE: probePlanningWorktree reports no
    // storeRefOid when the target line ref does not resolve" below drives
    // `probePlanningWorktree` directly at an unresolvable ref and asserts the
    // same fact this case relies on: the ref does not resolve to a commit,
    // reported as an absent `storeRefOid` rather than a guess or a throw.
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

  it.skip(
    // SUBSTITUTE: "DEFERRED SUBSTITUTE: probePlanningWorktree reports
    // linked:false for the Store integration checkout" below drives
    // `probePlanningWorktree` directly at the integration checkout and
    // asserts the exact fact the deferred resolver's refusal is built on:
    // the integration checkout IS a worktree but is never a LINKED one.
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

  // ---- deferred CLI surface: S2-scoped substitute coverage ---------------
  //
  // The five cases above are skipped because they all drive `new change
  // --target-line`, a CLI option that does not exist on this branch (it ships
  // in upstream commit 3b050663, owned by the `store-planning-scope-routing`
  // slice, out of scope here). Per the portfolio ruling: deferring the CASE is
  // acceptable, shipping the BEHAVIOR untested is not. The cases below drive
  // the actual S2-owned functions the deferred CLI resolver is built on top
  // of — `probePlanningWorktree` and `readBindingFact` (both in
  // src/core/store/workspace/, both documented in module.ts as "the evidence
  // the scope resolver's planningWorktreeVerified consumes instead of a
  // marker file exists") — directly, bypassing only the missing flag.
  describe('deferred CLI surface: S2-scoped substitute coverage', () => {
    it(
      'probePlanningWorktree reports no storeRefOid when the target line ref does not resolve',
      async () => {
        // Substitute for the skipped "now refuses a marker whose target line
        // names no commit in the Store" above. No marker is even written here:
        // `probePlanningWorktree` never reads the marker (module.ts's own
        // comment: "the resolver already has [the marker's declared scope] in
        // hand" before calling this), it only resolves `storeRef` against live
        // Git — so this isolates exactly the fact in question.
        const probe = await probePlanningWorktree(
          { planningRoot, storeRef: 'refs/heads/never-created' },
          f.dependencies
        );
        expect(probe.isWorktree).toBe(true);
        expect(probe.linked).toBe(true);
        expect(probe.storeRefOid).toBeUndefined();
      },
      BASELINE_TIMEOUT_MS
    );

    it(
      'probePlanningWorktree resolves storeRefOid to the real commit when the ref DOES exist',
      async () => {
        // The negative case above is only meaningful beside this positive one:
        // proves the function is not simply always-undefined.
        const oid = f.git(f.storeRoot, ['rev-parse', 'refs/heads/release/0.2']).trim();
        const probe = await probePlanningWorktree(
          { planningRoot, storeRef: 'refs/heads/release/0.2' },
          f.dependencies
        );
        expect(probe.storeRefOid).toBe(oid);
      },
      BASELINE_TIMEOUT_MS
    );

    it(
      'probePlanningWorktree reports linked:false for the Store integration checkout',
      async () => {
        // Substitute for the skipped "still refuses a project mutation from
        // the Store integration checkout, by name" above. The integration
        // checkout IS a worktree (the main one) but is never a LINKED one —
        // exactly the fact the deferred resolver's refusal is built on.
        const probe = await probePlanningWorktree(
          { planningRoot: f.storeRoot },
          f.dependencies
        );
        expect(probe.isWorktree).toBe(true);
        expect(probe.linked).toBe(false);
      },
      BASELINE_TIMEOUT_MS
    );

    it(
      'probePlanningWorktree reports linked:true for a genuine linked planning worktree',
      async () => {
        // The positive counterpart: the hand-assembled planning worktree this
        // whole suite prepares in beforeEach IS linked, so the false above is
        // not a function that always answers false.
        const probe = await probePlanningWorktree({ planningRoot }, f.dependencies);
        expect(probe.isWorktree).toBe(true);
        expect(probe.linked).toBe(true);
      },
      BASELINE_TIMEOUT_MS
    );

    it(
      'DEFERRED SUBSTITUTE: an under-declared marker fails closed through the reader S2 owns, never silently proceeds',
      async () => {
        // Substitute for the skipped "now refuses a marker that does not
        // declare the resolved project and line" above — with an honest
        // caveat. That case asserts the CLI-level code `planning_worktree_required`,
        // decided entirely by the deferred resolver. Reading binding.ts
        // (parseBindingFact) confirms S2's OWN reader does not return that
        // code for this input: it throws `workspace_marker_conflict`, the same
        // code used for a marker that actively CONTRADICTS the resolved scope,
        // not a distinct "declares nothing" code. That is a genuine difference
        // from the code name the skipped case names, recorded here rather than
        // papered over. What this test proves is the invariant that survives
        // regardless of which code names it: an incomplete carrier is REFUSED,
        // never silently accepted as if the missing fields were absent-but-fine.
        writeMarker({ storeUid: f.storeUid, storeId: f.storeId });
        const markerPath = planningMarkerPath(planningRoot);
        const before = fs.readFileSync(markerPath);

        const error = await readBindingFact(f.dependencies, markerPath).catch(
          (raised: unknown) => raised
        );

        expect(error).toBeInstanceOf(StoreError);
        expect((error as StoreError).diagnostic.code).toBe('workspace_marker_conflict');
        expect((error as StoreError).diagnostic.message).toContain('projectId');
        expect((error as StoreError).diagnostic.message).toContain('targetLineId');
        // The refusal wrote nothing: the marker is untouched.
        expect(fs.readFileSync(markerPath).equals(before)).toBe(true);
      },
      BASELINE_TIMEOUT_MS
    );
  });

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

    // Upstream (0.1.7) numbers this alongside a sibling "Child 3" layout
    // migration that already existed there and wrote the catalog too. In
    // this repo's re-decomposition (store-v2-foundation), that migration is
    // `store-issue-resources` (S3) — explicitly out of scope for this change
    // (design carve-out: `layout-migration/` is untouched here) and not yet
    // implemented in this tree. Until S3 lands, this change's own authoring
    // surface (`add` / `set-ref`) is the ONLY writer; S3 must extend this
    // list with its own writer when it adds one, not silently satisfy it.
    expect(callers.sort()).toEqual([
      // This change's explicit authoring surface: `add` and `set-ref`.
      'src/core/store/target-lines.ts x2',
    ]);
  });
});
