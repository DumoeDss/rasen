import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

export const PROJECT_LEARNED_LEDGER_VERSION = 1 as const;
export const PROJECT_LEARNED_LEDGER_FILE = '.learned-skill-materializations.json';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/;
const OwnerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('global') }),
  z.strictObject({ type: z.literal('project'), id: z.string().min(1) }),
  z.strictObject({ type: z.literal('store'), id: z.string().min(1) }),
]);
const SourceSchema = z.strictObject({
  owner: OwnerSchema,
  id: z.string().min(1),
});
const ArtifactFileSchema = z.strictObject({
  scope: z.enum(['project', 'absolute']),
  path: z.string().min(1),
  sha256: z.string().regex(sha256Pattern),
}).superRefine((file, context) => {
  if (file.scope === 'absolute') {
    if (!path.isAbsolute(file.path)) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'absolute learned artifact paths must be absolute',
      });
    }
    return;
  }
  if (
    path.isAbsolute(file.path) ||
    file.path.includes('\\') ||
    file.path.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['path'],
      message: 'project learned artifact paths must be portable root-relative paths',
    });
  }
});
const ProjectLearnedArtifactSchema = z.strictObject({
  effectiveScope: z.enum(['project', 'store', 'global']),
  sources: z.array(SourceSchema).min(1),
  canonicalContentDigest: z.string().regex(sha256Pattern),
  resolutionDigest: z.string().regex(sha256Pattern),
  file: ArtifactFileSchema,
});
const StoreFactSchema = z.strictObject({
  lastMembership: z.enum(['member', 'not-member', 'unavailable']),
  relevant: z.boolean().optional(),
});
const ProjectLearnedLedgerSchema = z
  .strictObject({
    version: z.literal(PROJECT_LEARNED_LEDGER_VERSION),
    stores: z.record(z.string(), StoreFactSchema),
    tools: z.record(
      z.string(),
      z.strictObject({
        learned: z.record(z.string(), ProjectLearnedArtifactSchema),
      })
    ),
  })
  .superRefine((ledger, context) => {
    for (const [toolId, tool] of Object.entries(ledger.tools)) {
      for (const [id, entry] of Object.entries(tool.learned)) {
        for (const [sourceIndex, source] of entry.sources.entries()) {
          if (source.id !== id) {
            context.addIssue({
              code: 'custom',
              path: ['tools', toolId, 'learned', id, 'sources', sourceIndex, 'id'],
              message: 'learned source ids must match their ledger map key',
            });
          }
        }
      }
    }
  });

export type ProjectLearnedArtifactEntry = z.infer<typeof ProjectLearnedArtifactSchema>;
export type ProjectLearnedStoreFact = z.infer<typeof StoreFactSchema>;
export type ProjectLearnedLedger = z.infer<typeof ProjectLearnedLedgerSchema>;

export class ProjectLearnedLedgerError extends Error {
  constructor(message: string, readonly code: 'ledger_unreadable' | 'ledger_invalid') {
    super(message);
    this.name = 'ProjectLearnedLedgerError';
  }
}

export function getProjectLearnedLedgerPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), 'rasen', PROJECT_LEARNED_LEDGER_FILE);
}

function emptyLedger(): ProjectLearnedLedger {
  return { version: PROJECT_LEARNED_LEDGER_VERSION, stores: {}, tools: {} };
}

/** Strict reader: an invalid typed ledger blocks mutation instead of losing ownership. */
export function readProjectLearnedLedger(projectRoot: string): ProjectLearnedLedger | null {
  const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ProjectLearnedLedgerError(
      `Cannot read project learned ledger: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_unreadable'
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ProjectLearnedLedgerError(
      `Project learned ledger is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      'ledger_invalid'
    );
  }
  const parsed = ProjectLearnedLedgerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectLearnedLedgerError(
      `Project learned ledger is invalid: ${
        parsed.error.issues[0]?.message ?? 'schema mismatch'
      }`,
      'ledger_invalid'
    );
  }
  return parsed.data;
}

function writeProjectLearnedLedger(projectRoot: string, ledger: ProjectLearnedLedger): void {
  const ledgerPath = getProjectLearnedLedgerPath(projectRoot);
  const hasEntries =
    Object.keys(ledger.stores).length > 0 ||
    Object.values(ledger.tools).some((tool) => Object.keys(tool.learned).length > 0);
  if (!hasEntries) {
    fs.rmSync(ledgerPath, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const temporary = path.join(
    path.dirname(ledgerPath),
    `.${path.basename(ledgerPath)}.${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  );
  const backup = `${temporary}.bak`;
  fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
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

export function readProjectLearnedArtifacts(
  projectRoot: string,
  toolId: string
): Record<string, ProjectLearnedArtifactEntry> {
  return readProjectLearnedLedger(projectRoot)?.tools[toolId]?.learned ?? {};
}

export function readProjectLearnedStoreFacts(
  projectRoot: string
): Record<string, ProjectLearnedStoreFact> {
  return readProjectLearnedLedger(projectRoot)?.stores ?? {};
}

/** Every typed store mentioned by prior ownership or the prior availability snapshot. */
export function collectProjectLearnedStoreIds(projectRoot: string): string[] {
  const ledger = readProjectLearnedLedger(projectRoot);
  if (!ledger) return [];
  const ids = new Set(
    Object.entries(ledger.stores)
      .filter(
        ([, fact]) => fact.lastMembership === 'member' || fact.relevant === true
      )
      .map(([id]) => id)
  );
  for (const tool of Object.values(ledger.tools)) {
    for (const entry of Object.values(tool.learned)) {
      for (const source of entry.sources) {
        if (source.owner.type === 'store') ids.add(source.owner.id);
      }
    }
  }
  return [...ids].sort();
}

/**
 * Atomically persists one tool plus the command-wide store snapshot. Existing
 * tools are preserved so several adapters can share the same preflight plan.
 */
export function persistProjectLearnedArtifacts(
  projectRoot: string,
  toolId: string,
  learned: Record<string, ProjectLearnedArtifactEntry>,
  stores: Record<string, ProjectLearnedStoreFact>
): void {
  const current = readProjectLearnedLedger(projectRoot);
  const before = current ? JSON.stringify(current) : undefined;
  const ledger = current ?? emptyLedger();
  ledger.stores = Object.fromEntries(
    Object.entries(stores).sort(([left], [right]) => left.localeCompare(right))
  );
  if (Object.keys(learned).length > 0) {
    ledger.tools[toolId] = {
      learned: Object.fromEntries(
        Object.entries(learned).sort(([left], [right]) => left.localeCompare(right))
      ),
    };
  } else {
    delete ledger.tools[toolId];
  }
  if (before === JSON.stringify(ledger)) return;
  writeProjectLearnedLedger(projectRoot, ledger);
}
