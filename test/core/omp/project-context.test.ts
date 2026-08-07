import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectOmpNestedInstallCapture } from '../../../src/core/omp/project-context.js';
import { ompNestedInstallCaptureReport } from '../../../src/core/omp/project-context-locale.js';

/**
 * The detector discriminates on the ERRNO, not on a filesystem shape: `ENOENT`
 * and `ENOTDIR` mean absent, anything else means present-but-unreadable. The
 * errno is therefore what the test has to control. A `chmod 0` fixture is inert
 * for an administrator on Windows, and a path under a regular file yields
 * `ENOTDIR` on POSIX but `ENOENT` on Windows — so building the shape would
 * prove the opposite thing on the two CI platforms. Inject instead, gated on
 * the exact directory under test so every other read in this file stays real.
 */
const readdirFault = vi.hoisted(() => ({
  target: undefined as string | undefined,
  code: 'EACCES',
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    readdirSync: ((target: fs.PathLike, options?: unknown) => {
      const p = typeof target === 'string' ? target : target.toString();
      if (readdirFault.target !== undefined && p === readdirFault.target) {
        const error = new Error(`${readdirFault.code}: injected`) as NodeJS.ErrnoException;
        error.code = readdirFault.code;
        throw error;
      }
      return (actual.readdirSync as (t: fs.PathLike, o?: unknown) => unknown)(target, options);
    }) as typeof actual.readdirSync,
  };
});

describe('detectOmpNestedInstallCapture', () => {
  // `home` is nested inside a disposable sandbox because one case below writes
  // an `.omp/AGENTS.md` ABOVE `home` to prove the walk stops there. With `home`
  // itself the mkdtemp, that write landed in the shared system temp directory
  // and `afterEach` never removed it, so the suite permanently planted a
  // `$TMPDIR/.omp/AGENTS.md` that every later capture walk over a temp-dir
  // install root would then find.
  let sandbox: string;
  let home: string;
  let repo: string;
  let pkg: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-omp-ctx-'));
    home = path.join(sandbox, 'home');
    repo = path.join(home, 'work', 'monorepo');
    pkg = path.join(repo, 'packages', 'api');
    fs.mkdirSync(pkg, { recursive: true });
    // A real repository boundary: the walk must not escape past it.
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  function writeOmpFile(dir: string, name: string): string {
    fs.mkdirSync(path.join(dir, '.omp'), { recursive: true });
    const file = path.join(dir, '.omp', name);
    fs.writeFileSync(file, '# content\n', 'utf-8');
    return file;
  }

  it('names an enclosing AGENTS.md that stops loading', () => {
    const captured = writeOmpFile(repo, 'AGENTS.md');
    const capture = detectOmpNestedInstallCapture(pkg, home);
    expect(capture).toEqual({ installRoot: pkg, capturedRoot: repo, capturedFiles: [captured] });
  });

  it('names an enclosing RULES.md that stops loading', () => {
    const captured = writeOmpFile(repo, 'RULES.md');
    expect(detectOmpNestedInstallCapture(pkg, home)?.capturedFiles).toEqual([captured]);
  });

  it('names both context files when both exist', () => {
    const agents = writeOmpFile(repo, 'AGENTS.md');
    const rules = writeOmpFile(repo, 'RULES.md');
    expect(detectOmpNestedInstallCapture(pkg, home)?.capturedFiles).toEqual([agents, rules]);
  });

  it('reports nothing when no enclosing context file exists', () => {
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
  });

  it('reports nothing when the enclosing .omp holds only skills', () => {
    // Skills scan every ancestor and do not require a non-empty `.omp/`, so a
    // nested install captures nothing from a skills-only ancestor. Warning here
    // would name a consequence that does not happen.
    fs.mkdirSync(path.join(repo, '.omp', 'skills', 'rasen-explore'), { recursive: true });
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
  });

  it('reports nothing when the enclosing .omp directory is empty', () => {
    // Oh My Pi's admission helper treats an empty project `.omp/` as absent, so
    // it never held the context lookup in the first place.
    fs.mkdirSync(path.join(repo, '.omp'), { recursive: true });
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
  });

  it('reports nothing when installing AT the directory that carries the files', () => {
    // `<repo>/.omp/AGENTS.md` keeps loading when the install target IS `<repo>`;
    // a file inside the directory being installed into is not "enclosing".
    writeOmpFile(repo, 'AGENTS.md');
    expect(detectOmpNestedInstallCapture(repo, home)).toBeUndefined();
  });

  it('reports nothing when the install target is already populated', () => {
    // The "newly populate" half of the requirement: an already-populated `.omp/`
    // means the enclosing files were shadowed before Rasen ran, so warning would
    // blame Rasen for a pre-existing state.
    writeOmpFile(repo, 'AGENTS.md');
    writeOmpFile(pkg, 'RULES.md');
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
  });

  it('stops at the nearest populated ancestor, as Oh My Pi does', () => {
    // Oh My Pi stops at the nearest non-empty `.omp/`, so `<repo>/.omp/AGENTS.md`
    // was ALREADY shadowed by the intermediate one before this install.
    writeOmpFile(repo, 'AGENTS.md');
    const nearer = writeOmpFile(path.join(repo, 'packages'), 'AGENTS.md');
    const capture = detectOmpNestedInstallCapture(pkg, home);
    expect(capture?.capturedFiles).toEqual([nearer]);
    expect(capture?.capturedRoot).toBe(path.join(repo, 'packages'));
  });

  // Both cases below use a `.git`-free chain, because `repo`'s Git boundary
  // would otherwise stop the walk on its own and the assertion would hold with
  // the errno discrimination deleted.
  it('stops at an ancestor whose .omp cannot be listed, rather than walking past it', () => {
    // An `.omp/` that exists but is unreadable is PRESENT — Oh My Pi would stop
    // there. Reading the error as "absent" lets the walk escape and blame a
    // farther, unrelated ancestor for a capture that directory did not cause.
    // The errno is the contract, so it is injected rather than built: `chmod 0`
    // is inert for an administrator on Windows, and a path under a regular file
    // yields ENOTDIR on POSIX but ENOENT on Windows.
    const loose = path.join(home, 'work', 'proj', 'sub');
    fs.mkdirSync(loose, { recursive: true });
    writeOmpFile(path.join(home, 'work'), 'AGENTS.md');
    const unreadable = path.join(home, 'work', 'proj', '.omp');
    fs.mkdirSync(unreadable, { recursive: true });
    readdirFault.target = unreadable;
    try {
      expect(detectOmpNestedInstallCapture(loose, home)).toBeUndefined();
    } finally {
      readdirFault.target = undefined;
    }
  });

  it('treats an ENOENT .omp as absent and keeps walking', () => {
    // The control for the case above: same fixture, same injection point, only
    // the CODE differs — so it proves the discrimination is on the errno rather
    // than on "any throw stops the walk".
    const loose = path.join(home, 'work', 'proj', 'sub');
    fs.mkdirSync(loose, { recursive: true });
    const enclosing = writeOmpFile(path.join(home, 'work'), 'AGENTS.md');
    readdirFault.target = path.join(home, 'work', 'proj', '.omp');
    readdirFault.code = 'ENOENT';
    try {
      expect(detectOmpNestedInstallCapture(loose, home)?.capturedFiles).toEqual([enclosing]);
    } finally {
      readdirFault.target = undefined;
      readdirFault.code = 'EACCES';
    }
  });

  it('never reports the home directory itself as the captured root', () => {
    // `~/.omp` is Oh My Pi's CONFIG root, populated for every Oh My Pi user, and
    // its user-level context files live under `~/.omp/agent/` and are read
    // directly rather than through this walk. Reporting it would be both a
    // category error and the most frequently reached false positive there is.
    const loose = path.join(home, 'scratch', 'project');
    fs.mkdirSync(loose, { recursive: true });
    writeOmpFile(home, 'AGENTS.md');
    expect(detectOmpNestedInstallCapture(loose, home)).toBeUndefined();
  });

  it('does not walk past the repository root', () => {
    // A `.omp/AGENTS.md` above the enclosing Git checkout is outside Oh My Pi's
    // own discovery boundary, so it was never loading here to begin with.
    writeOmpFile(path.join(home, 'work'), 'AGENTS.md');
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
  });

  it('reports nothing when the install root IS the repository root', () => {
    // The ordinary `rasen init` case. Oh My Pi resolves project context only up
    // to the enclosing Git checkout, so from inside `repo` nothing above it is
    // ever consulted — naming an enclosing file would blame the install for a
    // capture that never happens. The walk must stop before it starts, not
    // after its first hop.
    const above = writeOmpFile(path.join(home, 'work'), 'AGENTS.md');
    expect(fs.existsSync(above)).toBe(true);
    expect(detectOmpNestedInstallCapture(repo, home)).toBeUndefined();
  });

  it('reports nothing when the install root is a worktree whose .git is a FILE', () => {
    const wt = path.join(home, 'work', 'worktree');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere\n', 'utf-8');
    writeOmpFile(path.join(home, 'work'), 'RULES.md');
    expect(detectOmpNestedInstallCapture(wt, home)).toBeUndefined();
  });

  it('does not walk past the home directory when there is no repository root', () => {
    const loose = path.join(home, 'scratch', 'project');
    fs.mkdirSync(loose, { recursive: true });
    writeOmpFile(path.dirname(home), 'AGENTS.md');
    expect(detectOmpNestedInstallCapture(loose, home)).toBeUndefined();
  });
});

describe('ompNestedInstallCaptureReport', () => {
  it('names the captured files and where to install instead', () => {
    const lines = ompNestedInstallCaptureReport({
      installRoot: path.join('/repo', 'packages', 'api'),
      capturedRoot: '/repo',
      capturedFiles: [path.join('/repo', '.omp', 'AGENTS.md')],
    });
    expect(lines.map((line) => line.tone)).toEqual(['warn', 'info']);
    expect(lines[0]!.text).toContain(path.join('/repo', 'packages', 'api'));
    expect(lines[0]!.text).toContain(path.join('/repo', '.omp', 'AGENTS.md'));
    expect(lines[1]!.text).toContain('/repo');
    // Every placeholder is substituted — an uninterpolated `{files}` reaching a
    // user is the failure mode a formatter that leaves placeholders intact has.
    for (const line of lines) expect(line.text).not.toMatch(/\{[A-Za-z]+\}/);
  });
});
