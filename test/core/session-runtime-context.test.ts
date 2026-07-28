import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  RASEN_SESSION_CONTEXT_ENV,
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
      version: 1,
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
        JSON.stringify({ version: 1, sessionId: 'session-5', planning: {}, execution: {} }),
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
