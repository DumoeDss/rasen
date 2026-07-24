import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { AI_TOOLS } from './config.js';
import { resolveToolSkillsRoot } from './shared/index.js';
import {
  loadWorkflowCatalog,
  resolveWorkflowSelection,
  type WorkflowDefinition,
} from './workflow-registry/index.js';

export const WORKFLOW_ARTIFACT_LEDGER_VERSION = 1 as const;
export const WORKFLOW_ARTIFACT_LEDGER_FILE = '.workflow-artifacts.json';

const ArtifactFileSchema = z.strictObject({
  scope: z.enum(['project', 'absolute']),
  path: z.string().min(1),
  sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

const WorkflowEntrySchema = z.strictObject({
  source: z.string().min(1),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  files: z.array(ArtifactFileSchema),
});

/**
 * One materialized learned-skill copy generated into a tool's skill home.
 * Keyed in the ledger by the canonical learned-skill id, it records the source
 * scope, the canonical content digest (the refresh key), and the exact target
 * file (path + sha256) so update/init can refresh or prune ONLY the exact copy
 * Rasen generated — never a similarly named or human-authored directory.
 */
const LearnedArtifactSchema = z.strictObject({
  /** Canonical scope the materialization came from. */
  skillScope: z.enum(['project', 'global']),
  /** Canonical content digest of the source learned skill (refresh key). */
  contentDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  /** Exact generated target file (the materialized SKILL.md). */
  file: ArtifactFileSchema,
});

const ToolLedgerSchema = z.strictObject({
  workflows: z.record(z.string(), WorkflowEntrySchema),
  /** Learned-skill materializations (absent when none are tracked for the tool). */
  learned: z.record(z.string(), LearnedArtifactSchema).optional(),
});

const LedgerSchema = z.strictObject({
  version: z.literal(WORKFLOW_ARTIFACT_LEDGER_VERSION),
  workflows: z.array(z.string()),
  tools: z.record(z.string(), ToolLedgerSchema),
});

type ArtifactFile = z.infer<typeof ArtifactFileSchema>;
type WorkflowEntry = z.infer<typeof WorkflowEntrySchema>;
export type LearnedArtifactEntry = z.infer<typeof LearnedArtifactSchema>;
export type WorkflowArtifactLedger = z.infer<typeof LedgerSchema>;

export class WorkflowArtifactLedgerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'WorkflowArtifactLedgerError';
  }
}

export function getWorkflowArtifactLedgerPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), 'rasen', WORKFLOW_ARTIFACT_LEDGER_FILE);
}

function emptyLedger(): WorkflowArtifactLedger {
  return { version: WORKFLOW_ARTIFACT_LEDGER_VERSION, workflows: [], tools: {} };
}

export function readWorkflowArtifactLedger(projectRoot: string): WorkflowArtifactLedger | null {
  const ledgerPath = getWorkflowArtifactLedgerPath(projectRoot);
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new WorkflowArtifactLedgerError(
      `Cannot read workflow artifact ledger: ${error instanceof Error ? error.message : String(error)}`,
      'ledger_unreadable'
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new WorkflowArtifactLedgerError(
      `Workflow artifact ledger is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'ledger_invalid'
    );
  }
  const result = LedgerSchema.safeParse(raw);
  if (!result.success) {
    throw new WorkflowArtifactLedgerError(
      `Workflow artifact ledger is invalid: ${result.error.issues[0]?.message ?? 'schema mismatch'}`,
      'ledger_invalid'
    );
  }
  return result.data;
}

export function sha256File(filePath: string): string | null {
  try {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    return `sha256:${createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')}`;
  } catch {
    return null;
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function storedArtifactFile(projectRoot: string, filePath: string): Omit<ArtifactFile, 'sha256'> {
  const absolute = path.resolve(filePath);
  if (isWithin(projectRoot, absolute)) {
    return {
      scope: 'project',
      path: path.relative(path.resolve(projectRoot), absolute).split(path.sep).join('/'),
    };
  }
  return { scope: 'absolute', path: absolute };
}

export function resolveArtifactFile(projectRoot: string, file: ArtifactFile): string | null {
  if (file.scope === 'absolute') return path.isAbsolute(file.path) ? path.resolve(file.path) : null;
  if (path.isAbsolute(file.path) || file.path.split('/').includes('..')) return null;
  const resolved = path.resolve(projectRoot, ...file.path.split('/'));
  return isWithin(projectRoot, resolved) ? resolved : null;
}

function expectedArtifactPaths(
  projectRoot: string,
  toolId: string,
  definition: WorkflowDefinition
): string[] {
  const tool = AI_TOOLS.find((candidate) => candidate.value === toolId);
  if (!tool?.skillsDir) return [];
  const skillDir = path.join(resolveToolSkillsRoot(tool, projectRoot), definition.skill.dirName);
  const files = [path.join(skillDir, 'SKILL.md')];
  for (const file of definition.files) {
    if (file.path === 'SKILL.md' || file.path === 'workflow.yaml') continue;
    files.push(path.join(skillDir, ...file.path.split('/')));
  }
  return files.map((file) => path.resolve(file)).sort();
}

function artifactKey(file: Pick<ArtifactFile, 'scope' | 'path'>): string {
  return `${file.scope}:${file.path}`;
}

function buildWorkflowEntry(
  projectRoot: string,
  toolId: string,
  definition: WorkflowDefinition
): WorkflowEntry {
  const files = expectedArtifactPaths(projectRoot, toolId, definition).map((filePath) => {
    const digest = sha256File(filePath);
    if (!digest) {
      throw new WorkflowArtifactLedgerError(
        `Generated workflow artifact is missing or unsafe: ${filePath}`,
        'artifact_missing'
      );
    }
    return { ...storedArtifactFile(projectRoot, filePath), sha256: digest };
  });
  files.sort((left, right) => artifactKey(left).localeCompare(artifactKey(right)));
  return {
    source: definition.sourcePath ?? definition.source,
    digest: definition.digest,
    files,
  };
}

export function writeWorkflowArtifactLedger(projectRoot: string, ledger: WorkflowArtifactLedger): void {
  const ledgerPath = getWorkflowArtifactLedgerPath(projectRoot);
  const hasEntries = Object.values(ledger.tools).some(
    (tool) =>
      Object.keys(tool.workflows).length > 0 ||
      (tool.learned !== undefined && Object.keys(tool.learned).length > 0)
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

function containsSymlinkInChain(boundary: string, candidate: string): boolean {
  const resolvedBoundary = path.resolve(boundary);
  let current = path.resolve(candidate);
  if (!isWithin(resolvedBoundary, current)) return true;
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return true;
    }
    if (current === resolvedBoundary) return false;
    current = path.dirname(current);
  }
}

function isAllowedManagedPath(
  projectRoot: string,
  toolId: string,
  definition: WorkflowDefinition,
  candidate: string
): boolean {
  const tool = AI_TOOLS.find((item) => item.value === toolId);
  if (!tool?.skillsDir) return false;
  const skillsRoot = path.resolve(resolveToolSkillsRoot(tool, projectRoot));
  const expectedSkillPaths = new Set(
    expectedArtifactPaths(projectRoot, toolId, definition).map((item) => path.resolve(item))
  );
  const resolvedCandidate = path.resolve(candidate);
  if (!expectedSkillPaths.has(resolvedCandidate)) return false;
  const boundary = isWithin(projectRoot, resolvedCandidate) ? projectRoot : skillsRoot;
  return !containsSymlinkInChain(boundary, resolvedCandidate);
}

function removeEmptyParents(start: string, stop: string): void {
  let current = path.resolve(start);
  const boundary = path.resolve(stop);
  while (isWithin(boundary, current)) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    if (current === boundary) return;
    current = path.dirname(current);
  }
}

/**
 * Reconciles one successfully generated tool with its user-workflow ledger.
 * Only unchanged files recorded by the previous ledger are removed.
 */
export function syncWorkflowArtifactLedger(
  projectRoot: string,
  toolId: string,
  desiredWorkflows: readonly string[]
): { removedFiles: number } {
  const resolvedProject = path.resolve(projectRoot);
  const catalog = loadWorkflowCatalog();
  const selected = resolveWorkflowSelection(catalog, desiredWorkflows);
  const desiredUsers = selected.filter((definition) => definition.source === 'user');
  const ledger = readWorkflowArtifactLedger(resolvedProject) ?? emptyLedger();
  const previous = ledger.tools[toolId]?.workflows ?? {};
  const next: Record<string, WorkflowEntry> = {};

  for (const definition of desiredUsers) {
    next[definition.id] = buildWorkflowEntry(resolvedProject, toolId, definition);
  }

  let removedFiles = 0;
  for (const [workflowId, entry] of Object.entries(previous)) {
    const definition = catalog.get(workflowId);
    if (!definition || definition.source !== 'user') {
      next[workflowId] ??= entry;
      continue;
    }
    const keep = new Set((next[workflowId]?.files ?? []).map(artifactKey));
    const tool = AI_TOOLS.find((candidate) => candidate.value === toolId);
    if (!tool?.skillsDir) continue;
    const skillDir = path.join(resolveToolSkillsRoot(tool, resolvedProject), definition.skill.dirName);
    for (const file of entry.files) {
      if (keep.has(artifactKey(file))) continue;
      const candidate = resolveArtifactFile(resolvedProject, file);
      if (!candidate || !isAllowedManagedPath(resolvedProject, toolId, definition, candidate)) continue;
      if (sha256File(candidate) !== file.sha256) continue;
      if (!isAllowedManagedPath(resolvedProject, toolId, definition, candidate)) continue;
      fs.rmSync(candidate, { force: true });
      removedFiles += 1;
      if (isWithin(skillDir, candidate)) removeEmptyParents(path.dirname(candidate), skillDir);
    }
  }

  // Preserve any learned-skill materializations recorded for this tool — the
  // workflow reconciliation owns only the `workflows` section.
  const existingLearned = ledger.tools[toolId]?.learned;
  const hasLearned = existingLearned !== undefined && Object.keys(existingLearned).length > 0;
  if (Object.keys(next).length > 0 || hasLearned) {
    ledger.tools[toolId] = { workflows: next, ...(hasLearned ? { learned: existingLearned } : {}) };
  } else {
    delete ledger.tools[toolId];
  }
  ledger.workflows = [...new Set(
    Object.values(ledger.tools).flatMap((tool) => Object.keys(tool.workflows))
  )].sort();
  writeWorkflowArtifactLedger(resolvedProject, ledger);
  return { removedFiles };
}

/**
 * Reads the learned-skill materializations recorded for one tool, or an empty
 * map when the ledger is absent, unreadable, or has no learned section for it.
 * A read failure is treated as "nothing tracked" so a corrupt ledger never
 * blocks reconciliation (materialization re-derives desired state and rewrites).
 */
export function readToolLearnedArtifacts(
  projectRoot: string,
  toolId: string
): Record<string, LearnedArtifactEntry> {
  let ledger: WorkflowArtifactLedger | null;
  try {
    ledger = readWorkflowArtifactLedger(projectRoot);
  } catch {
    return {};
  }
  return ledger?.tools[toolId]?.learned ?? {};
}

/**
 * Persists the learned-skill materializations for one tool, preserving that
 * tool's workflow section. Passing an empty map clears the tool's learned
 * section (and removes the tool entry entirely when it then has no workflows).
 */
export function persistToolLearnedArtifacts(
  projectRoot: string,
  toolId: string,
  learned: Record<string, LearnedArtifactEntry>
): void {
  const resolvedProject = path.resolve(projectRoot);
  const ledger = readWorkflowArtifactLedger(resolvedProject) ?? emptyLedger();
  const workflows = ledger.tools[toolId]?.workflows ?? {};
  const hasLearned = Object.keys(learned).length > 0;
  if (Object.keys(workflows).length === 0 && !hasLearned) {
    delete ledger.tools[toolId];
  } else {
    ledger.tools[toolId] = { workflows, ...(hasLearned ? { learned } : {}) };
  }
  ledger.workflows = [...new Set(
    Object.values(ledger.tools).flatMap((tool) => Object.keys(tool.workflows))
  )].sort();
  writeWorkflowArtifactLedger(resolvedProject, ledger);
}

export function hasWorkflowArtifactLedgerDrift(
  projectRoot: string,
  toolIds: readonly string[],
  desiredWorkflows: readonly string[]
): boolean {
  const catalog = loadWorkflowCatalog();
  const desiredUsers = resolveWorkflowSelection(catalog, desiredWorkflows)
    .filter((definition) => definition.source === 'user');
  let ledger: WorkflowArtifactLedger | null;
  try {
    ledger = readWorkflowArtifactLedger(projectRoot);
  } catch {
    return true;
  }

  for (const toolId of toolIds) {
    const actual = ledger?.tools[toolId]?.workflows ?? {};
    if (Object.keys(actual).length !== desiredUsers.length) return true;
    for (const definition of desiredUsers) {
      const entry = actual[definition.id];
      if (!entry || entry.digest !== definition.digest || entry.source !== (definition.sourcePath ?? definition.source)) {
        return true;
      }
      const expected = expectedArtifactPaths(projectRoot, toolId, definition)
        .map((filePath) => storedArtifactFile(projectRoot, filePath));
      const expectedKeys = expected.map(artifactKey).sort();
      const actualKeys = entry.files.map(artifactKey).sort();
      if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index])) {
        return true;
      }
      for (const file of entry.files) {
        const filePath = resolveArtifactFile(projectRoot, file);
        if (!filePath || sha256File(filePath) !== file.sha256) return true;
      }
    }
  }
  return false;
}
