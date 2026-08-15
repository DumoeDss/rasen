/**
 * Reading Store-level Issue content across refs.
 *
 * An Issue is cross-line by construction and `rasen/issues/` exists on every
 * Store ref, so "which ref does an Issue live on" has no single answer. The
 * adopted design (decision 7) makes an Issue ordinary committed Store content
 * on whatever ref the write landed on, spans refs on read, and REPORTS
 * divergence rather than arbitrating it: choosing by recency would require
 * trusting a timestamp inside a file the divergence already proves
 * untrustworthy.
 *
 * The local checkout's working tree is read as one additional, clearly labelled
 * source, because that is where a just-authored Issue lives until someone
 * commits it. It is deliberately EXCLUDED from the divergence decision, which
 * the requirement states over two Store refs.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { resolveStorePlanningLayoutV2Path } from '../planning-foundation.js';
import { parseIssueRecord } from '../issues/records.js';
import { parseExecutionPlanRevision } from '../issues/plans.js';
import type { ExecutionPlanRevisionV1, IssueRecordV1 } from '../issues/types.js';
import type { StoreQueryDependencies } from './dependencies.js';
import { issuesTreePath, type RefReader, type StoreRefTarget } from './refs.js';
import type { IssueDivergence, IssueRecordCopy } from './types.js';

function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyFrom(
  text: string,
  storeRef: string | null,
  targetLineId: string | null,
  filePath: string
): IssueRecordCopy {
  let record: IssueRecordV1 | null = null;
  let diagnostic: string | null = null;
  try {
    record = parseIssueRecord(text, filePath);
  } catch (error) {
    diagnostic = messageOf(error);
  }
  return { storeRef, targetLineId, sha256: digestOf(text), record, diagnostic };
}

export interface IssueContent {
  readonly issueId: string;
  readonly copies: readonly IssueRecordCopy[];
  /** Revision ids seen anywhere, ascending. */
  readonly revisionIds: readonly string[];
}

function issueRecordBlobPath(issueId: string): string {
  return `${issuesTreePath()}/${issueId}/issue.yaml`;
}

function issuePlansTreePath(issueId: string): string {
  return `${issuesTreePath()}/${issueId}/plans`;
}

function revisionBlobPath(issueId: string, revisionId: string): string {
  return `${issuePlansTreePath(issueId)}/${revisionId}.yaml`;
}

/**
 * Every Issue in the Store, from every readable ref plus the local checkout.
 *
 * An unreadable ref is already recorded by `RefReader.openRef`, so an Issue
 * that only lives on that ref simply does not appear here — and the caller's
 * `complete` flag is false, which is what stops that absence from being read as
 * a deletion.
 */
export async function collectIssues(
  dependencies: StoreQueryDependencies,
  reader: RefReader,
  refs: readonly StoreRefTarget[],
  storeCheckoutRoot: string
): Promise<readonly IssueContent[]> {
  const byId = new Map<string, { copies: IssueRecordCopy[]; revisions: Set<string> }>();
  /**
   * A copy that does not parse is an item that WAS read and cannot be
   * understood, so it is reported on the reader alongside the unsearched refs:
   * the id alone would say an Issue is unreadable without ever saying why, and
   * the summary's own `diagnostic` cannot carry the sole-copy case for a caller
   * that only looks at the result's problems.
   */
  const noteIfUnreadable = (
    issueId: string,
    copy: IssueRecordCopy,
    filePath: string
  ): IssueRecordCopy => {
    if (copy.diagnostic !== null) {
      reader.recordProblem({
        kind: 'issue',
        itemId: issueId,
        storeRef: copy.storeRef,
        path: filePath,
        reason: copy.diagnostic,
      });
    }
    return copy;
  };
  const bucket = (issueId: string) => {
    const existing = byId.get(issueId);
    if (existing !== undefined) return existing;
    const created = { copies: [] as IssueRecordCopy[], revisions: new Set<string>() };
    byId.set(issueId, created);
    return created;
  };

  for (const target of refs) {
    if (!(await reader.openRef(target))) continue;
    for (const issueId of await reader.childDirectories(target.storeRef, issuesTreePath())) {
      const text = await reader.blob(target.storeRef, issueRecordBlobPath(issueId));
      const entry = bucket(issueId);
      if (text !== null) {
        entry.copies.push(
          noteIfUnreadable(
            issueId,
            copyFrom(text, target.storeRef, target.targetLineId, issueRecordBlobPath(issueId)),
            issueRecordBlobPath(issueId)
          )
        );
      }
      for (const name of await reader.childBlobs(
        target.storeRef,
        issuePlansTreePath(issueId)
      )) {
        if (name.endsWith('.yaml')) entry.revisions.add(name.slice(0, -'.yaml'.length));
      }
    }
  }

  // The local checkout, read from disk. Labelled with a null ref so it can
  // never be mistaken for committed evidence. The collection directory comes
  // from the ONE contract path of a probe member rather than a hand-joined
  // `rasen/issues`, the same way the catalog families are addressed.
  const issuesRoot = path.dirname(
    resolveStorePlanningLayoutV2Path(storeCheckoutRoot, { kind: 'issue', issueId: 'probe' })
  );
  for (const issueId of await dependencies.fs.listNames(issuesRoot)) {
    const recordPath = safeIssueRecordPath(storeCheckoutRoot, issueId);
    if (recordPath === null) continue;
    const text = await dependencies.fs.readText(recordPath);
    const entry = bucket(issueId);
    if (text !== null) {
      entry.copies.push(
        noteIfUnreadable(issueId, copyFrom(text, null, null, recordPath), recordPath)
      );
    }
    const plansDir = safeIssuePlansPath(storeCheckoutRoot, issueId);
    if (plansDir === null) continue;
    for (const name of await dependencies.fs.listNames(plansDir)) {
      if (name.endsWith('.yaml')) entry.revisions.add(name.slice(0, -'.yaml'.length));
    }
  }

  return [...byId.entries()]
    .map(([issueId, entry]) => ({
      issueId,
      copies: entry.copies,
      revisionIds: [...entry.revisions].sort(),
    }))
    .filter(entry => entry.copies.length > 0 || entry.revisionIds.length > 0)
    .sort((left, right) => left.issueId.localeCompare(right.issueId));
}

/**
 * The layout contract validates the identifier, so a directory whose name is
 * not a legal Issue id resolves to null and is skipped rather than becoming a
 * path this process joins by hand.
 */
function safeIssueRecordPath(storeRoot: string, issueId: string): string | null {
  try {
    return resolveStorePlanningLayoutV2Path(storeRoot, { kind: 'issue-record', issueId });
  } catch {
    return null;
  }
}

function safeIssuePlansPath(storeRoot: string, issueId: string): string | null {
  try {
    return resolveStorePlanningLayoutV2Path(storeRoot, { kind: 'execution-plans', issueId });
  } catch {
    return null;
  }
}

/**
 * Divergence over COMMITTED copies only: two Store refs carrying byte-differing
 * records for one Issue id. Every copy is listed with its ref and none is
 * presented as the record.
 */
export function divergenceOf(copies: readonly IssueRecordCopy[]): IssueDivergence | null {
  const committed = copies.filter(copy => copy.storeRef !== null);
  const digests = new Set(committed.map(copy => copy.sha256));
  if (digests.size <= 1) return null;
  return {
    copies: [...copies].sort((left, right) =>
      `${left.storeRef ?? ''}`.localeCompare(`${right.storeRef ?? ''}`)
    ),
  };
}

/**
 * The record to present. A divergent Issue presents NONE. Otherwise a committed
 * copy is preferred over the working-tree one, because committed content is the
 * portable evidence.
 */
export function presentedRecord(copies: readonly IssueRecordCopy[]): IssueRecordV1 | null {
  if (divergenceOf(copies) !== null) return null;
  const committed = copies.find(copy => copy.storeRef !== null && copy.record !== null);
  if (committed?.record != null) return committed.record;
  return copies.find(copy => copy.record !== null)?.record ?? null;
}

/**
 * WHY no record is presented, when a copy is the reason.
 *
 * The diagnostic is captured per copy already; without this it dies inside
 * `IssueContent` and the summary reports an Issue whose record is null with no
 * reason attached — the id survives and the why does not. Committed copies are
 * named first, matching the presentation order.
 */
export function presentedDiagnostic(copies: readonly IssueRecordCopy[]): string | null {
  if (presentedRecord(copies) !== null) return null;
  const committed = copies.find(copy => copy.storeRef !== null && copy.diagnostic !== null);
  if (committed?.diagnostic != null) return committed.diagnostic;
  return copies.find(copy => copy.diagnostic !== null)?.diagnostic ?? null;
}

export interface RevisionRead {
  readonly revision: ExecutionPlanRevisionV1 | null;
  readonly diagnostic: string | null;
  readonly foundAt: string | null;
}

/**
 * Reads ONE revision, preferring committed evidence and falling back to the
 * local checkout. The recorded canonical digest is verified on every read, so a
 * hand-edited revision is reported as a mismatch and is never silently repaired
 * or re-digested.
 */
export async function readRevision(
  dependencies: StoreQueryDependencies,
  reader: RefReader,
  refs: readonly StoreRefTarget[],
  storeCheckoutRoot: string,
  issueId: string,
  revisionId: string
): Promise<RevisionRead> {
  const parseInto = (text: string, foundAt: string): RevisionRead => {
    try {
      return {
        revision: parseExecutionPlanRevision(text, { verifyDigest: true }),
        diagnostic: null,
        foundAt,
      };
    } catch (error) {
      return { revision: null, diagnostic: messageOf(error), foundAt };
    }
  };

  for (const target of refs) {
    if (!(await reader.openRef(target))) continue;
    const text = await reader.blob(target.storeRef, revisionBlobPath(issueId, revisionId));
    if (text !== null) return parseInto(text, target.storeRef);
  }
  let localPath: string;
  try {
    localPath = resolveStorePlanningLayoutV2Path(storeCheckoutRoot, {
      kind: 'execution-plan',
      issueId,
      revisionId,
    });
  } catch (error) {
    return { revision: null, diagnostic: messageOf(error), foundAt: null };
  }
  const text = await dependencies.fs.readText(localPath);
  if (text === null) return { revision: null, diagnostic: null, foundAt: null };
  return parseInto(text, localPath);
}
