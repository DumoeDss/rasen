/**
 * Machine-global learned-skill ledger (design D9).
 *
 * A project's artifact ledger cannot own a shared, project-independent skill
 * path. For a tool whose skill adapter exposes only a machine-global skill home
 * (currently Hermes), the set of materialized global learned skills is the same
 * for every project on the machine, so their ownership is tracked here — under
 * the global data directory — rather than in any one project's ledger. One
 * project's applicability result therefore can never remove a shared global
 * copy installed for another project.
 *
 * The file records, per tool, the exact generated target (absolute path +
 * sha256) and the canonical content digest for each materialized global
 * learned skill, mirroring the project ledger's learned section.
 */

import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { getGlobalDataDir } from './global-config.js';

export const GLOBAL_LEARNED_LEDGER_VERSION = 2 as const;
export const GLOBAL_LEARNED_LEDGER_FILE = 'learned-skill-global-ledger.json';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

const LegacyGlobalLearnedArtifactSchema = z.strictObject({
  contentDigest: z.string().regex(sha256Pattern),
  /** Absolute generated target file (the materialized SKILL.md). */
  path: z.string().min(1).refine((value) => path.isAbsolute(value), {
    message: 'global learned artifact paths must be absolute',
  }),
  sha256: z.string().regex(sha256Pattern),
});

const GlobalSourceSchema = z.strictObject({
  owner: z.strictObject({ type: z.literal('global') }),
  id: z.string().min(1),
});

const GlobalLearnedArtifactSchema = z.strictObject({
  effectiveScope: z.literal('global'),
  sources: z.array(GlobalSourceSchema).min(1).max(1),
  canonicalContentDigest: z.string().regex(sha256Pattern),
  resolutionDigest: z.string().regex(sha256Pattern),
  /** Absolute generated target file (the materialized SKILL.md). */
  path: z.string().min(1).refine((value) => path.isAbsolute(value), {
    message: 'global learned artifact paths must be absolute',
  }),
  sha256: z.string().regex(sha256Pattern),
});

const LegacyGlobalLearnedLedgerSchema = z.strictObject({
  version: z.literal(1),
  tools: z.record(
    z.string(),
    z.strictObject({ learned: z.record(z.string(), LegacyGlobalLearnedArtifactSchema) })
  ),
});

const GlobalLearnedLedgerSchema = z
  .strictObject({
    version: z.literal(2),
    tools: z.record(
      z.string(),
      z.strictObject({ learned: z.record(z.string(), GlobalLearnedArtifactSchema) })
    ),
  })
  .superRefine((ledger, context) => {
    for (const [toolId, tool] of Object.entries(ledger.tools)) {
      for (const [id, entry] of Object.entries(tool.learned)) {
        if (entry.sources[0]?.id !== id) {
          context.addIssue({
            code: 'custom',
            path: ['tools', toolId, 'learned', id, 'sources', 0, 'id'],
            message: 'global learned source id must match its ledger map key',
          });
        }
      }
    }
  });

export type GlobalLearnedArtifactEntry = z.infer<typeof GlobalLearnedArtifactSchema>;
type GlobalLearnedLedger = z.infer<typeof GlobalLearnedLedgerSchema>;

export class GlobalLearnedLedgerError extends Error {
  constructor(message: string, readonly code: 'ledger_unreadable' | 'ledger_invalid') {
    super(message);
    this.name = 'GlobalLearnedLedgerError';
  }
}

export function getGlobalLearnedLedgerPath(globalDataDir?: string): string {
  const root = globalDataDir ?? getGlobalDataDir();
  return path.join(path.resolve(root), GLOBAL_LEARNED_LEDGER_FILE);
}

function emptyGlobalLearnedLedger(): GlobalLearnedLedger {
  return { version: GLOBAL_LEARNED_LEDGER_VERSION, tools: {} };
}

/**
 * Reads the machine-global learned ledger. Absence is empty; unreadable or
 * invalid ownership blocks mutation so a damaged ledger can never cause a
 * shared global copy to be treated as untracked and overwritten/pruned.
 */
function readGlobalLearnedLedger(globalDataDir?: string): GlobalLearnedLedger {
  const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyGlobalLearnedLedger();
    }
    throw new GlobalLearnedLedgerError(
      `Cannot read global learned ledger: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_unreadable'
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new GlobalLearnedLedgerError(
      `Global learned ledger is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_invalid'
    );
  }
  const current = GlobalLearnedLedgerSchema.safeParse(raw);
  if (current.success) return current.data;
  const legacy = LegacyGlobalLearnedLedgerSchema.safeParse(raw);
  if (!legacy.success) {
    const rawVersion =
      typeof raw === 'object' && raw !== null && 'version' in raw
        ? (raw as { version?: unknown }).version
        : undefined;
    throw new GlobalLearnedLedgerError(
      `Global learned ledger is invalid: ${
        (rawVersion === 1
          ? legacy.error.issues[0]?.message
          : current.error.issues[0]?.message) ?? 'schema mismatch'
      }`,
      'ledger_invalid'
    );
  }
  const tools: GlobalLearnedLedger['tools'] = {};
  for (const [toolId, tool] of Object.entries(legacy.data.tools)) {
    const learned: Record<string, GlobalLearnedArtifactEntry> = {};
    for (const [id, entry] of Object.entries(tool.learned)) {
      learned[id] = {
        effectiveScope: 'global',
        sources: [{ owner: { type: 'global' }, id }],
        canonicalContentDigest: entry.contentDigest,
        // The legacy content digest is the only stable resolution identity
        // available and already satisfies the strict sha256 contract.
        resolutionDigest: entry.contentDigest,
        path: entry.path,
        sha256: entry.sha256,
      };
    }
    tools[toolId] = { learned };
  }
  return { version: GLOBAL_LEARNED_LEDGER_VERSION, tools };
}

function writeGlobalLearnedLedger(globalDataDir: string | undefined, ledger: GlobalLearnedLedger): void {
  const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
  const hasEntries = Object.values(ledger.tools).some(
    (tool) => Object.keys(tool.learned).length > 0
  );
  if (!hasEntries) {
    fs.rmSync(ledgerPath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = path.join(
    path.dirname(ledgerPath),
    `.${path.basename(ledgerPath)}.${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  );
  fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const backup = `${temporary}.bak`;
  try {
    if (!fs.existsSync(ledgerPath)) {
      fs.renameSync(temporary, ledgerPath);
      return;
    }
    fs.renameSync(ledgerPath, backup);
    try {
      fs.renameSync(temporary, ledgerPath);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      fs.rmSync(ledgerPath, { force: true });
      fs.renameSync(backup, ledgerPath);
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** The materialized global learned skills tracked for one tool. */
export function readGlobalLearnedArtifacts(
  globalDataDir: string | undefined,
  toolId: string
): Record<string, GlobalLearnedArtifactEntry> {
  return readGlobalLearnedLedger(globalDataDir).tools[toolId]?.learned ?? {};
}

/** Persists the materialized global learned skills for one tool. */
export function persistGlobalLearnedArtifacts(
  globalDataDir: string | undefined,
  toolId: string,
  learned: Record<string, GlobalLearnedArtifactEntry>
): void {
  for (const [id, entry] of Object.entries(learned)) {
    const parsed = GlobalLearnedArtifactSchema.safeParse(entry);
    if (
      !parsed.success ||
      parsed.data.sources[0]?.id !== id ||
      parsed.data.sources[0]?.owner.type !== 'global'
    ) {
      throw new GlobalLearnedLedgerError(
        `Machine-global learned ledger rejected non-global or invalid source identity for "${id}".`,
        'ledger_invalid'
      );
    }
  }
  const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
  let needsVersionUpgrade = false;
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) as { version?: unknown };
    needsVersionUpgrade = raw.version === 1;
  } catch {
    // The strict read below owns invalid/unreadable diagnostics.
  }
  const ledger = readGlobalLearnedLedger(globalDataDir);
  const before = JSON.stringify(ledger);
  if (Object.keys(learned).length > 0) {
    ledger.tools[toolId] = { learned };
  } else {
    delete ledger.tools[toolId];
  }
  if (before === JSON.stringify(ledger) && !needsVersionUpgrade) return;
  writeGlobalLearnedLedger(globalDataDir, ledger);
}

/** sha256:<hex> over a file's bytes, or null when it is absent/unsafe. */
export function sha256GlobalFile(filePath: string): string | null {
  try {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
  } catch {
    return null;
  }
}
