import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import {
  AUDIT_RUNTIMES,
  DISPATCH_BRIDGES,
  DISPATCH_RUNTIMES,
  PROBE_RUNTIMES,
  RUNTIME_ADAPTER_IDS,
  detectHostRuntime,
} from '../../../src/core/runtime-adapters.js';
import { buildCodexExecInvocation, formatShellInvocation } from '../../../src/core/codex/index.js';
import { AUDIT_READERS } from '../../../src/core/runtimes/audit-readers.js';
import { CONTEXT_READERS } from '../../../src/core/runtimes/context-readers.js';
import { DISPATCH_ADAPTERS, bridgeChildEnv } from '../../../src/core/runtimes/dispatch-adapters.js';
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
  omp: { canProbeContext: true, canAudit: false, canDispatch: false },
} as const;
type Id = keyof typeof RUNTIME_ADAPTERS;
type For<C extends 'canProbeContext' | 'canAudit' | 'canDispatch'> = {
  [R in Id]: (typeof RUNTIME_ADAPTERS)[R][C] extends true ? R : never;
}[Id];
type ProbeRuntime = For<'canProbeContext'>;
interface ContextReader<I extends ProbeRuntime = ProbeRuntime> { id: I; read(p: string): number }
const claudeReader: ContextReader<'claude'> = { id: 'claude', read: () => 1 };
const codexReader: ContextReader<'codex'> = { id: 'codex', read: () => 1 };
const ompReader: ContextReader<'omp'> = { id: 'omp', read: () => 1 };
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
export const OK = { claude: claudeReader, codex: codexReader, omp: ompReader } satisfies {
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
    // `zed` is the non-declared runtime here, not `omp`: once Oh My Pi declares
    // `canProbeContext` an `omp` reader is legitimate, so using it would assert
    // the opposite of the mechanism under test.
    const diagnostics = compile(
      `${HARNESS}
export const EXTRA = {
  claude: claudeReader,
  codex: codexReader,
  omp: ompReader,
  zed: { id: 'zed' as never, read: () => 1 },
} satisfies { [I in ProbeRuntime]: ContextReader<I> };`
    );
    expect(diagnostics.map((d) => d.code)).toContain(2353);
    expect(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')).toContain('zed');
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
    // A locator comes with the probe capability, not with registration: `omp`
    // has both now, while `zed` is registered for recognition and audit only.
    expect(SESSION_STORES.omp.locateLatest).toBeDefined();
    expect(SESSION_STORES.zed.locateLatest).toBeUndefined();
  });

  it('agrees with the leaf bridge table each adapter is typed against', () => {
    for (const [target, bridge] of Object.entries(DISPATCH_BRIDGES)) {
      expect(DISPATCH_ADAPTERS[target as keyof typeof DISPATCH_ADAPTERS].bridge).toBe(bridge);
    }
  });

  it('gives EVERY dispatch target its own identity, whoever owns the spawn', () => {
    // The guarantee is required for every bridge, not just the one Rasen
    // spawns itself, so this iterates the registry rather than naming claude.
    // An adapter that omits `childEnv` or declares the WRONG id cannot reach
    // here — `RuntimeIdentityEnv<Id>` pins the value, so both are build errors.
    for (const [id, adapter] of Object.entries(DISPATCH_ADAPTERS)) {
      expect(adapter.childEnv.RASEN_AGENT_RUNTIME, id).toBe(id);
      const merged = bridgeChildEnv(id as keyof typeof DISPATCH_ADAPTERS, {
        CODEX_THREAD_ID: 'parent-thread',
        CARRIED: 'kept',
      });
      expect(merged.RASEN_AGENT_RUNTIME, id).toBe(id);
      // The spawning harness's fingerprints still reach the child; they are
      // outranked, not stripped.
      expect(merged.CODEX_THREAD_ID, id).toBe('parent-thread');
      expect(merged.CARRIED, id).toBe('kept');
    }
  });

  it('overwrites an ancestor worker identity instead of inheriting it', () => {
    // An identity is an environment variable, so it reaches the whole
    // descendant tree and outranks every fingerprint. Without a target of its
    // own, a Codex worker started beneath a bridged Claude worker would report
    // `claude` while holding Codex's fingerprints — a confident wrong answer,
    // and the reason the merge is keyed on the target rather than skipped for
    // a playbook-owned spawn.
    const bridgedClaudeWorker = bridgeChildEnv('claude', { CODEX_THREAD_ID: 'parent-thread' });
    expect(detectHostRuntime(bridgedClaudeWorker)).toEqual({
      runtime: 'claude',
      source: 'env-override',
    });
    expect(detectHostRuntime(bridgeChildEnv('codex', bridgedClaudeWorker))).toEqual({
      runtime: 'codex',
      source: 'env-override',
    });
  });

  it('surfaces the identity on the playbook-owned invocation Rasen cannot apply itself', () => {
    // `codex/invocation.ts` returns data and the playbook owns the process, so
    // the only way the identity reaches that child is by being rendered into
    // the command the playbook runs.
    expect(DISPATCH_ADAPTERS.codex.spawn).toBe('playbook-owned');
    const invocation = buildCodexExecInvocation({
      prompt: 'Task prompt.',
      outputLastMessagePath: '/tmp/last.txt',
      sandbox: 'read-only',
      model: 'm',
      effort: 'low',
    });
    expect(invocation.env).toEqual(DISPATCH_ADAPTERS.codex.childEnv);
    expect(formatShellInvocation(invocation)).toContain("RASEN_AGENT_RUNTIME='codex'");
  });
});
