/**
 * `StoreIssues` — creating an Issue, declaring its state, and publishing an
 * immutable Execution Plan revision.
 *
 * Everything a mutation could get wrong is decided BEFORE a byte is written:
 * the identifier, the schema, the graph, the write location, and every `change`
 * node's reference against real Store evidence. A published revision is
 * immutable, so there is no repair path afterwards — which is exactly why
 * publication refuses rather than reports.
 *
 * Three properties this file is responsible for holding:
 *
 *   - **Referencing writes nothing into the referenced Change.** No file inside
 *     a project partition, an Archive entry, or a Change directory is created,
 *     modified, or deleted here, and no Change records which Issues reference it.
 *   - **Nothing is staged.** Every write prints the pathspec that would commit
 *     it. The Git index is untouched; nothing is fetched or pushed.
 *   - **Only the issue key is taken.** An Issue write touches no project
 *     partition, no worktree, and no canonical spec, so it needs no other lock.
 */
import * as path from 'node:path';

import {
  formatExecutionPlanRevisionId,
  parseExecutionPlanRevisionId,
  parseIssueId,
  type ExecutionPlanRevisionId,
} from '../planning-validation.js';
import { listProjectEntries, listTargetLineEntries } from '../query/refs.js';
import { resolveRegisteredStore } from '../registry.js';
import {
  productionStoreIssueDependencies,
  type StoreIssueDependencies,
} from './dependencies.js';
import { issueError, issueRefusal } from './diagnostics.js';
import { issueLockKey, withIssueLock } from './locks.js';
import { verifyExecutionPlanReferences } from './reference-verification.js';
import {
  executionPlanDigest,
  normalizePlanNodes,
  serializeExecutionPlanRevision,
} from './plans.js';
import {
  isPermittedIssueTransition,
  parseIssueRecord,
  serializeIssueRecord,
} from './records.js';
import {
  assertIssueWriteLocation,
  issueAddresses,
  issuePathspec,
  resolveIssueScope,
  revisionAddress,
  type ResolvedIssueScope,
} from './scope.js';
import type {
  CreateIssueInput,
  ExecutionPlanNode,
  ExecutionPlanResult,
  ExecutionPlanRevisionV1,
  IssueRecordResult,
  IssueRecordV1,
  PublishExecutionPlanInput,
  SetIssueStateInput,
  StoreIssues,
  SuggestedIssueCommit,
} from './types.js';

export interface StoreIssuesOptions {
  readonly dependencies?: StoreIssueDependencies;
}

function canonicalTimestamp(now: Date): string {
  return now.toISOString();
}

const README_SCAFFOLD = [
  '# Issue narrative',
  '',
  'Optional. Rasen never parses this file for facts: the Issue record carries',
  'identity, title, and state, and the Execution Plan revisions carry the graph.',
  '',
].join('\n');

export class StoreIssuesModule implements StoreIssues {
  private readonly dependencies: StoreIssueDependencies;

  constructor(options: StoreIssuesOptions = {}) {
    this.dependencies = options.dependencies ?? productionStoreIssueDependencies;
  }

  async create(input: CreateIssueInput): Promise<IssueRecordResult> {
    const issueId = parseIssueId(input.issueId);
    return this.withWriteLock(input, issueId, async (scope) => {
      const addresses = issueAddresses(scope.checkoutRoot, issueId);
      if ((await this.dependencies.fs.statKind(addresses.record)) !== 'absent') {
        // Refused WITHOUT touching the existing record. A create that repaired
        // a title would be an edit nobody asked for.
        throw issueRefusal(
          'issue_already_exists',
          `Issue '${issueId}' already exists in Store '${scope.storeId}'.`,
          {
            expected: 'no Issue with this identifier',
            actual: addresses.record,
            target: addresses.record,
            fix: `Choose another identifier, or change the existing Issue with 'rasen store issue state ${issueId}'.`,
          }
        );
      }

      const record: IssueRecordV1 = {
        version: 1,
        id: issueId,
        title: input.title,
        state: 'open',
        reason: null,
        createdAt: canonicalTimestamp(this.dependencies.now()),
      };
      const serialized = serializeIssueRecord(record);

      await this.dependencies.fs.mkdirp(addresses.plans);
      await this.dependencies.fs.writeText(addresses.record, serialized);
      const written = [addresses.record];
      if (input.readme === true) {
        await this.dependencies.fs.writeText(addresses.readme, README_SCAFFOLD);
        written.push(addresses.readme);
      }

      return {
        ...this.report(scope, issueId, written, `chore(store): open issue ${issueId}`),
        record: parseIssueRecord(serialized, addresses.record),
      };
    });
  }

  async setState(input: SetIssueStateInput): Promise<IssueRecordResult> {
    const issueId = parseIssueId(input.issueId);
    return this.withWriteLock(input, issueId, async (scope) => {
      const addresses = issueAddresses(scope.checkoutRoot, issueId);
      const current = await this.requireRecord(addresses.record, issueId, scope);

      if (!isPermittedIssueTransition(current.state, input.state)) {
        throw issueRefusal(
          'issue_state_transition_refused',
          `Issue '${issueId}' is '${current.state}', which is terminal or does not permit '${input.state}'.`,
          {
            expected: `a transition permitted from '${current.state}'`,
            actual: input.state,
            target: addresses.record,
            fix: "An Issue moves from 'open' to 'resolved' or 'dropped' once. Open a new Issue rather than reopening a terminal one.",
          }
        );
      }
      if (input.state === 'dropped' && (input.reason ?? '').trim().length === 0) {
        throw issueRefusal(
          'issue_state_transition_refused',
          `Dropping Issue '${issueId}' requires a reason.`,
          {
            expected: 'a non-empty reason',
            actual: '(none)',
            target: addresses.record,
            fix: 'Add --reason "<why this work is not being done>".',
          }
        );
      }

      // Only `state` and `reason` move. Every other field is carried through
      // from the record on disk, so a state change can never rewrite identity,
      // title, or creation time.
      const next: IssueRecordV1 = {
        ...current,
        state: input.state,
        reason:
          input.state === 'dropped'
            ? (input.reason as string).trim()
            : input.reason === undefined
              ? current.reason
              : input.reason.trim(),
      };
      const serialized = serializeIssueRecord(next);
      await this.dependencies.fs.writeText(addresses.record, serialized);

      return {
        ...this.report(
          scope,
          issueId,
          [addresses.record],
          `chore(store): mark issue ${issueId} ${input.state}`
        ),
        record: parseIssueRecord(serialized, addresses.record),
      };
    });
  }

  async publishPlan(input: PublishExecutionPlanInput): Promise<ExecutionPlanResult> {
    const issueId = parseIssueId(input.issueId);
    return this.withWriteLock(input, issueId, async (scope) => {
      const addresses = issueAddresses(scope.checkoutRoot, issueId);
      await this.requireRecord(addresses.record, issueId, scope);

      // Schema and graph first: they are pure, they need no Git, and refusing
      // here means an unverifiable reference never costs a ref read.
      const nodes = normalizePlanNodes(input.nodes);
      await this.verifyReferences(scope, nodes, input.globalDataDir);

      const { previous, next } = await this.allocateOrdinal(addresses.plans);
      const target = revisionAddress(scope.checkoutRoot, issueId, next);
      if ((await this.dependencies.fs.statKind(target)) !== 'absent') {
        throw issueRefusal(
          'execution_plan_revision_exists',
          `Execution Plan revision '${next}' of Issue '${issueId}' already exists.`,
          {
            expected: 'an unpublished ordinal',
            actual: target,
            target,
            fix: 'A published revision is never overwritten. Re-run the publication so it allocates the next ordinal, and resolve any add/add Git conflict on the revision path in Git.',
          }
        );
      }

      const draft: Omit<ExecutionPlanRevisionV1, 'contentSha256'> = {
        version: 1,
        issueId,
        revisionId: next,
        supersedes: previous,
        createdAt: canonicalTimestamp(this.dependencies.now()),
        nodes,
      };
      const revision: ExecutionPlanRevisionV1 = {
        ...draft,
        contentSha256: executionPlanDigest(draft),
      };
      const serialized = serializeExecutionPlanRevision(revision);
      await this.dependencies.fs.mkdirp(addresses.plans);
      await this.dependencies.fs.writeText(target, serialized);

      return {
        ...this.report(
          scope,
          issueId,
          [target],
          `chore(store): publish execution plan ${issueId}/${next}`
        ),
        revision,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * An explicit Store selector lets a writer derive the canonical Issue key
   * from registry identity before layout-v2 scope validation. That ordering is
   * essential during migration: once publication owns the batch, ordinary
   * writes wait or return the existing bounded lock diagnostic at every
   * pre-flip boundary instead of racing past the batch with a flat-layout
   * scope refusal. The full scope/location validation still runs under the
   * lock before any filesystem write.
   */
  private async withWriteLock<T>(
    input: {
      readonly store?: string;
      readonly startPath: string;
      readonly globalDataDir?: string;
    },
    issueId: string,
    fn: (scope: ResolvedIssueScope) => Promise<T>
  ): Promise<T> {
    if (input.store !== undefined) {
      const registered = await resolveRegisteredStore({
        id: input.store,
        ...(input.globalDataDir === undefined
          ? {}
          : { globalDataDir: input.globalDataDir }),
      });
      if (registered.uid !== undefined) {
        const key = issueLockKey({ storeUid: registered.uid, issueId });
        return withIssueLock(
          this.dependencies.coordination(input.globalDataDir),
          key,
          async () => fn(await this.openWriteScope(input))
        );
      }
    }
    const scope = await this.openWriteScope(input);
    const key = issueLockKey({ storeUid: scope.storeUid, issueId });
    return withIssueLock(
      this.dependencies.coordination(input.globalDataDir),
      key,
      async () => fn(scope)
    );
  }

  private async openWriteScope(input: {
    readonly store?: string;
    readonly startPath: string;
    readonly globalDataDir?: string;
  }): Promise<ResolvedIssueScope> {
    const scope = await resolveIssueScope(this.dependencies, input);
    await assertIssueWriteLocation(this.dependencies, scope, input.globalDataDir);
    return scope;
  }

  private async requireRecord(
    recordPath: string,
    issueId: string,
    scope: ResolvedIssueScope
  ): Promise<IssueRecordV1> {
    const text = await this.dependencies.fs.readText(recordPath);
    if (text === null) {
      throw issueError(
        'issue_not_found',
        `Issue '${issueId}' has no record in Store checkout ${scope.checkoutRoot}.`,
        {
          target: recordPath,
          fix: `Create it with 'rasen store issue new ${issueId} --store ${scope.storeId} --title "<title>"', or run the command in the Store checkout that holds it.`,
        }
      );
    }
    return parseIssueRecord(text, recordPath);
  }

  /**
   * The next ordinal, and the one it supersedes.
   *
   * A zero-padded ordinal answers "which is latest" without opening every file.
   * Two clones can both mint the same next ordinal, and Git surfaces that as an
   * add/add conflict on the revision path — a VISIBLE conflict between two
   * plans, which is the correct outcome and strictly better than a digest
   * scheme where both revisions silently coexist and neither is "next".
   */
  private async allocateOrdinal(plansDir: string): Promise<{
    readonly previous: ExecutionPlanRevisionId | null;
    readonly next: ExecutionPlanRevisionId;
  }> {
    const published: ExecutionPlanRevisionId[] = [];
    for (const name of await this.dependencies.fs.listNames(plansDir)) {
      if (!name.endsWith('.yaml')) continue;
      try {
        published.push(parseExecutionPlanRevisionId(name.slice(0, -'.yaml'.length)));
      } catch {
        // A file whose name is not a canonical ordinal addresses no revision.
        // It is left alone rather than renamed or counted.
      }
    }
    published.sort();
    const previous = published.at(-1) ?? null;
    const nextOrdinal = previous === null ? 1 : Number.parseInt(previous, 10) + 1;
    return { previous, next: formatExecutionPlanRevisionId(nextOrdinal) };
  }

  /**
   * Verifies every node against real Store evidence.
   *
   * A `change` node must re-derive to exactly ONE Change in THIS Store whose
   * committed identity names the node's project and target line. An `intent`
   * node is verified against the project and target-line catalogs only, and
   * needs no Change to exist — which is what makes a plan draftable before the
   * work is created.
   *
   * A Store ref that cannot be read stops the search from concluding "not
   * found": an unreadable ref is reported as unsearched and the publication
   * refuses on THAT rather than on a false absence.
   */
  private async verifyReferences(
    scope: ResolvedIssueScope,
    nodes: readonly ExecutionPlanNode[],
    globalDataDir?: string
  ): Promise<void> {
    const targetLines = await listTargetLineEntries(this.dependencies, scope.registeredRoot);
    const projects = await listProjectEntries(this.dependencies, scope.registeredRoot);
    await verifyExecutionPlanReferences(
      {
        ...this.dependencies,
        snapshotProjects: async () => [],
        now: this.dependencies.now,
      },
      {
        registeredRoot: scope.registeredRoot,
        storeId: scope.storeId,
        storeUid: scope.storeUid,
        nodes,
        catalogs: {
          projectIds: projects
            .filter(entry => entry.catalog !== null)
            .map(entry => entry.projectId),
          targetLines: targetLines
            .filter(entry => entry.catalog !== null)
            .map(entry => ({
              targetLineId: entry.targetLineId,
              storeRef: (entry.catalog as NonNullable<typeof entry.catalog>).storeRef,
            })),
        },
        ...(globalDataDir === undefined ? {} : { globalDataDir }),
      }
    );
  }

  /**
   * The write report. It names the checkout and the ref the write landed on and
   * suggests the commit pathspec; the Git index is untouched and nothing is
   * fetched or pushed.
   */
  private report(
    scope: ResolvedIssueScope,
    issueId: string,
    written: readonly string[],
    message: string
  ): {
    readonly issueId: ReturnType<typeof parseIssueId>;
    readonly storeId: string;
    readonly storeUid: string;
    readonly checkoutRoot: string;
    readonly checkoutRef: string | null;
    readonly written: readonly string[];
    readonly suggestedCommits: readonly SuggestedIssueCommit[];
  } {
    const pathspecs = written.map(target => issuePathspec(scope.checkoutRoot, target));
    const suggestion: SuggestedIssueCommit = {
      repoRoot: scope.checkoutRoot,
      pathspecs,
      message,
      rationale:
        'Issue content is Git-tracked Store content. Rasen wrote the file and staged nothing.',
    };
    return {
      issueId: parseIssueId(issueId),
      storeId: scope.storeId,
      storeUid: scope.storeUid,
      checkoutRoot: scope.checkoutRoot,
      checkoutRef: scope.checkoutRef,
      written: written.map(target => path.resolve(target)),
      suggestedCommits: [suggestion],
    };
  }
}

/** The sole production Store-level Issue Module. */
export const StoreIssuesModuleInstance: StoreIssues = new StoreIssuesModule();
