import { WORKSPACE_DIR_NAME } from './config.js';
import { WORKSPACE_SPECS_DIR } from './workspace-root.js';
/**
 * Spec Application Logic
 *
 * Extracted from ArchiveCommand to enable standalone spec application.
 * Applies delta specs from a change to main specs without archiving.
 */

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  extractRequirementsSection,
  parseDeltaSpec,
  normalizeRequirementName,
  type RequirementBlock,
} from './parsers/requirement-blocks.js';
import {
  findMainSpecStructureIssues,
  stripFencedCodeBlocksPreservingLines,
} from './parsers/spec-structure.js';
import { isKebabId } from './id.js';
import { Validator } from './validation/validator.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SpecUpdate {
  source: string;
  target: string;
  capability: string;
  exists: boolean;
  /** Exact delta bytes already admitted by a caller that must analyze one snapshot. */
  sourceSnapshot?: Uint8Array;
  /** Exact canonical bytes already admitted alongside sourceSnapshot. */
  targetSnapshot?: Uint8Array | null;
}

export interface DeltaSpecDiscovery {
  files: string[];
  issues: SpecReconciliationIssue[];
}

export interface SpecUpdateDiscovery {
  updates: SpecUpdate[];
  issues: SpecReconciliationIssue[];
}

export interface SpecOperationCounts {
  added: number;
  modified: number;
  removed: number;
  renamed: number;
}

export interface BuiltSpecUpdate {
  update: SpecUpdate;
  rebuilt: string;
  counts: SpecOperationCounts;
  emptied: boolean;
  sourceSha256: string;
  targetPrecondition:
    | { state: 'absent' }
    | { state: 'file'; sha256: string };
}

export type SpecReconciliationIssueCode =
  | 'spec_reconciliation_failed'
  | 'spec_delta_discovery_failed'
  | 'spec_delta_path_invalid'
  | 'spec_target_read_failed'
  | 'spec_delta_duplicate_added'
  | 'spec_delta_duplicate_modified'
  | 'spec_delta_duplicate_removed'
  | 'spec_delta_duplicate_renamed_from'
  | 'spec_delta_duplicate_renamed_to'
  | 'spec_modified_uses_renamed_source'
  | 'spec_renamed_target_conflicts_added'
  | 'spec_delta_cross_section_conflict'
  | 'spec_delta_no_operations'
  | 'spec_existing_target_required'
  | 'spec_target_structure_invalid'
  | 'spec_target_validation_failed'
  | 'spec_renamed_source_missing'
  | 'spec_renamed_target_exists'
  | 'spec_removed_requirement_missing'
  | 'spec_modified_requirement_not_found'
  | 'spec_modified_header_mismatch'
  | 'spec_modified_scenarios_missing'
  | 'spec_added_requirement_exists';

export interface SpecReconciliationIssue {
  code: SpecReconciliationIssueCode;
  source: string;
  capability: string;
  requirement?: string;
  missingScenarios?: string[];
  message: string;
}

export interface SpecReconciliationAnalysis {
  prepared: BuiltSpecUpdate[];
  issues: SpecReconciliationIssue[];
}

export class SpecReconciliationError extends Error {
  constructor(readonly issues: readonly SpecReconciliationIssue[]) {
    super(issues.map(issue => issue.message).join('\n'));
    this.name = 'SpecReconciliationError';
  }
}


export interface ApplyResult {
  capability: string;
  added: number;
  modified: number;
  removed: number;
  renamed: number;
}

export interface SpecsApplyOutput {
  changeName: string;
  capabilities: ApplyResult[];
  totals: {
    added: number;
    modified: number;
    removed: number;
    renamed: number;
  };
  noChanges: boolean;
}

interface ScenarioBlock {
  name: string;
  raw: string;
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Discover every delta `spec.md` below a change, preserving unreadable
 * directory failures instead of treating them as an empty change.
 */
export async function discoverDeltaSpecFiles(
  changeDir: string
): Promise<DeltaSpecDiscovery> {
  const files: string[] = [];
  const issues: SpecReconciliationIssue[] = [];
  const changeSpecsDir = path.join(changeDir, 'specs');

  async function visit(directory: string, root = false): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (root && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      issues.push({
        code: 'spec_delta_discovery_failed',
        source: directory,
        capability: path.basename(directory),
        message: `Cannot inspect delta spec directory ${directory}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile() && entry.name === 'spec.md') {
        const relative = path.relative(changeSpecsDir, absolute);
        const capabilitySegments = relative.split(path.sep).slice(0, -1);
        if (
          capabilitySegments.length === 0 ||
          capabilitySegments.some(segment => !isKebabId(segment))
        ) {
          issues.push({
            code: 'spec_delta_path_invalid',
            source: absolute,
            capability: capabilitySegments.join('/'),
            message:
              `Delta spec must be nested under specs/<capability>/spec.md using canonical lowercase kebab-case directory segments: ${absolute}`,
          });
          continue;
        }
        files.push(absolute);
      }
    }
  }

  await visit(changeSpecsDir, true);
  issues.sort(compareReconciliationIssues);
  return { files, issues };
}

/**
 * Find all delta spec files that need to be applied from a change.
 */
export async function findSpecUpdates(
  changeDir: string,
  mainSpecsDir: string,
  deltaDiscovery?: DeltaSpecDiscovery
): Promise<SpecUpdateDiscovery> {
  const discovery =
    deltaDiscovery ?? (await discoverDeltaSpecFiles(changeDir));
  const changeSpecsDir = path.join(changeDir, 'specs');
  const updates: SpecUpdate[] = [];

  for (const source of discovery.files) {
    const relative = path.relative(changeSpecsDir, source);
    const capability = path
      .dirname(relative)
      .split(path.sep)
      .join('/');
    const target = path.join(mainSpecsDir, relative);
    let exists = true;
    try {
      await fs.stat(target);
    } catch (error) {
      exists = (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    updates.push({ source, target, capability, exists });
  }

  return { updates, issues: [...discovery.issues] };
}

/**
 * Build an updated spec by applying delta operations.
 * Returns the rebuilt content and counts of operations.
 */
async function buildUpdatedSpecCore(
  update: SpecUpdate,
  changeName: string,
  options: { silent?: boolean; validateTarget?: boolean } = {}
): Promise<Omit<BuiltSpecUpdate, 'update'>> {
  // Bind the prepared result to the exact delta bytes used for parsing. Validation
  // may supply its already-admitted snapshot so shape and reconciliation checks
  // cannot observe different versions of the same delta.
  const sourceBytes =
    update.sourceSnapshot === undefined
      ? await fs.readFile(update.source)
      : Buffer.from(update.sourceSnapshot);
  const changeContent = sourceBytes.toString('utf8');
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');

  // Parse deltas from the change spec file
  const plan = parseDeltaSpec(changeContent);
  const specName = update.capability;

  // Pre-validate the full delta before simulating any operation. Independent
  // authoring defects are collected so one preview can report them together.
  const preflightIssues: SpecReconciliationIssue[] = [];
  const skippedAdded = new Set<string>();
  const skippedModified = new Set<string>();
  const skippedRemoved = new Set<string>();
  const skippedRenameFrom = new Set<string>();
  const skippedRenameTo = new Set<string>();
  const addedNames = new Set<string>();
  for (const add of plan.added) {
    const name = normalizeRequirementName(add.name);
    if (addedNames.has(name)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_delta_duplicate_added',
          `${specName} validation failed - duplicate requirement in ADDED for header "### Requirement: ${add.name}"`,
          add.name
        )
      );
      skippedAdded.add(name);
    }
    addedNames.add(name);
  }
  const modifiedNames = new Set<string>();
  for (const mod of plan.modified) {
    const name = normalizeRequirementName(mod.name);
    if (modifiedNames.has(name)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_delta_duplicate_modified',
          `${specName} validation failed - duplicate requirement in MODIFIED for header "### Requirement: ${mod.name}"`,
          mod.name
        )
      );
      skippedModified.add(name);
    }
    modifiedNames.add(name);
  }
  const removedNamesSet = new Set<string>();
  for (const rem of plan.removed) {
    const name = normalizeRequirementName(rem);
    if (removedNamesSet.has(name)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_delta_duplicate_removed',
          `${specName} validation failed - duplicate requirement in REMOVED for header "### Requirement: ${rem}"`,
          rem
        )
      );
      skippedRemoved.add(name);
    }
    removedNamesSet.add(name);
  }
  const renamedFromSet = new Set<string>();
  const renamedToSet = new Set<string>();
  for (const { from, to } of plan.renamed) {
    const fromNorm = normalizeRequirementName(from);
    const toNorm = normalizeRequirementName(to);
    if (renamedFromSet.has(fromNorm)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_delta_duplicate_renamed_from',
          `${specName} validation failed - duplicate FROM in RENAMED for header "### Requirement: ${from}"`,
          from
        )
      );
      skippedRenameFrom.add(fromNorm);
    }
    if (renamedToSet.has(toNorm)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_delta_duplicate_renamed_to',
          `${specName} validation failed - duplicate TO in RENAMED for header "### Requirement: ${to}"`,
          to
        )
      );
      skippedRenameTo.add(toNorm);
    }
    renamedFromSet.add(fromNorm);
    renamedToSet.add(toNorm);
  }

  const conflicts: Array<{ name: string; a: string; b: string }> = [];
  for (const name of modifiedNames) {
    if (removedNamesSet.has(name)) {
      conflicts.push({ name, a: 'MODIFIED', b: 'REMOVED' });
      skippedModified.add(name);
      skippedRemoved.add(name);
    }
    if (addedNames.has(name)) {
      conflicts.push({ name, a: 'MODIFIED', b: 'ADDED' });
      skippedModified.add(name);
      skippedAdded.add(name);
    }
  }
  for (const name of addedNames) {
    if (removedNamesSet.has(name)) {
      conflicts.push({ name, a: 'ADDED', b: 'REMOVED' });
      skippedAdded.add(name);
      skippedRemoved.add(name);
    }
  }
  for (const { from, to } of plan.renamed) {
    const fromNorm = normalizeRequirementName(from);
    const toNorm = normalizeRequirementName(to);
    if (modifiedNames.has(fromNorm)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_modified_uses_renamed_source',
          `${specName} validation failed - when a rename exists, MODIFIED must reference the NEW header "### Requirement: ${to}"`,
          from
        )
      );
      skippedModified.add(fromNorm);
    }
    if (addedNames.has(toNorm)) {
      preflightIssues.push(
        reconciliationIssue(
          update,
          'spec_renamed_target_conflicts_added',
          `${specName} validation failed - RENAMED TO header collides with ADDED for "### Requirement: ${to}"`,
          to
        )
      );
      skippedAdded.add(toNorm);
      skippedRenameTo.add(toNorm);
    }
  }
  for (const conflict of conflicts) {
    preflightIssues.push(
      reconciliationIssue(
        update,
        'spec_delta_cross_section_conflict',
        `${specName} validation failed - requirement present in multiple sections (${conflict.a} and ${conflict.b}) for header "### Requirement: ${conflict.name}"`,
        conflict.name
      )
    );
  }
  const hasAnyDelta =
    plan.added.length +
      plan.modified.length +
      plan.removed.length +
      plan.renamed.length >
    0;
  if (!hasAnyDelta) {
    preflightIssues.push(
      reconciliationIssue(
        update,
        'spec_delta_no_operations',
        `Delta parsing found no operations for ${path.basename(path.dirname(update.source))}. ` +
          'Provide ADDED/MODIFIED/REMOVED/RENAMED sections in change spec.'
      )
    );
  }
  if (!hasAnyDelta) {
    throw new SpecReconciliationError(preflightIssues);
  }
  // Load or create the base target and bind its exact bytes to the result.
  let targetContent: string;
  let targetPrecondition: BuiltSpecUpdate['targetPrecondition'];
  let isNewSpec = false;
  try {
    if (update.targetSnapshot === null) {
      const missing = new Error(`Canonical spec is absent: ${update.target}`);
      (missing as NodeJS.ErrnoException).code = 'ENOENT';
      throw missing;
    }
    const targetBytes =
      update.targetSnapshot === undefined
        ? await fs.readFile(update.target)
        : Buffer.from(update.targetSnapshot);
    targetContent = targetBytes.toString('utf8');
    targetPrecondition = {
      state: 'file',
      sha256: createHash('sha256').update(targetBytes).digest('hex'),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new SpecReconciliationError([
        ...preflightIssues,
        reconciliationIssue(
          update,
          'spec_target_read_failed',
          `Cannot read canonical spec ${update.target}: ${
            error instanceof Error ? error.message : String(error)
          }`
        ),
      ]);
    }
    // Target spec does not exist; every unambiguous MODIFIED and RENAMED
    // operation is an independent authoring failure for a new capability.
    const missingTargetIssues = [
      ...plan.modified
        .filter(
          mod => !skippedModified.has(normalizeRequirementName(mod.name))
        )
        .map(mod =>
          reconciliationIssue(
            update,
            'spec_existing_target_required',
            `${specName}: target spec does not exist; MODIFIED for "### Requirement: ${mod.name}" requires an existing spec. Only ADDED requirements are allowed for new specs.`,
            mod.name
          )
        ),
      ...plan.renamed
        .filter(rename => {
          const from = normalizeRequirementName(rename.from);
          const to = normalizeRequirementName(rename.to);
          return !skippedRenameFrom.has(from) && !skippedRenameTo.has(to);
        })
        .map(rename =>
          reconciliationIssue(
            update,
            'spec_existing_target_required',
            `${specName}: target spec does not exist; RENAMED to "### Requirement: ${rename.to}" requires an existing spec. Only ADDED requirements are allowed for new specs.`,
            rename.to
          )
        ),
    ];
    if (missingTargetIssues.length > 0) {
      throw new SpecReconciliationError([
        ...preflightIssues,
        ...missingTargetIssues,
      ]);
    }
    // Warn about REMOVED requirements being ignored for new specs.
    if (plan.removed.length > 0 && !options.silent) {
      console.log(
        chalk.yellow(
          `⚠️  Warning: ${specName} - ${plan.removed.length} REMOVED requirement(s) ignored for new spec (nothing to remove).`
        )
      );
    }
    isNewSpec = true;
    targetPrecondition = { state: 'absent' };
    targetContent = buildSpecSkeleton(specName, changeName);
  }

  const structureIssues = findMainSpecStructureIssues(targetContent);
  const structureDetails = structureIssues.map(
    issue => `line ${issue.line}: ${issue.message}`
  );
  if (
    !isNewSpec &&
    !/^##\s+Requirements\s*$/im.test(targetContent)
  ) {
    structureDetails.push('missing a "## Requirements" section');
  }
  if (structureDetails.length > 0) {
    throw new SpecReconciliationError([
      ...preflightIssues,
      reconciliationIssue(
        update,
        'spec_target_structure_invalid',
        `${specName}: target spec is structurally invalid and cannot be updated until fixed:\n${structureDetails.join('\n')}`
      ),
    ]);
  }


  // A canonical requirement inventory must be one-to-one before it can be
  // simulated. Building the map first would collapse normalized duplicates and
  // could incorrectly classify a single REMOVED operation as deleting the
  // entire capability.
  const parts = extractRequirementsSection(targetContent);
  const canonicalBlocks = new Map<string, RequirementBlock>();
  const duplicateCanonicalNames = new Set<string>();
  for (const block of parts.bodyBlocks) {
    const key = normalizeRequirementName(block.name);
    if (canonicalBlocks.has(key)) {
      duplicateCanonicalNames.add(key);
    } else {
      canonicalBlocks.set(key, block);
    }
  }
  if (duplicateCanonicalNames.size > 0) {
    const duplicates = [...duplicateCanonicalNames].sort();
    throw new SpecReconciliationError([
      ...preflightIssues,
      reconciliationIssue(
        update,
        'spec_target_structure_invalid',
        `${specName}: target spec is structurally invalid and cannot be updated until fixed:\n` +
          duplicates
            .map(
              name =>
                `duplicate canonical requirement header "### Requirement: ${name}"`
            )
            .join('\n')
      ),
    ]);
  }

  // Clone the canonical inventory for mutation. canonicalBlocks remains
  // immutable so every MODIFIED block is diagnosed against the admitted
  // baseline, including duplicate blocks whose mutation is ambiguous.
  const nameToBlock = new Map(canonicalBlocks);

  // Simulate operations in order: RENAMED → REMOVED → MODIFIED → ADDED.
  // Invalid operations do not mutate the simulation, but do not stop
  // independent operations from being checked.
  const operationIssues: SpecReconciliationIssue[] = [];

  for (const rename of plan.renamed) {
    const from = normalizeRequirementName(rename.from);
    const to = normalizeRequirementName(rename.to);
    if (skippedRenameFrom.has(from) || skippedRenameTo.has(to)) continue;
    const block = nameToBlock.get(from);
    if (block === undefined) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_renamed_source_missing',
          `${specName} RENAMED failed for header "### Requirement: ${rename.from}" - source not found`,
          rename.from
        )
      );
    }
    if (nameToBlock.has(to)) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_renamed_target_exists',
          `${specName} RENAMED failed for header "### Requirement: ${rename.to}" - target already exists`,
          rename.to
        )
      );
    }
    if (block === undefined || nameToBlock.has(to)) continue;

    const newHeader = `### Requirement: ${to}`;
    const rawLines = block.raw.split('\n');
    rawLines[0] = newHeader;
    nameToBlock.delete(from);
    nameToBlock.set(to, {
      headerLine: newHeader,
      name: to,
      raw: rawLines.join('\n'),
    });
  }

  for (const name of plan.removed) {
    const key = normalizeRequirementName(name);
    if (skippedRemoved.has(key)) continue;
    if (!nameToBlock.has(key)) {
      if (!isNewSpec) {
        operationIssues.push(
          reconciliationIssue(
            update,
            'spec_removed_requirement_missing',
            `${specName} REMOVED failed for header "### Requirement: ${name}" - not found`,
            name
          )
        );
      }
      continue;
    }
    nameToBlock.delete(key);
  }

  for (const mod of plan.modified) {
    const key = normalizeRequirementName(mod.name);
    const canonicalBlock = canonicalBlocks.get(key);
    const currentBlock = nameToBlock.get(key);
    if (!currentBlock) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_modified_requirement_not_found',
          `${specName} MODIFIED failed for header "### Requirement: ${mod.name}" - not found`,
          mod.name
        )
      );
      continue;
    }
    const modHeaderMatch = mod.raw
      .split('\n')[0]
      .match(/^###\s*Requirement:\s*(.+)\s*$/i);
    if (!modHeaderMatch || normalizeRequirementName(modHeaderMatch[1]) !== key) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_modified_header_mismatch',
          `${specName} MODIFIED failed for header "### Requirement: ${mod.name}" - header mismatch in content`,
          mod.name
        )
      );
      continue;
    }
    const diagnosticBlock = canonicalBlock ?? currentBlock;
    const missingScenarios = findMissingCurrentScenarios(diagnosticBlock, mod);
    if (missingScenarios.length > 0) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_modified_scenarios_missing',
          `${specName} MODIFIED failed for header "### Requirement: ${mod.name}" - ` +
            `current spec contains scenario(s) not present in the modified block: ${missingScenarios
              .map(name => `"${name}"`)
              .join(', ')}. Refresh the change spec before archiving to avoid dropping scenarios.`,
          mod.name,
          missingScenarios
        )
      );
      continue;
    }
    if (skippedModified.has(key)) continue;
    nameToBlock.set(key, mod);
  }

  for (const add of plan.added) {
    const key = normalizeRequirementName(add.name);
    if (skippedAdded.has(key)) continue;
    if (nameToBlock.has(key)) {
      operationIssues.push(
        reconciliationIssue(
          update,
          'spec_added_requirement_exists',
          `${specName} ADDED failed for header "### Requirement: ${add.name}" - already exists`,
          add.name
        )
      );
      continue;
    }
    nameToBlock.set(key, add);
  }

  if (preflightIssues.length > 0 || operationIssues.length > 0) {
    throw new SpecReconciliationError([
      ...preflightIssues,
      ...operationIssues,
    ]);
  }

  // An existing spec that this delta empties — every requirement REMOVED,
  // none remaining — is deleted from main specs by the caller rather than
  // written empty. A new spec that ends empty is NOT emptied: it still has no
  // requirements and must hit min(1) (creating an empty spec is never intended).
  const emptied = !isNewSpec && nameToBlock.size === 0;

  // Duplicates within resulting map are implicitly prevented by key uniqueness.

  // Recompose requirements section preserving original ordering where possible
  const keptOrder: RequirementBlock[] = [];
  const seen = new Set<string>();
  for (const block of parts.bodyBlocks) {
    const key = normalizeRequirementName(block.name);
    const replacement = nameToBlock.get(key);
    if (replacement) {
      keptOrder.push(replacement);
      seen.add(key);
    }
  }
  // Append any newly added that were not in original order
  for (const [key, block] of nameToBlock.entries()) {
    if (!seen.has(key)) {
      keptOrder.push(block);
    }
  }

  const reqBody = [parts.preamble && parts.preamble.trim() ? parts.preamble.trimEnd() : '']
    .filter(Boolean)
    .concat(keptOrder.map((b) => b.raw))
    .join('\n\n')
    .trimEnd();

  const rebuilt = [parts.before.trimEnd(), parts.headerLine, reqBody, parts.after]
    .filter((s, idx) => !(idx === 0 && s === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  if (options.validateTarget && !emptied) {
    const report = await new Validator().validateSpecContent(specName, rebuilt);
    if (!report.valid) {
      const details = report.issues
        .filter(issue => issue.level === 'ERROR')
        .map(issue => `${issue.path}: ${issue.message}`)
        .join('\n');
      throw new SpecReconciliationError([
        ...preflightIssues,
        reconciliationIssue(
          update,
          'spec_target_validation_failed',
          `${specName}: rebuilt canonical spec is invalid:\n${details}`
        ),
      ]);
    }
  }

  return {
    rebuilt,
    emptied,
    sourceSha256,
    targetPrecondition,
    counts: {
      added: plan.added.length,
      modified: plan.modified.length,
      removed: plan.removed.length,
      renamed: plan.renamed.length,
    },
  };
}

function reconciliationIssue(
  update: SpecUpdate,
  code: SpecReconciliationIssueCode,
  message: string,
  requirement?: string,
  missingScenarios?: string[]
): SpecReconciliationIssue {
  return {
    code,
    source: update.source,
    capability: update.capability,
    ...(requirement === undefined ? {} : { requirement }),
    ...(missingScenarios === undefined ? {} : { missingScenarios }),
    message,
  };
}

function compareReconciliationIssues(
  left: SpecReconciliationIssue,
  right: SpecReconciliationIssue
): number {
  return (
    left.source.localeCompare(right.source) ||
    (left.requirement ?? '').localeCompare(right.requirement ?? '') ||
    left.code.localeCompare(right.code)
  );
}

export async function analyzeSpecUpdates(
  discovery: SpecUpdateDiscovery,
  changeName: string,
  options: { silent?: boolean; validateTarget?: boolean } = {}
): Promise<SpecReconciliationAnalysis> {
  const prepared: BuiltSpecUpdate[] = [];
  const issues: SpecReconciliationIssue[] = [...discovery.issues];

  for (const update of [...discovery.updates].sort((left, right) =>
    left.source.localeCompare(right.source)
  )) {
    try {
      const built = await buildUpdatedSpecCore(update, changeName, options);
      prepared.push({ update, ...built });
    } catch (error) {
      if (error instanceof SpecReconciliationError) {
        issues.push(...error.issues);
        continue;
      }
      issues.push(
        reconciliationIssue(
          update,
          'spec_reconciliation_failed',
          error instanceof Error ? error.message : String(error)
        )
      );
    }
  }

  issues.sort(compareReconciliationIssues);
  return { prepared, issues };
}

export async function buildUpdatedSpec(
  update: SpecUpdate,
  changeName: string,
  options: { silent?: boolean } = {}
): Promise<Pick<BuiltSpecUpdate, 'rebuilt' | 'counts' | 'emptied'>> {
  const analysis = await analyzeSpecUpdates(
    { updates: [update], issues: [] },
    changeName,
    options
  );
  if (analysis.issues.length > 0) {
    throw new SpecReconciliationError(analysis.issues);
  }
  const [prepared] = analysis.prepared;
  return {
    rebuilt: prepared.rebuilt,
    counts: prepared.counts,
    emptied: prepared.emptied,
  };
}

/**
 * Write an updated spec to disk.
 */
export async function writeUpdatedSpec(
  update: SpecUpdate,
  rebuilt: string,
  counts: { added: number; modified: number; removed: number; renamed: number },
  options: { silent?: boolean; displayPath?: string } = {}
): Promise<void> {
  // Create target directory if needed
  const targetDir = path.dirname(update.target);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(update.target, rebuilt);

  if (options.silent) return;

  const specName = update.capability;
  console.log(`Applying changes to ${options.displayPath ?? `${WORKSPACE_SPECS_DIR}/${specName}/spec.md`}:`);
  if (counts.added) console.log(`  + ${counts.added} added`);
  if (counts.modified) console.log(`  ~ ${counts.modified} modified`);
  if (counts.removed) console.log(`  - ${counts.removed} removed`);
  if (counts.renamed) console.log(`  → ${counts.renamed} renamed`);
}

/**
 * Build a skeleton spec for new capabilities.
 */
export function buildSpecSkeleton(specFolderName: string, changeName: string): string {
  const titleBase = specFolderName;
  return `# ${titleBase} Specification\n\n## Purpose\nTBD - created by archiving change ${changeName}. Update Purpose after archive.\n\n## Requirements\n`;
}

function findMissingCurrentScenarios(
  current: RequirementBlock,
  incoming: RequirementBlock
): string[] {
  const incomingCounts = new Map<string, number>();
  for (const scenario of parseScenarioBlocks(incoming.raw)) {
    incomingCounts.set(
      scenario.name,
      (incomingCounts.get(scenario.name) ?? 0) + 1
    );
  }
  const missing: string[] = [];
  for (const scenario of parseScenarioBlocks(current.raw)) {
    const available = incomingCounts.get(scenario.name) ?? 0;
    if (available === 0) {
      missing.push(scenario.name);
    } else {
      incomingCounts.set(scenario.name, available - 1);
    }
  }
  return missing;
}

function parseScenarioBlocks(requirementRaw: string): ScenarioBlock[] {
  const normalized = requirementRaw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const visibleLines = stripFencedCodeBlocksPreservingLines(normalized).split(
    '\n'
  );
  const scenarios: ScenarioBlock[] = [];
  let index = 0;

  while (index < visibleLines.length) {
    const headerMatch = visibleLines[index].match(
      /^####\s*Scenario:\s*(.+)\s*$/
    );
    if (!headerMatch) {
      index++;
      continue;
    }

    const start = index;
    const name = headerMatch[1].trim();
    index++;
    while (
      index < visibleLines.length &&
      !/^####\s*Scenario:\s*(.+)\s*$/.test(visibleLines[index])
    ) {
      index++;
    }

    scenarios.push({
      name,
      raw: lines.slice(start, index).join('\n').trimEnd(),
    });
  }

  return scenarios;
}

/**
 * Apply all delta specs from a change to main specs.
 *
 * @param projectRoot - The project root directory
 * @param changeName - The name of the change to apply
 * @param options - Options for the operation
 * @returns Result of the operation with counts
 */
export async function applySpecs(
  projectRoot: string,
  changeName: string,
  options: {
    dryRun?: boolean;
    skipValidation?: boolean;
    silent?: boolean;
  } = {}
): Promise<SpecsApplyOutput> {
  const changeDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'changes', changeName);
  const mainSpecsDir = path.join(projectRoot, WORKSPACE_DIR_NAME, 'specs');

  // Verify change exists
  try {
    const stat = await fs.stat(changeDir);
    if (!stat.isDirectory()) {
      throw new Error(`Change '${changeName}' not found.`);
    }
  } catch {
    throw new Error(`Change '${changeName}' not found.`);
  }

  // Discover specs and retain every filesystem failure for the analysis pass.
  const discovery = await findSpecUpdates(changeDir, mainSpecsDir);

  const analysis = await analyzeSpecUpdates(discovery, changeName, {
    silent: options.silent,
  });
  if (analysis.issues.length > 0) {
    throw new SpecReconciliationError(analysis.issues);
  }
  if (discovery.updates.length === 0) {
    return {
      changeName,
      capabilities: [],
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      noChanges: true,
    };
  }

  // Prepare every update before the write phase. Independent failures are
  // retained together, so one bad capability cannot hide another.
  const prepared = analysis.prepared;

  // Validate rebuilt specs unless validation is skipped. An emptied existing
  // spec (every requirement REMOVED) is deleted, not written, so it has no
  // content to validate — skip it rather than fail on the empty Requirements.
  if (!options.skipValidation) {
    const validator = new Validator();
    for (const p of prepared) {
      if (p.emptied) continue;
      const specName = p.update.capability;
      const report = await validator.validateSpecContent(specName, p.rebuilt);
      if (!report.valid) {
        const errors = report.issues
          .filter((i) => i.level === 'ERROR')
          .map((i) => `  ✗ ${i.message}`)
          .join('\n');
        throw new Error(`Validation errors in rebuilt spec for ${specName}:\n${errors}`);
      }
    }
  }

  // Build results
  const capabilities: ApplyResult[] = [];
  const totals = { added: 0, modified: 0, removed: 0, renamed: 0 };

  for (const p of prepared) {
    const capability = p.update.capability;

    if (p.emptied) {
      // Existing spec fully emptied by this delta → delete its directory.
      if (!options.dryRun) {
        await fs.rm(path.dirname(p.update.target), { recursive: true, force: true });
        if (!options.silent) {
          console.log(`Deleting spec '${capability}' — all requirements removed by this change.`);
        }
      } else if (!options.silent) {
        console.log(`Would delete spec '${capability}' — all requirements removed by this change.`);
      }
    } else if (!options.dryRun) {
      // Write the updated spec
      const targetDir = path.dirname(p.update.target);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(p.update.target, p.rebuilt);

      if (!options.silent) {
        console.log(`Applying changes to ${WORKSPACE_SPECS_DIR}/${capability}/spec.md:`);
        if (p.counts.added) console.log(`  + ${p.counts.added} added`);
        if (p.counts.modified) console.log(`  ~ ${p.counts.modified} modified`);
        if (p.counts.removed) console.log(`  - ${p.counts.removed} removed`);
        if (p.counts.renamed) console.log(`  → ${p.counts.renamed} renamed`);
      }
    } else if (!options.silent) {
      console.log(`Would apply changes to ${WORKSPACE_SPECS_DIR}/${capability}/spec.md:`);
      if (p.counts.added) console.log(`  + ${p.counts.added} added`);
      if (p.counts.modified) console.log(`  ~ ${p.counts.modified} modified`);
      if (p.counts.removed) console.log(`  - ${p.counts.removed} removed`);
      if (p.counts.renamed) console.log(`  → ${p.counts.renamed} renamed`);
    }

    capabilities.push({
      capability,
      ...p.counts,
    });

    totals.added += p.counts.added;
    totals.modified += p.counts.modified;
    totals.removed += p.counts.removed;
    totals.renamed += p.counts.renamed;
  }

  return {
    changeName,
    capabilities,
    totals,
    noChanges: false,
  };
}
