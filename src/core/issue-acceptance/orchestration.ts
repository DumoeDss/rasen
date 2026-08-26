/**
 * `issue-acceptance-close` — the read and the accept orchestration.
 *
 * `readIssueAcceptanceFacts` is the ONE reader of an Issue's acceptance
 * content: it resolves the same Store-level Issue scope the mutations write
 * through, reads the conditions directory and the acceptance record from that
 * checkout's working tree, and verifies every digest it returns. The query's
 * committed-ref preference is deliberately not re-derived here — the
 * mutations land in this checkout, an acceptance read is fresh from where the
 * write surface is, and a content divergence between the working tree and a
 * ref is the Git conflict the write surface already surfaces rather than a
 * second arbitration point.
 *
 * `acceptIssue` is design D6 made executable: evaluate FRESH over the
 * machine-local run-state (lock-free, like every read), then serialize the
 * write under the issue lock with the evaluated snapshot in hand. Between the
 * two, run-state can move; the record's snapshot states the facts the
 * acceptance was made under, so that boundary is auditable rather than
 * silently absorbed.
 */
import {
  StoreIssuesModuleInstance,
  issueAddresses,
  issueError,
  parseAcceptedRecord,
  parseAcceptanceConditionsRevision,
  productionStoreIssueDependencies,
  resolveIssueScope,
  acceptanceRevisionAddress,
  type AcceptIssueResult,
  type StoreIssues,
  type StoreIssueDependencies,
} from '../store/issues/index.js';
import { StoreAggregateQuery } from '../store/query/index.js';
import { projectIssueStatus } from '../issue-status/index.js';
import { acceptanceRefusalFix, evaluateIssueAcceptanceGate } from './gate.js';
import type {
  IssueAcceptanceConditionsRead,
  IssueAcceptanceFacts,
  IssueAcceptanceRecordRead,
} from './types.js';
import type { WorkspaceIndexEntry } from '../store/workspace/registry.js';
import type { ExecutionPlanRevisionId } from '../store/planning-validation.js';
import { parseExecutionPlanRevisionId } from '../store/planning-validation.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ReadAcceptanceFactsInput {
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
  readonly issueId: string;
}

export interface ReadAcceptanceFactsOptions {
  readonly dependencies?: StoreIssueDependencies;
}

/**
 * The latest conditions revision of one Issue, from the resolved checkout.
 * Ordinals answer "which is latest" without opening every file, so the max
 * parseable ordinal is chosen and its content read and digest-verified; a
 * file whose name is not a canonical ordinal addresses no revision and is
 * left alone rather than renamed or counted.
 */
async function readLatestConditions(
  dependencies: StoreIssueDependencies,
  checkoutRoot: string,
  issueId: string
): Promise<IssueAcceptanceConditionsRead> {
  const addresses = issueAddresses(checkoutRoot, issueId);
  const ordinals: ExecutionPlanRevisionId[] = [];
  for (const name of await dependencies.fs.listNames(addresses.acceptance)) {
    if (!name.endsWith('.yaml')) continue;
    try {
      ordinals.push(parseExecutionPlanRevisionId(name.slice(0, -'.yaml'.length)));
    } catch {
      // A file whose name is not a canonical ordinal addresses no revision.
    }
  }
  ordinals.sort();
  const latest = ordinals.at(-1);
  if (latest === undefined) {
    return { revision: null, revisionId: null, diagnostic: null, path: null };
  }
  const revisionPath = acceptanceRevisionAddress(checkoutRoot, issueId, latest);
  const text = await dependencies.fs.readText(revisionPath);
  if (text === null) {
    return {
      revision: null,
      revisionId: latest,
      diagnostic: 'the revision file vanished between listing and reading',
      path: revisionPath,
    };
  }
  try {
    return {
      revision: parseAcceptanceConditionsRevision(text, { verifyDigest: true }),
      revisionId: latest,
      diagnostic: null,
      path: revisionPath,
    };
  } catch (error) {
    return {
      revision: null,
      revisionId: latest,
      diagnostic: messageOf(error),
      path: revisionPath,
    };
  }
}

/**
 * One Issue's acceptance record, digest-verified. `present` is file
 * existence: an existing-but-tampered record is present (the Issue is not
 * re-acceptable) while reading back null (the Issue never presents done from
 * unreadable bytes).
 */
async function readAcceptedRecord(
  dependencies: StoreIssueDependencies,
  checkoutRoot: string,
  issueId: string
): Promise<IssueAcceptanceRecordRead> {
  const addresses = issueAddresses(checkoutRoot, issueId);
  const text = await dependencies.fs.readText(addresses.accepted);
  if (text === null) {
    return { present: false, record: null, diagnostic: null, path: null };
  }
  try {
    return {
      present: true,
      record: parseAcceptedRecord(text, { verifyDigest: true }),
      diagnostic: null,
      path: addresses.accepted,
    };
  } catch (error) {
    return {
      present: true,
      record: null,
      diagnostic: messageOf(error),
      path: addresses.accepted,
    };
  }
}

/**
 * Reads one Issue's acceptance facts — the fourth input of the status
 * projection and the acceptance-side input of the gate — from the Store
 * checkout this command is standing in.
 */
export async function readIssueAcceptanceFacts(
  input: ReadAcceptanceFactsInput,
  options: ReadAcceptanceFactsOptions = {}
): Promise<IssueAcceptanceFacts> {
  const dependencies = options.dependencies ?? productionStoreIssueDependencies;
  const scope = await resolveIssueScope(dependencies, input);
  return {
    conditions: await readLatestConditions(dependencies, scope.checkoutRoot, input.issueId),
    acceptedRecord: await readAcceptedRecord(dependencies, scope.checkoutRoot, input.issueId),
  };
}

/**
 * The machine-local projection inputs the accept orchestration needs,
 * resolved by the CLI exactly as the read commands resolve them (design D2:
 * the projection takes explicit inputs; the caller resolves the local ones).
 */
export interface AcceptIssueProjectionContext {
  readonly executionRoot?: string;
  readonly changesDir?: string;
  readonly storeRoot?: string;
  readonly workspaceEntries?: readonly WorkspaceIndexEntry[];
  readonly workDirFor?: (alias: string) => Promise<string | null>;
}

export interface AcceptIssueOrchestrationInput extends ReadAcceptanceFactsInput {
  readonly note?: string;
  readonly projection?: AcceptIssueProjectionContext;
  /** Injectable for tests; the production mutation Module by default. */
  readonly issues?: StoreIssues;
  readonly dependencies?: StoreIssueDependencies;
}

/**
 * Accept one Issue: read its status through the one seam, evaluate the gate
 * fresh, and — only when the gate holds — serialize the record-writing
 * mutation with the evaluated snapshot (design D6).
 */
export async function acceptIssue(
  input: AcceptIssueOrchestrationInput
): Promise<AcceptIssueResult> {
  const issues = input.issues ?? StoreIssuesModuleInstance;
  const detail = await StoreAggregateQuery.showIssue({
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    issueId: input.issueId,
  });
  const facts = await readIssueAcceptanceFacts(input, {
    ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
  });
  const projection = input.projection ?? {};
  const status = await projectIssueStatus({
    detail,
    ...(projection.executionRoot === undefined ? {} : { executionRoot: projection.executionRoot }),
    ...(projection.changesDir === undefined ? {} : { changesDir: projection.changesDir }),
    ...(projection.storeRoot === undefined ? {} : { storeRoot: projection.storeRoot }),
    ...(projection.workspaceEntries === undefined
      ? {}
      : { workspaceEntries: projection.workspaceEntries }),
    ...(projection.workDirFor === undefined ? {} : { workDirFor: projection.workDirFor }),
    acceptance: facts,
  });

  // The gate evaluated over the status this very read derived — structural
  // refusals and fact blockers arrive as distinct codes with every blocker
  // named, so the refusal is an answer rather than a puzzle.
  const view = {
    issueState: detail.issue.record?.state ?? null,
    nodes: status.nodes,
    problems: status.problems,
    health: status.health,
    complete: status.complete,
  };
  const gate = evaluateIssueAcceptanceGate(view, facts);
  if (!gate.eligible) {
    throw issueError(
      gate.refusalCode,
      `Accepting Issue '${input.issueId}' is refused: ${gate.message}`,
      { fix: acceptanceRefusalFix(gate.refusalCode) }
    );
  }
  const revision = facts.conditions.revision;
  if (revision === null) {
    // Unreachable after an eligible evaluation; held fail-closed anyway.
    throw issueError(
      'issue_accept_conditions_required',
      `Accepting Issue '${input.issueId}' is refused: no acceptance conditions revision reads back.`,
      { fix: acceptanceRefusalFix('issue_accept_conditions_required') }
    );
  }

  return issues.accept({
    ...(input.store === undefined ? {} : { store: input.store }),
    startPath: input.startPath,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    issueId: input.issueId,
    conditionsRevisionId: gate.conditionsRevisionId,
    conditionsSha256: revision.contentSha256,
    gate: gate.snapshot,
    // The evaluation's lifecycle accounting rides the record verbatim, so
    // the total it freezes is explained by the record itself. An empty
    // accounting is passed as such — the mutation writes the absent form.
    exclusions: gate.exclusions,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
}
