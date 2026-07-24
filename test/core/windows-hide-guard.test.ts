import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Source-tree guard for the windows-process-launch capability: every
 * non-interactive child-process call site in `src/` MUST pass `windowsHide`
 * (true on Windows, a no-op on POSIX) so no console window flashes when a
 * console-less parent (the daemon) spawns a console child. The sole exception
 * is the interactive `$EDITOR` spawn in `commands/config.ts`, which must keep
 * its window. This static scan is cheaper and more complete than per-site
 * behavioral tests and catches any future spawn site that forgets the flag.
 *
 * It matches standalone `spawn(`/`spawnSync(`/`execFile(`/`execFileSync(`/
 * `execSync(`/`exec(`/`fork(` calls (never method calls like `regex.exec(` nor
 * the `promisify(execFile)` reference, where `execFile` is an argument),
 * extracts each call's balanced-paren argument text (skipping quoted/template
 * strings), and asserts `windowsHide` appears within it. To catch aliased
 * imports (`import { spawn as spawnProcess } from 'node:child_process'`), each
 * file's `node:child_process` binding names are parsed and folded into the scan
 * so a call through the local alias is checked too.
 *
 * Out of scope (documented limitation): a child-process function reached
 * through a value the scan cannot statically resolve — an injected callback
 * (`options.spawnFn(...)`) or a re-assigned local (`const s = spawn; s(...)`) —
 * is invisible to this static guard.
 */
const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

// The child-process functions whose calls must pass windowsHide.
const CP_FUNCTIONS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork'];

/** Local binding names bound to a `node:child_process` function in `src` (handles `as` aliases). */
function childProcessBindings(src: string): string[] {
  const names: string[] = [];
  const importRe = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g;
  for (const match of src.matchAll(importRe)) {
    for (const spec of match[1]!.split(',')) {
      const [original, alias] = spec.split(/\s+as\s+/).map((s) => s.trim());
      if (!original) continue;
      if (CP_FUNCTIONS.includes(original)) names.push((alias || original).trim());
    }
  }
  return names;
}

/** A regex matching a standalone call to any name in `names` (longest-first, no `.`/word-char before). */
function buildCallRe(names: string[]): RegExp {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![.\\w])(${escaped.join('|')})\\s*\\(`, 'g');
}

/**
 * Blanks comment and string/template-literal CONTENT (preserving length, quotes,
 * and newlines) so the scan sees only real code — the word "spawn" in a
 * doc-comment or a shell snippet inside a template string is not a call site.
 */
function stripNonCode(src: string): string {
  let out = '';
  type State = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let state: State = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { out += '  '; i++; state = 'line'; continue; }
      if (c === '/' && c2 === '*') { out += '  '; i++; state = 'block'; continue; }
      if (c === "'") { out += c; state = 'sq'; continue; }
      if (c === '"') { out += c; state = 'dq'; continue; }
      if (c === '`') { out += c; state = 'tpl'; continue; }
      out += c;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') { out += '\n'; state = 'code'; } else out += ' ';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { out += '  '; i++; state = 'code'; continue; }
      out += c === '\n' ? '\n' : ' ';
      continue;
    }
    // A string/template body: blank content, keep the closing quote.
    const quote = state === 'sq' ? "'" : state === 'dq' ? '"' : '`';
    if (c === '\\') { out += '  '; i++; continue; }
    if (c === quote) { out += c; state = 'code'; continue; }
    out += c === '\n' ? '\n' : ' ';
  }
  return out;
}

/** From the index of a call's opening `(`, returns the balanced call text, skipping string/template literals. */
function extractCall(src: string, openIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}

interface Offender {
  file: string;
  fn: string;
  snippet: string;
}

/** The single interactive spawn allowed to omit windowsHide: the $EDITOR in commands/config.ts. */
function isAllowedEditorSpawn(relPath: string, fn: string, argsText: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  return normalized === 'commands/config.ts' && fn === 'spawn' && /^\(\s*editor\b/.test(argsText);
}

/** Every child-process call site in `content` that neither passes windowsHide nor is the allowlisted editor spawn. */
function findOffenders(relPath: string, rawContent: string): Offender[] {
  const content = stripNonCode(rawContent);
  // Scan the canonical names plus this file's own child_process import aliases.
  const callRe = buildCallRe([...CP_FUNCTIONS, ...childProcessBindings(rawContent)]);
  const offenders: Offender[] = [];
  for (const match of content.matchAll(callRe)) {
    const fn = match[1]!;
    const openIdx = match.index! + match[0].length - 1;
    const argsText = extractCall(content, openIdx);
    if (argsText.includes('windowsHide')) continue;
    if (isAllowedEditorSpawn(relPath, fn, argsText)) continue;
    offenders.push({ file: relPath, fn, snippet: argsText.slice(0, 80) });
  }
  return offenders;
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('windowsHide source guard (windows-process-launch)', () => {
  it('every child-process call site in src/ passes windowsHide (editor spawn excepted)', () => {
    const offenders: Offender[] = [];
    for (const file of collectTsFiles(SRC_ROOT)) {
      offenders.push(...findOffenders(path.relative(SRC_ROOT, file), readFileSync(file, 'utf-8')));
    }
    expect(offenders).toEqual([]);
  });

  it('the interactive $EDITOR spawn in commands/config.ts is the only allowlisted omission', () => {
    const content = readFileSync(path.join(SRC_ROOT, 'commands', 'config.ts'), 'utf-8');
    // Its spawn omits windowsHide deliberately and is not flagged...
    expect(findOffenders('commands/config.ts', content)).toEqual([]);
    // ...but the same call in any other file WOULD be flagged (allowlist is path-scoped).
    const elsewhere = findOffenders('commands/other.ts', 'const c = spawn(editor, [configPath], { stdio: "inherit" });');
    expect(elsewhere).toHaveLength(1);
  });

  it('catches a seeded violation (guard is live)', () => {
    const seeded = `
      import { spawn } from 'node:child_process';
      const c = spawn(process.execPath, ['update'], { cwd, shell: false });
    `;
    const offenders = findOffenders('core/fake.ts', seeded);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.fn).toBe('spawn');
  });

  it('catches a violation through an aliased child_process import', () => {
    const seeded = `
      import { spawn as spawnProcess } from 'node:child_process';
      const c = spawnProcess(bin, argv, { shell: false });
    `;
    const offenders = findOffenders('core/fake.ts', seeded);
    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.fn).toBe('spawnProcess');
  });

  it('does not flag an aliased call that passes windowsHide', () => {
    const compliant = `
      import { spawn as spawnProcess } from 'node:child_process';
      const c = spawnProcess(bin, argv, { shell: false, windowsHide: true });
    `;
    expect(findOffenders('core/fake.ts', compliant)).toEqual([]);
  });

  it('does not flag a compliant call, a method .exec(), or the promisify(execFile) reference', () => {
    const compliant = `
      spawn(bin, argv, { shell: false, windowsHide: true });
      const m = /foo/.exec(input);
      const p = promisify(execFile);
      const wrapped = execFileAsync('git', ['status']);
    `;
    expect(findOffenders('core/fake.ts', compliant)).toEqual([]);
  });
});
