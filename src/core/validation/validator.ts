import { createHash } from 'node:crypto';
import { z, ZodError } from 'zod';
import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { SpecSchema, ChangeSchema, Spec, Change } from '../schemas/index.js';
import { MarkdownParser } from '../parsers/markdown-parser.js';
import { ChangeParser } from '../parsers/change-parser.js';
import { ValidationReport, ValidationIssue, ValidationLevel } from './types.js';
import {
  MIN_PURPOSE_LENGTH,
  MAX_REQUIREMENT_TEXT_LENGTH,
  VALIDATION_MESSAGES
} from './constants.js';
import { parseDeltaSpec, normalizeRequirementName, extractRequirementsSection } from '../parsers/requirement-blocks.js';
import {
  findMainSpecStructureIssues,
  stripFencedCodeBlocksPreservingLines,
} from '../parsers/spec-structure.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  analyzeSpecUpdates,
  discoverDeltaSpecFiles,
  findSpecUpdates,
  type DeltaSpecDiscovery,
} from '../specs-apply.js';

export class Validator {
  private strictMode: boolean;

  constructor(strictMode: boolean = false) {
    this.strictMode = strictMode;
  }

  async validateSpec(filePath: string): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const specName = this.extractNameFromPath(filePath);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const parser = new MarkdownParser(content);
      
      const spec = parser.parseSpec(specName);
      
      const result = SpecSchema.safeParse(spec);
      
      if (!result.success) {
        issues.push(...this.convertZodErrors(result.error));
      }
      
      issues.push(...this.applySpecRules(spec, content));
      
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : 'Unknown error';
      const enriched = this.enrichTopLevelError(specName, baseMessage);
      issues.push({
        level: 'ERROR',
        path: 'file',
        message: enriched,
      });
    }
    
    return this.createReport(issues);
  }

  /**
   * Validate spec content from a string (used for pre-write validation of rebuilt specs)
   */
  async validateSpecContent(specName: string, content: string): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    try {
      const parser = new MarkdownParser(content);
      const spec = parser.parseSpec(specName);
      const result = SpecSchema.safeParse(spec);
      if (!result.success) {
        issues.push(...this.convertZodErrors(result.error));
      }
      issues.push(...this.applySpecRules(spec, content));
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : 'Unknown error';
      const enriched = this.enrichTopLevelError(specName, baseMessage);
      issues.push({ level: 'ERROR', path: 'file', message: enriched });
    }
    return this.createReport(issues);
  }

  async validateChange(filePath: string): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const changeName = this.extractNameFromPath(filePath);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const changeDir = path.dirname(filePath);
      const parser = new ChangeParser(content, changeDir);
      
      const change = await parser.parseChangeWithDeltas(changeName);
      
      const result = ChangeSchema.safeParse(change);
      
      if (!result.success) {
        issues.push(...this.convertZodErrors(result.error));
      }
      
      issues.push(...this.applyChangeRules(change, content));
      
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : 'Unknown error';
      const enriched = this.enrichTopLevelError(changeName, baseMessage);
      issues.push({
        level: 'ERROR',
        path: 'file',
        message: enriched,
      });
    }
    
    return this.createReport(issues);
  }

  /**
   * Validate delta-formatted spec files under a change directory.
   * Enforces:
   * - At least one delta across all files
   * - ADDED/MODIFIED: each requirement has SHALL/MUST and at least one scenario
   * - REMOVED: names only; no scenario/description required
   * - RENAMED: pairs well-formed
   * - No duplicates within sections; no cross-section conflicts per spec
   */
  async validateChangeDeltaSpecs(
    changeDir: string,
    canonicalSpecsDir?: string,
    discoveredDeltaSpecs?: DeltaSpecDiscovery
  ): Promise<ValidationReport> {
    const issues: ValidationIssue[] = [];
    const specsDir = path.join(changeDir, 'specs');
    let totalDeltas = 0;
    const deltaSnapshots = new Map<string, Buffer>();
    const reconciliationIssueKey = (
      source: string,
      code: string,
      requirement?: string
    ): string =>
      `${source}\0${code}\0${
        requirement === undefined ? '' : normalizeRequirementName(requirement)
      }`;
    const independentlyReported = new Set<string>();
    const shapeIssueKeys = new Set<string>();
    const shapeIssueKey = (
      source: string,
      kind: 'requirement-keyword' | 'scenario',
      requirement: string
    ): string =>
      `${source}\0${kind}\0${normalizeRequirementName(requirement)}`;
    const deltaDiscovery =
      discoveredDeltaSpecs ?? (await discoverDeltaSpecFiles(changeDir));
    let deltaInputUnavailable = deltaDiscovery.issues.length > 0;
    for (const issue of deltaDiscovery.issues) {
      issues.push({
        level: 'ERROR',
        path: FileSystemUtils.toPosixPath(
          path.relative(specsDir, issue.source)
        ),
        code: issue.code,
        source: issue.source,
        capability: issue.capability,
        message: issue.message,
      });
      independentlyReported.add(
        reconciliationIssueKey(issue.source, issue.code, issue.requirement)
      );
    }
    const discovery =
      canonicalSpecsDir === undefined
        ? null
        : await findSpecUpdates(
            changeDir,
            canonicalSpecsDir,
            deltaDiscovery
          );

    try {
      for (const specFile of deltaDiscovery.files) {
        const entryPath = FileSystemUtils.toPosixPath(
          path.relative(specsDir, specFile)
        );
        const capability = path.posix.dirname(entryPath);
        const deltaIssue = (
          code: string,
          message: string,
          requirement?: string
        ): ValidationIssue => ({
          level: 'ERROR',
          path: entryPath,
          code,
          source: specFile,
          capability,
          ...(requirement === undefined ? {} : { requirement }),
          message,
        });
        let content: string;
        try {
          const snapshot = await fs.readFile(specFile);
          deltaSnapshots.set(specFile, snapshot);
          content = snapshot.toString('utf8');
        } catch (error) {
          issues.push(
            deltaIssue(
              'spec_delta_read_failed',
              `Cannot read delta spec ${specFile}: ${
              error instanceof Error ? error.message : String(error)
              }`
            )
          );
          deltaInputUnavailable = true;
          continue;
        }
        const issuesBeforeShapeValidation = issues.length;

        const plan = parseDeltaSpec(content);
        const sectionNames: string[] = [];
        if (plan.sectionPresence.added) sectionNames.push('## ADDED Requirements');
        if (plan.sectionPresence.modified) sectionNames.push('## MODIFIED Requirements');
        if (plan.sectionPresence.removed) sectionNames.push('## REMOVED Requirements');
        if (plan.sectionPresence.renamed) sectionNames.push('## RENAMED Requirements');
        const hasSections = sectionNames.length > 0;
        const hasEntries = plan.added.length + plan.modified.length + plan.removed.length + plan.renamed.length > 0;
        if (!hasEntries) {
          issues.push(
            deltaIssue(
              'spec_delta_no_operations',
              hasSections
                ? `Delta sections ${this.formatSectionList(sectionNames)} were found, but no requirement entries parsed. Ensure each section includes at least one "### Requirement:" block (REMOVED may use bullet list syntax).`
                : 'No delta sections found. Add headers such as "## ADDED Requirements" or move non-delta notes outside specs/.'
            )
          );
          independentlyReported.add(
            reconciliationIssueKey(specFile, 'spec_delta_no_operations')
          );
        }

        const addedNames = new Set<string>();
        const modifiedNames = new Set<string>();
        const removedNames = new Set<string>();
        const renamedFrom = new Set<string>();
        const renamedTo = new Set<string>();

        // Validate ADDED
        for (const block of plan.added) {
          const key = normalizeRequirementName(block.name);
          totalDeltas++;
          if (addedNames.has(key)) {
            issues.push(
              deltaIssue(
                'spec_delta_duplicate_added',
                `Duplicate requirement in ADDED: "${block.name}"`,
                block.name
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_duplicate_added',
                block.name
              )
            );
          } else {
            addedNames.add(key);
          }
          const requirementText = this.extractRequirementText(block.raw);
          if (!requirementText) {
            issues.push(
              deltaIssue(
                'spec_delta_requirement_text_missing',
                `ADDED "${block.name}" is missing requirement text`,
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'requirement-keyword', block.name)
            );
          } else if (!this.containsShallOrMust(requirementText)) {
            issues.push(
              deltaIssue(
                'spec_delta_requirement_keyword_missing',
                this.buildMissingShallOrMustMessage(
                  `ADDED "${block.name}"`,
                  block.name
                ),
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'requirement-keyword', block.name)
            );
          }
          const scenarioCount = this.countScenarios(block.raw);
          if (scenarioCount < 1) {
            issues.push(
              deltaIssue(
                'spec_delta_scenarios_missing',
                `ADDED "${block.name}" must include at least one scenario`,
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'scenario', block.name)
            );
          }
        }

        // Validate MODIFIED
        for (const block of plan.modified) {
          const key = normalizeRequirementName(block.name);
          totalDeltas++;
          if (modifiedNames.has(key)) {
            issues.push(
              deltaIssue(
                'spec_delta_duplicate_modified',
                `Duplicate requirement in MODIFIED: "${block.name}"`,
                block.name
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_duplicate_modified',
                block.name
              )
            );
          } else {
            modifiedNames.add(key);
          }
          const requirementText = this.extractRequirementText(block.raw);
          if (!requirementText) {
            issues.push(
              deltaIssue(
                'spec_delta_requirement_text_missing',
                `MODIFIED "${block.name}" is missing requirement text`,
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'requirement-keyword', block.name)
            );
          } else if (!this.containsShallOrMust(requirementText)) {
            issues.push(
              deltaIssue(
                'spec_delta_requirement_keyword_missing',
                this.buildMissingShallOrMustMessage(
                  `MODIFIED "${block.name}"`,
                  block.name
                ),
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'requirement-keyword', block.name)
            );
          }
          const scenarioCount = this.countScenarios(block.raw);
          if (scenarioCount < 1) {
            issues.push(
              deltaIssue(
                'spec_delta_scenarios_missing',
                `MODIFIED "${block.name}" must include at least one scenario`,
                block.name
              )
            );
            shapeIssueKeys.add(
              shapeIssueKey(specFile, 'scenario', block.name)
            );
          }
        }

        // Validate REMOVED (names only)
        for (const name of plan.removed) {
          const key = normalizeRequirementName(name);
          totalDeltas++;
          if (removedNames.has(key)) {
            issues.push(
              deltaIssue(
                'spec_delta_duplicate_removed',
                `Duplicate requirement in REMOVED: "${name}"`,
                name
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_duplicate_removed',
                name
              )
            );
          } else {
            removedNames.add(key);
          }
        }

        // Validate RENAMED pairs
        for (const { from, to } of plan.renamed) {
          const fromKey = normalizeRequirementName(from);
          const toKey = normalizeRequirementName(to);
          totalDeltas++;
          if (renamedFrom.has(fromKey)) {
            issues.push(
              deltaIssue(
                'spec_delta_duplicate_renamed_from',
                `Duplicate FROM in RENAMED: "${from}"`,
                from
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_duplicate_renamed_from',
                from
              )
            );
          } else {
            renamedFrom.add(fromKey);
          }
          if (renamedTo.has(toKey)) {
            issues.push(
              deltaIssue(
                'spec_delta_duplicate_renamed_to',
                `Duplicate TO in RENAMED: "${to}"`,
                to
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_duplicate_renamed_to',
                to
              )
            );
          } else {
            renamedTo.add(toKey);
          }
        }

        // Cross-section conflicts (within the same spec file)
        for (const n of modifiedNames) {
          if (removedNames.has(n)) {
            issues.push(
              deltaIssue(
                'spec_delta_cross_section_conflict',
                `Requirement present in both MODIFIED and REMOVED: "${n}"`,
                n
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_cross_section_conflict',
                n
              )
            );
          }
          if (addedNames.has(n)) {
            issues.push(
              deltaIssue(
                'spec_delta_cross_section_conflict',
                `Requirement present in both MODIFIED and ADDED: "${n}"`,
                n
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_cross_section_conflict',
                n
              )
            );
          }
        }
        for (const n of addedNames) {
          if (removedNames.has(n)) {
            issues.push(
              deltaIssue(
                'spec_delta_cross_section_conflict',
                `Requirement present in both ADDED and REMOVED: "${n}"`,
                n
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_delta_cross_section_conflict',
                n
              )
            );
          }
        }
        for (const { from, to } of plan.renamed) {
          const fromKey = normalizeRequirementName(from);
          const toKey = normalizeRequirementName(to);
          if (modifiedNames.has(fromKey)) {
            issues.push(
              deltaIssue(
                'spec_modified_uses_renamed_source',
                `MODIFIED references old name from RENAMED. Use new header for "${to}"`,
                from
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_modified_uses_renamed_source',
                from
              )
            );
          }
          if (addedNames.has(toKey)) {
            issues.push(
              deltaIssue(
                'spec_renamed_target_conflicts_added',
                `RENAMED TO collides with ADDED for "${to}"`,
                to
              )
            );
            independentlyReported.add(
              reconciliationIssueKey(
                specFile,
                'spec_renamed_target_conflicts_added',
                to
              )
            );
          }
        }
        void issuesBeforeShapeValidation;
      }
    } catch (error) {
      deltaInputUnavailable = true;
      issues.push({
        level: 'ERROR',
        path: 'specs',
        code: 'spec_delta_discovery_failed',
        source: specsDir,
        message: `Cannot inspect delta specs under ${specsDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }

    const analyzedTargets = new Map<
      string,
      { state: 'absent' } | { state: 'file'; sha256: string }
    >();

    const targetSnapshots = new Map<string, Buffer | null>();
    if (discovery !== null) {
      for (const update of discovery.updates) {
        try {
          const snapshot = await fs.readFile(update.target);
          targetSnapshots.set(update.target, snapshot);
          analyzedTargets.set(update.target, {
            state: 'file',
            sha256: createHash('sha256').update(snapshot).digest('hex'),
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            targetSnapshots.set(update.target, null);
            analyzedTargets.set(update.target, { state: 'absent' });
          }
        }
      }
    }

    if (discovery !== null) {
      const analysisDiscovery = {
        issues: discovery.issues,
        updates: discovery.updates.flatMap(update => {
          const sourceSnapshot = deltaSnapshots.get(update.source);
          if (sourceSnapshot === undefined) return [];
          const hasTargetSnapshot = targetSnapshots.has(update.target);
          return [
            {
              ...update,
              sourceSnapshot,
              ...(hasTargetSnapshot
                ? { targetSnapshot: targetSnapshots.get(update.target) ?? null }
                : {}),
            },
          ];
        }),
      };
      const analysis = await analyzeSpecUpdates(
        analysisDiscovery,
        path.basename(changeDir),
        { silent: true }
      );
      for (const prepared of analysis.prepared) {
        analyzedTargets.set(
          prepared.update.target,
          prepared.targetPrecondition
        );
        if (prepared.emptied) continue;

        const projectedReport = await this.validateSpecContent(
          prepared.update.capability,
          prepared.rebuilt
        );
        const projectedBlocks = extractRequirementsSection(
          prepared.rebuilt
        ).bodyBlocks;
        for (const projectedIssue of projectedReport.issues) {
          if (projectedIssue.level !== 'ERROR') continue;
          const requirementIndexMatch = projectedIssue.path.match(
            /^requirements(?:\.|\[)(\d+)/
          );
          const requirement =
            requirementIndexMatch === null
              ? undefined
              : projectedBlocks[Number(requirementIndexMatch[1])]?.name;
          const projectedKind = projectedIssue.message.includes(
            'SHALL or MUST'
          )
            ? 'requirement-keyword'
            : projectedIssue.path.includes('scenarios') ||
                /\bscenario/i.test(projectedIssue.message)
              ? 'scenario'
              : undefined;
          if (
            requirement !== undefined &&
            projectedKind !== undefined &&
            shapeIssueKeys.has(
              shapeIssueKey(
                prepared.update.source,
                projectedKind,
                requirement
              )
            )
          ) {
            continue;
          }
          issues.push({
            path: FileSystemUtils.toPosixPath(
              path.relative(specsDir, prepared.update.source)
            ),
            level: 'ERROR',
            code: 'spec_target_validation_failed',
            source: prepared.update.source,
            capability: prepared.update.capability,
            ...(requirement === undefined ? {} : { requirement }),
            message:
              `${prepared.update.capability}: rebuilt canonical spec is invalid:\n` +
              `${projectedIssue.path}: ${projectedIssue.message}`,
          });
        }
      }
      for (const issue of analysis.issues) {
        const preservationFailure =
          issue.code === 'spec_modified_scenarios_missing';
        if (
          independentlyReported.has(
            reconciliationIssueKey(
              issue.source,
              issue.code,
              issue.requirement
            )
          )
        ) {
          continue;
        }
        issues.push({
          path: FileSystemUtils.toPosixPath(
            path.relative(specsDir, issue.source)
          ),
          level: preservationFailure
            ? this.strictMode
              ? 'ERROR'
              : 'WARNING'
            : 'ERROR',
          code: issue.code,
          source: issue.source,
          capability: issue.capability,
          ...(issue.requirement === undefined
            ? {}
            : { requirement: issue.requirement }),
          ...(issue.missingScenarios === undefined
            ? {}
            : { missingScenarios: issue.missingScenarios }),
          message: preservationFailure
            ? `${issue.message} MODIFIED replaces the complete requirement; include every scenario that should survive.`
            : issue.message,
        });
      }
    }


    for (const [target, precondition] of analyzedTargets) {
      try {
        const current = await fs.readFile(target);
        if (
          precondition.state === 'absent' ||
          createHash('sha256').update(current).digest('hex') !==
            precondition.sha256
        ) {
          issues.push({
            level: 'ERROR',
            path: target,
            code: 'spec_target_source_changed',
            source: target,
            message: `Canonical spec changed during validation: ${target}. Rerun validation against the current baseline.`,
          });
        }
      } catch (error) {
        if (
          precondition.state === 'absent' &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          continue;
        }
        issues.push({
          level: 'ERROR',
          path: target,
          code: 'spec_target_read_failed',
          source: target,
          message: `Cannot confirm canonical spec snapshot ${target}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    const unreadableDeltaSnapshots = new Set<string>();
    for (const [specFile, snapshot] of deltaSnapshots) {
      try {
        const current = await fs.readFile(specFile);
        if (!current.equals(snapshot)) {
          issues.push({
            level: 'ERROR',
            path: FileSystemUtils.toPosixPath(
              path.relative(specsDir, specFile)
            ),
            code: 'spec_delta_source_changed',
            source: specFile,
            message: `Delta spec changed during validation: ${specFile}. Rerun validation against the current bytes.`,
          });
          deltaInputUnavailable = true;
        }
      } catch (error) {
        issues.push({
          level: 'ERROR',
          path: FileSystemUtils.toPosixPath(
            path.relative(specsDir, specFile)
          ),
          code: 'spec_delta_read_failed',
          source: specFile,
          capability: path.posix.dirname(
            FileSystemUtils.toPosixPath(path.relative(specsDir, specFile))
          ),
          message: `Cannot confirm delta spec snapshot ${specFile}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        unreadableDeltaSnapshots.add(path.resolve(specFile));
        deltaInputUnavailable = true;
      }
    }
    const finalDeltaDiscovery = await discoverDeltaSpecFiles(changeDir);
    for (const issue of finalDeltaDiscovery.issues) {
      const key = reconciliationIssueKey(
        issue.source,
        issue.code,
        issue.requirement
      );
      if (independentlyReported.has(key)) continue;
      issues.push({
        level: 'ERROR',
        path: FileSystemUtils.toPosixPath(
          path.relative(specsDir, issue.source)
        ),
        code: issue.code,
        source: issue.source,
        capability: issue.capability,
        message: issue.message,
      });
      independentlyReported.add(key);
      deltaInputUnavailable = true;
    }
    const admittedDeltaFiles = new Set(
      deltaDiscovery.files.map(file => path.resolve(file))
    );
    const finalDeltaFiles = new Set(
      finalDeltaDiscovery.files.map(file => path.resolve(file))
    );
    for (const specFile of admittedDeltaFiles) {
      if (
        finalDeltaFiles.has(specFile) ||
        unreadableDeltaSnapshots.has(specFile)
      ) {
        continue;
      }
      issues.push({
        level: 'ERROR',
        path: FileSystemUtils.toPosixPath(
          path.relative(specsDir, specFile)
        ),
        code: 'spec_delta_set_changed',
        source: specFile,
        message: `Admitted delta spec is no longer a discoverable regular file: ${specFile}. Rerun validation against the complete current delta set.`,
      });
      deltaInputUnavailable = true;
    }
    for (const specFile of finalDeltaDiscovery.files) {
      if (admittedDeltaFiles.has(path.resolve(specFile))) continue;
      issues.push({
        level: 'ERROR',
        path: FileSystemUtils.toPosixPath(
          path.relative(specsDir, specFile)
        ),
        code: 'spec_delta_set_changed',
        source: specFile,
        message: `Delta spec appeared during validation: ${specFile}. Rerun validation against the complete current delta set.`,
      });
      deltaInputUnavailable = true;
    }

    if (totalDeltas === 0 && !deltaInputUnavailable) {
      issues.push({ level: 'ERROR', path: 'file', message: this.enrichTopLevelError('change', VALIDATION_MESSAGES.CHANGE_NO_DELTAS) });
    }

    return this.createReport(issues);
  }


  private convertZodErrors(error: ZodError): ValidationIssue[] {
    return error.issues.map(err => {
      let message = err.message;
      if (message === VALIDATION_MESSAGES.CHANGE_NO_DELTAS) {
        message = `${message}. ${VALIDATION_MESSAGES.GUIDE_NO_DELTAS}`;
      }
      return {
        level: 'ERROR' as ValidationLevel,
        path: err.path.join('.'),
        message,
      };
    });
  }

  private applySpecRules(spec: Spec, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    for (const structuralIssue of findMainSpecStructureIssues(content)) {
      issues.push({
        level: 'ERROR',
        path: 'file',
        line: structuralIssue.line,
        message: structuralIssue.message,
      });
    }
    
    if (spec.overview.length < MIN_PURPOSE_LENGTH) {
      issues.push({
        level: 'WARNING',
        path: 'overview',
        message: VALIDATION_MESSAGES.PURPOSE_TOO_BRIEF,
      });
    }
    
    spec.requirements.forEach((req, index) => {
      if (req.text.length > MAX_REQUIREMENT_TEXT_LENGTH) {
        issues.push({
          level: 'INFO',
          path: `requirements[${index}]`,
          message: VALIDATION_MESSAGES.REQUIREMENT_TOO_LONG,
        });
      }

      if (req.scenarios.length === 0) {
        issues.push({
          level: 'WARNING',
          path: `requirements[${index}].scenarios`,
          message: `${VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS}. ${VALIDATION_MESSAGES.GUIDE_SCENARIO_FORMAT}`,
        });
      }
    });

    // SHALL/MUST body-keyword enforcement for main specs (#1156). The main-spec
    // parser collapses the requirement header into `text`, so we recover the
    // header+body pairs here (the same source the delta path trusts) and reuse
    // the delta detection: a body that omits the keyword errors, with the
    // targeted "move it to the body line" hint when the keyword is in the header
    // only and the generic message otherwise. Emitted exactly once per
    // requirement (the Zod refine that used to emit a generic error is removed).
    extractRequirementsSection(content).bodyBlocks.forEach((block, index) => {
      const requirementText = this.extractRequirementText(block.raw);
      if (!requirementText || !this.containsShallOrMust(requirementText)) {
        issues.push({
          level: 'ERROR',
          path: `requirements[${index}]`,
          message: this.buildMissingShallOrMustMessage(`Requirement "${block.name}"`, block.name),
        });
      }
    });

    return issues;
  }

  private applyChangeRules(change: Change, content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    
    const MIN_DELTA_DESCRIPTION_LENGTH = 10;
    
    change.deltas.forEach((delta, index) => {
      if (!delta.description || delta.description.length < MIN_DELTA_DESCRIPTION_LENGTH) {
        issues.push({
          level: 'WARNING',
          path: `deltas[${index}].description`,
          message: VALIDATION_MESSAGES.DELTA_DESCRIPTION_TOO_BRIEF,
        });
      }
      
      if ((delta.operation === 'ADDED' || delta.operation === 'MODIFIED') && 
          (!delta.requirements || delta.requirements.length === 0)) {
        issues.push({
          level: 'WARNING',
          path: `deltas[${index}].requirements`,
          message: `${delta.operation} ${VALIDATION_MESSAGES.DELTA_MISSING_REQUIREMENTS}`,
        });
      }
    });
    
    return issues;
  }

  private enrichTopLevelError(itemId: string, baseMessage: string): string {
    const msg = baseMessage.trim();
    if (msg === VALIDATION_MESSAGES.CHANGE_NO_DELTAS) {
      return `${msg}. ${VALIDATION_MESSAGES.GUIDE_NO_DELTAS}`;
    }
    if (msg.includes('Spec must have a Purpose section') || msg.includes('Spec must have a Requirements section')) {
      return `${msg}. ${VALIDATION_MESSAGES.GUIDE_MISSING_SPEC_SECTIONS}`;
    }
    if (msg.includes('Change must have a Why section') || msg.includes('Change must have a What Changes section')) {
      return `${msg}. ${VALIDATION_MESSAGES.GUIDE_MISSING_CHANGE_SECTIONS}`;
    }
    return msg;
  }

  private extractNameFromPath(filePath: string): string {
    const normalizedPath = FileSystemUtils.toPosixPath(filePath);
    const parts = normalizedPath.split('/');
    
    // Look for the directory name after 'specs' or 'changes'
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] === 'specs' || parts[i] === 'changes') {
        if (i < parts.length - 1) {
          return parts[i + 1];
        }
      }
    }
    
    // Fallback to filename without extension if not in expected structure
    const fileName = parts[parts.length - 1] ?? '';
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  }

  private createReport(issues: ValidationIssue[]): ValidationReport {
    const errors = issues.filter(i => i.level === 'ERROR').length;
    const warnings = issues.filter(i => i.level === 'WARNING').length;
    const info = issues.filter(i => i.level === 'INFO').length;
    
    const valid = this.strictMode 
      ? errors === 0 && warnings === 0
      : errors === 0;
    
    return {
      valid,
      issues,
      summary: {
        errors,
        warnings,
        info,
      },
    };
  }

  isValid(report: ValidationReport): boolean {
    return report.valid;
  }

  private extractRequirementText(blockRaw: string): string | undefined {
    const lines = blockRaw.split('\n');
    // Skip header line (index 0)
    let i = 1;

    // Find the first substantial text line, skipping metadata and blank lines
    for (; i < lines.length; i++) {
      const line = lines[i];

      // Stop at scenario headers
      if (/^####\s+/.test(line)) break;

      const trimmed = line.trim();

      // Skip blank lines
      if (trimmed.length === 0) continue;

      // Skip metadata lines (lines starting with ** like **ID**, **Priority**, etc.)
      if (/^\*\*[^*]+\*\*:/.test(trimmed)) continue;

      // Found first non-metadata, non-blank line - this is the requirement text
      return trimmed;
    }

    // No requirement text found
    return undefined;
  }

  private containsShallOrMust(text: string): boolean {
    return /\b(SHALL|MUST)\b/.test(text);
  }

  /**
   * Build an error message for a requirement block whose body lacks SHALL/MUST.
   *
   * When the SHALL/MUST keyword already appears in the requirement header (e.g.
   * `### Requirement: The system SHALL ...`) the original generic error
   * ("must contain SHALL or MUST") is confusing because the keyword is visibly
   * present in the spec. Per the Rasen conventions the keyword has to live
   * on the requirement body line (the line right after the header), so we point
   * the author at that exact fix when the keyword is found in the header only.
   */
  private buildMissingShallOrMustMessage(prefix: string, blockName: string): string {
    const base = `${prefix} must contain SHALL or MUST`;
    if (this.containsShallOrMust(blockName)) {
      return `${base} in the requirement body, not only in the header. Move the SHALL/MUST statement to the line immediately after the "### Requirement: ..." header.`;
    }
    return base;
  }

  private countScenarios(blockRaw: string): number {
    const visible = stripFencedCodeBlocksPreservingLines(
      blockRaw.replace(/\r\n?/g, '\n')
    );
    const matches = visible.match(/^####\s+/gm);
    return matches ? matches.length : 0;
  }

  private formatSectionList(sections: string[]): string {
    if (sections.length === 0) return '';
    if (sections.length === 1) return sections[0];
    const head = sections.slice(0, -1);
    const last = sections[sections.length - 1];
    return `${head.join(', ')} and ${last}`;
  }
}
