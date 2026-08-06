import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import {
  AUDIT_RUNTIMES,
  DISPATCH_BRIDGES,
  DISPATCH_RUNTIMES,
  PROBE_RUNTIMES,
  RUNTIME_ADAPTER_IDS,
} from '../../../src/core/runtime-adapters.js';
import { AUDIT_READERS } from '../../../src/core/runtimes/audit-readers.js';
import { CONTEXT_READERS } from '../../../src/core/runtimes/context-readers.js';
import { DISPATCH_ADAPTERS } from '../../../src/core/runtimes/dispatch-adapters.js';
import { SESSION_STORES } from '../../../src/core/runtimes/session-stores.js';

/**
 * The registry's derived-union machinery, reproduced standalone so the
 * compiler check runs in milliseconds instead of pulling the whole program in.
 * It must mirror `runtime-adapters.ts`; the runtime assertions below pin the
 * real maps, and this pins the mechanism those maps rely on.
 */
const HARNESS = `
const RUNTIME_ADAPTERS = {
  claude: { canProbeContext: true, canAudit: true, canDispatch: true },
  codex: { canProbeContext: true, canAudit: true, canDispatch: true },
  zed: { canProbeContext: false, canAudit: true, canDispatch: false },
  omp: { canProbeContext: false, canAudit: false, canDispatch: false },
} as const;
type Id = keyof typeof RUNTIME_ADAPTERS;
type For<C extends 'canProbeContext' | 'canAudit' | 'canDispatch'> = {
  [R in Id]: (typeof RUNTIME_ADAPTERS)[R][C] extends true ? R : never;
}[Id];
type ProbeRuntime = For<'canProbeContext'>;
interface ContextReader<I extends ProbeRuntime = ProbeRuntime> { id: I; read(p: string): number }
const claudeReader: ContextReader<'claude'> = { id: 'claude', read: () => 1 };
const codexReader: ContextReader<'codex'> = { id: 'codex', read: () => 1 };
`;

function compile(source: string): ts.Diagnostic[] {
  const fileName = '/probe.ts';
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    writeFile: () => undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? source : undefined),
  };
  const program = ts.createProgram([fileName], { strict: true, noEmit: true, noLib: true }, host);
  return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
}

describe('registry build enforcement', () => {
  it('compiles clean when every declared capability has an implementation', () => {
    const diagnostics = compile(
      `${HARNESS}
export const OK = { claude: claudeReader, codex: codexReader } satisfies {
  [I in ProbeRuntime]: ContextReader<I>;
};`
    );
    expect(diagnostics.map((d) => d.code)).toEqual([]);
  });

  it('fails the build when a declared capability has no implementation', () => {
    const diagnostics = compile(
      `${HARNESS}
export const MISSING = { claude: claudeReader } satisfies {
  [I in ProbeRuntime]: ContextReader<I>;
};`
    );
    expect(diagnostics.map((d) => d.code)).toContain(1360);
    expect(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')).toContain('codex');
  });

  it('fails the build when an implementation has no declared capability', () => {
    const diagnostics = compile(
      `${HARNESS}
export const EXTRA = {
  claude: claudeReader,
  codex: codexReader,
  omp: { id: 'omp' as never, read: () => 1 },
} satisfies { [I in ProbeRuntime]: ContextReader<I> };`
    );
    expect(diagnostics.map((d) => d.code)).toContain(2353);
    expect(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')).toContain('omp');
  });
});

describe('shipped registry maps', () => {
  // The compiler check above proves the mechanism; these pin the real maps,
  // which is what actually regresses when someone edits one of them.
  it.each([
    ['SESSION_STORES', SESSION_STORES, RUNTIME_ADAPTER_IDS],
    ['CONTEXT_READERS', CONTEXT_READERS, PROBE_RUNTIMES],
    ['AUDIT_READERS', AUDIT_READERS, AUDIT_RUNTIMES],
    ['DISPATCH_ADAPTERS', DISPATCH_ADAPTERS, DISPATCH_RUNTIMES],
  ] as const)('%s covers exactly its derived runtime set', (_name, map, expected) => {
    expect(Object.keys(map).sort()).toEqual([...expected].sort());
  });

  it.each([
    ['SESSION_STORES', SESSION_STORES],
    ['CONTEXT_READERS', CONTEXT_READERS],
    ['AUDIT_READERS', AUDIT_READERS],
    ['DISPATCH_ADAPTERS', DISPATCH_ADAPTERS],
  ] as const)('%s keys its entries by the id each entry reports', (_name, map) => {
    for (const [key, adapter] of Object.entries(map)) {
      expect(adapter.id).toBe(key);
    }
  });

  it('gives every registered runtime a session store, capability or not', () => {
    expect(Object.keys(SESSION_STORES).sort()).toEqual([...RUNTIME_ADAPTER_IDS].sort());
    expect(SESSION_STORES.omp.locateLatest).toBeUndefined();
    expect(SESSION_STORES.zed.locateLatest).toBeUndefined();
  });

  it('agrees with the leaf bridge table each adapter is typed against', () => {
    for (const [target, bridge] of Object.entries(DISPATCH_BRIDGES)) {
      expect(DISPATCH_ADAPTERS[target as keyof typeof DISPATCH_ADAPTERS].bridge).toBe(bridge);
    }
  });

  it('declares a child identity only for a spawn Rasen actually owns', () => {
    expect(DISPATCH_ADAPTERS.claude.spawn).toBe('rasen-owned');
    expect(DISPATCH_ADAPTERS.claude.childEnv).toEqual({ RASEN_AGENT_RUNTIME: 'claude' });
    // Codex returns argv and the playbook owns the process, so there is no
    // spawn site to inject an environment into (design D7).
    expect(DISPATCH_ADAPTERS.codex.spawn).toBe('playbook-owned');
    expect(DISPATCH_ADAPTERS.codex.childEnv).toBeUndefined();
  });
});
