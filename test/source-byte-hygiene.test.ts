/**
 * `store-finalization-outcomes-v2` — the byte-level source gate.
 *
 * WHY THIS EXISTS. `src/core/store/finalization/successor.ts` shipped through a
 * full implementation pass, an author's own encoding audit, a `git diff --check`
 * gate and a whole test suite while containing three literal 0x00 bytes. Every
 * one of those checks was blind to it:
 *
 * - the encoding audit enumerated UTF-8 / BOM / U+FFFD / mojibake / LF /
 *   trailing whitespace, and NUL was not on the list;
 * - `git diff --check` inspects the working-tree diff of TRACKED files, and
 *   every file this change adds is untracked, so the gate examined none of
 *   them — and it skips binary files even once they are tracked;
 * - Git classifies a file containing NUL as BINARY, so `git diff`, `git show`
 *   and a PR's "Files changed" view render 260 lines of source as an opaque
 *   blob, and `grep`/`rg` print `Binary file … matches` with no line content.
 *
 * A defect that makes a file unreviewable and simultaneously hides itself from
 * every text-mode tool cannot be caught by another text-mode tool. So this
 * guard reads BYTES.
 *
 * A repository-wide byte sweep at the time this was written found the same
 * class in two other children's files, which is why the scope is the whole tree
 * rather than this change's own directory: one author's slip is an incident,
 * three independent authors is an authoring-path property.
 *
 * THE EXCEPTION LIST IS ENUMERATED, NEVER A PREFIX RULE. Each entry names one
 * file, one defect kind, and why it is not repaired here. It is checked for
 * STALENESS in both directions: an entry whose file no longer carries the
 * defect fails this suite and must be deleted, so the list cannot quietly
 * outlive the debt it records.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Defect = 'nul' | 'bom' | 'replacement-char';

interface Exception {
  readonly file: string;
  readonly defect: Defect;
  /** Why this file is not repaired by the change that added this guard. */
  readonly reason: string;
}

/**
 * Every file currently allowed to carry a byte defect, one at a time.
 *
 * Nothing here belongs to `store-finalization-outcomes-v2`. Three entries are
 * sibling changes' files in this shared worktree, which this change may not
 * edit; the rest predate the branch and are byte-identical to their `HEAD`
 * blobs, verified with `git show HEAD:<path>` rather than assumed.
 */
const EXCEPTIONS: readonly Exception[] = Object.freeze([
  // `src/core/store/query/module.ts` (child 6) carried 2 NUL bytes and was
  // listed here. Its owner repaired it, this suite's staleness half went red on
  // the now-unnecessary entry, and the entry came out. That round trip is the
  // list working; leave this note as the worked example.
  {
    file: 'test/core/pipeline-registry/run-state.test.ts',
    defect: 'replacement-char',
    reason: 'predates this branch; byte-identical to the HEAD blob.',
  },
  {
    file: 'test/core/templates/skill-templates-parity.test.ts',
    defect: 'bom',
    reason: 'predates this branch; byte-identical to the HEAD blob.',
  },
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json']);

function scannedFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue;
      found.push(
        path.relative(repoRoot, path.join(dir, entry.name)).split(path.sep).join('/')
      );
    }
  };
  walk(path.join(repoRoot, 'src'));
  walk(path.join(repoRoot, 'test'));
  return found.sort();
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const REPLACEMENT = Buffer.from([0xef, 0xbf, 0xbd]);

/** Every defect a file's BYTES carry. Never decoded to a string first. */
function defectsIn(relative: string): Defect[] {
  const bytes = fs.readFileSync(path.join(repoRoot, relative));
  const defects: Defect[] = [];
  if (bytes.includes(0x00)) defects.push('nul');
  if (bytes.subarray(0, 3).equals(BOM)) defects.push('bom');
  if (bytes.includes(REPLACEMENT)) defects.push('replacement-char');
  return defects;
}

function allowed(): Set<string> {
  return new Set(EXCEPTIONS.map((entry) => `${entry.file}::${entry.defect}`));
}

describe('source byte hygiene', () => {
  const files = scannedFiles();

  it('scans a non-trivial tree, so a green result is not an empty sweep', () => {
    // An empty or tiny file list would make every assertion below vacuous —
    // the failure mode a byte-identity baseline of `{}` has.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('src/core/store/finalization/successor.ts');
  });

  it('contains no NUL byte, no BOM, and no U+FFFD outside the enumerated list', () => {
    const permitted = allowed();
    const offenders: string[] = [];
    for (const file of files) {
      for (const defect of defectsIn(file)) {
        if (permitted.has(`${file}::${defect}`)) continue;
        offenders.push(`${file}::${defect}`);
      }
    }
    // Named individually, so a failure says which file and which defect rather
    // than only that the count moved.
    expect(offenders).toEqual([]);
  });

  /**
   * A NUL is the one defect that also DEFEATS REVIEW: Git marks the file
   * binary, so it lands in a PR as an opaque blob. Called out separately from
   * the sweep above so its list is readable on its own.
   */
  it('keeps every finalization source file out of Git s binary classification', () => {
    const finalization = files.filter((file) =>
      file.startsWith('src/core/store/finalization/')
    );
    expect(finalization.length).toBeGreaterThan(10);
    expect(finalization.filter((file) => defectsIn(file).includes('nul'))).toEqual([]);
  });

  it('has no STALE exception: an entry whose file is clean must be deleted', () => {
    const stale = EXCEPTIONS.filter((entry) => {
      if (!fs.existsSync(path.join(repoRoot, entry.file))) return true;
      return !defectsIn(entry.file).includes(entry.defect);
    }).map((entry) => `${entry.file}::${entry.defect}`);
    // This half is what stops the list from outliving the debt. When a sibling
    // repairs its file, this fails and the entry comes out — the list can never
    // grow into a permanent exemption.
    expect(stale).toEqual([]);
  });

  it('records a reason for every exception, and enumerates rather than globs', () => {
    for (const entry of EXCEPTIONS) {
      expect(entry.reason.length).toBeGreaterThan(20);
      // One file per entry. A pattern would let an unexamined file inherit an
      // exemption nobody decided to grant.
      expect(entry.file).not.toContain('*');
    }
    expect(new Set(EXCEPTIONS.map((entry) => `${entry.file}::${entry.defect}`)).size).toBe(
      EXCEPTIONS.length
    );
  });
});
