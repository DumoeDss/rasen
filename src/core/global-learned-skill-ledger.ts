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

export const GLOBAL_LEARNED_LEDGER_VERSION = 1 as const;
export const GLOBAL_LEARNED_LEDGER_FILE = 'learned-skill-global-ledger.json';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

const GlobalLearnedArtifactSchema = z.strictObject({
  contentDigest: z.string().regex(sha256Pattern),
  /** Absolute generated target file (the materialized SKILL.md). */
  path: z.string().min(1),
  sha256: z.string().regex(sha256Pattern),
});

const GlobalLearnedLedgerSchema = z.strictObject({
  version: z.literal(GLOBAL_LEARNED_LEDGER_VERSION),
  tools: z.record(
    z.string(),
    z.strictObject({ learned: z.record(z.string(), GlobalLearnedArtifactSchema) })
  ),
});

export type GlobalLearnedArtifactEntry = z.infer<typeof GlobalLearnedArtifactSchema>;
type GlobalLearnedLedger = z.infer<typeof GlobalLearnedLedgerSchema>;

export function getGlobalLearnedLedgerPath(globalDataDir?: string): string {
  const root = globalDataDir ?? getGlobalDataDir();
  return path.join(path.resolve(root), GLOBAL_LEARNED_LEDGER_FILE);
}

function emptyGlobalLearnedLedger(): GlobalLearnedLedger {
  return { version: GLOBAL_LEARNED_LEDGER_VERSION, tools: {} };
}

/**
 * Reads the machine-global learned ledger, returning an empty ledger when it is
 * absent, unreadable, or invalid so a corrupt file never blocks reconciliation
 * (materialization re-derives desired state and rewrites).
 */
function readGlobalLearnedLedger(globalDataDir?: string): GlobalLearnedLedger {
  const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return emptyGlobalLearnedLedger();
  }
  try {
    const result = GlobalLearnedLedgerSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : emptyGlobalLearnedLedger();
  } catch {
    return emptyGlobalLearnedLedger();
  }
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
  try {
    fs.renameSync(temporary, ledgerPath);
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
  const ledger = readGlobalLearnedLedger(globalDataDir);
  if (Object.keys(learned).length > 0) {
    ledger.tools[toolId] = { learned };
  } else {
    delete ledger.tools[toolId];
  }
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
