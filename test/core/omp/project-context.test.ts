import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectOmpNestedInstallCapture } from '../../../src/core/omp/project-context.js';
import { ompNestedInstallCaptureReport } from '../../../src/core/omp/project-context-locale.js';

describe('detectOmpNestedInstallCapture', () => {
  let home: string;
  let repo: string;
  let pkg: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-omp-ctx-'));
    repo = path.join(home, 'work', 'monorepo');
    pkg = path.join(repo, 'packages', 'api');
    fs.mkdirSync(pkg, { recursive: true });
    // A real repository boundary: the walk must not escape past it.
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
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

  it('does not walk past the repository root', () => {
    // A `.omp/AGENTS.md` above the enclosing Git checkout is outside Oh My Pi's
    // own discovery boundary, so it was never loading here to begin with.
    writeOmpFile(path.join(home, 'work'), 'AGENTS.md');
    expect(detectOmpNestedInstallCapture(pkg, home)).toBeUndefined();
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
