/**
 * The portfolio→plan publication orchestration (design D4/D5/D6):
 * locate the run-state through the resume seam, read it strictly, compile,
 * resolve every child against committed evidence, publish through
 * `StoreIssues.publishPlan`.
 *
 * The channel writes EXACTLY ONE thing: the revision file `publishPlan`
 * creates. The portfolio run-state, the parent change directory, the machine
 * workspace index, and every child change directory are read-only inputs; the
 * dogfood asserts the run-state's bytes across publication (design D6).
 *
 * The portfolio locator is `rasen pipeline resume`'s seam, mirrored exactly:
 * the planning root resolved from the working directory, the change directory
 * under it, a probe-only work directory (publication never mints one), and the
 * execution root's ephemera directory — searched ephemera-first, then legacy
 * work dir, then the change directory, by `resolvePortfolioStateLocation`
 * itself. Consequences the refusals below hold onto:
 *
 *   - absent vs invalid stay distinct (`readPortfolioStateDetailed`; resume
 *     refuses to fall back and so does publication);
 *   - the record's own `parent` must agree with the requested parent — a
 *     copied or moved record never publishes under the wrong name;
 *   - no children → nothing to publish; an empty revision would read as a
 *     plan;
 *   - the change directory itself need not exist; the run-state file is the
 *     authority and the absent-refusal lists every location searched.
 */
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';

import { StoreError } from '../store/errors.js';
import {
  StoreIssuesModuleInstance,
  productionStoreIssueDependencies,
  type StoreIssueDependencies,
  type StoreIssues,
} from '../store/issues/index.js';
import { parseDecompositionDocument } from './decomposition.js';
import {
  PORTFOLIO_STATE_FILENAME,
  readPortfolioStateDetailed,
  resolvePortfolioStateLocation,
} from '../pipeline-registry/portfolio-state.js';
import { stateFileSearchChain } from '../pipeline-registry/run-state.js';
import { resolveChangeWorkDir } from '../change-work.js';
import { ephemeraDir } from '../file-placement.js';
import {
  resolvedExecutionProjectRoot,
  resolveOpenSpecRoot,
  type ResolvedOpenSpecRoot,
} from '../root-selection.js';
import { compilePortfolioChildren, planNodeForChild } from './compiler.js';
import { gatherChildEvidence, resolveChildByName, childNameRefusal } from './resolution.js';
import type {
  IssuePlanPublicationResult,
  PublishPlanFromDecompositionInput,
  PublishPlanFromPortfolioInput,
} from './types.js';

export interface PublishPlanFromPortfolioOptions {
  /** Injectable for tests; the production mutation Module by default. */
  readonly issues?: StoreIssues;
  readonly dependencies?: StoreIssueDependencies;
}

/** The same injection surface, for the decomposition channel. */
export type PublishPlanFromDecompositionOptions = PublishPlanFromPortfolioOptions;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Publishes the next Execution Plan revision for an Issue from a parent
 * Change's portfolio run-state.
 *
 * Refusal codes: `issue_plan_portfolio_root_unresolvable`,
 * `issue_plan_portfolio_absent`, `issue_plan_portfolio_invalid`,
 * `issue_plan_portfolio_parent_mismatch`,
 * `issue_plan_portfolio_children_empty`, and — from child resolution — the
 * `issue_reference_*` family plus `store_query_ref_unreadable`. Every refusal
 * lands with nothing durable: the only write in this function is the one
 * `publishPlan` performs after every check has passed.
 */
export async function publishPlanFromPortfolio(
  input: PublishPlanFromPortfolioInput,
  options: PublishPlanFromPortfolioOptions = {}
): Promise<IssuePlanPublicationResult> {
  const dependencies = options.dependencies ?? productionStoreIssueDependencies;
  const issues = options.issues ?? StoreIssuesModuleInstance;

  // 1. The planning root, from the working directory — the same fact resume
  //    resolves its placement chain from. `reporter: false`: a publication
  //    refuses or succeeds; it never narrates root selection.
  let root: ResolvedOpenSpecRoot;
  try {
    root = await resolveOpenSpecRoot({
      startPath: input.startPath,
      reporter: false,
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    });
  } catch (error) {
    throw new StoreError(
      `--from-portfolio resolves the parent '${input.parent}' from the working directory, like 'rasen pipeline resume', and '${input.startPath}' resolves no Rasen root (${messageOf(error)}).`,
      'issue_plan_portfolio_root_unresolvable',
      {
        target: input.startPath,
        fix: 'Run the command from a directory inside the project whose planning root locates the parent change.',
      }
    );
  }

  const changeDir = path.join(root.changesDir, input.parent);
  // Probe-only: publication reads state, it never mints identity or a work
  // directory (the same `ensure: false` resume uses).
  const workDir = await resolveChangeWorkDir(root.path, input.parent, { ensure: false });
  const executionRoot = resolvedExecutionProjectRoot(root);
  const stateLocations = {
    ...(executionRoot === undefined ? {} : { ephemeraDir: ephemeraDir(executionRoot, input.parent) }),
    ...(workDir === null ? {} : { workDir }),
  };

  // 2. Locate and strictly read the run-state.
  const location = resolvePortfolioStateLocation(changeDir, stateLocations);
  if (location === null) {
    const searched = stateFileSearchChain(changeDir, stateLocations)
      .map(dir => path.join(dir, PORTFOLIO_STATE_FILENAME))
      .join('; ');
    throw new StoreError(
      `No portfolio run-state exists for parent '${input.parent}' anywhere in the placement chain (execution-root ephemera directory, legacy work directory, change directory). Locations searched: ${searched}.`,
      'issue_plan_portfolio_absent',
      {
        target: changeDir,
        fix: `Publish the plan from a directory whose placement chain holds '${input.parent}'s ${PORTFOLIO_STATE_FILENAME}, or decompose the parent first so the run-state exists.`,
      }
    );
  }
  const read = readPortfolioStateDetailed(location.dir);
  if (read.kind === 'absent') {
    // Located by `resolvePortfolioStateLocation`, gone by the detailed read:
    // a vanish between the two is reported as absence at the located path —
    // the same honest fallback resume would need, never as invalid content.
    throw new StoreError(
      `No portfolio run-state exists for parent '${input.parent}' anywhere in the placement chain; a candidate was located at ${location.path} and vanished before it could be read.`,
      'issue_plan_portfolio_absent',
      {
        target: location.path,
        fix: `Re-run the publication; the run-state file moved or was removed while the command read it.`,
      }
    );
  }
  if (read.kind === 'invalid') {
    throw new StoreError(
      `The portfolio run-state for '${input.parent}' exists at ${location.path} but does not read back: ${read.reason}.`,
      'issue_plan_portfolio_invalid',
      {
        target: location.path,
        fix: `Repair the run-state file. A record that exists but does not parse is reported, never treated as absent — so a broken record cannot fall back to a different placement.`,
      }
    );
  }
  const state = read.state;
  if (state.parent !== input.parent) {
    throw new StoreError(
      `The portfolio run-state at ${location.path} declares parent '${state.parent}', not '${input.parent}'; a copied or moved record never publishes under the wrong name (expected: '${input.parent}'; actual: '${state.parent}').`,
      'issue_plan_portfolio_parent_mismatch',
      {
        target: location.path,
        fix: `Pass the parent the record itself declares, or move the record to the change directory of the parent it belongs to.`,
      }
    );
  }
  if (state.children.length === 0) {
    throw new StoreError(
      `The portfolio run-state for '${input.parent}' at ${location.path} names no children, so there is nothing to publish; an empty revision would read as a plan (expected: at least one child; actual: 0).`,
      'issue_plan_portfolio_children_empty',
      {
        target: location.path,
        fix: 'Publish from a portfolio that has decomposed children, or author the plan by hand with --from-file.',
      }
    );
  }

  // 3. Compile and resolve. Evidence is gathered ONCE and every child is
  //    resolved against the same snapshot, so two children cannot disagree
  //    about what the Store contained.
  const children = compilePortfolioChildren(state);
  const { reader, evidence } = await gatherChildEvidence(dependencies, {
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
  });
  const nodes = children.map(child => {
    const resolution = resolveChildByName(evidence, child.childId);
    if (resolution.status === 'resolved') {
      return planNodeForChild(child, resolution.identity);
    }
    const refusal = childNameRefusal(child.childId, resolution, reader);
    // childNameRefusal is total over the non-resolved variants; the guard
    // exists for the type system, not the runtime.
    throw refusal ?? new StoreError(`Portfolio child '${child.childId}' did not resolve.`, 'issue_reference_unresolved');
  });

  // 4. Publish through the existing mutation — ordinal, digest, supersedes
  //    chaining, graph checking, the issue lock, and the commit suggestion
  //    are all inherited, and reference verification runs AGAIN under the
  //    lock by instance id (design D3: no parallel implementation).
  const result = await issues.publishPlan({
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    issueId: input.issueId,
    nodes,
  });
  return {
    ...result,
    source: {
      kind: 'portfolio' as const,
      parent: input.parent,
      statePath: location.path,
      childCount: children.length,
    },
  };
}

/**
 * Publishes the next Execution Plan revision for an Issue from a
 * decomposition document (design D3/D6).
 *
 * Refusal codes: `issue_plan_decomposition_unreadable` (the named document
 * does not read back — never treated as absent), `issue_plan_decomposition_invalid`,
 * `issue_plan_decomposition_change_node`, `issue_plan_decomposition_field_missing`
 * (from the pure reader), and — from `publishPlan` — the whole existing
 * discipline: schema and graph, the planning-member target gate, the registry
 * check on every suggestion, ordinal allocation. Every refusal lands with
 * nothing durable: the only write in this function is the one `publishPlan`
 * performs after every check has passed, and the DOCUMENT itself is read-only
 * input whose bytes publication leaves identical (pinned by test).
 */
export async function publishPlanFromDecomposition(
  input: PublishPlanFromDecompositionInput,
  options: PublishPlanFromDecompositionOptions = {}
): Promise<IssuePlanPublicationResult> {
  const issues = options.issues ?? StoreIssuesModuleInstance;

  // 1. Read the named document. Unreadable is not absent: the operator named
  //    a file, so a file that does not read back is a fact to report, never a
  //    silent skip. (A vanished file, a directory, and a permission error all
  //    land here.)
  let content: string;
  try {
    content = await readFile(input.documentPath, 'utf8');
  } catch (error) {
    throw new StoreError(
      `The decomposition document at ${input.documentPath} does not read back: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      'issue_plan_decomposition_unreadable',
      {
        target: input.documentPath,
        fix: 'Point --from-decomposition at a readable YAML file; a document that exists but cannot be read is reported, never treated as absent.',
      }
    );
  }

  // 2. The pure reader: strict shape, intent-only, suggestion-complete.
  const nodes = parseDecompositionDocument(content, input.documentPath);

  // 3. Publish through the existing mutation — normalization, graph checks,
  //    the planning-member target gate, the suggestion's registry check,
  //    ordinal/digest/supersedes chaining, the issue lock, and the commit
  //    suggestion are all inherited (design D3: no parallel implementation).
  const result = await issues.publishPlan({
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    issueId: input.issueId,
    nodes,
    ...(input.pipelineKnown === undefined ? {} : { pipelineKnown: input.pipelineKnown }),
  });
  return {
    ...result,
    source: {
      kind: 'decomposition' as const,
      documentPath: path.resolve(input.documentPath),
      nodeCount: nodes.length,
    },
  };
}
