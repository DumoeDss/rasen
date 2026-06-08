/**
 * Pipeline Command
 *
 * Inspect and reason about orchestration pipelines:
 *   - list     : enumerate available pipelines (project > user > package)
 *   - show     : print a single pipeline's stage DAG + build order
 *   - classify : deterministic keyword heuristic mapping a task to a pipeline
 *   - resume   : compute next/remaining stages from a change's run-state
 *
 * This command is a thin consumer of the pipeline-registry public API; it does
 * not own any pipeline parsing/graph logic of its own.
 */

import * as path from 'node:path';
import {
  loadPipelineByName,
  listPipelines,
  listPipelinesWithInfo,
  PipelineGraph,
  readRunState,
  completedStages,
  stageWorkers,
  stagesWithStatus,
  normalizeWorker,
  readPortfolioState,
  runnableChildren,
  interruptedChildren,
  escalatedChildren,
  isPortfolioComplete,
  resolveChildPipelineName,
  type PipelineInfo,
  type Stage,
} from '../core/pipeline-registry/index.js';
import { validateChangeExists } from './workflow/shared.js';

interface PipelineCommandOptions {
  json?: boolean;
}

/**
 * Serialized form of a single stage in `show` output: every field, with
 * defaults made explicit so consumers (e.g. auto.ts) get a stable shape.
 */
interface StageView {
  id: string;
  kind: Stage['kind'];
  skill: string | null;
  childPipeline: string | null;
  role: Stage['role'] | null;
  requires: string[];
  gate: boolean;
  loop: Stage['loop'] | null;
  parallelGroup: string | null;
  condition: string | null;
  leadReview: boolean;
  verifyPolicy: Stage['verifyPolicy'] | null;
}

// Keyword heuristics for `classify`. Matched against the lowercased task string.
const BUG_FIX_KEYWORDS = [
  'fix',
  'bug',
  'broken',
  'regression',
  'error',
  "doesn't work",
  'crash',
  'hotfix',
] as const;

const FULL_FEATURE_KEYWORDS = [
  'add system',
  'implement',
  'module',
  'new feature',
  'multi-component',
  'architecture',
  'redesign',
  'subsystem',
] as const;

/**
 * Whole-word/phrase match so short keywords like "fix" don't hit substrings
 * such as "prefix" / "suffix". Boundaries are non-alphanumeric (or string
 * edges), which also handles multi-word phrases and apostrophes.
 */
function matchesKeyword(keyword: string, lowercasedText: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(lowercasedText);
}

export class PipelineCommand {
  private resolveProjectRoot(): string {
    return process.cwd();
  }

  /**
   * List available pipelines with metadata.
   */
  async list(options: PipelineCommandOptions = {}): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const pipelines = listPipelinesWithInfo(projectRoot);

    if (options.json) {
      console.log(JSON.stringify({ pipelines }, null, 2));
      return;
    }

    if (pipelines.length === 0) {
      console.log('No pipelines found.');
      return;
    }

    this.printPipelineTable(pipelines);
  }

  /**
   * Show a single pipeline's stage DAG and build order.
   */
  async show(name: string, options: PipelineCommandOptions = {}): Promise<void> {
    const projectRoot = this.resolveProjectRoot();

    let pipeline;
    try {
      pipeline = loadPipelineByName(name, projectRoot);
    } catch {
      const available = listPipelines(projectRoot);
      const list = available.length > 0 ? available.join('\n  ') : '(none)';
      throw new Error(`Pipeline '${name}' not found. Available pipelines:\n  ${list}`);
    }

    const graph = PipelineGraph.fromPipeline(pipeline);
    const buildOrder = graph.getBuildOrder();
    const stages: StageView[] = pipeline.stages.map((s) => this.toStageView(s));

    const result = {
      name: pipeline.name,
      description: pipeline.description ?? '',
      buildOrder,
      stages,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    this.printPipelineDetail(result, graph);
  }

  /**
   * Classify a task string to a suggested pipeline using deterministic keyword
   * heuristics. Advisory only — callers may override.
   */
  async classify(task: string, options: PipelineCommandOptions = {}): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const available = listPipelines(projectRoot);
    const lowered = (task ?? '').toLowerCase();

    const bugMatches = BUG_FIX_KEYWORDS.filter((kw) => matchesKeyword(kw, lowered));
    const fullMatches = FULL_FEATURE_KEYWORDS.filter((kw) => matchesKeyword(kw, lowered));

    let suggested: string;
    let matched: string[];
    if (bugMatches.length > 0) {
      suggested = 'bug-fix';
      matched = [...bugMatches];
    } else if (fullMatches.length > 0) {
      suggested = 'full-feature';
      matched = [...fullMatches];
    } else {
      suggested = 'small-feature';
      matched = [];
    }

    const result = { suggested, matched, available };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`Suggested pipeline: ${suggested}`);
    if (matched.length > 0) {
      console.log(`Matched indicators: ${matched.join(', ')}`);
    } else {
      console.log('Matched indicators: (none — defaulted to small-feature)');
    }
    console.log('This suggestion is advisory; you can override it with any available pipeline.');
    if (available.length > 0) {
      console.log(`Available: ${available.join(', ')}`);
    }
  }

  /**
   * Resume a change: compute next/remaining stages from its run-state file.
   */
  async resume(change: string | undefined, options: PipelineCommandOptions = {}): Promise<void> {
    const projectRoot = this.resolveProjectRoot();
    const changeName = await validateChangeExists(change, projectRoot);

    const changeDir = path.join(projectRoot, 'openspec', 'changes', changeName);

    // Portfolio parent? The portfolio record is authoritative — resume reports
    // the next runnable child(ren) from the dependency DAG rather than stages.
    const portfolio = readPortfolioState(changeDir);
    if (portfolio) {
      const isSatisfied = (s: string) => s === 'done' || s === 'skipped';
      const runnable = runnableChildren(portfolio);
      // Interrupted (in_progress) and escalated children are NOT runnable, but
      // must be surfaced so resume never silently strands them: interrupted →
      // warm-seed-resume; escalated → human attention.
      const interrupted = interruptedChildren(portfolio);
      const escalated = escalatedChildren(portfolio);
      // Run-level persistent planner pointer (one planner spans all children's
      // proposes) — the resumer warm-seeds the next planner from it.
      const planner = normalizeWorker(portfolio.planner) ?? null;
      const completedChildren = portfolio.children
        .filter(c => isSatisfied(c.status))
        .map(c => c.id);
      const remainingChildren = portfolio.children
        .filter(c => !isSatisfied(c.status))
        .map(c => c.id);
      const result = {
        change: changeName,
        isPortfolio: true as const,
        hasRunState: true as const,
        complete: isPortfolioComplete(portfolio),
        completedChildren,
        runnableChildren: runnable,
        interruptedChildren: interrupted,
        escalatedChildren: escalated,
        planner,
        remainingChildren,
        children: portfolio.children.map(c => ({
          id: c.id,
          pipeline: c.pipeline,
          dependsOn: c.dependsOn,
          status: c.status,
        })),
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Change: ${changeName} (portfolio of ${portfolio.children.length} children)`);
      console.log(`Completed: ${completedChildren.length > 0 ? completedChildren.join(', ') : '(none)'}`);
      console.log(`Runnable now: ${runnable.length > 0 ? runnable.join(', ') : '(none)'}`);
      if (interrupted.length > 0) {
        console.log(`Interrupted (warm-seed resume): ${interrupted.join(', ')}`);
      }
      if (escalated.length > 0) {
        console.log(`Escalated (needs attention): ${escalated.join(', ')}`);
      }
      if (planner) {
        console.log(
          `Planner (persistent, warm-seedable): ${planner.agentId ?? planner.role ?? 'recorded'}`
        );
      }
      console.log(`Remaining: ${remainingChildren.length > 0 ? remainingChildren.join(', ') : '(none)'}`);
      return;
    }

    const runState = readRunState(changeDir);

    // No run-state recorded yet (or not in usable form).
    if (!runState || runState.pipeline.length === 0) {
      const result = {
        change: changeName,
        hasRunState: false as const,
        pipeline: null,
        completed: [] as string[],
        next: null,
        remaining: [] as string[],
        note: 'No run-state (auto-run.json) found; run classification to select a pipeline.',
      };
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Change: ${changeName}`);
      console.log(result.note);
      return;
    }

    const pipeline = loadPipelineByName(runState.pipeline, projectRoot);
    const graph = PipelineGraph.fromPipeline(pipeline);
    const buildOrder = graph.getBuildOrder();
    const completed = completedStages(runState);
    const completedSet = new Set(completed);
    // getNextStages can return several ready stages (parallel frontier); report
    // the full set as `ready`, and keep `next` as its first member for callers
    // that want a single cursor.
    const ready = graph.getNextStages(completedSet);
    const next = ready[0] ?? null;
    const remaining = buildOrder.filter((id) => !completedSet.has(id));
    // Worker pointers recorded per stage. After a restart these agentIds are
    // dead SendMessage handles, but their `transcript` paths let a resume
    // WARM-SEED a fresh same-role worker from its predecessor's context.
    const workers = stageWorkers(runState);
    // Surface non-terminal stages so resume never hides them: in_progress was
    // interrupted (re-engage), escalated needs human attention. openFindings
    // carries unresolved Blocker/Major so a resumer does not ship past them.
    const inProgressStages = stagesWithStatus(runState, 'in_progress');
    const escalatedStages = stagesWithStatus(runState, 'escalated');
    const openFindings = runState.openFindings ?? [];

    const result = {
      change: changeName,
      pipeline: runState.pipeline,
      hasRunState: true as const,
      completed,
      next,
      ready,
      remaining,
      workers,
      inProgressStages,
      escalatedStages,
      openFindings,
    };

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const warmSeedable = Object.keys(workers);
    console.log(`Change: ${changeName}`);
    console.log(`Pipeline: ${runState.pipeline}`);
    console.log(`Completed: ${completed.length > 0 ? completed.join(', ') : '(none)'}`);
    console.log(`Next: ${next ?? '(complete)'}`);
    console.log(`Remaining: ${remaining.length > 0 ? remaining.join(', ') : '(none)'}`);
    if (inProgressStages.length > 0) {
      console.log(`Interrupted (warm-seed resume): ${inProgressStages.join(', ')}`);
    }
    if (escalatedStages.length > 0) {
      console.log(`Escalated (needs attention): ${escalatedStages.join(', ')}`);
    }
    if (openFindings.length > 0) {
      console.log(`Open findings: ${openFindings.length} (resolve before ship)`);
    }
    if (warmSeedable.length > 0) {
      console.log(`Warm-seed available (prior worker transcripts): ${warmSeedable.join(', ')}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private toStageView(stage: Stage): StageView {
    return {
      id: stage.id,
      kind: stage.kind,
      skill: stage.skill ?? null,
      // For a decompose stage, surface the RESOLVED child pipeline (default
      // applied) so consumers see exactly what each child will run.
      childPipeline: stage.kind === 'decompose' ? resolveChildPipelineName(stage) : null,
      role: stage.role ?? null,
      requires: stage.requires,
      gate: stage.gate,
      loop: stage.loop ?? null,
      parallelGroup: stage.parallelGroup ?? null,
      condition: stage.condition ?? null,
      leadReview: stage.leadReview,
      verifyPolicy: stage.verifyPolicy ?? null,
    };
  }

  private printPipelineTable(pipelines: PipelineInfo[]): void {
    console.log('Available pipelines:');
    console.log();
    for (const p of pipelines) {
      console.log(`  ${p.name}  [${p.source}]`);
      if (p.description) {
        console.log(`    ${p.description.replace(/\s+/g, ' ').trim()}`);
      }
      console.log(`    stages: ${p.stages.join(' -> ')}`);
      console.log();
    }
  }

  private printPipelineDetail(
    result: { name: string; description: string; buildOrder: string[]; stages: StageView[] },
    graph: PipelineGraph
  ): void {
    console.log(`Pipeline: ${result.name}`);
    if (result.description) {
      console.log(result.description.replace(/\s+/g, ' ').trim());
    }
    console.log();
    console.log('Build order:');
    for (const id of result.buildOrder) {
      const stage = graph.getStage(id);
      if (!stage) continue;
      const meta: string[] = [];
      if (stage.role) meta.push(`role=${stage.role}`);
      if (stage.requires.length > 0) meta.push(`requires=[${stage.requires.join(', ')}]`);
      if (stage.gate) meta.push('gate');
      if (stage.loop) meta.push(`loop=${stage.loop.kind}(max ${stage.loop.maxRounds})`);
      if (stage.parallelGroup) meta.push(`parallelGroup=${stage.parallelGroup}`);
      if (stage.condition) meta.push(`condition=${stage.condition}`);
      if (stage.leadReview) meta.push('leadReview');
      if (stage.verifyPolicy) meta.push(`verifyPolicy=${stage.verifyPolicy}`);
      const suffix = meta.length > 0 ? `  (${meta.join('; ')})` : '';
      // A decompose stage has no leaf skill; show its fan-out target instead.
      const action =
        stage.kind === 'decompose'
          ? `decompose -> childPipeline=${resolveChildPipelineName(stage)}`
          : stage.skill;
      console.log(`  ${id} -> ${action}${suffix}`);
    }
  }
}

