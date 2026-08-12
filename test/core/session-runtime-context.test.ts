import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  RASEN_SESSION_CONTEXT_ENV,
  RUNTIME_CONTEXT_VERSION,
  buildRuntimeContext,
  planningRefFor,
  readSessionRuntimeContext,
  readSessionRuntimeContextFile,
  removeSessionRuntimeContext,
  requireSessionRuntimeContext,
  sessionRuntimeContextDir,
  sessionRuntimeContextPath,
  writeSessionRuntimeContext,
  isSessionContextError,
  type RuntimeContext,
} from '../../src/core/session-runtime-context.js';
import { cleanupTempPathAsync } from '../helpers/temp-cleanup.js';

describe('session runtime context', () => {
  let tempDir: string;
  let dataDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-runtime-context-'));
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempPathAsync(tempDir);
  });

  function contextFor(sessionId: string): RuntimeContext {
    return {
      version: RUNTIME_CONTEXT_VERSION,
      sessionId,
      planning: { type: 'store', id: 'team-store', root: path.join(tempDir, 'store') },
      execution: {
        kind: 'project',
        projectId: 'project-a',
        root: path.join(tempDir, 'checkout'),
      },
    };
  }

  describe('paths', () => {
    it('composes the context path under the machine data directory with path.join', () => {
      expect(sessionRuntimeContextPath('abc', { globalDataDir: dataDir })).toBe(
        path.join(dataDir, 'sessions', 'abc', 'context.json')
      );
      expect(sessionRuntimeContextDir('abc', { globalDataDir: dataDir })).toBe(
        path.join(dataDir, 'sessions', 'abc')
      );
    });
  });

  describe('planning ref', () => {
    it('records a project planning space by its project identity', () => {
      expect(planningRefFor({ type: 'project', id: 'p1', root: '/repo' })).toEqual({
        type: 'project',
        projectId: 'p1',
        root: '/repo',
      });
    });

    it('records a Store planning space by its display alias and root', () => {
      expect(planningRefFor({ type: 'store', id: 'team-store', root: '/store' })).toEqual({
        type: 'store',
        id: 'team-store',
        root: '/store',
      });
    });
  });

  describe('buildRuntimeContext', () => {
    it('records planning-only as an explicit fact', () => {
      const built = buildRuntimeContext({
        sessionId: 's1',
        space: { type: 'store', id: 'team-store', root: '/store' },
        execution: { kind: 'planning-only' },
      });
      expect(built?.execution).toEqual({ kind: 'planning-only' });
    });

    it('produces nothing when the launch has no derivable planning space', () => {
      expect(
        buildRuntimeContext({
          sessionId: 's1',
          execution: { kind: 'project', projectId: 'p1', root: '/repo' },
        })
      ).toBeUndefined();
    });

    it('produces nothing when the launch project has no minted projectId', () => {
      expect(
        buildRuntimeContext({
          sessionId: 's1',
          space: { type: 'project', id: 'p1', root: '/repo' },
          execution: { kind: 'project', projectId: '', root: '/repo' },
        })
      ).toBeUndefined();
    });
  });

  describe('write and read', () => {
    it('round-trips a context through an atomic write, leaving no temp file behind', () => {
      const context = contextFor('session-1');
      const written = writeSessionRuntimeContext(context, { globalDataDir: dataDir });

      expect(written).toBe(sessionRuntimeContextPath('session-1', { globalDataDir: dataDir }));
      expect(fs.readdirSync(path.dirname(written))).toEqual(['context.json']);

      const read = readSessionRuntimeContextFile(written, { sessionId: 'session-1' });
      expect(read).toEqual({ kind: 'ok', context, path: written });
    });

    it('writes UTF-8 with no BOM', () => {
      const written = writeSessionRuntimeContext(contextFor('session-bom'), {
        globalDataDir: dataDir,
      });
      const bytes = fs.readFileSync(written);
      expect(bytes[0]).not.toBe(0xef);
    });

    it('reports a missing file rather than falling back', () => {
      const missing = sessionRuntimeContextPath('nope', { globalDataDir: dataDir });
      expect(readSessionRuntimeContextFile(missing)).toMatchObject({
        kind: 'broken',
        reason: 'missing',
        path: missing,
      });
    });

    it('reports an unparseable file rather than falling back', () => {
      const written = writeSessionRuntimeContext(contextFor('session-2'), {
        globalDataDir: dataDir,
      });
      fs.writeFileSync(written, '{ not json', 'utf-8');
      expect(readSessionRuntimeContextFile(written)).toMatchObject({
        kind: 'broken',
        reason: 'unreadable',
      });
    });

    it('reports a file that names a different session', () => {
      const written = writeSessionRuntimeContext(contextFor('session-3'), {
        globalDataDir: dataDir,
      });
      expect(readSessionRuntimeContextFile(written, { sessionId: 'session-other' })).toMatchObject({
        kind: 'broken',
        reason: 'session-mismatch',
      });
    });

    it('reports an unknown version distinctly from a schema failure', () => {
      const written = writeSessionRuntimeContext(contextFor('session-4'), {
        globalDataDir: dataDir,
      });
      fs.writeFileSync(
        written,
        JSON.stringify({ ...contextFor('session-4'), version: 99 }),
        'utf-8'
      );
      expect(readSessionRuntimeContextFile(written)).toMatchObject({
        kind: 'broken',
        reason: 'unknown-version',
      });
    });

    it('reports a schema violation as invalid', () => {
      const written = writeSessionRuntimeContext(contextFor('session-5'), {
        globalDataDir: dataDir,
      });
      fs.writeFileSync(
        written,
        JSON.stringify({
          version: RUNTIME_CONTEXT_VERSION,
          sessionId: 'session-5',
          planning: {},
          execution: {},
        }),
        'utf-8'
      );
      expect(readSessionRuntimeContextFile(written)).toMatchObject({
        kind: 'broken',
        reason: 'invalid',
      });
    });

    it('tolerates CRLF line endings and a stray BOM in a hand-edited file', () => {
      const context = contextFor('session-crlf');
      const written = writeSessionRuntimeContext(context, { globalDataDir: dataDir });
      fs.writeFileSync(
        written,
        `﻿${JSON.stringify(context, null, 2).replaceAll('\n', '\r\n')}\r\n`,
        'utf-8'
      );
      expect(readSessionRuntimeContextFile(written)).toMatchObject({ kind: 'ok' });
    });
  });

  /**
   * `store-planning-worktree-bindings` tasks 8.1-8.3, 8.6 and 8.7.
   *
   * A session freezes the COMPLETE pair, not just the two roots: without the
   * worktree instance identity a later command cannot tell "the same worktree,
   * addressed through another spelling" from "a different worktree". Facts that
   * do not exist stay ABSENT — a planning-only session has no pair, and an
   * unbound workspace has no pair identity.
   */
  describe('version 2: the frozen worktree pair', () => {
    const planningWorktree = {
      root: '/store--fix-a',
      worktreeInstanceId: 'wt_planning',
      ref: 'refs/heads/change/line-0.2/project-a/fix-a',
      headOid: 'a'.repeat(40),
    };
    const executionWorktree = {
      root: '/app-a--fix-a',
      worktreeInstanceId: 'wt_execution',
      ref: 'refs/heads/change/line-0.2/project-a/fix-a',
      headOid: 'b'.repeat(40),
    };

    it('is version 2', () => {
      expect(RUNTIME_CONTEXT_VERSION).toBe(2);
    });

    it('freezes both worktree sides, the Change instance, and the pair id', () => {
      const built = buildRuntimeContext({
        sessionId: 's-pair',
        space: {
          type: 'store',
          id: 'team-store',
          root: '/store',
          planning: { storeId: 'team-store', projectId: 'project-a', targetLineId: 'line-0.2' },
        },
        execution: { kind: 'project', projectId: 'project-a', root: '/app-a' },
        workspace: {
          planning: planningWorktree,
          execution: executionWorktree,
          changeInstanceId: 'ci_abc',
          workspacePairId: 'wp_abc',
        },
      });

      expect(built?.version).toBe(2);
      expect(built?.planning).toEqual({
        type: 'store',
        id: 'team-store',
        projectId: 'project-a',
        targetLineId: 'line-0.2',
        root: '/store',
        worktree: planningWorktree,
      });
      expect(built?.execution).toEqual({
        kind: 'project',
        projectId: 'project-a',
        root: '/app-a',
        worktree: executionWorktree,
      });
      expect(built?.changeInstanceId).toBe('ci_abc');
      expect(built?.workspacePairId).toBe('wp_abc');
      // The frozen shape survives the file round-trip unchanged.
      const written = writeSessionRuntimeContext(built as RuntimeContext, {
        globalDataDir: dataDir,
      });
      expect(readSessionRuntimeContextFile(written, { sessionId: 's-pair' })).toEqual({
        kind: 'ok',
        context: built,
        path: written,
      });
    });

    it('records no pair when none was resolved, rather than a null one', () => {
      const built = buildRuntimeContext({
        sessionId: 's-none',
        space: { type: 'store', id: 'team-store', root: '/store' },
        execution: { kind: 'project', projectId: 'project-a', root: '/app-a' },
      });

      expect(built?.planning).not.toHaveProperty('worktree');
      expect(built?.execution).not.toHaveProperty('worktree');
      expect(built).not.toHaveProperty('changeInstanceId');
      expect(built).not.toHaveProperty('workspacePairId');
      // Absence is representable and round-trips.
      const written = writeSessionRuntimeContext(built as RuntimeContext, {
        globalDataDir: dataDir,
      });
      expect(readSessionRuntimeContextFile(written, { sessionId: 's-none' })).toMatchObject({
        kind: 'ok',
      });
    });

    it('never attaches an execution worktree to a planning-only session', () => {
      const built = buildRuntimeContext({
        sessionId: 's-planning-only',
        space: { type: 'store', id: 'team-store', root: '/store' },
        execution: { kind: 'planning-only' },
        workspace: { planning: planningWorktree, execution: executionWorktree },
      });

      expect(built?.execution).toEqual({ kind: 'planning-only' });
      expect(built?.planning).toHaveProperty('worktree', planningWorktree);
    });

    it('reports a version-1 file as an unsupported version rather than parsing it partially', () => {
      // A session started by an earlier build and still running across an
      // upgrade. The repair is to restart the session; the file is
      // machine-local and dies with it, so nothing durable is affected.
      const written = writeSessionRuntimeContext(contextFor('session-v1'), {
        globalDataDir: dataDir,
      });
      fs.writeFileSync(
        written,
        JSON.stringify({
          version: 1,
          sessionId: 'session-v1',
          planning: { type: 'store', id: 'team-store', root: path.join(tempDir, 'store') },
          execution: { kind: 'project', projectId: 'project-a', root: path.join(tempDir, 'checkout') },
        }),
        'utf-8'
      );

      const read = readSessionRuntimeContextFile(written);
      expect(read).toMatchObject({ kind: 'broken', reason: 'unknown-version' });
      // No partial context leaked out of the read.
      expect(read).not.toHaveProperty('context');
    });

    it('rejects a frozen worktree with no instance identity, which is the whole point of freezing', () => {
      const written = writeSessionRuntimeContext(contextFor('session-partial'), {
        globalDataDir: dataDir,
      });
      const partial = contextFor('session-partial') as RuntimeContext;
      fs.writeFileSync(
        written,
        JSON.stringify({
          ...partial,
          planning: { ...partial.planning, worktree: { root: '/store--fix-a' } },
        }),
        'utf-8'
      );
      expect(readSessionRuntimeContextFile(written)).toMatchObject({
        kind: 'broken',
        reason: 'invalid',
      });
    });
  });

  describe('environment', () => {
    it('reports absent when the variable is unset', () => {
      expect(readSessionRuntimeContext({ env: {} })).toEqual({ kind: 'absent' });
      expect(readSessionRuntimeContext({ env: { [RASEN_SESSION_CONTEXT_ENV]: '  ' } })).toEqual({
        kind: 'absent',
      });
    });

    it('reads the context the variable points at', () => {
      const written = writeSessionRuntimeContext(contextFor('session-env'), {
        globalDataDir: dataDir,
      });
      expect(
        readSessionRuntimeContext({ env: { [RASEN_SESSION_CONTEXT_ENV]: written } })
      ).toMatchObject({ kind: 'ok' });
    });

    it('throws on a broken context instead of resolving from the working directory', () => {
      const missing = sessionRuntimeContextPath('gone', { globalDataDir: dataDir });
      let thrown: unknown;
      try {
        requireSessionRuntimeContext({ env: { [RASEN_SESSION_CONTEXT_ENV]: missing } });
      } catch (error) {
        thrown = error;
      }
      expect(isSessionContextError(thrown)).toBe(true);
      if (isSessionContextError(thrown)) {
        expect(thrown.broken.reason).toBe('missing');
        expect(thrown.broken.repair.length).toBeGreaterThan(0);
      }
    });

    it('returns undefined, not a throw, when no context was handed over', () => {
      expect(requireSessionRuntimeContext({ env: {} })).toBeUndefined();
    });
  });

  describe('removal', () => {
    it('removes the session directory and is a no-op when already gone', () => {
      writeSessionRuntimeContext(contextFor('session-rm'), { globalDataDir: dataDir });
      const dir = sessionRuntimeContextDir('session-rm', { globalDataDir: dataDir });
      expect(fs.existsSync(dir)).toBe(true);

      removeSessionRuntimeContext('session-rm', { globalDataDir: dataDir });
      expect(fs.existsSync(dir)).toBe(false);

      expect(() =>
        removeSessionRuntimeContext('session-rm', { globalDataDir: dataDir })
      ).not.toThrow();
    });

    it('leaves a crashed session s leftover file inert for a later session', () => {
      writeSessionRuntimeContext(contextFor('crashed'), { globalDataDir: dataDir });
      const leftover = sessionRuntimeContextPath('crashed', { globalDataDir: dataDir });

      // A later session asking with its OWN id gets a mismatch, never the
      // crashed session's answer.
      expect(readSessionRuntimeContextFile(leftover, { sessionId: 'later' })).toMatchObject({
        kind: 'broken',
        reason: 'session-mismatch',
      });
    });
  });
});
