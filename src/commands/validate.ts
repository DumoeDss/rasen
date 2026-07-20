import ora from 'ora';
import path from 'path';
import { Validator } from '../core/validation/validator.js';
import {
  resolveRootForCommand,
  toRootOutput,
  withStoreFlag,
  type ResolvedOpenSpecRoot,
} from '../core/root-selection.js';
import { isInteractive, resolveNoInteractive } from '../utils/interactive.js';
import { getSpecIds } from '../utils/item-discovery.js';
import { getAvailableChanges } from './workflow/shared.js';
import { nearestMatches } from '../utils/match.js';
import {
  loadPipelineByName,
  listPipelines,
  validatePipelineForExecution,
  PipelineValidationError,
} from '../core/pipeline-registry/index.js';
import { PipelineLoadError } from '../core/pipeline-registry/index.js';

type ItemType = 'change' | 'spec' | 'pipeline';

type ValidationIssue = {
  level: 'ERROR' | 'WARNING' | 'INFO';
  path: string;
  message: string;
  code?: string;
};

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
    validatePipelineForExecution(pipeline, projectRoot);
  } catch (error) {
    const message =
      error instanceof PipelineLoadError && error.cause
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    issues.push({
      level: 'ERROR',
      path: 'pipeline',
      message,
      ...(error instanceof PipelineValidationError ? { code: error.code } : {}),
    });
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
  store?: string;
  project?: string;
  storePath?: string;
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
    const root = await resolveRootForCommand(options, { json: options.json });
    if (!root) {
      return;
    }

    const interactive = isInteractive(options);

    // Handle bulk flags first
    if (options.all || options.changes || options.specs || options.pipelines) {
      await this.runBulkValidation(root, {
        changes: !!options.all || !!options.changes,
        specs: !!options.all || !!options.specs,
        pipelines: !!options.all || !!options.pipelines,
      }, { strict: !!options.strict, json: !!options.json, concurrency: options.concurrency, noInteractive: resolveNoInteractive(options) });
      return;
    }

    // `--type pipeline` with no item name => validate all pipelines.
    if (!itemName && this.normalizeType(options.type) === 'pipeline') {
      await this.runBulkValidation(
        root,
        { changes: false, specs: false, pipelines: true },
        { strict: !!options.strict, json: !!options.json, concurrency: options.concurrency, noInteractive: resolveNoInteractive(options) }
      );
      return;
    }

    // No item and no flags
    if (!itemName) {
      if (interactive) {
        await this.runInteractiveSelector(root, { strict: !!options.strict, json: !!options.json, concurrency: options.concurrency });
        return;
      }
      this.printNonInteractiveHint(root);
      process.exitCode = 1;
      return;
    }

    // Direct item validation with type detection or override
    const typeOverride = this.normalizeType(options.type);
    await this.validateDirectItem(root, itemName, { typeOverride, strict: !!options.strict, json: !!options.json });
  }

  private normalizeType(value?: string): ItemType | undefined {
    if (!value) return undefined;
    const v = value.toLowerCase();
    if (v === 'change' || v === 'spec' || v === 'pipeline') return v;
    return undefined;
  }

  /**
   * Resolve change IDs by directory existence within the resolved root — the
   * same rule `rasen status`/`instructions` use (`getAvailableChanges`) —
   * rather than requiring `proposal.md`. This lets `validate` resolve a
   * scaffolded or still-authoring change that the sibling commands already
   * resolve (#1182). Sorted to preserve the prior `getActiveChangeIds` ordering.
   */
  private async listChangeIds(root: ResolvedOpenSpecRoot): Promise<string[]> {
    const ids = await getAvailableChanges(root.path, root.changesDir);
    return ids.sort();
  }

  private async runInteractiveSelector(root: ResolvedOpenSpecRoot, opts: { strict: boolean; json: boolean; concurrency?: string }): Promise<void> {
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

    if (choice === 'all') return this.runBulkValidation(root, { changes: true, specs: true, pipelines: true }, opts);
    if (choice === 'changes') return this.runBulkValidation(root, { changes: true, specs: false, pipelines: false }, opts);
    if (choice === 'specs') return this.runBulkValidation(root, { changes: false, specs: true, pipelines: false }, opts);
    if (choice === 'pipelines') return this.runBulkValidation(root, { changes: false, specs: false, pipelines: true }, opts);

    // one
    const [changes, specs] = await Promise.all([this.listChangeIds(root), getSpecIds(root.path)]);
    const pipelines = listPipelines(root.path);
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
    await this.validateByType(root, picked.type, picked.id, opts);
  }

  private printNonInteractiveHint(root: ResolvedOpenSpecRoot): void {
    console.error('Nothing to validate. Try one of:');
    console.error(`  ${withStoreFlag(root, 'rasen validate --all')}`);
    console.error(`  ${withStoreFlag(root, 'rasen validate --changes')}`);
    console.error(`  ${withStoreFlag(root, 'rasen validate --specs')}`);
    console.error(`  ${withStoreFlag(root, 'rasen validate --pipelines')}`);
    console.error(`  ${withStoreFlag(root, 'rasen validate <item-name>')}`);
    console.error('Or run in an interactive terminal.');
  }

  private async validateDirectItem(root: ResolvedOpenSpecRoot, itemName: string, opts: { typeOverride?: ItemType; strict: boolean; json: boolean }): Promise<void> {
    // Explicit --type pipeline: validate by name directly.
    if (opts.typeOverride === 'pipeline') {
      await this.validateByType(root, 'pipeline', itemName, opts);
      return;
    }

    const [changes, specs] = await Promise.all([this.listChangeIds(root), getSpecIds(root.path)]);
    const pipelines = listPipelines(root.path);
    const isChange = changes.includes(itemName);
    const isSpec = specs.includes(itemName);
    const isPipeline = pipelines.includes(itemName);

    const type =
      opts.typeOverride ??
      (isChange ? 'change' : isSpec ? 'spec' : isPipeline ? 'pipeline' : undefined);

    if (!type) {
      const suggestions = nearestMatches(itemName, [...changes, ...specs, ...pipelines]);
      const message = suggestions.length
        ? `Unknown item '${itemName}'. Did you mean: ${suggestions.join(', ')}?`
        : `Unknown item '${itemName}'.`;
      if (opts.json) {
        console.log(
          JSON.stringify(
            { status: [{ severity: 'error', code: 'unknown_item', message }] },
            null,
            2
          )
        );
      } else {
        console.error(message);
      }
      process.exitCode = 1;
      return;
    }

    // Ambiguity: only changes and specs share a namespace requiring --type.
    // Pipelines live in a distinct directory, so a change/spec always wins
    // unless --type pipeline is passed (handled above).
    if (!opts.typeOverride && isChange && isSpec) {
      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              status: [
                {
                  severity: 'error',
                  code: 'ambiguous_item',
                  message: `Ambiguous item '${itemName}' matches both a change and a spec.`,
                  fix: 'Pass --type change|spec.',
                },
              ],
            },
            null,
            2
          )
        );
        process.exitCode = 1;
        return;
      }
      console.error(`Ambiguous item '${itemName}' matches both a change and a spec.`);
      console.error('Pass --type change|spec.');
      process.exitCode = 1;
      return;
    }

    await this.validateByType(root, type, itemName, opts);
  }

  private async validateByType(root: ResolvedOpenSpecRoot, type: ItemType, id: string, opts: { strict: boolean; json: boolean }): Promise<void> {
    if (type === 'pipeline') {
      const start = Date.now();
      const report = validatePipelineByName(id, root.path);
      const durationMs = Date.now() - start;
      this.printReport('pipeline', id, report, durationMs, opts.json, root);
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    const validator = new Validator(opts.strict);
    if (type === 'change') {
      const changeDir = path.join(root.changesDir, id);
      const start = Date.now();
      const report = await validator.validateChangeDeltaSpecs(changeDir);
      const durationMs = Date.now() - start;
      this.printReport('change', id, report, durationMs, opts.json, root);
      // Non-zero exit if invalid (keeps enriched output test semantics)
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    const file = path.join(root.specsDir, id, 'spec.md');
    const start = Date.now();
    const report = await validator.validateSpec(file);
    const durationMs = Date.now() - start;
    this.printReport('spec', id, report, durationMs, opts.json, root);
    process.exitCode = report.valid ? 0 : 1;
  }

  private printReport(type: ItemType, id: string, report: { valid: boolean; issues: any[] }, durationMs: number, json: boolean, root: ResolvedOpenSpecRoot): void {
    if (json) {
      const out = { items: [{ id, type, valid: report.valid, issues: report.issues, durationMs }], summary: { totals: { items: 1, passed: report.valid ? 1 : 0, failed: report.valid ? 0 : 1 }, byType: { [type]: { items: 1, passed: report.valid ? 1 : 0, failed: report.valid ? 0 : 1 } } }, version: '1.0', root: toRootOutput(root) };
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
      this.printNextSteps(type, id, root);
    }
  }

  private printNextSteps(type: ItemType, id: string, root: ResolvedOpenSpecRoot): void {
    const bullets: string[] = [];
    if (type === 'change') {
      bullets.push('- Ensure change has deltas in specs/: use headers ## ADDED/MODIFIED/REMOVED/RENAMED Requirements');
      bullets.push('- Each requirement MUST include at least one #### Scenario: block');
      bullets.push(`- Debug parsed deltas: ${withStoreFlag(root, `rasen show ${id} --json --deltas-only`)}`);
    } else if (type === 'pipeline') {
      bullets.push('- Ensure every stage has an `id` and `skill`, and that `requires` references existing stage ids');
      bullets.push('- Ensure each `skill` matches a known skill (see `rasen pipeline show <name>`)');
      bullets.push('- Avoid dependency cycles and keep parallelGroup members mutually independent');
    } else {
      bullets.push('- Ensure spec includes ## Purpose and ## Requirements sections');
      bullets.push('- Each requirement MUST include at least one #### Scenario: block');
      bullets.push('- Re-run with --json to see structured report');
    }
    console.error('Next steps:');
    bullets.forEach(b => console.error(`  ${b}`));
  }

  private async runBulkValidation(root: ResolvedOpenSpecRoot, scope: { changes: boolean; specs: boolean; pipelines?: boolean }, opts: { strict: boolean; json: boolean; concurrency?: string; noInteractive?: boolean }): Promise<void> {
    const spinner = !opts.json && !opts.noInteractive ? ora('Validating...').start() : undefined;
    const [changeIds, specIds] = await Promise.all([
      scope.changes ? this.listChangeIds(root) : Promise.resolve<string[]>([]),
      scope.specs ? getSpecIds(root.path) : Promise.resolve<string[]>([]),
    ]);
    const pipelineIds = scope.pipelines ? listPipelines(root.path) : [];

    const DEFAULT_CONCURRENCY = 6;
    const maxSuggestions = 5; // used by nearestMatches
    const concurrency = normalizeConcurrency(opts.concurrency) ?? normalizeConcurrency(process.env.RASEN_CONCURRENCY) ?? DEFAULT_CONCURRENCY;
    const validator = new Validator(opts.strict);
    const queue: Array<() => Promise<BulkItemResult>> = [];

    for (const id of changeIds) {
      queue.push(async () => {
        const start = Date.now();
        const changeDir = path.join(root.changesDir, id);
        const report = await validator.validateChangeDeltaSpecs(changeDir);
        const durationMs = Date.now() - start;
        return { id, type: 'change' as const, valid: report.valid, issues: report.issues, durationMs };
      });
    }
    for (const id of specIds) {
      queue.push(async () => {
        const start = Date.now();
        const file = path.join(root.specsDir, id, 'spec.md');
        const report = await validator.validateSpec(file);
        const durationMs = Date.now() - start;
        return { id, type: 'spec' as const, valid: report.valid, issues: report.issues, durationMs };
      });
    }
    for (const id of pipelineIds) {
      queue.push(async () => {
        const start = Date.now();
        const report = validatePipelineByName(id, root.path);
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
        const out = { items: [] as BulkItemResult[], summary, version: '1.0', root: toRootOutput(root) };
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
      const out = { items: results, summary, version: '1.0', root: toRootOutput(root) };
      console.log(JSON.stringify(out, null, 2));
    } else {
      for (const res of results) {
        if (res.valid) console.log(`✓ ${res.type}/${res.id}`);
        else console.error(`✗ ${res.type}/${res.id}`);
      }
      console.log(`Totals: ${summary.totals.passed} passed, ${summary.totals.failed} failed (${summary.totals.items} items)`);
      const firstFailure = results.find((res) => !res.valid);
      if (firstFailure) {
        console.log(
          `Details: ${withStoreFlag(root, `rasen validate ${firstFailure.id} --type ${firstFailure.type}`)}`
        );
      }
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
