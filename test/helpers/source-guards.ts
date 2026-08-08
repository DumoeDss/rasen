/**
 * Source-level guards, inverted.
 *
 * Two guards in this repo used to work the other way round: they enumerated
 * the RECEIVER shapes a dangerous property could hang off — `pointer.value`,
 * `<ident>Pointer.value`, `entry.sourcePath`, `adoption.sourcePath` — and
 * treated everything else as safe. Both were then defeated by a receiver shape
 * nobody had thought to enumerate:
 *
 * - `readStorePointer(root).value` — the receiver is a CALL RESULT, so the
 *   `<ident>Pointer` alternation never fired, and a real defect (a member repo
 *   silently vanishing from a Store's member list) lived in `spaces.ts`.
 * - `record.sourcePath` — `record` was not one of the six enumerated names,
 *   and `StoreProjectRecord` is exactly the shape a future reader binds to a
 *   variable called `record`.
 *
 * So these helpers invert the question: find every read of the PROPERTY,
 * whatever the receiver, and make the caller allowlist the receivers it has
 * decided are legitimate. An allowlist can be checked for staleness — and is,
 * in both guards. A regex cannot, and nobody re-tests a regex that is passing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Blanks whole-line and block comments, so a guard reads the CODE. Without
 * this, a comment naming the very pattern a guard bans (as several of the
 * fixes for these defects do) reports itself as an offender.
 */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(/\r?\n/u)
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*');
    })
    .join('\n');
}

/** Every `.ts` file under `src/`, relative to `repoRoot` with `/` separators. */
export function sourceFiles(repoRoot: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        found.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(repoRoot, 'src'));
  return found.sort();
}

/**
 * The three flat-layout path constructors. `specsDir(x)`, `changesDir(x)` and
 * `inRepoArchiveDir(x)` ARE `<x>/rasen/{specs,changes,changes/archive}`, so a
 * call on a Store root is a flat Store address even though no literal segment
 * appears in the source.
 */
export const FLAT_PATH_HELPERS = ['specsDir', 'changesDir', 'inRepoArchiveDir'] as const;

/**
 * Every call of a flat path helper in this source, keyed `helper(argument)`.
 *
 * Inverted for the same reason `propertyReceivers` is (see the docblock above):
 * the guard this replaced matched four literal argument spellings —
 * `storeRoot`, `store.root`, `store.storeRoot`, `input.storeRoot` — and
 * therefore saw 7 of the 23 calls that existed the day it was written. Every
 * other spelling, and a call with a second argument, passed straight through a
 * census the caller inventory called "the enforcement".
 *
 * This finds every CALL, whatever the argument is called, and hands the caller
 * the argument token so it can allowlist per file. A spelling nobody enumerated
 * lands in the offender map instead of disappearing from it. A declaration
 * (`function specsDir(...)`) is reported as `helper(declaration)` — a call site
 * can never be preceded by the `function` keyword, so the two cannot be
 * confused. An optional call (`changesDir?.(x)`) is a call and is counted.
 *
 * KNOWN HOLES — three, all needing symbol resolution this deliberately does not
 * do, and neither appearing against a flat-path helper today:
 *
 *   import { changesDir as cd } from '…'; cd(storeRoot)   // 50 files use `{ X as Y }`
 *   const f = changesDir; f(storeRoot)                     // rebinding
 *   helpers['changesDir'](storeRoot)                       // computed property
 *
 * Recorded as three shapes rather than one, because a hole believed to be one
 * item wide does not get audited the way a three-item hole does. Closing them
 * needs a real parse (ts-morph or the TypeScript AST), which is the right fix if
 * a fourth ever appears — not another regex.
 */
export function flatPathHelperCalls(source: string): Record<string, number> {
  const code = withoutComments(source);
  const occurrence = new RegExp(String.raw`\b(${FLAT_PATH_HELPERS.join('|')})\b`, 'gu');
  const found: Record<string, number> = {};

  for (const match of code.matchAll(occurrence)) {
    const start = match.index ?? 0;
    let open = start + match[0].length;
    while (open < code.length && /\s/u.test(code[open] as string)) open += 1;
    // An OPTIONAL call is still a call. `?.(` is idiomatic here — 39 sites in
    // `src/` — so skipping it would have left a flat-Store address one keystroke
    // away from invisible.
    if (code[open] === '?' && code[open + 1] === '.') {
      open += 2;
      while (open < code.length && /\s/u.test(code[open] as string)) open += 1;
    }
    // A bare reference is not a call. `changesDir` is also a widely used local
    // variable and property name in this repo, so only a real call counts.
    if (code[open] !== '(') continue;

    let before = start - 1;
    while (before >= 0 && /\s/u.test(code[before] as string)) before -= 1;
    const isDeclaration = /\bfunction$/u.test(code.slice(Math.max(0, before - 9), before + 1));

    let depth = 1;
    let argument = '';
    for (let i = open + 1; i < code.length && depth > 0; i += 1) {
      const ch = code[i] as string;
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      // Only the FIRST argument identifies the address; a second argument must
      // not be able to hide the call, which is how the old regex was defeated.
      if (depth === 1 && ch === ',') break;
      argument += ch;
    }

    const token = isDeclaration ? 'declaration' : argument.trim().replace(/\s+/gu, ' ');
    const key = `${match[1]}(${token})`;
    found[key] = (found[key] ?? 0) + 1;
  }

  return found;
}

const IDENT = /[\w$]/u;

/**
 * The receiver a property access hangs off, read backwards from the `.`.
 *
 * Normalized so an allowlist entry is a readable token rather than a slice of
 * source: an identifier stays itself, a call result becomes `callee()`, an
 * index or any other parenthesised expression becomes `(index)` / `(expr)`,
 * and `this` stays `this`. A shape with no identifier at all still produces a
 * token, so it lands in the offender list instead of disappearing.
 */
function receiverBefore(code: string, dotIndex: number): string {
  let i = dotIndex - 1;
  while (i >= 0 && /\s/u.test(code[i] as string)) i -= 1;
  if (i < 0) return '(expr)';

  if (code[i] === ')') {
    // Walk back to the matching '(' — nesting included, which the old forward
    // regexes could not do and which `f(g(x)).value` needs.
    let depth = 0;
    let j = i;
    for (; j >= 0; j -= 1) {
      if (code[j] === ')') depth += 1;
      else if (code[j] === '(') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j < 0) return '(expr)';
    let k = j - 1;
    while (k >= 0 && /\s/u.test(code[k] as string)) k -= 1;
    const end = k + 1;
    while (k >= 0 && IDENT.test(code[k] as string)) k -= 1;
    const callee = code.slice(k + 1, end);
    return callee.length > 0 ? `${callee}()` : '(expr)';
  }

  if (code[i] === ']') return '(index)';

  if (IDENT.test(code[i] as string)) {
    let k = i;
    while (k >= 0 && IDENT.test(code[k] as string)) k -= 1;
    return code.slice(k + 1, i + 1);
  }

  return '(expr)';
}

/**
 * Every receiver that reads `<property>` in this source, deduplicated.
 *
 * Covers the plain access, the optional-chained access, whitespace between
 * every token, a call-result receiver, and destructuring (`const { value } =
 * pointer`), which is reported as the destructured receiver so it allowlists
 * exactly like the property access it is equivalent to.
 */
export function propertyReceivers(source: string, property: string): string[] {
  const code = withoutComments(source);
  const found = new Set<string>();

  const access = new RegExp(String.raw`\??\.\s*${property}\b`, 'gu');
  for (const match of code.matchAll(access)) {
    // `match.index` sits on the `?` of `?.` or on the `.`; either way the
    // receiver is whatever ends immediately before it.
    found.add(receiverBefore(code, match.index ?? 0));
  }

  const destructure = new RegExp(
    String.raw`\{[^{}]*\b${property}\b[^{}]*\}\s*=\s*([\w$.]+)`,
    'gu'
  );
  for (const match of code.matchAll(destructure)) {
    const chain = match[1] ?? '';
    const last = chain.split('.').filter(Boolean).pop();
    if (last) found.add(last);
  }

  return [...found].sort();
}
