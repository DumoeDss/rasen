/**
 * `store-finalization-outcomes-v2` tasks 1.7 and 1.8.
 *
 * Finalization is the only slice in this portfolio that mutates the Store's
 * working tree while making NO Git call that writes. That is a property of the
 * source, not of a comment, so it is scanned: any writing Git verb anywhere
 * under `src/core/store/finalization/` fails this suite.
 *
 * The second guard is the addressing one. A Store v2 Archive entry is produced
 * by the Foundation layout contract from validated semantic identifiers; a
 * finalization path that composed `${date}-${change}` itself would be a second
 * addressing rule that nothing keeps in step with the first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FINALIZATION_GIT_VERBS } from '../../../src/core/store/finalization/dependencies.js';

const MODULE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'core',
  'store',
  'finalization'
);

/**
 * Every Git verb with a write effect, enumerated individually. A prefix rule
 * would make this gate pass while destroying the precision it exists for.
 */
const FORBIDDEN_WRITE_VERBS: readonly string[] = [
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'branch',
  'worktree',
  'add',
  'commit',
  'fetch',
  'pull',
  'push',
  'clone',
  'tag',
  'cherry-pick',
  'revert',
  'stash',
  'apply',
  'am',
  'update-ref',
  'gc',
  'prune',
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const absolute = path.join(dir, name);
    if (statSync(absolute).isDirectory()) {
      found.push(...sourceFiles(absolute));
    } else if (name.endsWith('.ts')) {
      found.push(absolute);
    }
  }
  return found.sort();
}

function readSources(): Array<[string, string]> {
  return sourceFiles(MODULE_DIR).map(absolute => [
    path.relative(MODULE_DIR, absolute).split(path.sep).join('/'),
    readFileSync(absolute, 'utf8'),
  ]);
}

describe('finalization Git verb guard', () => {
  it('scans a non-empty module', () => {
    expect(readSources().length).toBeGreaterThan(5);
  });

  it('declares a read-only verb set', () => {
    expect([...FINALIZATION_GIT_VERBS].sort()).toEqual([
      'for-each-ref',
      'merge-base',
      'rev-parse',
      'show',
      'status',
      'symbolic-ref',
    ]);
    for (const verb of FINALIZATION_GIT_VERBS) {
      expect(FORBIDDEN_WRITE_VERBS, `${verb} must not be a writing verb`).not.toContain(
        verb
      );
    }
  });

  it('spawns no writing Git verb anywhere in the module', () => {
    for (const [file, source] of readSources()) {
      for (const verb of FORBIDDEN_WRITE_VERBS) {
        // The verb only matters as a spawned ARGUMENT: a quoted array element
        // in an argv list. Identifiers (`mergeBase`, `codeMerge`) are not Git
        // calls, and backticks are excluded because the module's own header
        // enumerates the forbidden verbs in prose — quoting them there is the
        // documentation this guard enforces, not a violation of it.
        const spawned = new RegExp(`['"]${verb}['"]\\s*[,\\]]`, 'u');
        expect(spawned.test(source), `${file} must not spawn 'git ${verb}'`).toBe(false);
      }
    }
  });

  it('composes no archive entry name by string concatenation', () => {
    for (const [file, source] of readSources()) {
      // The only legitimate producer is the layout contract. A date-prefixed
      // template literal anywhere here would be a second addressing rule.
      expect(
        /\$\{[^}]*[Dd]ate[^}]*\}-\$\{/u.test(source),
        `${file} must not compose an entry name from a date and a change id`
      ).toBe(false);
      expect(
        /--\$\{[^}]*[Ii]nstance/u.test(source),
        `${file} must not compose the instance suffix itself`
      ).toBe(false);
    }
  });

  it('routes every Store v2 destination through the layout contract', () => {
    const record = readFileSync(path.join(MODULE_DIR, 'record.ts'), 'utf8');
    expect(record).toContain('resolveStorePlanningLayoutV2Path');
    expect(record).toContain("kind: 'archive-entry'");
  });
});
