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
 *   - **Only Issue-family keys are taken.** Every mutation takes Store
 *     allocation before UID Issue so selector resolution and identity
 *     publication share one linearization boundary. No Issue write touches a
 *     project partition, worktree, or canonical spec.
 */
import * as path from 'node:path';

import {
  formatExecutionPlanRevisionId,
  parseExecutionPlanRevisionId,
  parseIssueId,
  parseIssueStorageKey,
  type ExecutionPlanRevisionId,
} from '../planning-validation.js';
import { listProjectEntries, listTargetLineEntries } from '../query/refs.js';
import {
  StoreQueryModuleImpl,
  productionStoreQueryDependencies,
  type IssueSummaryPage,
} from '../query/index.js';
import {
  productionStoreIssueDependencies,
  type StoreIssueDependencies,
} from './dependencies.js';
import { issueError, issueRefusal, StoreIssueError } from './diagnostics.js';
import {
  allocateIssueIdentity,
  issueResourceOwnerMatches,
  projectStoredIssueIdentity,
  resolveIssueSelector,
  type IssueIdentityCandidate,
} from './identity.js';
import {
  issueAllocationLockKey,
  issueLockKey,
  withIssueAllocationLock,
  withIssueLock,
} from './locks.js';
import { verifyExecutionPlanReferences } from './reference-verification.js';
import {
  assertPlanNodeSuggestions,
  executionPlanDigest,
  normalizePlanNodes,
  serializeExecutionPlanRevision,
} from './plans.js';
import {
  acceptedRecordDigest,
  assertCoherentGateSnapshot,
  normalizeAcceptanceConditions,
  parseAcceptedRecord,
  parseAcceptanceConditionsRevision,
  acceptanceConditionsDigest,
  serializeAcceptanceConditionsRevision,
  serializeAcceptedRecord,
} from './acceptance.js';
import {
  assertPortableIssueText,
  isPermittedIssueTransition,
  parseStoredIssueRecord,
  serializeIssueRecordV2,
  serializeStoredIssueRecord,
} from './records.js';
import {
  acceptanceRevisionAddress,
  assertIssueWriteLocation,
  issueAddresses,
  issuePathspec,
  resolveIssueScope,
  revisionAddress,
  type ResolvedIssueScope,
} from './scope.js';
import type {
  AcceptanceConditionsResult,
  AcceptanceConditionsRevisionV2,
  StoredAcceptanceConditionsRevision,
  AcceptIssueInput,
  AcceptIssueResult,
  CreateIssueInput,
  ExecutionPlanNode,
  ExecutionPlanResult,
  ExecutionPlanRevisionV2,
  IssueAcceptedRecordV2,
  IssueRecordResult,
  IssueRecordV2,
  IssueWriteWarning,
  StoredIssueRecord,
  PublishAcceptanceConditionsInput,
  PublishExecutionPlanInput,
  SetIssueStateInput,
  StoreIssues,
  StoreIssueSelector,
  SuggestedIssueCommit,
} from './types.js';

export interface StoreIssuesOptions {
  readonly dependencies?: StoreIssueDependencies;
}

interface ResolvedMutationIssue extends IssueIdentityCandidate {
  readonly record: StoredIssueRecord;
}

interface IssueIdentityCatalog {
  readonly candidates: readonly IssueIdentityCandidate[];
  readonly divergentUids: ReadonlySet<string>;
}

type IssueCreateAttempt =
  | { readonly kind: 'published'; readonly result: IssueRecordResult }
  | { readonly kind: 'collision'; readonly candidate: IssueIdentityCandidate };

function canonicalTimestamp(now: Date): string {
  return now.toISOString();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issueWriteWarning(
  code: IssueWriteWarning['code'],
  message: string,
  cause: unknown
): IssueWriteWarning {
  return { code, message, cause };
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
    if (input.title.length > 200) {
      throw issueError(
        'issue_title_required',
        'Issue title is required and must be at most 200 characters.'
      );
    }
    try {
      assertPortableIssueText(input.title, 'title', 'invalid_issue_record');
    } catch (error) {
      throw issueError(
        'issue_title_required',
        `Issue title is required and must be portable durable text: ${messageOf(error)}`
      );
    }

    const scope = await this.openWriteScope(input);
    const coordination = this.dependencies.coordination(input.globalDataDir);
    const allocationKey = issueAllocationLockKey({ storeUid: scope.storeUid });
    return withIssueAllocationLock(coordination, allocationKey, async () => {
      const catalog = await this.readIdentityCatalog(input, scope);
      const existing = [...catalog.candidates];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        let identity;
        try {
          identity = allocateIssueIdentity({
            title: input.title,
            existing,
            mintIssueUid: this.dependencies.mintIssueUid,
            ...(input.issueId === undefined ? {} : { compatibilityAlias: input.issueId }),
            maxAttempts: 1,
          });
        } catch (error) {
          if (
            error instanceof StoreIssueError &&
            error.issueCode === 'issue_identity_allocation_failed'
          ) {
            continue;
          }
          throw error;
        }

        const storageKey = parseIssueStorageKey(identity.uid);
        const addresses = issueAddresses(scope.checkoutRoot, storageKey);
        const result = await withIssueLock(
          coordination,
          issueLockKey({ storeUid: scope.storeUid, issueUid: identity.uid }),
          async (): Promise<IssueCreateAttempt> => {
            if ((await this.dependencies.fs.statKind(addresses.record)) !== 'absent') {
              const occupied = await this.dependencies.fs.readText(addresses.record);
              if (occupied === null) {
                throw issueError(
                  'issue_identity_allocation_failed',
                  `Issue identity '${identity.uid}' is occupied by a non-readable record carrier.`
                );
              }
              const occupiedRecord = parseStoredIssueRecord(occupied, addresses.record);
              return {
                kind: 'collision',
                candidate: {
                  ...projectStoredIssueIdentity({
                    storeUid: scope.storeUid,
                    record: occupiedRecord,
                    storageKey,
                  }),
                  title: occupiedRecord.title,
                },
              };
            }
            const record: IssueRecordV2 = {
              version: 2,
              identity,
              title: input.title,
              state: 'open',
              reason: null,
              createdAt: canonicalTimestamp(this.dependencies.now()),
            };
            const serialized = serializeIssueRecordV2(record);
            if (this.dependencies.fs.writeTextAtomic === undefined) {
              throw issueError(
                'issue_identity_allocation_failed',
                'Issue creation requires the atomic expected-absent filesystem adapter.'
              );
            }
            let published = false;
            const warnings: IssueWriteWarning[] = [];
            try {
              await this.dependencies.fs.writeTextAtomic(addresses.record, serialized, {
                content: null,
                identity: null,
              });
              published = true;
            } catch (error) {
              let occupied: string | null;
              try {
                occupied = await this.dependencies.fs.readText(addresses.record);
              } catch (readError) {
                throw issueError(
                  'issue_publication_indeterminate',
                  'Issue record publication failed and its durable outcome could not be verified.',
                  {
                    fix: `Inspect Issue ${identity.key} (${identity.uid}) locally before any retry; a fresh create can mint a duplicate.`,
                    recovery: {
                      kind: 'issue-publication-indeterminate',
                      identity: { uid: identity.uid, key: identity.key },
                      retrySafe: false,
                    },
                    cause: { writeError: error, readError },
                  }
                );
              }
              if (occupied === serialized) {
                // The record commit point landed and only a later durability,
                // verification, or cleanup step failed. Retrying would create
                // a second Issue, so return the committed identity with an
                // explicit warning regardless of the thrown error's class.
                published = true;
                warnings.push(issueWriteWarning(
                  'issue_record_post_publish_warning',
                  'The Issue record was created, but a later atomic verification or cleanup step failed.',
                  error
                ));
              } else if (occupied !== null) {
                try {
                  const occupiedRecord = parseStoredIssueRecord(occupied, addresses.record);
                  return {
                    kind: 'collision',
                    candidate: {
                      ...projectStoredIssueIdentity({
                        storeUid: scope.storeUid,
                        record: occupiedRecord,
                        storageKey,
                      }),
                      title: occupiedRecord.title,
                    },
                  };
                } catch (occupiedError) {
                  // A corrupt carrier or retained atomic-write artifact is not
                  // an allocation collision and must not mint another Issue.
                  throw issueError(
                    'issue_publication_indeterminate',
                    'Issue record publication failed and left bytes whose ownership could not be verified.',
                    {
                      fix: `Inspect Issue ${identity.key} (${identity.uid}) locally before any retry; Rasen will not allocate around unreadable ownership evidence.`,
                      recovery: {
                        kind: 'issue-publication-indeterminate',
                        identity: { uid: identity.uid, key: identity.key },
                        retrySafe: false,
                      },
                      cause: { writeError: error, occupiedError },
                    }
                  );
                }
              } else {
                throw issueError(
                  'issue_publication_indeterminate',
                  'Issue record publication failed before a committed record could be observed.',
                  {
                    fix: `Inspect Issue ${identity.key} (${identity.uid}) and any retained atomic-write carriers locally before retrying; a fresh create can mint a duplicate.`,
                    recovery: {
                      kind: 'issue-publication-indeterminate',
                      identity: { uid: identity.uid, key: identity.key },
                      retrySafe: false,
                    },
                    cause: error,
                  }
                );
              }
            }

            const written = [addresses.record];
            if (input.readme === true) {
              try {
                await this.dependencies.fs.writeText(addresses.readme, README_SCAFFOLD);
                written.push(addresses.readme);
              } catch (error) {
                warnings.push(issueWriteWarning(
                  'issue_readme_write_failed',
                  'The Issue record was created, but its optional README could not be completed.',
                  error
                ));
              }
            }
            if (!published) {
              throw issueError(
                'issue_identity_allocation_failed',
                `Issue identity '${identity.uid}' was not published.`
              );
            }
            return {
              kind: 'published',
              result: {
                ...this.report(
                  scope,
                  identity,
                  written,
                  `chore(store): open issue ${identity.key}`
                ),
                ...(warnings.length === 0 ? {} : { warnings }),
                record: parseStoredIssueRecord(serialized, addresses.record),
              },
            };
          }
        );
        if (result.kind === 'published') return result.result;
        existing.push(result.candidate);
      }
      throw issueError(
        'issue_identity_allocation_failed',
        'Unable to publish a non-conflicting Issue identity after 8 attempts.'
      );
    });
  }

  async setState(input: SetIssueStateInput): Promise<IssueRecordResult> {
    return this.withResolvedIssueLock(input, async (scope, issue) => {
      const issueId = input.issueId;
      const addresses = issueAddresses(scope.checkoutRoot, issue.storageKey);
      const current = issue.record;

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
      const next: StoredIssueRecord = {
        ...current,
        state: input.state,
        reason:
          input.state === 'dropped'
            ? (input.reason as string).trim()
            : input.reason === undefined
              ? current.reason
              : input.reason.trim(),
      };
      const serialized = serializeStoredIssueRecord(next);
      await this.dependencies.fs.writeText(addresses.record, serialized);

      return {
        ...this.report(
          scope,
          issue.identity,
          [addresses.record],
          `chore(store): mark issue ${issueId} ${input.state}`
        ),
        record: parseStoredIssueRecord(serialized, addresses.record),
      };
    });
  }

  async publishPlan(input: PublishExecutionPlanInput): Promise<ExecutionPlanResult> {
    return this.withResolvedIssueLock(input, async (scope, issue) => {
      const issueId = input.issueId;
      const addresses = issueAddresses(scope.checkoutRoot, issue.storageKey);

      // Schema and graph first: they are pure, they need no Git, and refusing
      // here means an unverifiable reference never costs a ref read.
      const nodes = normalizePlanNodes(input.nodes);
      // The one other pure pre-write gate: a node's suggestion must name a
      // pipeline the registry resolves, checked through the injected membership
      // test (the CLI composes the same root-aware seam `store issue start
      // --pipeline` validates through — this module has no working-directory
      // root of its own to resolve pipelines from).
      assertPlanNodeSuggestions(nodes, input.pipelineKnown);
      let ordinal: { previous: ExecutionPlanRevisionId | null; next: ExecutionPlanRevisionId };
      if (input.expectedRevisionId !== undefined) {
        ordinal = await this.allocateOrdinal(addresses.plans);
        if (input.expectedRevisionId !== ordinal.previous) {
          throw issueRefusal(
            'execution_plan_revision_conflict',
            `Execution Plan publication for Issue '${issueId}' was based on a stale latest revision.`,
            {
              expected: input.expectedRevisionId ?? '(no revision)',
              actual: ordinal.previous ?? '(no revision)',
              target: addresses.plans,
              fix: 'Refresh the Issue and rebuild the complete replacement plan from its latest revision before publishing again.',
            }
          );
        }
        // Reference reads happen only after the lock-held comparison. A stale
        // request therefore performs no reference work and can write nothing.
        await this.verifyReferences(scope, nodes, input.globalDataDir);
      } else {
        // Preserve the unconditional caller's historical validation/allocation
        // order exactly.
        await this.verifyReferences(scope, nodes, input.globalDataDir);
        ordinal = await this.allocateOrdinal(addresses.plans);
      }

      const { previous, next } = ordinal;
      const target = revisionAddress(scope.checkoutRoot, issue.storageKey, next);
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

      const draft: Omit<ExecutionPlanRevisionV2, 'contentSha256'> = {
        version: 2,
        issueUid: issue.identity.uid,
        revisionId: next,
        supersedes: previous,
        createdAt: canonicalTimestamp(this.dependencies.now()),
        nodes,
      };
      const revision: ExecutionPlanRevisionV2 = {
        ...draft,
        contentSha256: executionPlanDigest(draft),
      };
      const serialized = serializeExecutionPlanRevision(revision);
      await this.dependencies.fs.mkdirp(addresses.plans);
      await this.dependencies.fs.writeText(target, serialized);

      return {
        ...this.report(
          scope,
          issue.identity,
          [target],
          `chore(store): publish execution plan ${issue.identity.key}/${next}`
        ),
        revision,
      };
    });
  }

  async publishAcceptance(
    input: PublishAcceptanceConditionsInput
  ): Promise<AcceptanceConditionsResult> {
    return this.withResolvedIssueLock(input, async (scope, issue) => {
      const issueId = input.issueId;
      const addresses = issueAddresses(scope.checkoutRoot, issue.storageKey);

      // Pure validation first, exactly like a plan publication: the schema,
      // the portable-text contract, and duplicate condition identifiers are
      // decided before a single ordinal is allocated.
      const conditions = normalizeAcceptanceConditions(input.conditions);

      const { previous, next } = await this.allocateOrdinal(addresses.acceptance);
      const target = acceptanceRevisionAddress(
        scope.checkoutRoot,
        issue.storageKey,
        next
      );
      if ((await this.dependencies.fs.statKind(target)) !== 'absent') {
        throw issueRefusal(
          'acceptance_conditions_revision_exists',
          `Acceptance conditions revision '${next}' of Issue '${issueId}' already exists.`,
          {
            expected: 'an unpublished ordinal',
            actual: target,
            target,
            fix: 'A published revision is never overwritten. Re-run the publication so it allocates the next ordinal, and resolve any add/add Git conflict on the revision path in Git.',
          }
        );
      }

      const draft: Omit<AcceptanceConditionsRevisionV2, 'contentSha256'> = {
        version: 2,
        issueUid: issue.identity.uid,
        revisionId: next,
        supersedes: previous,
        createdAt: canonicalTimestamp(this.dependencies.now()),
        conditions,
      };
      const revision: AcceptanceConditionsRevisionV2 = {
        ...draft,
        contentSha256: acceptanceConditionsDigest(draft),
      };
      const serialized = serializeAcceptanceConditionsRevision(revision);
      await this.dependencies.fs.mkdirp(addresses.acceptance);
      await this.dependencies.fs.writeText(target, serialized);

      return {
        ...this.report(
          scope,
          issue.identity,
          [target],
          `chore(store): publish acceptance conditions ${issue.identity.key}/${next}`
        ),
        revision,
      };
    });
  }

  /**
   * Records one Issue's acceptance. The gate has ALREADY been evaluated by the
   * caller (`issue-acceptance`'s orchestration); this mutation receives the
   * portable snapshot it was evaluated under, enforces the D5 state matrix,
   * and reads no run-state. The conditions revision it freezes is re-read and
   * digest-verified under the lock, so the record can never name a conditions
   * revision that does not exist in this Store checkout.
   */
  async accept(input: AcceptIssueInput): Promise<AcceptIssueResult> {
    return this.withResolvedIssueLock(input, async (scope, issue) => {
      const selector = input.issueId;
      const issueId = parseIssueId(issue.identity.uid);
      const addresses = issueAddresses(scope.checkoutRoot, issue.storageKey);
      const current = issue.record;

      // One record per Issue, never rewritten — even a record that no longer
      // parses is an existing acceptance, and overwriting it would be exactly
      // the silent repair this Module refuses everywhere else.
      const existingText = await this.dependencies.fs.readText(addresses.accepted);
      if (existingText !== null) {
        let reason = 'the file is present';
        try {
          const existing = parseAcceptedRecord(existingText, { verifyDigest: true });
          reason = `accepted at ${existing.acceptedAt} under conditions revision ${existing.conditionsRevisionId}`;
        } catch (error) {
          reason = `the file is present but does not read back (${messageOf(error)})`;
        }
        throw issueRefusal(
          'issue_accept_already_accepted',
          `Issue '${selector}' already carries an acceptance record: ${reason}.`,
          {
            expected: 'no acceptance record for this Issue',
            actual: addresses.accepted,
            target: addresses.accepted,
            fix: 'An acceptance record is never rewritten. Open a new Issue for follow-up work rather than re-accepting this one.',
          }
        );
      }

      if (current.state === 'dropped') {
        throw issueRefusal(
          'issue_accept_dropped',
          `Issue '${selector}' is dropped — abandoned, not acceptable.`,
          {
            expected: 'an Issue whose state is open or resolved',
            actual: 'dropped',
            target: addresses.record,
            fix: 'A dropped Issue records work that will not be done. Open a new Issue for any revived intent.',
          }
        );
      }

      // The transition an open Issue's acceptance implies is checked BEFORE
      // any byte is written, through the same lifecycle gate `setState` uses
      // (review Info-2): under the current table `open` → `resolved` is
      // always permitted, but if a future lifecycle ever refused it, the
      // refusal must land with NOTHING durable — no record written against a
      // state that never moved, which would be an Issue that can neither
      // present done nor re-accept.
      if (current.state === 'open' && !isPermittedIssueTransition(current.state, 'resolved')) {
        throw issueRefusal(
          'issue_state_transition_refused',
          `Issue '${selector}' is '${current.state}', which does not permit 'resolved'.`,
          {
            expected: "a transition permitted from 'open'",
            actual: 'resolved',
            target: addresses.record,
            fix: 'Set the Issue state explicitly with the state subcommand if the lifecycle has changed.',
          }
        );
      }

      assertCoherentGateSnapshot(input.gate);

      // What the record freezes must be real: the named conditions revision is
      // read back under the lock and its digest verified against the input.
      const conditionsPath = acceptanceRevisionAddress(
        scope.checkoutRoot,
        issue.storageKey,
        input.conditionsRevisionId
      );
      const conditionsText = await this.dependencies.fs.readText(conditionsPath);
      if (conditionsText === null) {
        throw issueRefusal(
          'issue_accept_conditions_unreadable',
          `Acceptance conditions revision '${input.conditionsRevisionId}' of Issue '${selector}' does not exist in Store checkout ${scope.checkoutRoot}.`,
          {
            expected: 'a published acceptance conditions revision',
            actual: '(absent)',
            target: conditionsPath,
            fix: `Publish conditions first with 'rasen store issue acceptance ${issueId} --from-file <path>'.`,
          }
        );
      }
      let conditions: StoredAcceptanceConditionsRevision;
      try {
        conditions = parseAcceptanceConditionsRevision(conditionsText, { verifyDigest: true });
      } catch (error) {
        throw issueRefusal(
          'issue_accept_conditions_unreadable',
          `Acceptance conditions revision '${input.conditionsRevisionId}' of Issue '${selector}' does not read back: ${messageOf(error)}`,
          {
            expected: 'a readable acceptance conditions revision',
            actual: messageOf(error),
            target: conditionsPath,
            fix: 'The revision is Store content whose digest no longer matches. Re-publish conditions as a new revision rather than repairing the old one.',
          }
        );
      }
      if (!issueResourceOwnerMatches(issue, conditions)) {
        const actualOwner = conditions.version === 2 ? conditions.issueUid : conditions.issueId;
        throw issueError(
          'issue_resource_identity_mismatch',
          `Acceptance conditions revision '${input.conditionsRevisionId}' belongs to Issue '${actualOwner}', not '${issue.identity.uid}'.`,
          { target: conditionsPath }
        );
      }
      if (conditions.contentSha256 !== input.conditionsSha256) {
        throw issueRefusal(
          'issue_accept_conditions_unreadable',
          `The acceptance names conditions digest '${input.conditionsSha256}', but revision '${input.conditionsRevisionId}' carries '${conditions.contentSha256}'.`,
          {
            expected: input.conditionsSha256,
            actual: conditions.contentSha256,
            target: conditionsPath,
            fix: 'Re-evaluate the gate so the acceptance freezes the revision that is actually latest.',
          }
        );
      }

      const note = input.note === undefined ? null : input.note.trim();
      if (note === '') {
        throw issueRefusal(
          'issue_accept_note_invalid',
          `Accepting Issue '${selector}' with --note requires a non-empty note.`,
          {
            expected: 'a non-empty note or no note at all',
            actual: '(blank)',
            target: addresses.accepted,
            fix: 'Drop --note, or give the note content.',
          }
        );
      }
      if (note !== null) {
        // The note becomes durable Store content, so the portable-text
        // contract applies here too — refused, never trimmed.
        try {
          assertPortableIssueText(note, 'note', 'invalid_acceptance_record');
        } catch (error) {
          throw issueError(
            'issue_accept_note_invalid',
            `The acceptance note is not portable durable text: ${messageOf(error)}`,
            { target: addresses.accepted, fix: 'Remove machine paths and credentials from the note.' }
          );
        }
      }

      // The gate's exclusions ride the record verbatim — already the
      // evaluation's portable shape, no translation layer — and an empty
      // accounting writes the ABSENT form: the canonical record omits the
      // field when no exclusion stood, byte-identical to the pre-field shape.
      // The serializer validates every exclusion (node id, closed lifecycle,
      // portable reason) before any byte lands, same as the note.
      const exclusions =
        input.exclusions === undefined || input.exclusions.length === 0
          ? undefined
          : input.exclusions;
      const draft: Omit<IssueAcceptedRecordV2, 'contentSha256'> = {
        version: 2,
        issueUid: issue.identity.uid,
        acceptedAt: canonicalTimestamp(this.dependencies.now()),
        conditionsRevisionId: conditions.revisionId,
        conditionsSha256: conditions.contentSha256,
        gate: input.gate,
        ...(exclusions === undefined ? {} : { exclusions }),
        note,
      };
      const record: IssueAcceptedRecordV2 = {
        ...draft,
        contentSha256: acceptedRecordDigest(draft),
      };
      const serialized = serializeAcceptedRecord(record);
      await this.dependencies.fs.mkdirp(addresses.acceptance);
      await this.dependencies.fs.writeText(addresses.accepted, serialized);

      // D5: an open Issue resolves in the SAME serialized mutation; a legacy
      // resolved close is upgraded in place with no transition attempted.
      const written: string[] = [addresses.accepted];
      let state = current.state;
      if (current.state === 'open') {
        // The transition was already checked above, before any write, so the
        // state record and the acceptance record land as one durable pair.
        const nextRecord: StoredIssueRecord = { ...current, state: 'resolved' };
        await this.dependencies.fs.writeText(
          addresses.record,
          serializeStoredIssueRecord(nextRecord)
        );
        written.push(addresses.record);
        state = 'resolved';
      }

      return {
        ...this.report(
          scope,
          issue.identity,
          written,
          `chore(store): accept issue ${issue.identity.key}`
        ),
        record,
        state,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async readIdentityCatalog(
    input: {
      readonly globalDataDir?: string;
    },
    scope: ResolvedIssueScope
  ): Promise<IssueIdentityCatalog> {
    const query = new StoreQueryModuleImpl({
      dependencies: {
        ...productionStoreQueryDependencies,
        fs: this.dependencies.fs,
        git: this.dependencies.git,
      },
    });
    const page: IssueSummaryPage = await query.listIssues({
      store: scope.storeId,
      startPath: scope.checkoutRoot,
      ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    });
    if (!page.complete) {
      throw issueError(
        'store_query_ref_unreadable',
        `Issue identity catalog is incomplete (${page.unsearchedRefs.length} unsearched refs, ${page.problems.length} unreadable records); uniqueness cannot be proved.`
      );
    }

    const byCopy = new Map<string, IssueIdentityCandidate>();
    const divergentUids = new Set<string>();
    const add = (candidate: IssueIdentityCandidate): void => {
      byCopy.set(`${candidate.identity.uid}\0${candidate.storageKey}`, candidate);
    };
    for (const issue of page.issues) {
      if (issue.divergence !== null) {
        for (const copy of issue.divergence.copies) {
          if (copy.identity !== null && copy.record !== null) {
            divergentUids.add(copy.identity.identity.uid);
            add({ ...copy.identity, title: copy.record.title });
          }
        }
        continue;
      }
      if (issue.record === null) continue;
      const storageKey =
        issue.record.version === 1
          ? parseIssueStorageKey(issue.record.id)
          : parseIssueStorageKey(issue.record.identity.uid);
      add({
        ...projectStoredIssueIdentity({
          storeUid: scope.storeUid,
          record: issue.record,
          storageKey,
        }),
        title: issue.record.title,
      });
    }
    return { candidates: [...byCopy.values()], divergentUids };
  }

  private async withResolvedIssueLock<T>(
    input: StoreIssueSelector,
    fn: (scope: ResolvedIssueScope, issue: ResolvedMutationIssue) => Promise<T>
  ): Promise<T> {
    const scope = await this.openWriteScope(input);
    const coordination = this.dependencies.coordination(input.globalDataDir);
    return withIssueAllocationLock(
      coordination,
      issueAllocationLockKey({ storeUid: scope.storeUid }),
      async () => {
        const catalog = await this.readIdentityCatalog(input, scope);
        const selected = resolveIssueSelector({
          selector: input.issueId,
          candidates: catalog.candidates,
          complete: true,
        });
        if (catalog.divergentUids.has(selected.identity.uid)) {
          throw issueError(
            'issue_record_divergent',
            `Issue '${input.issueId}' resolves to '${selected.identity.uid}', whose records diverge across Store refs; no mutation winner can be chosen.`
          );
        }
        return withIssueLock(
          coordination,
          issueLockKey({
            storeUid: scope.storeUid,
            issueUid: selected.identity.uid,
          }),
          async () => {
            const addresses = issueAddresses(scope.checkoutRoot, selected.storageKey);
            const text = await this.dependencies.fs.readText(addresses.record);
            if (text === null) {
              throw issueError(
                'issue_not_found',
                `Issue '${input.issueId}' resolves to '${selected.identity.uid}', but that record is absent from Store checkout ${scope.checkoutRoot}.`,
                { target: addresses.record }
              );
            }
            const record = parseStoredIssueRecord(text, addresses.record);
            const projected = projectStoredIssueIdentity({
              storeUid: scope.storeUid,
              record,
              storageKey: selected.storageKey,
            });
            if (projected.identity.uid !== selected.identity.uid) {
              throw issueError(
                'issue_storage_identity_mismatch',
                `Issue selector '${input.issueId}' changed identity while its UID lock was being acquired.`
              );
            }
            const current = { ...projected, title: record.title };
            try {
              resolveIssueSelector({
                selector: input.issueId,
                candidates: [current],
                complete: true,
              });
            } catch {
              throw issueError(
                'issue_storage_identity_mismatch',
                `Issue selector '${input.issueId}' no longer identifies the locked checkout record.`
              );
            }
            return fn(scope, { ...current, record });
          }
        );
      }
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
   * work is created. A node of either kind must TARGET a project the roster
   * records with `roles.planning: true`: the planning-member gate rides this
   * same call, so every publication source meets it in one place.
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
          // The roster as the checkout's membership records state it, roles and
          // all: the catalog-presence check and the planning-member gate below
          // both read this one list, and both CLI publication sources
          // (`--from-file` here, `--from-portfolio` through this same
          // `publishPlan`) inherit the gate through this single call.
          projects: projects
            .filter(entry => entry.catalog !== null)
            .map(entry => ({
              projectId: entry.projectId,
              roles: {
                planning: (entry.catalog as NonNullable<typeof entry.catalog>).roles.planning,
                knowledge: (entry.catalog as NonNullable<typeof entry.catalog>).roles.knowledge,
              },
            })),
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
    identity: ResolvedMutationIssue['identity'],
    written: readonly string[],
    message: string
  ): {
    readonly identity: ResolvedMutationIssue['identity'];
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
      identity,
      issueId: parseIssueId(identity.uid),
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
