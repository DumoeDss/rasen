import { WORKSPACE_DIR_NAME } from './config.js';
import { WORKSPACE_SPECS_DIR } from './workspace-root.js';
/**
 * Spec Application Logic
 *
 * Extracted from ArchiveCommand to enable standalone spec application.
 * Applies delta specs from a change to main specs without archiving.
 */

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
import { findMainSpecStructureIssues } from './parsers/spec-structure.js';
import { Validator } from './validation/validator.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SpecUpdate {
  source: string;
  target: string;
  exists: boolean;
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
}

export type SpecReconciliationIssueCode =
  | 'spec_reconciliation_failed'
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

class SpecReconciliationFailure extends Error {
  constructor(readonly issue: SpecReconciliationIssue) {
    super(issue.message);
    this.name = 'SpecReconciliationFailure';
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
 * Find all delta spec files that need to be applied from a change.
 */
export async function findSpecUpdates(
  changeDir: string,
  mainSpecsDir: string
): Promise<SpecUpdate[]> {
  const updates: SpecUpdate[] = [];
  const changeSpecsDir = path.join(changeDir, 'specs');

  async function visit(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || entry.name !== 'spec.md') continue;

      const relative = path.relative(changeSpecsDir, absolute);
      const target = path.join(mainSpecsDir, relative);
      let exists = false;
      try {
        await fs.access(target);
        exists = true;
      } catch {
        // A missing target is a new capability; analysis decides which
        // operations are valid for it.
      }
      updates.push({ source: absolute, target, exists });
    }
  }

  await visit(changeSpecsDir);
  return updates;
}

/**
 * Build an updated spec by applying delta operations.
 * Returns the rebuilt content and counts of operations.
 */
async function buildUpdatedSpecCore(
  update: SpecUpdate,
  changeName: string,
  options: { silent?: boolean } = {}
): Promise<Omit<BuiltSpecUpdate, 'update'>> {
  // Read change spec content (delta-format expected)
  const changeContent = await fs.readFile(update.source, 'utf-8');

  // Parse deltas from the change spec file
  const plan = parseDeltaSpec(changeContent);
  const specName = path.basename(path.dirname(update.target));

  // Pre-validate the full delta before simulating any operation. Independent
  // authoring defects are collected so one preview can report them together.
  const preflightIssues: SpecReconciliationIssue[] = [];
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
    }
    renamedFromSet.add(fromNorm);
    renamedToSet.add(toNorm);
  }

  const conflicts: Array<{ name: string; a: string; b: string }> = [];
  for (const name of modifiedNames) {
    if (removedNamesSet.has(name)) {
      conflicts.push({ name, a: 'MODIFIED', b: 'REMOVED' });
    }
    if (addedNames.has(name)) {
      conflicts.push({ name, a: 'MODIFIED', b: 'ADDED' });
    }
  }
  for (const name of addedNames) {
    if (removedNamesSet.has(name)) {
      conflicts.push({ name, a: 'ADDED', b: 'REMOVED' });
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
  if (preflightIssues.length > 0) {
    throw new SpecReconciliationError(preflightIssues);
  }
  // Load or create base target content
  let targetContent: string;
  let isNewSpec = false;
  try {
    targetContent = await fs.readFile(update.target, 'utf-8');
  } catch {
    // Target spec does not exist; every MODIFIED and RENAMED operation is an
    // independent authoring failure for a new capability.
    if (plan.modified.length > 0 || plan.renamed.length > 0) {
      const missingTargetIssues = [
        ...plan.modified.map(mod =>
          reconciliationIssue(
            update,
            'spec_existing_target_required',
            `${specName}: target spec does not exist; MODIFIED for "### Requirement: ${mod.name}" requires an existing spec. Only ADDED requirements are allowed for new specs.`,
            mod.name
          )
        ),
        ...plan.renamed.map(rename =>
          reconciliationIssue(
            update,
            'spec_existing_target_required',
            `${specName}: target spec does not exist; RENAMED to "### Requirement: ${rename.to}" requires an existing spec. Only ADDED requirements are allowed for new specs.`,
            rename.to
          )
        ),
      ];
      throw new SpecReconciliationError(missingTargetIssues);
    }
    // Warn about REMOVED requirements being ignored for new specs
    if (plan.removed.length > 0 && !options.silent) {
      console.log(
        chalk.yellow(
          `⚠️  Warning: ${specName} - ${plan.removed.length} REMOVED requirement(s) ignored for new spec (nothing to remove).`
        )
      );
    }
    isNewSpec = true;
    targetContent = buildSpecSkeleton(specName, changeName);
  }

  const structureIssues = findMainSpecStructureIssues(targetContent);
  if (structureIssues.length > 0) {
    const details = structureIssues
      .map(issue => `line ${issue.line}: ${issue.message}`)
      .join('\n');
    throw reconciliationFailure(
      update,
      'spec_target_structure_invalid',
      `${specName}: target spec is structurally invalid and cannot be updated until fixed:\n${details}`
    );
  }

  // Extract requirements section and build name->block map
  const parts = extractRequirementsSection(targetContent);
  const nameToBlock = new Map<string, RequirementBlock>();
  for (const block of parts.bodyBlocks) {
    nameToBlock.set(normalizeRequirementName(block.name), block);
  }

  // Simulate operations in order: RENAMED → REMOVED → MODIFIED → ADDED.
  // Invalid operations do not mutate the simulation, but do not stop
  // independent operations from being checked.
  const operationIssues: SpecReconciliationIssue[] = [];

  for (const rename of plan.renamed) {
    const from = normalizeRequirementName(rename.from);
    const to = normalizeRequirementName(rename.to);
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
    const missingScenarios = findMissingCurrentScenarios(currentBlock, mod);
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
    nameToBlock.set(key, mod);
  }

  for (const add of plan.added) {
    const key = normalizeRequirementName(add.name);
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

  if (operationIssues.length > 0) {
    throw new SpecReconciliationError(operationIssues);
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

  return {
    rebuilt,
    emptied,
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
    capability: path.basename(path.dirname(update.target)),
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

function reconciliationFailure(
  update: SpecUpdate,
  code: SpecReconciliationIssueCode,
  message: string,
  requirement?: string
): SpecReconciliationFailure {
  return new SpecReconciliationFailure(
    reconciliationIssue(update, code, message, requirement)
  );
}
export async function analyzeSpecUpdates(

  updates: readonly SpecUpdate[],
  changeName: string,
  options: { silent?: boolean } = {}
): Promise<SpecReconciliationAnalysis> {
  const prepared: BuiltSpecUpdate[] = [];
  const issues: SpecReconciliationIssue[] = [];

  for (const update of [...updates].sort((left, right) => left.source.localeCompare(right.source))) {
    try {
      const built = await buildUpdatedSpecCore(update, changeName, options);
      prepared.push({ update, ...built });
    } catch (error) {
      if (error instanceof SpecReconciliationError) {
        issues.push(...error.issues);
        continue;
      }
      if (error instanceof SpecReconciliationFailure) {
        issues.push(error.issue);
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
): Promise<Omit<BuiltSpecUpdate, 'update'>> {
  const analysis = await analyzeSpecUpdates([update], changeName, options);
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

  const specName = path.basename(path.dirname(update.target));
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

function findMissingCurrentScenarios(current: RequirementBlock, incoming: RequirementBlock): string[] {
  const incomingScenarioNames = new Set(parseScenarioBlocks(incoming.raw).map((scenario) => scenario.name));
  return parseScenarioBlocks(current.raw)
    .filter((scenario) => !incomingScenarioNames.has(scenario.name))
    .map((scenario) => scenario.name);
}

function parseScenarioBlocks(requirementRaw: string): ScenarioBlock[] {
  const lines = requirementRaw.replace(/\r\n?/g, '\n').split('\n');
  const scenarios: ScenarioBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const headerMatch = lines[index].match(/^####\s*Scenario:\s*(.+)\s*$/);
    if (!headerMatch) {
      index++;
      continue;
    }

    const start = index;
    const name = headerMatch[1].trim();
    index++;
    while (index < lines.length && !/^####\s*Scenario:\s*(.+)\s*$/.test(lines[index])) {
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

  // Find specs to update
  const specUpdates = await findSpecUpdates(changeDir, mainSpecsDir);

  if (specUpdates.length === 0) {
    return {
      changeName,
      capabilities: [],
      totals: { added: 0, modified: 0, removed: 0, renamed: 0 },
      noChanges: true,
    };
  }

  // Prepare every update before the write phase. Independent failures are
  // retained together, so one bad capability cannot hide another.
  const analysis = await analyzeSpecUpdates(specUpdates, changeName, {
    silent: options.silent,
  });
  if (analysis.issues.length > 0) {
    throw new SpecReconciliationError(analysis.issues);
  }
  const prepared = analysis.prepared;

  // Validate rebuilt specs unless validation is skipped. An emptied existing
  // spec (every requirement REMOVED) is deleted, not written, so it has no
  // content to validate — skip it rather than fail on the empty Requirements.
  if (!options.skipValidation) {
    const validator = new Validator();
    for (const p of prepared) {
      if (p.emptied) continue;
      const specName = path.basename(path.dirname(p.update.target));
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
    const capability = path.basename(path.dirname(p.update.target));

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
