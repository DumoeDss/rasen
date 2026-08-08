/**
 * `store-planning-worktree-bindings` task 1.7 — the Git verb source guard.
 *
 * This is the portfolio's first Git-MUTATING code path, so the verb set is
 * closed by a guard rather than by convention: "the restriction SHALL be
 * enforced by a source guard" (capability requirement "Git mutation is a
 * closed, non-destructive verb set").
 *
 * The guard reads the workspace Module's source, not its behavior, because the
 * failure it prevents is someone ADDING a verb later. That makes the guard's
 * own discrimination the whole question, and the first version of this file got
 * it wrong in two ways that a synthetic-string check could not see:
 *
 *   1. `withoutVerbDeclarations` matched the allow-list constants by NAME
 *      rather than by declaration, so it also fired on `GIT_WORKTREE_SUBCOMMANDS
 *      .includes(subcommand)` — a USE — and then lazily swallowed everything up
 *      to the next `];`. On `dependencies.ts` that deleted 2,903 characters
 *      including the module's only Git spawn, blanking 65 consecutive lines of
 *      real adapter code from the scan.
 *   2. The verb matcher anchored on `[` immediately before the quoted verb, so
 *      it could only see a verb in FIRST argument position. The module's own
 *      spawn is `execFilePromise('git', ['-C', cwd, ...args])`, where the verb
 *      sits at index 2 — so a new call written in the shape this file already
 *      uses was invisible everywhere, and because such a call bypasses
 *      `spawnGit` it evades the RUNTIME allow-list too.
 *
 * So the guard is now three checks, and the sweep below proves each one fires
 * by INJECTING the real bypasses into the real adapter at every line where a
 * statement can legally go, rather than by feeding the matchers a string
 * written to match them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../../helpers/source-guards.js';
import {
  GIT_READ_VERBS,
  GIT_WORKTREE_SUBCOMMANDS,
  GIT_WRITE_VERBS,
} from '../../../src/core/store/workspace/dependencies.js';

const WORKSPACE_DIR = 'src/core/store/workspace';
/** The one file permitted to name and spawn the Git executable. */
const SPAWN_FILE = 'dependencies.ts';

/**
 * Every module the workspace Module reaches OUTSIDE its own directory.
 *
 * The ledger exists because the checks above read only this directory's own
 * text, and Git is reachable without writing a single Git token here: an
 * ordinary `import { commitStoreFiles } from '../git.js'` names no verb, no
 * `'git'` literal, and no `child_process`, and `src/core/store/git.ts` spawns
 * `git add`, `git commit`, `git rm`, `git clone`, and `git init` — precisely
 * the verbs "Git mutation is a closed, non-destructive verb set" forbids, and
 * precisely what `#### Scenario: No command stages or commits` rules out.
 *
 * What this ledger does and does not prove is worth stating exactly, because
 * the round-1 version of the spawn-site check claimed more than it enforced.
 * It does NOT prove Git is unreachable: `store/registry.ts` transitively
 * reaches `store/git.ts`, as most of `src/core/store` does, so a transitive
 * guard would be red on the day it was written and would be asserting a
 * property this codebase does not have. What it proves is that the set of
 * DOORS out of this Module is closed and reviewed — adding one is a diff to
 * this list, which is the review moment a source guard exists to create.
 *
 * Entries are enumerated one by one, never by directory prefix, and checked for
 * staleness in both directions.
 */
const ALLOWED_EXTERNAL_IMPORTS = new Set([
  // Node builtins and packages.
  'node:async_hooks',
  'node:child_process',
  'node:crypto',
  'node:fs',
  'node:path',
  'node:util',
  'yaml',
  // Repository modules. None of these spawns Git — which the check below
  // re-derives mechanically rather than trusting this comment.
  'src/core/canonical-json.ts',
  'src/core/change-metadata/index.ts',
  'src/core/file-state.ts',
  'src/core/global-config.ts',
  'src/core/project-registry.ts',
  'src/core/store/errors.ts',
  'src/core/store/foundation.ts',
  'src/core/store/identity-types.ts',
  'src/core/store/planning-foundation.ts',
  'src/core/store/planning-identity.ts',
  'src/core/store/planning-layout-v2.ts',
  'src/core/store/registry.ts',
  'src/core/store/target-lines.ts',
  'src/utils/file-system.ts',
]);

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)\b[^;'"`]*from\s*['"]([^'"]+)['"]/gu;
const IMPORT_BARE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu;

function importSpecifiers(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(IMPORT_FROM)) found.add(match[1] as string);
  for (const match of code.matchAll(IMPORT_BARE)) found.add(match[1] as string);
  return [...found];
}

function repoRelative(repoRoot: string, absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * The ledger entry a specifier resolves to: the bare specifier for a package or
 * builtin, the repo-relative source file for a relative one. A relative
 * specifier that resolves to nothing is reported rather than skipped, so a typo
 * cannot pass as "not a repository module".
 */
function ledgerEntryFor(repoRoot: string, fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return spec;
  const base = path.resolve(path.dirname(path.join(repoRoot, fromFile)), spec);
  for (const candidate of [base.replace(/\.js$/u, '.ts'), `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) {
      const relative = repoRelative(repoRoot, candidate);
      return relative.startsWith(`${WORKSPACE_DIR}/`) ? null : relative;
    }
  }
  return `UNRESOLVED ${spec}`;
}

interface ExternalImport {
  readonly file: string;
  readonly entry: string;
}

function externalImports(
  repoRoot: string,
  sources: readonly WorkspaceSource[]
): ExternalImport[] {
  const found: ExternalImport[] = [];
  for (const { file, code } of sources) {
    for (const spec of importSpecifiers(code)) {
      const entry = ledgerEntryFor(repoRoot, file, spec);
      if (entry !== null) found.push({ file, entry });
    }
  }
  return found;
}

/**
 * VALUE imports only. `import type { … }` and a brace clause whose every
 * specifier is `type X` are erased by the compiler, so they cannot create a
 * runtime cycle and cannot put a binding in a temporal dead zone. A scan that
 * counted them would forbid a harmless type cycle and call it a defect.
 */
function valueImportSpecifiers(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(/(?:^|\n)\s*import\s+([^;]*?)\s*from\s*['"]([^'"]+)['"]/gu)) {
    const clause = match[1] as string;
    const spec = match[2] as string;
    if (/^\s*type\s/u.test(clause)) continue;
    const brace = /\{([\s\S]*)\}/u.exec(clause);
    if (brace !== null) {
      const specifiers = (brace[1] as string)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      const hasValueSpecifier = specifiers.some((entry) => !/^type\s/u.test(entry));
      const hasDefaultOrNamespace = /[\w*]/u.test((clause.split('{')[0] ?? '').trim());
      if (!hasValueSpecifier && !hasDefaultOrNamespace) continue;
    }
    found.add(spec);
  }
  return [...found];
}

/** Every cycle in a directed graph, as sorted node lists (Tarjan, SCCs > 1). */
function importCycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) as number, low.get(next) as number));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) as number, index.get(next) as number));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let popped: string;
      do {
        popped = stack.pop() as string;
        onStack.delete(popped);
        component.push(popped);
      } while (popped !== node);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return cycles;
}

/**
 * Every module under `src/` that spawns the Git executable, derived rather than
 * listed: it imports `child_process` AND names `git` as a quoted executable.
 * Deriving it means the check below cannot go stale when a new one appears.
 */
/** The Module's own value-import graph, repo-relative, edges inside it only. */
function buildWorkspaceGraph(
  repoRoot: string,
  sources: readonly WorkspaceSource[]
): Map<string, string[]> {
  const own = new Set(sources.map(({ file }) => file));
  const graph = new Map<string, string[]>();
  for (const { file, code } of sources) {
    const edges: string[] = [];
    for (const spec of valueImportSpecifiers(code)) {
      if (!spec.startsWith('.')) continue;
      const base = path.resolve(path.dirname(path.join(repoRoot, file)), spec);
      for (const candidate of [
        base.replace(/\.js$/u, '.ts'),
        `${base}.ts`,
        path.join(base, 'index.ts'),
      ]) {
        if (!fs.existsSync(candidate)) continue;
        const relative = repoRelative(repoRoot, candidate);
        if (own.has(relative)) edges.push(relative);
        break;
      }
    }
    graph.set(file, [...new Set(edges)].sort());
  }
  return graph;
}

function gitSpawningModules(repoRoot: string): Set<string> {
  const spawners = new Set<string>();
  for (const file of sourceFiles(repoRoot)) {
    const code = withoutComments(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    if (/child_process/u.test(code) && /(['"`])git\1/u.test(code)) spawners.add(file);
  }
  return spawners;
}

/**
 * Every verb the accepted design forbids, by name. `merge-base` is permitted
 * and `merge` is not, which is exactly why the matcher below anchors on a
 * quoted string literal rather than on the bare word.
 */
const FORBIDDEN_VERBS = [
  'merge',
  'rebase',
  'reset',
  'checkout',
  'switch',
  'branch',
  'push',
  'pull',
  'fetch',
  'clone',
  'add',
  'commit',
  'cherry-pick',
  'stash',
  'apply',
  'am',
  'revert',
  'update-ref',
  'symbolic-ref-update',
] as const;

/** A forbidden verb that is not also a permitted one would be a contradiction. */
const SCANNED_VERBS = FORBIDDEN_VERBS.filter(
  (verb) =>
    !(GIT_READ_VERBS as readonly string[]).includes(verb) &&
    !(GIT_WRITE_VERBS as readonly string[]).includes(verb)
);

const QUOTE_CLASS = '([\'"`])';

/**
 * A Git argument-array ELEMENT: a quoted literal that follows a `[` or a `,`.
 *
 * Position-independent on purpose. The old first-element anchor could not see
 * `['-C', cwd, 'branch', ...]`, which is the shape this module's own spawn
 * uses; requiring only that the literal be an element still separates a spawn
 * argument from `objectType === 'commit'` (preceded by `=`) and from
 * `{ kind: 'add' }` (preceded by `:`), neither of which is a verb.
 */
function argumentElementMatcher(verbs: readonly string[]): RegExp {
  return new RegExp(`(?:\\[|,)\\s*${QUOTE_CLASS}(${verbs.join('|')})\\1`, 'gu');
}

/**
 * The allow-list constants are DECLARATIONS of what is permitted, not calls.
 * Reading them as offenders would make the guard fail on the very statement of
 * the rule it enforces — but the strip is anchored on `const <NAME>` so that a
 * mere MENTION of one of those names cannot blank the code that follows it.
 */
function withoutVerbDeclarations(code: string): string {
  return code.replace(
    /\b(?:export\s+)?const\s+(?:GIT_WRITE_VERBS|GIT_READ_VERBS|GIT_WORKTREE_SUBCOMMANDS|ALLOWED_GIT_VERBS)\b[^=]*=[\s\S]*?\]\)?;/gu,
    ''
  );
}

/**
 * `git worktree add` is permitted; `git add` is not. Both spell `'add'`, and
 * only the position distinguishes them, so the permitted pairing is collapsed
 * before the element scan runs and every other `'add'` stays an offender.
 */
function withoutPermittedWorktreeSubcommands(code: string): string {
  return code.replace(
    new RegExp(
      `${QUOTE_CLASS}worktree\\1\\s*,\\s*(['"\`])(?:${GIT_WORKTREE_SUBCOMMANDS.join('|')})\\2`,
      'gu'
    ),
    "'worktree'"
  );
}

function forceFlagMatcher(): RegExp {
  return new RegExp(`${QUOTE_CLASS}(?:--force|-f)\\1`, 'gu');
}

/**
 * The one legal appearance of a force flag is the RUNTIME refusal in the spawn
 * helper, which exists to reject a forced removal rather than to perform one.
 * Keyed to that exact condition rather than to a proximity window: a window
 * exempts anything a maintainer happens to write near it.
 */
const RUNTIME_FORCE_REFUSAL =
  /arg\s*===\s*(['"`])--force\1\s*\|\|\s*arg\s*===\s*(['"`])-f\2/u;

function lineAround(code: string, index: number): string {
  const start = code.lastIndexOf('\n', index) + 1;
  const end = code.indexOf('\n', index);
  return code.slice(start, end === -1 ? code.length : end);
}

/** The executable this Module may name. It may name it in exactly one place. */
function gitExecutableMatcher(): RegExp {
  return new RegExp(`${QUOTE_CLASS}git\\1`, 'gu');
}

function childProcessImportMatcher(): RegExp {
  return /from\s*(['"`])node:child_process\1|require\(\s*(['"`])(?:node:)?child_process\2/gu;
}

interface WorkspaceSource {
  readonly file: string;
  readonly name: string;
  /** Comment-free source. */
  readonly code: string;
}

function workspaceSources(repoRoot: string): WorkspaceSource[] {
  const dir = path.join(repoRoot, WORKSPACE_DIR);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort()
    .map((name) => ({
      file: `${WORKSPACE_DIR}/${name}`,
      name,
      code: withoutComments(fs.readFileSync(path.join(dir, name), 'utf8')),
    }));
}

/** The failure names the file and the verb, which is what the scenario asks. */
function verbOffenders(file: string, code: string): string[] {
  const scanned = withoutPermittedWorktreeSubcommands(withoutVerbDeclarations(code));
  return [...scanned.matchAll(argumentElementMatcher(SCANNED_VERBS))].map(
    (match) => `${file}: '${match[2]}'`
  );
}

function forceOffenders(file: string, code: string): string[] {
  const offenders: string[] = [];
  for (const match of code.matchAll(forceFlagMatcher())) {
    if (RUNTIME_FORCE_REFUSAL.test(lineAround(code, match.index ?? 0))) continue;
    offenders.push(`${file}: ${match[0]}`);
  }
  return offenders;
}

function spawnOffenders(file: string, code: string): string[] {
  const offenders: string[] = [];
  for (const match of code.matchAll(gitExecutableMatcher())) {
    offenders.push(`${file}: spawns ${match[0]}`);
  }
  for (const _match of code.matchAll(childProcessImportMatcher())) {
    offenders.push(`${file}: imports node:child_process`);
  }
  return offenders;
}

describe('workspace Git verb source guard', () => {
  const repoRoot = process.cwd();

  it('permits only the closed verb set anywhere under the workspace Module', () => {
    const offenders = workspaceSources(repoRoot).flatMap(({ file, code }) =>
      verbOffenders(file, code)
    );
    expect(offenders, `forbidden Git verbs found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never forces a worktree removal', () => {
    const offenders = workspaceSources(repoRoot).flatMap(({ file, code }) =>
      forceOffenders(file, code)
    );
    expect(offenders, `forced removal flags found:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('declares the closed verb set the design fixed', () => {
    expect([...GIT_WRITE_VERBS]).toEqual(['worktree']);
    expect([...GIT_READ_VERBS].sort()).toEqual([
      'for-each-ref',
      'ls-files',
      'merge-base',
      'rev-parse',
      'status',
      'symbolic-ref',
    ]);
    expect([...GIT_WORKTREE_SUBCOMMANDS].sort()).toEqual(['add', 'list', 'prune', 'remove']);
  });

  it('names the Git executable in exactly one file of this Module', () => {
    // The verb scan reads ARGUMENTS. This reads the EXECUTABLE, which any new
    // spawn written IN THIS DIRECTORY must name whatever shape its argument
    // array takes — and which is what keeps the runtime allow-list in
    // `spawnGit` on the only path from this directory to Git, rather than one
    // of two.
    //
    // Scope, stated rather than implied: this reads only this directory's text.
    // It does NOT establish that Git is unreachable from the Module, because a
    // sibling module reached by an ordinary import names neither `'git'` nor
    // `child_process` here. That half is the import ledger below; the two
    // together are what make the closed verb set enforceable rather than
    // conventional.
    const offenders = workspaceSources(repoRoot).flatMap(({ file, code }) =>
      spawnOffenders(file, code)
    );
    expect(offenders).toEqual([
      `${WORKSPACE_DIR}/${SPAWN_FILE}: spawns 'git'`,
      `${WORKSPACE_DIR}/${SPAWN_FILE}: imports node:child_process`,
    ]);
  });

  it('reaches outside its own directory only through the enumerated ledger', () => {
    const used = externalImports(repoRoot, workspaceSources(repoRoot));
    const offenders = used
      .filter(({ entry }) => !ALLOWED_EXTERNAL_IMPORTS.has(entry))
      .map(({ file, entry }) => `${file} -> ${entry}`)
      .sort();
    expect(
      offenders,
      `imports outside the workspace Module that the ledger does not record:\n${offenders.join('\n')}`
    ).toEqual([]);

    // Checked in the other direction too, same as the token ledger: an entry
    // nothing imports any more is a door that was closed without the list
    // saying so, and it would silently re-open for an unrelated reason later.
    const reached = new Set(used.map(({ entry }) => entry));
    const stale = [...ALLOWED_EXTERNAL_IMPORTS].filter((entry) => !reached.has(entry)).sort();
    expect(stale, `ledger entries nothing imports any more:\n${stale.join('\n')}`).toEqual([]);
  });

  it('never imports a module that spawns Git', () => {
    // The sharper half, and the one that needs no curation: whatever the ledger
    // happens to say, a module that spawns the Git executable is not something
    // this Module may reach directly, because reaching it puts verbs outside
    // the closed set one call away with nothing in this directory to scan.
    const spawners = gitSpawningModules(repoRoot);
    // Derivation sanity: the set is computed, so assert it actually found the
    // module this check exists for. A silently empty spawner set would make the
    // assertion below vacuous.
    expect(spawners).toContain('src/core/store/git.ts');
    expect(spawners).toContain(`${WORKSPACE_DIR}/${SPAWN_FILE}`);

    const offenders = externalImports(repoRoot, workspaceSources(repoRoot))
      .filter(({ entry }) => spawners.has(entry))
      .map(({ file, entry }) => `${file} -> ${entry}`)
      .sort();
    expect(
      offenders,
      `workspace files importing a Git-spawning module:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('has no import cycle of its own, so no binding can sit in a temporal dead zone', () => {
    // Enforced rather than assumed, for the same reason the import ledger above
    // exists: a comment in someone else's test file asserting this Module has a
    // `module.ts` <-> `binding.ts` cycle is what prompted this check, and the
    // claim was false in three ways at once — no such edge exists, the
    // directory's value-import graph is a DAG, and the symbol named
    // (`assertCarrierAgreesWithScope`) is a hoisted `function` declaration,
    // which is immune to the temporal dead zone even inside a real cycle.
    //
    // A future back-edge would be a genuine hazard, and it would present as an
    // unrelated crash far from here rather than as a failure of this Module. So
    // the property is asserted, and the failure names the edge.
    const sources = workspaceSources(repoRoot);
    const graph = buildWorkspaceGraph(repoRoot, sources);
    const cycles = importCycles(graph);
    expect(
      cycles.map((cycle) => cycle.join(' <-> ')),
      `import cycles inside the workspace Module:\n${cycles.map((c) => c.join(' <-> ')).join('\n')}`
    ).toEqual([]);
    // Derivation sanity: an empty or unresolved graph would make the assertion
    // above pass by having nothing to search.
    expect(graph.size).toBe(sources.length);
    expect(graph.get(`${WORKSPACE_DIR}/module.ts`)).toContain(`${WORKSPACE_DIR}/binding.ts`);
  });

  it('reports a back-edge that would create one', () => {
    // The discrimination, in the exact shape the false report described:
    // `binding.ts` importing back from `module.ts`.
    const smuggled = workspaceSources(repoRoot).map((source) =>
      source.name === 'binding.ts'
        ? {
            ...source,
            code: `import { completeChangeBinding } from './module.js';\n${source.code}`,
          }
        : source
    );
    const cycles = importCycles(buildWorkspaceGraph(repoRoot, smuggled));
    expect(cycles).toHaveLength(1);
    // The component is wider than the two files, because `module.ts` also
    // reaches `binding.ts` through `apply.ts`, `cleanup.ts`, and `plan.ts` —
    // which is exactly the point: one back-edge makes five modules mutually
    // dependent, and the guard names all of them rather than the edge alone.
    const component = cycles[0] as string[];
    expect(component).toContain(`${WORKSPACE_DIR}/binding.ts`);
    expect(component).toContain(`${WORKSPACE_DIR}/module.ts`);
    expect(component.length).toBeGreaterThan(2);
  });

  it('fails when a sibling Git-spawning module is imported, in the shape a maintainer would write', () => {
    // The concrete scenario: the natural next step from "the command SHALL
    // print the pathspec the user may commit themselves" to actually committing
    // it. It introduces no Git token at all in this directory, so every check
    // that reads only this directory's text passes.
    const smuggled = workspaceSources(repoRoot).map((source) =>
      source.name === 'module.ts'
        ? {
            ...source,
            code: `import { commitStoreFiles } from '../git.js';\n${source.code}\nawait commitStoreFiles(storeRoot, pathspecs, message);`,
          }
        : source
    );

    // The three text-scanning checks are blind to it, which is the point.
    expect(smuggled.flatMap(({ file, code }) => verbOffenders(file, code))).toEqual([]);
    expect(smuggled.flatMap(({ file, code }) => forceOffenders(file, code))).toEqual([]);
    expect(smuggled.flatMap(({ file, code }) => spawnOffenders(file, code))).toEqual([
      `${WORKSPACE_DIR}/${SPAWN_FILE}: spawns 'git'`,
      `${WORKSPACE_DIR}/${SPAWN_FILE}: imports node:child_process`,
    ]);

    // Both import checks catch it, and each names the file and what it reached.
    const reached = externalImports(repoRoot, smuggled);
    expect(
      reached
        .filter(({ entry }) => !ALLOWED_EXTERNAL_IMPORTS.has(entry))
        .map(({ file, entry }) => `${file} -> ${entry}`)
    ).toEqual([`${WORKSPACE_DIR}/module.ts -> src/core/store/git.ts`]);
    expect(
      reached
        .filter(({ entry }) => gitSpawningModules(repoRoot).has(entry))
        .map(({ file, entry }) => `${file} -> ${entry}`)
    ).toEqual([`${WORKSPACE_DIR}/module.ts -> src/core/store/git.ts`]);
  });

  it('strips the verb declarations without deleting the code around them', () => {
    // The regression that hid finding 2(a): a strip anchored on the NAME rather
    // than the declaration deleted the spawn helper along with the constants,
    // and every guard above then scanned a file with its Git calls removed.
    const source = workspaceSources(repoRoot).find(({ name }) => name === SPAWN_FILE);
    expect(source).toBeDefined();
    const code = (source as WorkspaceSource).code;
    const scanned = withoutVerbDeclarations(code);

    for (const survivor of [
      "execFilePromise('git'",
      'function nonEmptyLines',
      'async worktreeList',
      'may never force a worktree removal',
      'async removeWorktree',
    ]) {
      expect(scanned, `the strip deleted real adapter code: ${survivor}`).toContain(survivor);
    }
    // And the declarations themselves are gone, so they are not offenders.
    expect(scanned).not.toContain("Object.freeze(['worktree'])");
    // Four declarations, ~460 characters. The broken strip removed 2,903.
    expect(code.length - scanned.length).toBeLessThan(1000);
  });

  it('fails on a forbidden verb inserted ANYWHERE a statement can go in the adapter', () => {
    // The real discrimination proof. Each bypass is inserted after every line of
    // the real adapter where a statement is legal, and the guard must report an
    // offender at every one of them. A guard that fires only on the shape it was
    // written for is not a guard.
    const source = workspaceSources(repoRoot).find(({ name }) => name === SPAWN_FILE);
    const code = (source as WorkspaceSource).code;
    const lines = code.split('\n');

    // Lines inside the allow-list declarations are skipped: a statement cannot
    // legally be inserted into an array literal, so an insertion there is not a
    // bypass a maintainer could write. There are few of them, which is itself
    // the check — the broken strip would have made this set 65 lines larger.
    const declarationLines = new Set<number>();
    for (const match of code.matchAll(
      /\b(?:export\s+)?const\s+(?:GIT_WRITE_VERBS|GIT_READ_VERBS|GIT_WORKTREE_SUBCOMMANDS|ALLOWED_GIT_VERBS)\b[^=]*=[\s\S]*?\]\)?;/gu
    )) {
      const start = code.slice(0, match.index ?? 0).split('\n').length - 1;
      const end = start + (match[0].split('\n').length - 1);
      for (let line = start; line <= end; line += 1) declarationLines.add(line);
    }
    expect(declarationLines.size).toBeLessThan(30);

    const bypasses = [
      // (a) the canonical first-element shape the old matcher did catch
      "    await spawnGit(root, ['checkout', '--detach', oid]);",
      // (b) the module's OWN spawn shape, with the verb at index 2. This one
      //     also bypasses the runtime allow-list, because it never enters
      //     `spawnGit` — both layers missed it before.
      "    await execFilePromise('git', ['-C', repoRoot, 'branch', '-D', branch]);",
      // (c) a forced worktree removal, which the design forbids under any flag
      "    await spawnGit(repoRoot, ['worktree', 'remove', '--force', target]);",
    ];

    const missed: string[] = [];
    for (const bypass of bypasses) {
      for (let index = 0; index < lines.length; index += 1) {
        if (declarationLines.has(index)) continue;
        const mutated = [...lines.slice(0, index + 1), bypass, ...lines.slice(index + 1)].join(
          '\n'
        );
        const caught =
          verbOffenders(SPAWN_FILE, mutated).length > 0 ||
          forceOffenders(SPAWN_FILE, mutated).length > 0 ||
          spawnOffenders(SPAWN_FILE, mutated).length > 2;
        if (!caught) missed.push(`${bypass.trim()} @ line ${index + 1}`);
      }
    }
    expect(missed, `bypasses the guard did not catch:\n${missed.slice(0, 20).join('\n')}`).toEqual(
      []
    );
  });

  it('does not fire on the permitted neighbours it is one character away from', () => {
    // The other half of discrimination: a guard that fires on everything is as
    // useless as one that fires on nothing, and `merge-base` / `worktree add`
    // are both permitted spellings of forbidden-looking words.
    const permitted = [
      "await spawnGit(root, ['merge-base', '--is-ancestor', a, b]);",
      "await spawnGit(repoRoot, ['worktree', 'add', '-b', branchName, destination, commit]);",
      "const resolved = targets[0]?.objectType === 'commit' ? targets[0] : undefined;",
      "const action = { kind: 'add', destination };",
    ].join('\n');
    expect(verbOffenders('synthetic.ts', permitted)).toEqual([]);
    expect(forceOffenders('synthetic.ts', permitted)).toEqual([]);
  });
});
