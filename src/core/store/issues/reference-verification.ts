/**
 * Shared verification for canonical Execution Plan references.
 *
 * Normal Issue publication supplies the catalogs currently committed in the
 * checkout. Layout migration supplies the catalogs frozen in its immutable
 * plan. Both paths resolve canonical Change instances through the same
 * committed-ref and local-worktree evidence reader and therefore cannot drift
 * on ambiguity, unreadable refs, foreign Stores, or scope conflicts.
 */
import { RefReader, type StoreRefTarget } from '../query/refs.js';
import {
  gatherReferenceEvidence,
  resolveChangeReference,
} from '../query/references.js';
import type { StoreQueryDependencies } from '../query/dependencies.js';
import { issueRefusal } from './diagnostics.js';
import type { ExecutionPlanNode } from './types.js';

export interface IssueReferenceCatalogs {
  readonly projectIds: readonly string[];
  readonly targetLines: readonly StoreRefTarget[];
}

export interface VerifyExecutionPlanReferencesInput {
  readonly registeredRoot: string;
  readonly storeId: string;
  readonly storeUid: string;
  readonly nodes: readonly ExecutionPlanNode[];
  readonly catalogs: IssueReferenceCatalogs;
  readonly globalDataDir?: string;
}

export async function verifyExecutionPlanReferences(
  dependencies: StoreQueryDependencies,
  input: VerifyExecutionPlanReferencesInput
): Promise<void> {
  const declaredProjects = new Set(input.catalogs.projectIds);
  const declaredLines = new Set(
    input.catalogs.targetLines.map(entry => entry.targetLineId)
  );

  for (const node of input.nodes) {
    if (!declaredProjects.has(node.projectId)) {
      throw issueRefusal(
        'issue_reference_scope_conflict',
        `Node '${node.nodeId}' names project '${node.projectId}', which Store '${input.storeId}' has no project catalog for.`,
        {
          expected: `one of ${[...declaredProjects].sort().join(', ') || '(no project catalogs)'}`,
          actual: node.projectId,
          target: node.nodeId,
          fix: `Add the project to the Store with 'rasen store add-project', or correct the node's project.`,
        }
      );
    }
    if (!declaredLines.has(node.targetLineId)) {
      throw issueRefusal(
        'issue_reference_scope_conflict',
        `Node '${node.nodeId}' names target line '${node.targetLineId}', which Store '${input.storeId}' has no target-line catalog for.`,
        {
          expected: `one of ${[...declaredLines].sort().join(', ') || '(no target-line catalogs)'}`,
          actual: node.targetLineId,
          target: node.nodeId,
          fix: `Author the line with 'rasen store target-line add ${node.targetLineId} --store ${input.storeId} --store-ref refs/heads/<branch>'. A branch name is never a target line.`,
        }
      );
    }
  }

  const changeNodes = input.nodes.filter(node => node.kind === 'change');
  if (changeNodes.length === 0) return;

  const reader = new RefReader(dependencies, input.registeredRoot);
  const evidence = await gatherReferenceEvidence(dependencies, {
    reader,
    refs: input.catalogs.targetLines,
    projectIds: [...declaredProjects],
    storeUid: input.storeUid,
    ...(input.globalDataDir === undefined
      ? {}
      : { globalDataDir: input.globalDataDir }),
  });

  for (const node of changeNodes) {
    if (node.kind !== 'change') continue;
    const resolved = resolveChangeReference(evidence, node.changeInstanceId);
    if (resolved.status === 'ambiguous') {
      throw issueRefusal(
        'issue_reference_ambiguous',
        `Change instance '${node.changeInstanceId}' referenced by node '${node.nodeId}' is claimed by ${resolved.claimants.length} candidates: ${resolved.claimants
          .map(claimant => `${claimant.projectId}/${claimant.changeId} at ${claimant.foundAtRef}`)
          .join('; ')}.`,
        {
          expected: '1 claimant',
          actual: `${resolved.claimants.length} claimants`,
          target: node.nodeId,
          fix: 'Resolve the duplication in the Store; Rasen lists every claimant and selects none by ref order, recency, or proximity.',
        }
      );
    }
    if (resolved.status === 'unresolved') {
      if (!reader.complete) {
        throw issueRefusal(
          'store_query_ref_unreadable',
          `The reference search could not read ${reader.unsearchedRefs.length} Store ref(s), so '${node.changeInstanceId}' cannot be concluded absent: ${reader.unsearchedRefs
            .map(entry => `${entry.storeRef} (${entry.reason})`)
            .join('; ')}.`,
          {
            expected: 'every Store ref searched',
            actual: `${reader.searchedRefs.length} searched, ${reader.unsearchedRefs.length} unsearched`,
            target: node.nodeId,
            fix: 'Make the unreadable refs available in this checkout (they are read as Git objects; nothing is checked out), then retry.',
          }
        );
      }
      throw issueRefusal(
        'issue_reference_unresolved',
        `No committed Change metadata under this Store's target-line refs, and no local planning worktree, derives the Change instance '${node.changeInstanceId}' referenced by node '${node.nodeId}'. Refs searched: ${
          reader.searchedRefs.join(', ') || '(none)'
        }.`,
        {
          expected: node.changeInstanceId,
          actual: '(no match)',
          target: node.nodeId,
          fix: "Pass the Change's real instance identifier — a Change alias, a directory name, or a branch name is never accepted — or declare the node as an intent until the Change exists.",
        }
      );
    }

    const found = resolved.evidence;
    if (found === null) continue;
    if (found.storeUid !== input.storeUid) {
      throw issueRefusal(
        'issue_reference_foreign_store',
        `Change instance '${node.changeInstanceId}' belongs to Store '${found.storeUid}', not to '${input.storeUid}'.`,
        {
          expected: input.storeUid,
          actual: found.storeUid,
          target: node.nodeId,
          fix: 'An Issue references Changes of its own Store only. Open the Issue in the Store that owns the Change.',
        }
      );
    }
    if (found.projectId !== node.projectId || found.targetLineId !== node.targetLineId) {
      throw issueRefusal(
        'issue_reference_scope_conflict',
        `Node '${node.nodeId}' declares ${node.projectId}/${node.targetLineId} but Change instance '${node.changeInstanceId}' is committed as ${found.projectId}/${found.targetLineId}.`,
        {
          expected: `${node.projectId}/${node.targetLineId}`,
          actual: `${found.projectId}/${found.targetLineId}`,
          target: node.nodeId,
          fix: "Correct the node's project and target line to the Change's committed identity. Neither side is adjusted to agree with the other.",
        }
      );
    }
  }
}
