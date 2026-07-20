import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { CommandAdapterRegistry, getCommandFileId } from './command-generation/index.js';
import { AI_TOOLS } from './config.js';
import type { Delivery } from './global-config.js';
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

const LedgerSchema = z.strictObject({
  version: z.literal(WORKFLOW_ARTIFACT_LEDGER_VERSION),
  workflows: z.array(z.string()),
  tools: z.record(z.string(), z.strictObject({
    workflows: z.record(z.string(), WorkflowEntrySchema),
  })),
});

type ArtifactFile = z.infer<typeof ArtifactFileSchema>;
type WorkflowEntry = z.infer<typeof WorkflowEntrySchema>;
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

function sha256File(filePath: string): string | null {
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

function storedArtifactFile(projectRoot: string, filePath: string): Omit<ArtifactFile, 'sha256'> {
  const absolute = path.resolve(filePath);
  if (isWithin(projectRoot, absolute)) {
    return {
      scope: 'project',
      path: path.relative(path.resolve(projectRoot), absolute).split(path.sep).join('/'),
    };
  }
  return { scope: 'absolute', path: absolute };
}

function resolveArtifactFile(projectRoot: string, file: ArtifactFile): string | null {
  if (file.scope === 'absolute') return path.isAbsolute(file.path) ? path.resolve(file.path) : null;
  if (path.isAbsolute(file.path) || file.path.split('/').includes('..')) return null;
  const resolved = path.resolve(projectRoot, ...file.path.split('/'));
  return isWithin(projectRoot, resolved) ? resolved : null;
}

function expectedArtifactPaths(
  projectRoot: string,
  toolId: string,
  definition: WorkflowDefinition,
  delivery: Delivery
): string[] {
  const tool = AI_TOOLS.find((candidate) => candidate.value === toolId);
  if (!tool?.skillsDir) return [];
  const skillDir = path.join(resolveToolSkillsRoot(tool, projectRoot), definition.skill.dirName);
  const files = [path.join(skillDir, 'SKILL.md')];
  for (const file of definition.files) {
    if (file.path === 'SKILL.md' || file.path === 'workflow.yaml') continue;
    files.push(path.join(skillDir, ...file.path.split('/')));
  }
  if (delivery === 'both' && definition.command) {
    const adapter = CommandAdapterRegistry.get(toolId);
    if (adapter) {
      const commandPath = adapter.getFilePath(getCommandFileId(definition.command.content.id));
      files.push(path.isAbsolute(commandPath) ? commandPath : path.join(projectRoot, commandPath));
    }
  }
  return files.map((file) => path.resolve(file)).sort();
}

function artifactKey(file: Pick<ArtifactFile, 'scope' | 'path'>): string {
  return `${file.scope}:${file.path}`;
}

function buildWorkflowEntry(
  projectRoot: string,
  toolId: string,
  definition: WorkflowDefinition,
  delivery: Delivery
): WorkflowEntry {
  const files = expectedArtifactPaths(projectRoot, toolId, definition, delivery).map((filePath) => {
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

function writeLedger(projectRoot: string, ledger: WorkflowArtifactLedger): void {
  const ledgerPath = getWorkflowArtifactLedgerPath(projectRoot);
  const hasEntries = Object.values(ledger.tools).some(
    (tool) => Object.keys(tool.workflows).length > 0
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
  const skillDir = path.join(skillsRoot, definition.skill.dirName);
  const expectedSkillPaths = new Set(
    expectedArtifactPaths(projectRoot, toolId, definition, 'skills').map((item) => path.resolve(item))
  );
  const resolvedCandidate = path.resolve(candidate);
  if (expectedSkillPaths.has(resolvedCandidate)) {
    const boundary = isWithin(projectRoot, resolvedCandidate) ? projectRoot : skillsRoot;
    return !containsSymlinkInChain(boundary, resolvedCandidate);
  }
  if (!definition.command) return false;
  const adapter = CommandAdapterRegistry.get(toolId);
  if (!adapter) return false;
  const commandPath = adapter.getFilePath(getCommandFileId(definition.command.content.id));
  const absoluteCommandPath = path.isAbsolute(commandPath)
    ? path.resolve(commandPath)
    : path.resolve(projectRoot, commandPath);
  if (resolvedCandidate !== absoluteCommandPath) return false;
  const boundary = isWithin(projectRoot, resolvedCandidate)
    ? projectRoot
    : path.dirname(path.dirname(absoluteCommandPath));
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
  desiredWorkflows: readonly string[],
  delivery: Delivery
): { removedFiles: number } {
  const resolvedProject = path.resolve(projectRoot);
  const catalog = loadWorkflowCatalog();
  const selected = resolveWorkflowSelection(catalog, desiredWorkflows);
  const desiredUsers = selected.filter((definition) => definition.source === 'user');
  const ledger = readWorkflowArtifactLedger(resolvedProject) ?? emptyLedger();
  const previous = ledger.tools[toolId]?.workflows ?? {};
  const next: Record<string, WorkflowEntry> = {};

  for (const definition of desiredUsers) {
    next[definition.id] = buildWorkflowEntry(resolvedProject, toolId, definition, delivery);
  }

  let removedFiles = 0;
  for (const [workflowId, entry] of Object.entries(previous)) {
    const definition = catalog.get(workflowId);
    if (!definition || definition.source !== 'user') continue;
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

  if (Object.keys(next).length > 0) ledger.tools[toolId] = { workflows: next };
  else delete ledger.tools[toolId];
  ledger.workflows = [...new Set(
    Object.values(ledger.tools).flatMap((tool) => Object.keys(tool.workflows))
  )].sort();
  writeLedger(resolvedProject, ledger);
  return { removedFiles };
}

export function hasWorkflowArtifactLedgerDrift(
  projectRoot: string,
  toolIds: readonly string[],
  desiredWorkflows: readonly string[],
  delivery: Delivery
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
      const expected = expectedArtifactPaths(projectRoot, toolId, definition, delivery)
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
