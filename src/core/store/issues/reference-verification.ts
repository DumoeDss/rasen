/**
 * Shared verification for canonical Execution Plan references.
 *
 * Normal Issue publication supplies the catalogs currently committed in the
 * checkout. Layout migration supplies the catalogs frozen in its immutable
 * plan. Both paths resolve canonical Change instances through the same
 * committed-ref and local-worktree evidence reader and therefore cannot drift
 * on ambiguity, unreadable refs, foreign Stores, or scope conflicts.
 *
 * The same one verifier is where a node's TARGET PROJECT becomes authoritative:
 * every publication source meets the planning-member gate here, and each caller
 * supplies the roster from its own authority (the checkout's membership
 * records for publication, the frozen member set for a migration replay).
 */
import { RefReader, type StoreRefTarget } from '../query/refs.js';
import {
  gatherReferenceEvidence,
  resolveChangeReference,
} from '../query/references.js';
import type { StoreQueryDependencies } from '../query/dependencies.js';
import { issueRefusal } from './diagnostics.js';
import type { ExecutionPlanNode } from './types.js';

/**
 * One member project as the publication gate needs it: identity plus the
 * roster's own role statement. Both role facts travel because the refusal must
 * name the project's recorded roles as they are recorded, not half of them.
 */
export interface IssueReferenceProjectEntry {
  readonly projectId: string;
  readonly roles: Readonly<{ planning: boolean; knowledge: boolean }>;
}

export interface IssueReferenceCatalogs {
  /**
   * Every project the Store holds a membership record for. `projectIds` as a
   * separate input is gone: the list derives from these entries, so the
   * catalog-presence check and the planning-role check read ONE roster and
   * cannot drift into disagreeing about who is a member.
   */
  readonly projects: readonly IssueReferenceProjectEntry[];
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
  const projectEntries = new Map(
    input.catalogs.projects.map(entry => [entry.projectId, entry])
  );
  const declaredProjects = new Set(projectEntries.keys());
  const declaredLines = new Set(
    input.catalogs.targetLines.map(entry => entry.targetLineId)
  );

  for (const node of input.nodes) {
    const member = projectEntries.get(node.projectId);
    if (member === undefined) {
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
    // The target project must PLAN here. Catalog presence alone accepts a
    // knowledge-only member as silently as a planning one, which was correct
    // while every node shared one project and is vacuous now that targets span
    // projects: eligibility to be targeted is exactly what `roles.planning`
    // states. The gate confers eligibility; it never chooses — which member a
    // node names stays the plan author's decision. Both node kinds pass it:
    // for an intent node the roster is the only scope fact there is.
    if (!member.roles.planning) {
      const planningMembers = input.catalogs.projects
        .filter(entry => entry.roles.planning)
        .map(entry => entry.projectId)
        .sort()
        .join(', ');
      throw issueRefusal(
        'issue_reference_target_not_planning_member',
        `Node '${node.nodeId}' targets project '${node.projectId}', which Store '${input.storeId}' records with planning: false (roles: planning=${member.roles.planning}, knowledge=${member.roles.knowledge}); a plan target must be a project that plans in this Store. Planning members: ${planningMembers || '(none)'}.`,
        {
          expected: `a project with roles.planning: true (planning members: ${planningMembers || '(none)'})`,
          actual: `${node.projectId} (roles: planning=${member.roles.planning}, knowledge=${member.roles.knowledge})`,
          target: node.nodeId,
          fix: `Target a project that plans in this Store, or widen the project's membership with 'rasen store add-project' (re-adding OR-widens roles per the membership mutation's compose semantics).`,
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
    if (found === null) {
      // Resolved by the machine workspace index ALONE. That index is a
      // locator and authority for nothing (`references.ts`'s header table),
      // so it answers a READ and never a publication: a revision is durable,
      // portable Store content, and one naming a Change that is committed on
      // no Store ref would be a published claim no other clone can check.
      // The resolver is left reporting exactly what it found; the decision
      // that committed evidence is required belongs to the mutation.
      const locator = resolved.localLocator?.root ?? '(a local planning worktree)';
      throw issueRefusal(
        'issue_reference_uncommitted',
        `Change instance '${node.changeInstanceId}' referenced by node '${node.nodeId}' exists only as a local planning worktree on this machine (${locator}); no committed Change metadata under this Store's target-line refs derives it. Refs searched: ${
          reader.searchedRefs.join(', ') || '(none)'
        }.`,
        {
          expected: "the Change committed under one of this Store's target-line refs",
          actual: 'a local planning worktree on this machine only',
          target: node.nodeId,
          fix: "Land the Change on its target line so the Store carries it, or declare the node as an intent until the Change exists. A machine-local worktree is never evidence for a published plan.",
        }
      );
    }
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
