import ora from 'ora';
import path from 'path';
import { Validator } from '../core/validation/validator.js';
import { isInteractive, resolveNoInteractive } from '../utils/interactive.js';
import { getActiveChangeIds, getSpecIds } from '../utils/item-discovery.js';
import { nearestMatches } from '../utils/match.js';
import {
  loadPipelineByName,
  listPipelines,
  validatePipelineSkills,
  validateDecomposeChildPipelines,
  PipelineValidationError,
} from '../core/pipeline-registry/index.js';
import { PipelineLoadError } from '../core/pipeline-registry/index.js';
import { getSkillTemplates } from '../core/shared/skill-generation.js';

type ItemType = 'change' | 'spec' | 'pipeline';

type ValidationIssue = { level: 'ERROR' | 'WARNING' | 'INFO'; path: string; message: string };

/**
 * Validates a single pipeline (by name) for structural integrity: parse + Zod
 * + the pipeline.ts structural validators (run inside loadPipelineByName) +
 * skill-existence against the known skill-template set. Returns the same shape
 * the change/spec validators produce so it slots into the shared result set.
 */
function validatePipelineByName(
  id: string,
  projectRoot: string
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  try {
    // parse + Zod + structural validators (duplicate ids, requires refs,
    // cycles, parallel-group independence, decompose single/first) all run here.
    const pipeline = loadPipelineByName(id, projectRoot);
    // skill-existence check against the known skill-template set.
    const knownSkillNames = new Set(getSkillTemplates().map((t) => t.template.name));
    validatePipelineSkills(pipeline, knownSkillNames);
    // decompose childPipeline must resolve and be decompose-free (recursion guard).
    validateDecomposeChildPipelines(pipeline, projectRoot);
  } catch (error) {
    const message =
      error instanceof PipelineLoadError && error.cause
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    issues.push({ level: 'ERROR', path: 'pipeline', message });
  }
  return { valid: issues.length === 0, issues };
}

interface ExecuteOptions {
  all?: boolean;
  changes?: boolean;
  specs?: boolean;
  pipelines?: boolean;
  type?: string;
  strict?: boolean;
  json?: boolean;
  noInteractive?: boolean;
  interactive?: boolean; // Commander sets this to false when --no-interactive is used
  concurrency?: string;
}

interface BulkItemResult {
  id: string;
  type: ItemType;
  valid: boolean;
  issues: { level: 'ERROR' | 'WARNING' | 'INFO'; path: string; message: string }[];
  durationMs: number;
}

export class ValidateCommand {
  async execute(itemName: string | undefined, options: ExecuteOptions = {}): Promise<void> {
    const interactive = isInteractive(options);

    // Handle bulk flags first
    if (options.all || options.changes || options.specs || options.pipelines) {
      await this.runBulkValidation({
        changes: !!options.all || !!options.changes,
        specs: !!options.all || !!options.specs,
        pipelines: !!options.all || !!options.pipelines,
      }, { strict: !!options.strict, json: !!options.json, concurrency: options.concurrency, noInteractive: resolveNoInteractive(options) });
      return;
    }

    // `--type pipeline` with no item name => validate all pipelines.
    if (!itemName && this.normalizeType(options.type) === 'pipeline') {
      await this.runBulkValidation(
        { changes: false, specs: false, pipelines: true },
        { strict: !!options.strict, json: !!options.json, concurrency: options.concurrency, noInteractive: resolveNoInteractive(options) }
      );
      return;
    }

    // No item and no flags
    if (!itemName) {
      if (interactive) {
        await this.runInteractiveSelector({ strict: !!options.strict, json: !!options.json, concurrency: options.concurrency });
        return;
      }
      this.printNonInteractiveHint();
      process.exitCode = 1;
      return;
    }

    // Direct item validation with type detection or override
    const typeOverride = this.normalizeType(options.type);
    await this.validateDirectItem(itemName, { typeOverride, strict: !!options.strict, json: !!options.json });
  }

  private normalizeType(value?: string): ItemType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v === 'change' || v === 'spec' || v === 'pipeline') return v;
    return undefined;
  }

  private async runInteractiveSelector(opts: { strict: boolean; json: boolean; concurrency?: string }): Promise<void> {
    const { select } = await import('@inquirer/prompts');
    const choice = await select({
      message: 'What would you like to validate?',
      choices: [
        { name: 'All (changes + specs + pipelines)', value: 'all' },
        { name: 'All changes', value: 'changes' },
        { name: 'All specs', value: 'specs' },
        { name: 'All pipelines', value: 'pipelines' },
        { name: 'Pick a specific change, spec, or pipeline', value: 'one' },
      ],
    });

    if (choice === 'all') return this.runBulkValidation({ changes: true, specs: true, pipelines: true }, opts);
    if (choice === 'changes') return this.runBulkValidation({ changes: true, specs: false, pipelines: false }, opts);
    if (choice === 'specs') return this.runBulkValidation({ changes: false, specs: true, pipelines: false }, opts);
    if (choice === 'pipelines') return this.runBulkValidation({ changes: false, specs: false, pipelines: true }, opts);

    // one
    const [changes, specs] = await Promise.all([getActiveChangeIds(), getSpecIds()]);
    const pipelines = listPipelines(process.cwd());
    const items: { name: string; value: { type: ItemType; id: string } }[] = [];
    items.push(...changes.map(id => ({ name: `change/${id}`, value: { type: 'change' as const, id } })));
    items.push(...specs.map(id => ({ name: `spec/${id}`, value: { type: 'spec' as const, id } })));
    items.push(...pipelines.map(id => ({ name: `pipeline/${id}`, value: { type: 'pipeline' as const, id } })));
    if (items.length === 0) {
      console.error('No items found to validate.');
      process.exitCode = 1;
      return;
    }
    const picked = await select<{ type: ItemType; id: string }>({ message: 'Pick an item', choices: items });
    await this.validateByType(picked.type, picked.id, opts);
  }

  private printNonInteractiveHint(): void {
    console.error('Nothing to validate. Try one of:');
    console.error('  openspec validate --all');
    console.error('  openspec validate --changes');
    console.error('  openspec validate --specs');
    console.error('  openspec validate --pipelines');
    console.error('  openspec validate <item-name>');
    console.error('Or run in an interactive terminal.');
  }

  private async validateDirectItem(itemName: string, opts: { typeOverride?: ItemType; strict: boolean; json: boolean }): Promise<void> {
    // Explicit --type pipeline: validate by name directly.
    if (opts.typeOverride === 'pipeline') {
      await this.validateByType('pipeline', itemName, opts);
      return;
    }

    const [changes, specs] = await Promise.all([getActiveChangeIds(), getSpecIds()]);
    const pipelines = listPipelines(process.cwd());
    const isChange = changes.includes(itemName);
    const isSpec = specs.includes(itemName);
    const isPipeline = pipelines.includes(itemName);

    const type =
      opts.typeOverride ??
      (isChange ? 'change' : isSpec ? 'spec' : isPipeline ? 'pipeline' : undefined);

    if (!type) {
      console.error(`Unknown item '${itemName}'`);
      const suggestions = nearestMatches(itemName, [...changes, ...specs, ...pipelines]);
      if (suggestions.length) console.error(`Did you mean: ${suggestions.join(', ')}?`);
      process.exitCode = 1;
      return;
    }

    // Ambiguity: only changes and specs share a namespace requiring --type.
    // Pipelines live in a distinct directory, so a change/spec always wins
    // unless --type pipeline is passed (handled above).
    if (!opts.typeOverride && isChange && isSpec) {
      console.error(`Ambiguous item '${itemName}' matches both a change and a spec.`);
      console.error('Pass --type change|spec, or use: openspec change validate / openspec spec validate');
      process.exitCode = 1;
      return;
    }

    await this.validateByType(type, itemName, opts);
  }

  private async validateByType(type: ItemType, id: string, opts: { strict: boolean; json: boolean }): Promise<void> {
    if (type === 'pipeline') {
      const start = Date.now();
      const report = validatePipelineByName(id, process.cwd());
      const durationMs = Date.now() - start;
      this.printReport('pipeline', id, report, durationMs, opts.json);
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    const validator = new Validator(opts.strict);
    if (type === 'change') {
      const changeDir = path.join(process.cwd(), 'openspec', 'changes', id);
      const start = Date.now();
      const report = await validator.validateChangeDeltaSpecs(changeDir);
      const durationMs = Date.now() - start;
      this.printReport('change', id, report, durationMs, opts.json);
      // Non-zero exit if invalid (keeps enriched output test semantics)
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    const file = path.join(process.cwd(), 'openspec', 'specs', id, 'spec.md');
    const start = Date.now();
    const report = await validator.validateSpec(file);
    const durationMs = Date.now() - start;
    this.printReport('spec', id, report, durationMs, opts.json);
    process.exitCode = report.valid ? 0 : 1;
  }

  private printReport(type: ItemType, id: string, report: { valid: boolean; issues: any[] }, durationMs: number, json: boolean): void {
    if (json) {
      const out = { items: [{ id, type, valid: report.valid, issues: report.issues, durationMs }], summary: { totals: { items: 1, passed: report.valid ? 1 : 0, failed: report.valid ? 0 : 1 }, byType: { [type]: { items: 1, passed: report.valid ? 1 : 0, failed: report.valid ? 0 : 1 } } }, version: '1.0' };
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    const label = labelForType(type);
    if (report.valid) {
      console.log(`${label} '${id}' is valid`);
    } else {
      console.error(`${label} '${id}' has issues`);
      for (const issue of report.issues) {
        const issueLabel = issue.level === 'ERROR' ? 'ERROR' : issue.level;
        const prefix = issue.level === 'ERROR' ? '✗' : issue.level === 'WARNING' ? '⚠' : 'ℹ';
        console.error(`${prefix} [${issueLabel}] ${issue.path}: ${issue.message}`);
      }
      this.printNextSteps(type);
    }
  }

  private printNextSteps(type: ItemType): void {
    const bullets: string[] = [];
    if (type === 'change') {
      bullets.push('- Ensure change has deltas in specs/: use headers ## ADDED/MODIFIED/REMOVED/RENAMED Requirements');
      bullets.push('- Each requirement MUST include at least one #### Scenario: block');
      bullets.push('- Debug parsed deltas: openspec change show <id> --json --deltas-only');
    } else if (type === 'pipeline') {
      bullets.push('- Ensure every stage has an `id` and `skill`, and that `requires` references existing stage ids');
      bullets.push('- Ensure each `skill` matches a known skill (see `openspec pipeline show <name>`)');
      bullets.push('- Avoid dependency cycles and keep parallelGroup members mutually independent');
    } else {
      bullets.push('- Ensure spec includes ## Purpose and ## Requirements sections');
      bullets.push('- Each requirement MUST include at least one #### Scenario: block');
      bullets.push('- Re-run with --json to see structured report');
    }
    console.error('Next steps:');
    bullets.forEach(b => console.error(`  ${b}`));
  }

  private async runBulkValidation(scope: { changes: boolean; specs: boolean; pipelines?: boolean }, opts: { strict: boolean; json: boolean; concurrency?: string; noInteractive?: boolean }): Promise<void> {
    const spinner = !opts.json && !opts.noInteractive ? ora('Validating...').start() : undefined;
    const [changeIds, specIds] = await Promise.all([
      scope.changes ? getActiveChangeIds() : Promise.resolve<string[]>([]),
      scope.specs ? getSpecIds() : Promise.resolve<string[]>([]),
    ]);
    const pipelineIds = scope.pipelines ? listPipelines(process.cwd()) : [];

    const DEFAULT_CONCURRENCY = 6;
    const maxSuggestions = 5; // used by nearestMatches
    const concurrency = normalizeConcurrency(opts.concurrency) ?? normalizeConcurrency(process.env.OPENSPEC_CONCURRENCY) ?? DEFAULT_CONCURRENCY;
    const validator = new Validator(opts.strict);
    const queue: Array<() => Promise<BulkItemResult>> = [];

    for (const id of changeIds) {
      queue.push(async () => {
        const start = Date.now();
        const changeDir = path.join(process.cwd(), 'openspec', 'changes', id);
        const report = await validator.validateChangeDeltaSpecs(changeDir);
        const durationMs = Date.now() - start;
        return { id, type: 'change' as const, valid: report.valid, issues: report.issues, durationMs };
      });
    }
    for (const id of specIds) {
      queue.push(async () => {
        const start = Date.now();
        const file = path.join(process.cwd(), 'openspec', 'specs', id, 'spec.md');
        const report = await validator.validateSpec(file);
        const durationMs = Date.now() - start;
        return { id, type: 'spec' as const, valid: report.valid, issues: report.issues, durationMs };
      });
    }
    for (const id of pipelineIds) {
      queue.push(async () => {
        const start = Date.now();
        const report = validatePipelineByName(id, process.cwd());
        const durationMs = Date.now() - start;
        return { id, type: 'pipeline' as const, valid: report.valid, issues: report.issues, durationMs };
      });
    }

    if (queue.length === 0) {
      spinner?.stop();

      const summary = {
        totals: { items: 0, passed: 0, failed: 0 },
        byType: {
          ...(scope.changes ? { change: { items: 0, passed: 0, failed: 0 } } : {}),
          ...(scope.specs ? { spec: { items: 0, passed: 0, failed: 0 } } : {}),
          ...(scope.pipelines ? { pipeline: { items: 0, passed: 0, failed: 0 } } : {}),
        },
      } as const;

      if (opts.json) {
        const out = { items: [] as BulkItemResult[], summary, version: '1.0' };
        console.log(JSON.stringify(out, null, 2));
      } else {
        console.log('No items found to validate.');
      }

      process.exitCode = 0;
      return;
    }

    const results: BulkItemResult[] = [];
    let index = 0;
    let running = 0;
    let passed = 0;
    let failed = 0;

    await new Promise<void>((resolve) => {
      const next = () => {
        while (running < concurrency && index < queue.length) {
          const currentIndex = index++;
          const task = queue[currentIndex];
          running++;
          if (spinner) spinner.text = `Validating (${currentIndex + 1}/${queue.length})...`;
          task()
            .then(res => {
              results.push(res);
              if (res.valid) passed++; else failed++;
            })
            .catch((error: any) => {
              const message = error?.message || 'Unknown error';
              const res: BulkItemResult = { id: getPlannedId(currentIndex, changeIds, specIds, pipelineIds) ?? 'unknown', type: getPlannedType(currentIndex, changeIds, specIds, pipelineIds) ?? 'change', valid: false, issues: [{ level: 'ERROR', path: 'file', message }], durationMs: 0 };
              results.push(res);
              failed++;
            })
            .finally(() => {
              running--;
              if (index >= queue.length && running === 0) resolve();
              else next();
            });
        }
      };
      next();
    });

    spinner?.stop();

    results.sort((a, b) => a.id.localeCompare(b.id));
    const summary = {
      totals: { items: results.length, passed, failed },
      byType: {
        ...(scope.changes ? { change: summarizeType(results, 'change') } : {}),
        ...(scope.specs ? { spec: summarizeType(results, 'spec') } : {}),
        ...(scope.pipelines ? { pipeline: summarizeType(results, 'pipeline') } : {}),
      },
    } as const;

    if (opts.json) {
      const out = { items: results, summary, version: '1.0' };
      console.log(JSON.stringify(out, null, 2));
    } else {
      for (const res of results) {
        if (res.valid) console.log(`✓ ${res.type}/${res.id}`);
        else console.error(`✗ ${res.type}/${res.id}`);
      }
      console.log(`Totals: ${summary.totals.passed} passed, ${summary.totals.failed} failed (${summary.totals.items} items)`);
    }

    process.exitCode = failed > 0 ? 1 : 0;
  }
}

function summarizeType(results: BulkItemResult[], type: ItemType) {
  const filtered = results.filter(r => r.type === type);
  const items = filtered.length;
  const passed = filtered.filter(r => r.valid).length;
  const failed = items - passed;
  return { items, passed, failed };
}

function normalizeConcurrency(value?: string): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) return undefined;
  return n;
}

function labelForType(type: ItemType): string {
  if (type === 'change') return 'Change';
  if (type === 'pipeline') return 'Pipeline';
  return 'Specification';
}

function getPlannedId(index: number, changeIds: string[], specIds: string[], pipelineIds: string[] = []): string | undefined {
  const totalChanges = changeIds.length;
  if (index < totalChanges) return changeIds[index];
  const specIndex = index - totalChanges;
  if (specIndex < specIds.length) return specIds[specIndex];
  const pipelineIndex = specIndex - specIds.length;
  return pipelineIds[pipelineIndex];
}

function getPlannedType(index: number, changeIds: string[], specIds: string[], pipelineIds: string[] = []): ItemType | undefined {
  const totalChanges = changeIds.length;
  if (index < totalChanges) return 'change';
  const specIndex = index - totalChanges;
  if (specIndex >= 0 && specIndex < specIds.length) return 'spec';
  const pipelineIndex = specIndex - specIds.length;
  if (pipelineIndex >= 0 && pipelineIndex < pipelineIds.length) return 'pipeline';
  return undefined;
}
