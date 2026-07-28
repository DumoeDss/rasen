/**
 * The session runtime context (unified-session-runtime-context design D2/D3):
 * what a supervised Session records about where it plans, which project it is
 * working on, and which checkout of that project on THIS machine.
 *
 * Machine-local by construction. The file lives under the machine data
 * directory, never enters Git, is never shared, and dies with its session —
 * which is the only reason absolute roots are allowed inside it. Anything
 * recorded durably (manifests, ledgers, digests, frozen run-state) keeps
 * carrying identity WITHOUT a root; see `identity-types.ts`.
 *
 * The child process is handed the file's LOCATION through
 * `RASEN_SESSION_CONTEXT`, never the document: inlining it would put roots and
 * identifiers into the process table, every `ps` listing, and any log that
 * dumps the environment — and would hit quoting and length limits on Windows
 * besides.
 *
 * A reader that is pointed at a missing, unparseable, or mismatched file
 * reports it (`kind: 'broken'`). It never falls back to deriving context from
 * the working directory: a silent fallback here is exactly how a command ends
 * up in the wrong clone.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import { getGlobalDataDir } from './global-config.js';

/** The environment variable carrying the context FILE PATH (design D3). */
export const RASEN_SESSION_CONTEXT_ENV = 'RASEN_SESSION_CONTEXT';

/** Current context-file schema version. */
export const RUNTIME_CONTEXT_VERSION = 1;

const SESSIONS_DIR_NAME = 'sessions';
const CONTEXT_FILE_NAME = 'context.json';

/**
 * Where a session's planning artifacts live. `uid` is optional on the Store
 * arm — and only there — for the same reason child A made it optional on
 * `ResolvedStoreRef`: a Store whose metadata predates permanent identities
 * resolves legitimately with no identity yet.
 */
export type RuntimePlanningRef =
  | { type: 'project'; projectId: string; root: string }
  | { type: 'store'; uid?: string; id?: string; root: string };

/**
 * Which project the session works on, and where that checkout is. Planning-only
 * is an explicit arm, never an absent field.
 */
export type RuntimeExecutionRef =
  | { kind: 'planning-only' }
  | { kind: 'project'; projectId: string; root: string; home?: string };

export interface RuntimeContext {
  version: typeof RUNTIME_CONTEXT_VERSION;
  sessionId: string;
  planning: RuntimePlanningRef;
  execution: RuntimeExecutionRef;
}

export const RuntimePlanningRefSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('project'),
      projectId: z.string().min(1),
      root: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('store'),
      uid: z.string().min(1).optional(),
      id: z.string().min(1).optional(),
      root: z.string().min(1),
    })
    .strict(),
]);

export const RuntimeExecutionRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('planning-only') }).strict(),
  z
    .object({
      kind: z.literal('project'),
      projectId: z.string().min(1),
      root: z.string().min(1),
      home: z.string().min(1).optional(),
    })
    .strict(),
]);

export const RuntimeContextSchema = z
  .object({
    version: z.literal(RUNTIME_CONTEXT_VERSION),
    sessionId: z.string().min(1),
    planning: RuntimePlanningRefSchema,
    execution: RuntimeExecutionRefSchema,
  })
  .strict();

/**
 * The runtime planning ref for a session's planning space. `uid` is left off
 * the Store arm because the space resolver reports the Store's display alias
 * and root; a Store with legacy metadata legitimately has no identity yet, and
 * the root is the machine-local locator either way.
 *
 * Takes the space structurally rather than importing `SessionSpace`, so this
 * module stays free of the management-api graph.
 */
export function planningRefFor(space: {
  type: 'project' | 'store';
  id: string;
  root: string;
}): RuntimePlanningRef {
  return space.type === 'project'
    ? { type: 'project', projectId: space.id, root: space.root }
    : { type: 'store', id: space.id, root: space.root };
}

/**
 * The context to hand a session's child process, or `undefined` when the
 * launch cannot express one.
 *
 * Two launches legitimately produce no context, and both are the SAME
 * pre-existing situation: a cwd that yields no derivable planning space, and a
 * launch project that has no minted `projectId`. Neither can be named durably,
 * so nothing is written and the session keeps exactly today's cwd-derived
 * behavior. This is the "no session context" arm of design D4's ladder, not a
 * broken context.
 */
export function buildRuntimeContext(input: {
  sessionId: string;
  space?: { type: 'project' | 'store'; id: string; root: string };
  execution?: RuntimeExecutionRef;
}): RuntimeContext | undefined {
  if (!input.space || !input.execution) return undefined;
  if (input.execution.kind === 'project' && input.execution.projectId.length === 0) {
    return undefined;
  }
  return {
    version: RUNTIME_CONTEXT_VERSION,
    sessionId: input.sessionId,
    planning: planningRefFor(input.space),
    execution: input.execution,
  };
}

export interface SessionContextPathOptions {
  /** Machine data directory override; defaults to `getGlobalDataDir()`. */
  globalDataDir?: string;
}

/** `<machine data dir>/sessions/<sessionId>` (design D3). */
export function sessionRuntimeContextDir(
  sessionId: string,
  options: SessionContextPathOptions = {}
): string {
  const base = options.globalDataDir ?? getGlobalDataDir();
  return path.join(base, SESSIONS_DIR_NAME, sessionId);
}

/** `<machine data dir>/sessions/<sessionId>/context.json` (design D3). */
export function sessionRuntimeContextPath(
  sessionId: string,
  options: SessionContextPathOptions = {}
): string {
  return path.join(sessionRuntimeContextDir(sessionId, options), CONTEXT_FILE_NAME);
}

/**
 * Why a context pointer could not be honored. Each is REPORTED — never
 * silently swapped for cwd derivation.
 */
export type SessionContextBrokenReason =
  | 'missing'
  | 'unreadable'
  | 'invalid'
  | 'unknown-version'
  | 'session-mismatch';

export interface BrokenSessionContext {
  kind: 'broken';
  reason: SessionContextBrokenReason;
  path: string;
  message: string;
  /** Copy-pasteable repair guidance, in the portfolio's diagnostic style. */
  repair: string[];
}

export type SessionRuntimeContextRead =
  | { kind: 'absent' }
  | { kind: 'ok'; context: RuntimeContext; path: string }
  | BrokenSessionContext;

function broken(
  reason: SessionContextBrokenReason,
  contextPath: string,
  message: string
): BrokenSessionContext {
  return {
    kind: 'broken',
    reason,
    path: contextPath,
    message,
    repair: [
      `unset ${RASEN_SESSION_CONTEXT_ENV}`,
      'Relaunch the session so the supervisor rewrites its context file.',
    ],
  };
}

/**
 * Reads one context file. Tolerant of either line ending and of a UTF-8 BOM
 * (the file is written without one, but a hand-edit through a Windows editor
 * can add it and the failure would otherwise read as "unparseable JSON").
 */
export function readSessionRuntimeContextFile(
  contextPath: string,
  expected: { sessionId?: string } = {}
): Exclude<SessionRuntimeContextRead, { kind: 'absent' }> {
  let raw: string;
  try {
    raw = fs.readFileSync(contextPath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return broken(
        'missing',
        contextPath,
        `The session context file ${contextPath} does not exist.`
      );
    }
    return broken(
      'unreadable',
      contextPath,
      `The session context file ${contextPath} could not be read: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/u, ''));
  } catch {
    return broken(
      'unreadable',
      contextPath,
      `The session context file ${contextPath} is not valid JSON.`
    );
  }

  const declaredVersion = (parsed as { version?: unknown } | null)?.version;
  if (typeof declaredVersion === 'number' && declaredVersion !== RUNTIME_CONTEXT_VERSION) {
    return broken(
      'unknown-version',
      contextPath,
      `The session context file ${contextPath} declares version ${declaredVersion}; this Rasen build reads version ${RUNTIME_CONTEXT_VERSION}.`
    );
  }

  const result = RuntimeContextSchema.safeParse(parsed);
  if (!result.success) {
    return broken(
      'invalid',
      contextPath,
      `The session context file ${contextPath} does not match the session context schema.`
    );
  }

  if (expected.sessionId !== undefined && result.data.sessionId !== expected.sessionId) {
    return broken(
      'session-mismatch',
      contextPath,
      `The session context file ${contextPath} records session "${result.data.sessionId}", not "${expected.sessionId}".`
    );
  }

  return { kind: 'ok', context: result.data, path: contextPath };
}

/**
 * The session context this process was handed, if any. `absent` means the
 * environment variable is unset — the ONLY case where a caller legitimately
 * falls back to the working directory (design D4's third step).
 */
export function readSessionRuntimeContext(
  options: { env?: NodeJS.ProcessEnv; sessionId?: string } = {}
): SessionRuntimeContextRead {
  const env = options.env ?? process.env;
  const pointer = env[RASEN_SESSION_CONTEXT_ENV];
  if (pointer === undefined || pointer.trim().length === 0) return { kind: 'absent' };
  return readSessionRuntimeContextFile(
    pointer,
    options.sessionId === undefined ? {} : { sessionId: options.sessionId }
  );
}

export class SessionContextError extends Error {
  readonly broken: BrokenSessionContext;

  constructor(brokenContext: BrokenSessionContext) {
    super(brokenContext.message);
    this.name = 'SessionContextError';
    this.broken = brokenContext;
  }
}

export function isSessionContextError(error: unknown): error is SessionContextError {
  return error instanceof SessionContextError;
}

/**
 * The context, or undefined when none was handed over. A BROKEN context
 * throws — the whole point of D3 is that it is never quietly worked around.
 */
export function requireSessionRuntimeContext(
  options: { env?: NodeJS.ProcessEnv; sessionId?: string } = {}
): RuntimeContext | undefined {
  const read = readSessionRuntimeContext(options);
  if (read.kind === 'absent') return undefined;
  if (read.kind === 'broken') throw new SessionContextError(read);
  return read.context;
}

/**
 * Writes the context file atomically — temp file in the SAME directory, then
 * rename — so the agent can never observe a partial document (design D3,
 * task 4.1). Written UTF-8 with no BOM. Returns the file's absolute path.
 */
export function writeSessionRuntimeContext(
  context: RuntimeContext,
  options: SessionContextPathOptions = {}
): string {
  const dir = sessionRuntimeContextDir(context.sessionId, options);
  const target = path.join(dir, CONTEXT_FILE_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${CONTEXT_FILE_NAME}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(context, null, 2)}\n`, 'utf-8');
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The rename failed; the temp file is inert either way.
    }
    throw error;
  }
  return target;
}

/**
 * Removes a session's context directory. Best-effort by design (task 4.3): a
 * leftover directory is inert because its session id no longer resolves, and a
 * failure to clean up must never turn a finished session into an error.
 */
export function removeSessionRuntimeContext(
  sessionId: string,
  options: SessionContextPathOptions = {}
): void {
  try {
    fs.rmSync(sessionRuntimeContextDir(sessionId, options), {
      recursive: true,
      force: true,
    });
  } catch {
    // Best-effort: see the doc comment.
  }
}
