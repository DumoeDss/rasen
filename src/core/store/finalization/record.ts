/**
 * The Archive v2 destination and the record draft.
 *
 * Two rules shape this module. First, the destination is derived from the
 * Change's FROZEN target line, through the Foundation layout contract, from
 * validated semantic identifiers — never composed by string concatenation, and
 * never from whichever line the current checkout happens to sit on. Second,
 * every identity in the record is obtained verified or the finalization
 * refuses: a well-formed placeholder that makes the schema validate is exactly
 * what the record contract exists to prevent.
 */
import type { ArchiveV2RecordDraft } from '../../archive-accounting-v2.js';
import { validateArchiveV2Draft } from '../../archive-accounting-v2.js';
import type { ArchiveSpecAction } from '../finalization-v2.js';
import {
  resolveStorePlanningLayoutV2Path,
  type StorePlanningPathFlavor,
} from '../planning-layout-v2.js';
import type { VerifiedChangeInstanceId } from '../planning-identity.js';
import { finalizationRefusal } from './diagnostics.js';
import type {
  FinalizationLandedProof,
  FinalizationOutcomeName,
  FinalizationScopeFacts,
  FinalizationWorktreeFacts,
} from './types.js';

export interface ArchiveEntryAddressInput {
  readonly storeRoot: string;
  readonly projectId: string;
  /** The line frozen in the Change's committed identity, never the resolved one. */
  readonly frozenTargetLineId: string;
  readonly changeId: string;
  readonly archiveDate: string;
  readonly changeInstanceId: VerifiedChangeInstanceId;
  readonly flavor?: StorePlanningPathFlavor;
}

/** The addressed Archive entry, from the layout contract. */
export function archiveEntryAddress(input: ArchiveEntryAddressInput): string {
  return resolveStorePlanningLayoutV2Path(
    input.storeRoot,
    {
      kind: 'archive-entry',
      projectId: input.projectId,
      targetLineId: input.frozenTargetLineId,
      changeId: input.changeId,
      archiveDate: input.archiveDate,
      changeInstanceId: input.changeInstanceId,
    },
    input.flavor ?? 'native'
  );
}

/**
 * The gate that fires BEFORE a destination is computed, a canonical spec is
 * read, or the transaction is entered. Finalization is where filing a Change
 * under the wrong line becomes irreversible — the entry and any landed spec
 * action enter that release line's Git history — so the frozen line wins here
 * even though child 4's gate already checked it at scope resolution.
 */
export function assertFrozenTargetLine(input: {
  readonly changeId: string;
  readonly frozenTargetLineId: string;
  readonly resolvedTargetLineId: string;
}): void {
  if (input.frozenTargetLineId === input.resolvedTargetLineId) return;
  throw finalizationRefusal(
    'target_line_mismatch',
    `Change '${input.changeId}' is frozen against target line '${input.frozenTargetLineId}', but finalization resolved '${input.resolvedTargetLineId}'.`,
    {
      expected: input.frozenTargetLineId,
      actual: input.resolvedTargetLineId,
      target: input.changeId,
      fix: `Finalize the Change on its own line (--target-line ${input.frozenTargetLineId}). Nothing was read and no destination was computed.`,
    }
  );
}

export function workspacePairUnavailable(changeId: string, detail: string): Error {
  return finalizationRefusal(
    'workspace_pair_unavailable',
    `The verified workspace pair for Change '${changeId}' could not be obtained: ${detail}.`,
    {
      expected: 'a verified workspacePairId from the recorded binding',
      actual: '(unavailable)',
      target: changeId,
      fix: "Prepare and bind the pair with 'rasen store workspace plan' and 'rasen store workspace apply', then retry. Rasen never derives a pair identifier from a path, an alias, or a placeholder.",
    }
  );
}

export interface RecordDraftInput {
  readonly outcome: FinalizationOutcomeName;
  readonly reason: string | null;
  readonly supersededBy: string | null;
  readonly implementation: 'code' | 'none';
  readonly scope: FinalizationScopeFacts;
  readonly changeId: string;
  readonly changeInstanceId: string;
  readonly workspacePairId: string;
  readonly planning: FinalizationWorktreeFacts;
  readonly execution: FinalizationWorktreeFacts;
  /** The target line's Store ref: what the planning side is filed toward. */
  readonly planningTargetRef: string;
  readonly landedProof: FinalizationLandedProof | null;
  readonly specActions: readonly ArchiveSpecAction[];
  readonly archivedAt: string;
}

/**
 * Assembles the draft and validates it. `evidence` and `missing` are not part
 * of a draft: the transaction appends an `## Archive` section to the staged
 * ship log and captures quality inputs, so the published evidence is not the
 * active Change's evidence. The writer hashes the published tree and validates
 * again there, immediately before the bytes are written.
 */
export function buildArchiveV2RecordDraft(input: RecordDraftInput): ArchiveV2RecordDraft {
  const planning = {
    worktreeInstanceId: input.planning.worktreeInstanceId,
    sourceRef: input.planning.ref,
    sourceHead: input.planning.headOid,
    targetRef: input.planningTargetRef,
  };
  const common = {
    schemaVersion: 2 as const,
    implementation: input.implementation,
    storeUid: input.scope.storeUid,
    projectId: input.scope.projectId,
    targetLineId: input.scope.targetLineId,
    changeId: input.changeId,
    changeInstanceId: input.changeInstanceId,
    workspacePairId: input.workspacePairId,
    planning,
    archivedAt: input.archivedAt,
  };

  if (input.outcome === 'landed') {
    const codeMerge =
      input.implementation === 'none' || input.landedProof === null
        ? null
        : {
            // `projectId` is the portable repository fact; no `repo_...`
            // identity is minted anywhere in this portfolio.
            repoUid: input.scope.projectId,
            worktreeInstanceId: input.execution.worktreeInstanceId,
            targetRef: input.landedProof.codeRef,
            commit: input.landedProof.commit,
            reachable: true as const,
          };
    if (input.implementation === 'code' && codeMerge === null) {
      throw finalizationRefusal(
        'landed_proof_unavailable',
        `Change '${input.changeId}' is code-backed, so a landed record requires a proven code merge.`,
        {
          expected: 'a proven code merge',
          actual: '(none)',
          target: input.changeId,
          fix: 'Prove the commit is reachable from the target line code ref, or declare the Change planning-only in its committed metadata.',
        }
      );
    }
    const draft = {
      ...common,
      outcome: 'landed' as const,
      reason: null,
      supersededBy: null,
      codeMerge,
      specSync: { applied: true as const, actions: [...input.specActions] },
    } as unknown as ArchiveV2RecordDraft;
    validateDraft(draft, input.changeId);
    return draft;
  }

  if (input.specActions.length > 0) {
    throw finalizationRefusal(
      'finalization_record_invalid',
      `Outcome '${input.outcome}' is passive history and can carry no spec action.`,
      {
        expected: '0 spec actions',
        actual: `${input.specActions.length} spec actions`,
        target: input.changeId,
        fix: 'This is a programming error: the passive plan variants have no field that can carry a spec action.',
      }
    );
  }

  const passiveCommon = {
    ...common,
    reason: input.reason,
    codeMerge: null,
    specSync: { applied: false as const, actions: [] as [] },
  };
  const draft = (
    input.outcome === 'superseded'
      ? {
          ...passiveCommon,
          outcome: 'superseded' as const,
          supersededBy: input.supersededBy,
        }
      : {
          ...passiveCommon,
          outcome: input.outcome,
          supersededBy: null,
        }
  ) as unknown as ArchiveV2RecordDraft;
  validateDraft(draft, input.changeId);
  return draft;
}

function validateDraft(draft: ArchiveV2RecordDraft, changeId: string): void {
  try {
    validateArchiveV2Draft(draft);
  } catch (error) {
    throw finalizationRefusal(
      'finalization_record_invalid',
      `The Archive v2 record for Change '${changeId}' does not validate: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        target: changeId,
        fix: 'Correct the disagreeing fact rather than the record; a record that validates only because a value was invented is the failure this check exists for.',
        cause: error,
      }
    );
  }
}
