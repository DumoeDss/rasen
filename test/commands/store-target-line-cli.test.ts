/**
 * `store-planning-worktree-bindings` task 11.7 — `rasen store target-line`.
 *
 * The Module suite proves the rules; this proves the ADAPTER: that every flag
 * reaches the Module, that `--json` carries the same content as the human form,
 * that a refusal exits 1 with one JSON document, and that the commit suggestion
 * a Git-tracked write prints is real.
 */
import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCLI, type RunCLIResult } from '../helpers/run-cli.js';
import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../helpers/store-workspace-fixture.js';

const PROJECT = 'app-a';
const LINE_02 = 'line-0.2';
const LINE_03 = 'line-0.3';

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

describe('rasen store target-line CLI', () => {
  let f: StoreWorkspaceFixture;

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-target-line-cli-',
      projects: [PROJECT],
      storeBranches: ['release/0.2', 'release/0.3'],
      projectBranches: ['release/0.2'],
      lines: [
        {
          id: LINE_02,
          storeRef: 'refs/heads/release/0.2',
          codeRefs: { [PROJECT]: 'refs/heads/release/0.2' },
        },
      ],
    });
  });

  afterEach(() => {
    f.cleanup();
  });

  function run(argv: readonly string[]): Promise<RunCLIResult> {
    return runCLI([...argv], { cwd: f.storeRoot, env: f.env });
  }

  it('threads every add flag through to the catalog and suggests the commit', async () => {
    const json = parseJson(
      expectOk(
        await run([
          'store',
          'target-line',
          'add',
          LINE_03,
          '--store',
          f.storeId,
          '--store-ref',
          'refs/heads/release/0.3',
          '--project',
          PROJECT,
          '--code-ref',
          'refs/heads/release/0.2',
          '--json',
        ])
      )
    );

    expect(json.targetLineId).toBe(LINE_03);
    expect(json.storeRef).toBe('refs/heads/release/0.3');
    expect(json.projects).toEqual({ [PROJECT]: { codeRef: 'refs/heads/release/0.2' } });
    expect(json.path).toBe(f.at('.rasen-store', 'target-lines', `${LINE_03}.yaml`));
    expect(json.suggestedCommits[0].pathspecs).toEqual([
      `.rasen-store/target-lines/${LINE_03}.yaml`,
    ]);
    // The command wrote the file and staged nothing.
    expect(fs.existsSync(json.path)).toBe(true);
    expect(f.git(f.storeRoot, ['diff', '--cached', '--name-only'])).toBe('');
  });

  it('prints the same facts in the human form as in JSON', async () => {
    const human = expectOk(
      await run(['store', 'target-line', 'show', LINE_02, '--store', f.storeId, '--project', PROJECT])
    );
    const json = parseJson(
      expectOk(
        await run([
          'store',
          'target-line',
          'show',
          LINE_02,
          '--store',
          f.storeId,
          '--project',
          PROJECT,
          '--json',
        ])
      )
    );

    for (const fact of [
      json.targetLineId,
      json.storeRef,
      json.path,
      json.projects[PROJECT].codeRef,
      json.resolved.storeRefOid,
      json.resolved.codeRefOid,
    ]) {
      expect(human.stdout, String(fact)).toContain(String(fact));
    }
    expect(json.resolved.storeRefOid).toBe(f.refOid(f.storeRoot, 'refs/heads/release/0.2'));
  });

  it('lists every declared line in id order', async () => {
    expectOk(
      await run([
        'store',
        'target-line',
        'add',
        LINE_03,
        '--store',
        f.storeId,
        '--store-ref',
        'refs/heads/release/0.3',
        '--json',
      ])
    );
    const json = parseJson(
      expectOk(await run(['store', 'target-line', 'list', '--store', f.storeId, '--json']))
    );
    expect(json.targetLines.map((entry: { targetLineId: string }) => entry.targetLineId)).toEqual([
      LINE_02,
      LINE_03,
    ]);
  });

  it('exits 1 with one JSON diagnostic document on a refusal', async () => {
    const duplicate = await run([
      'store',
      'target-line',
      'add',
      LINE_02,
      '--store',
      f.storeId,
      '--store-ref',
      'refs/heads/main',
      '--json',
    ]);

    expect(duplicate.exitCode).toBe(1);
    const json = parseJson(duplicate);
    expect(json.targetLine).toBeNull();
    expect(json.status).toHaveLength(1);
    expect(json.status[0].code).toBe('target_line_exists');
    expect(json.status[0].severity).toBe('error');
    expect(json.status[0].fix).toContain('rasen store target-line set-ref');
  });

  it('refuses an add with no --store-ref before touching anything', async () => {
    const result = await run(['store', 'target-line', 'add', LINE_03, '--store', f.storeId, '--json']);
    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0].code).toBe('target_line_ref_unresolved');
    expect(fs.existsSync(f.at('.rasen-store', 'target-lines', `${LINE_03}.yaml`))).toBe(false);
  });

  it('moves a locator with set-ref and keeps the identifier', async () => {
    const json = parseJson(
      expectOk(
        await run([
          'store',
          'target-line',
          'set-ref',
          LINE_02,
          '--store',
          f.storeId,
          '--store-ref',
          'refs/heads/release/0.3',
          '--json',
        ])
      )
    );
    expect(json.targetLineId).toBe(LINE_02);
    expect(json.storeRef).toBe('refs/heads/release/0.3');
    expect(fs.readdirSync(f.at('.rasen-store', 'target-lines'))).toEqual([`${LINE_02}.yaml`]);
  });

  it('removes a project locator with --remove-code-ref', async () => {
    const json = parseJson(
      expectOk(
        await run([
          'store',
          'target-line',
          'set-ref',
          LINE_02,
          '--store',
          f.storeId,
          '--project',
          PROJECT,
          '--remove-code-ref',
          '--json',
        ])
      )
    );
    expect(json.projects).toEqual({});
  });

  it('reports an unknown line rather than inventing one from a branch name', async () => {
    f.git(f.storeRoot, ['branch', 'line-9.9']);
    const result = await run([
      'store',
      'target-line',
      'show',
      'line-9.9',
      '--store',
      f.storeId,
      '--json',
    ]);
    expect(result.exitCode).toBe(1);
    expect(parseJson(result).status[0].code).toBe('target_line_unknown');
  });
});
