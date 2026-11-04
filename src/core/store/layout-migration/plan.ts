/**
 * Plan construction, the item-state taxonomy, and the apply gate (design D5-D8).
 *
 * The plan is a pure value: ordered items with source, destination, owner,
 * evidence and digest, plus catalog upgrades, target-line catalogs, receipt
 * content, and the retirement set. `planId` is the digest of its own canonical
 * serialization, so two runs over equal inputs produce the same id, and `apply`
 * consumes only a token rather than re-resolving anything.
 *
 * The gate has no override: `apply` is refused unless every item is resolved
 * and nothing is blocked. A Store holding half a partitioned tree and half a
 * flat one is exactly the ambiguous truth source layout v2 exists to remove.
 */
import { createHash } from 'node:crypto';
import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { canonicalJson } from '../../canonical-json.js';
import { formatZodIssues } from '../../zod-issues.js';
import { StoreError } from '../errors.js';
import { compileMigrationIssueTree } from '../issues/migration-compiler.js';
import { normalizePlanNodes } from '../issues/plans.js';
import { verifyExecutionPlanReferences } from '../issues/reference-verification.js';
import type { ExecutionPlanNodeInput } from '../issues/types.js';
import {
  resolveStorePlanningLayoutV2Path,
  type StorePlanningPathFlavor,
} from '../planning-layout-v2.js';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  parseChangeInstanceSeed,
} from '../planning-identity.js';
import { serializeStoreTargetLineCatalogV1 } from '../planning-catalogs.js';
import {
  isProjectId,
  isTargetLineId,
  parseIssueStorageKey,
} from '../planning-validation.js';
import { listTargetLineEntries } from '../query/refs.js';
import { parseStoreProjectRecord } from '../project-records.js';
import { upgradeMembershipRecord } from './catalog-upgrade.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import {
  buildSpecProvenance,
  collectEvidence,
  evidenceKey,
  reduceOwnership,
  type CapabilityProvenance,
  type CollectedEvidence,
} from './evidence.js';
import {
  FLAT_RELATIVE,
  digestTree,
  flatStorePaths,
  storeRelative,
} from './flat-source.js';
import type { LoadedMappingFile } from './mapping.js';
import { validateMappingAgainstInventory } from './mapping.js';
import { loadMigrationPlanInput } from './plan-input.js';
import type {
  BlockedReason,
  CatalogUpgrade,
  FlatStoreInventory,
  ImmutableMigrationPlan,
  MigrationItem,
  MigrationItemState,
  MigrationPlanToken,
  MintedChangeIdentity,
  OwnershipEvidence,
  RetainedDesignDoc,
  SharedSpecResolution,
  SurveyedRef,
  TargetLineCatalogOutput,
  UnresolvedReason,
  WorkDisposition,
  MigrationMaterialization,
  SourceLifecycle,
} from './types.js';
import { migrationItemStateLabel } from './types.js';

export const MIGRATION_PLAN_SCHEMA_VERSION = 1;

export interface StoreContext {
  readonly storeId: string;
  readonly storeUid?: string;
  readonly storeRoot: string;
}

export interface BuildPlanInput {
  readonly context: StoreContext;
  readonly inventory: FlatStoreInventory;
  readonly mapping?: LoadedMappingFile;
  readonly defaultTargetLine?: string;
  readonly includeUntracked: boolean;
  readonly globalDataDir?: string;
  readonly pathFlavor?: StorePlanningPathFlavor;
  /** True when a completed publication receipt already exists for this ref. */
  readonly publicationRecorded: boolean;
}

const UNRESOLVED_TEXT: Record<UnresolvedReason, string> = {
  'unknown-owner': 'no ownership evidence exists in any class',
  'evidence-conflict': 'two lower-priority evidence sources name different projects',
  'shared-spec': 'two or more projects contributed deltas and no resolution is declared',
  'non-member-owner': 'the evidence names a project that is not a member of this Store',
  'unrecordable-identity':
    'an id required to address the layout v2 destination fails the portable identifier contract',
  'missing-target-line': 'no target line is declared for an item that needs one',
};

const BLOCKED_TEXT: Record<BlockedReason, string> = {
  'destination-exists': 'the computed destination already exists',
  'mixed-layout':
    'the ref declares layoutVersion 2 and still holds flat planning content with no completed publication',
  'store-identity-missing': 'the Store carries no permanent identity, so no v2 identity can be derived',
  'unrecordable-catalog-field': 'a membership record value cannot satisfy the v2 catalog contract',
  'target-line-catalog-conflict':
    'the declared target line disagrees with the catalog already present in the Store',
  'dirty-source': 'the source path has tracked modifications or staged changes',
  'ref-not-checked-out': 'no ref is checked out in the invoking Store worktree',
  'ref-unborn': 'the checked-out ref has no commit, so there is no recorded state to verify against',
};

interface DraftItem {
  kind: MigrationItem['kind'];
  name: string;
  source: string;
  sourceRelative: string;
  state: MigrationItemState;
  reason: string;
  repair: string;
  owner?: string;
  destination?: string;
  destinationRelative?: string;
  targetLineId?: string;
  evidence: OwnershipEvidence[];
  supersededEvidence: OwnershipEvidence[];
  contributors?: string[];
  digest?: string;
  untracked?: string[];
  sourceLifecycle?: SourceLifecycle;
  disposition?: WorkDisposition;
  materialization?: MigrationMaterialization;
  planInput?: MigrationItem['planInput'];
}

function unresolved(
  reason: UnresolvedReason,
  repair: string,
  detail?: string
): Pick<DraftItem, 'state' | 'reason' | 'repair'> {
  return {
    state: { kind: 'unresolved', reason },
    reason: detail === undefined ? UNRESOLVED_TEXT[reason] : `${UNRESOLVED_TEXT[reason]}: ${detail}`,
    repair,
  };
}

function blocked(reason: BlockedReason, repair: string, detail?: string): Pick<DraftItem, 'state' | 'reason' | 'repair'> {
  return {
    state: { kind: 'blocked', reason },
    reason: detail === undefined ? BLOCKED_TEXT[reason] : `${BLOCKED_TEXT[reason]}: ${detail}`,
    repair,
  };
}

function resolvedState(): Pick<DraftItem, 'state' | 'reason' | 'repair'> {
  return { state: { kind: 'resolved' }, reason: 'owner determined and destination computed', repair: '' };
}

function caseFoldKey(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/**
 * One target line per item, from an explicit declaration only. No target line
 * is ever derived from a branch name, a ref, or a sibling item — the design
 * treats it as a fact legacy data cannot prove.
 */
function declaredTargetLine(
  itemOverride: string | undefined,
  mappingDefault: string | undefined,
  optionDefault: string | undefined
): string | undefined {
  const candidate = itemOverride ?? mappingDefault ?? optionDefault;
  return candidate !== undefined && isTargetLineId(candidate) ? candidate : undefined;
}

export async function buildMigrationPlan(
  dependencies: StoreLayoutMigrationDependencies,
  input: BuildPlanInput
): Promise<ImmutableMigrationPlan> {
  const { context, inventory, mapping } = input;
  const storeRoot = context.storeRoot;
  const paths = flatStorePaths(storeRoot);
  const flavor = input.pathFlavor ?? 'native';
  const createdAt = dependencies.now().toISOString();

  const evidenceIndex = await collectEvidence(dependencies, {
    storeRoot,
    ...(input.globalDataDir === undefined ? {} : { globalDataDir: input.globalDataDir }),
    specs: inventory.specs,
    changes: inventory.changes,
    archiveEntries: inventory.archiveEntries,
  });

  const recordedIdentity = new Map<string, string>();
  for (const [key, entries] of evidenceIndex.byItem) {
    const first = entries.find((entry) => entry.class === 'E1-recorded-identity');
    if (first !== undefined) recordedIdentity.set(key, first.projectId);
  }

  if (mapping !== undefined) {
    validateMappingAgainstInventory({
      mapping,
      members: evidenceIndex.members,
      knownChanges: inventory.changes,
      knownArchiveEntries: inventory.archiveEntries,
      knownSpecs: inventory.specs,
      knownDesignDocs: inventory.designDocs,
      recordedIdentity,
    });
  }

  const mixedLayout =
    inventory.declaredLayoutVersion === 2 &&
    !input.publicationRecorded &&
    (inventory.specs.length > 0 ||
      inventory.changes.length > 0 ||
      inventory.archiveEntries.length > 0);

  const dirty = await collectDirtySources(dependencies, storeRoot);

  const items: DraftItem[] = [];
  const ownerByKey = new Map<string, string | undefined>();

  // --- Active Changes and Archive entries -----------------------------------
  for (const [kind, names, collection] of [
    ['change', inventory.changes, paths.changes],
    ['archive-entry', inventory.archiveEntries, paths.archive],
  ] as const) {
    for (const name of names) {
      const key = evidenceKey(kind, name);
      const evidence = evidenceIndex.byItem.get(key) ?? [];
      const decision = reduceOwnership(evidence, evidenceIndex.members);
      const declaration =
        kind === 'change' ? mapping?.changes.get(name) : mapping?.archive.get(name);

      if (declaration?.kind === 'store-issue') {
        const source = path.join(collection, name);
        const destination = safeLayoutPath(
          storeRoot,
          {
            kind: 'issue',
            issueStorageKey: parseIssueStorageKey(declaration.issueId),
          },
          flavor
        );
        if (destination === null) {
          items.push({
            kind,
            name,
            source,
            sourceRelative: storeRelative(storeRoot, source),
            evidence: [...decision.evidence],
            supersededEvidence: [...decision.superseded],
            sourceLifecycle: kind === 'change' ? 'active-change' : 'archive-entry',
            disposition: {
              kind: 'store-issue',
              nature: 'operator-asserted',
              issueId: declaration.issueId,
              title: declaration.title,
              state: declaration.state,
              reason: declaration.reason,
              ...(declaration.plan === undefined ? {} : { planInput: declaration.plan }),
            },
            ...unresolved(
              'unrecordable-identity',
              `Declare ${kind === 'change' ? 'changes' : 'archive'}.${name}.issueId with a portable Issue id.`
            ),
          });
          ownerByKey.set(key, undefined);
          continue;
        }
        const compiled = compileMigrationIssueTree({
          issueId: declaration.issueId,
          title: declaration.title,
          state: declaration.state,
          reason: declaration.reason,
          createdAt,
        });
        const destinationRelative = storeRelative(storeRoot, destination);
        items.push({
          kind,
          name,
          source,
          sourceRelative: storeRelative(storeRoot, source),
          destination,
          destinationRelative,
          evidence: [...decision.evidence],
          supersededEvidence: [...decision.superseded],
          sourceLifecycle: kind === 'change' ? 'active-change' : 'archive-entry',
          disposition: {
            kind: 'store-issue',
            nature: 'operator-asserted',
            issueId: declaration.issueId,
            title: declaration.title,
            state: declaration.state,
            reason: declaration.reason,
            ...(declaration.plan === undefined ? {} : { planInput: declaration.plan }),
          },
          materialization: {
            kind: 'generated-tree',
            role: 'store-issue',
            destination,
            destinationRelative,
            files: compiled.files,
          },
          ...resolvedState(),
          reason: `explicitly classified as Store Issue '${declaration.issueId}'`,
        });
        ownerByKey.set(key, undefined);
        continue;
      }

      let owner = decision.owner;
      const chain: OwnershipEvidence[] = [...decision.evidence];
      if (
        declaration?.kind === 'project-change' &&
        (decision.reason !== undefined || mapping?.version === 2)
      ) {
        // Mapping v1 keeps its established E4 behavior: it resolves only an
        // unknown/conflicting owner. Mapping v2 is an explicit work
        // disposition assertion and may override E2/E3, while inventory
        // validation above still makes E1 recorded identity binding.
        owner = declaration.project;
        chain.push({
          class: 'E4-explicit-mapping',
          source: mapping?.relative ?? 'mapping',
          projectId: declaration.project,
          nature: 'asserted',
          detail: `operator declaration for ${kind} '${name}'`,
        });
      }
      if (owner !== undefined && !evidenceIndex.members.includes(owner)) {
        owner = undefined;
      }

      const source = path.join(collection, name);
      const draft: DraftItem = {
        kind,
        name,
        source,
        sourceRelative: storeRelative(storeRoot, source),
        evidence: chain,
        supersededEvidence: [...decision.superseded],
        ...resolvedState(),
      };

      if (owner === undefined) {
        const reason = decision.reason ?? 'unknown-owner';
        const mappingKey = `${kind === 'change' ? 'changes' : 'archive'}.${name}`;
        const mappingRepair =
          mapping?.version === 2
            ? `Declare ${mappingKey} as kind: project-change with project, or kind: store-issue with explicit Issue fields.`
            : `Declare ${mappingKey}.project in the mapping file.`;
        // The mapping file is NOT the escape hatch for a non-member owner that
        // the item itself recorded: `validateMappingAgainstInventory` refuses
        // any entry contradicting a recorded identity, so following the generic
        // repair produced `mapping-contradicts-recorded-identity` and left the
        // operator with no named way out at all (triage O8).
        const recorded = recordedIdentity.get(key);
        const nonMemberRecorded = reason === 'non-member-owner' && recorded !== undefined;
        Object.assign(
          draft,
          unresolved(
            reason,
            nonMemberRecorded
              ? `Make project ${recorded} a member of Store '${context.storeId}' (for example 'rasen store add-project <path> --to ${context.storeId}'), commit the membership record, and re-plan. The mapping file cannot reassign this item: the Change records that identity, and a mapping entry contradicting a recorded identity is refused.`
              : mappingRepair,
            nonMemberRecorded ? `${recorded} is recorded by the item itself` : undefined
          )
        );
        if (decision.conflictingProjects !== undefined) {
          draft.contributors = [...decision.conflictingProjects];
        }
        items.push(draft);
        ownerByKey.set(key, undefined);
        continue;
      }

      draft.owner = owner;
      ownerByKey.set(key, owner);

      const targetLine = declaredTargetLine(
        declaration?.kind === 'project-change' ? declaration.targetLine : undefined,
        mapping?.defaultTargetLine,
        input.defaultTargetLine
      );
      if (targetLine === undefined) {
        Object.assign(
          draft,
          unresolved(
            'missing-target-line',
            `Declare defaultTargetLine, or ${kind === 'change' ? 'changes' : 'archive'}.${name}.targetLine, in the mapping file.`
          )
        );
        items.push(draft);
        continue;
      }
      draft.targetLineId = targetLine;

      const destination =
        kind === 'change'
          ? safeLayoutPath(storeRoot, { kind: 'active-change', projectId: owner, changeId: name }, flavor)
          : archiveEntryDestination(storeRoot, owner, targetLine, name, flavor);
      if (destination === null) {
        // Two different facts land here, and reporting the wrong one costs the
        // operator the whole investigation: a UTF-8 Change directory name is
        // rejected by `parseChangeId` while its owning project id is perfectly
        // portable, and the old text blamed the project id and offered a
        // mapping entry that cannot help (triage O9).
        const ownerUnrecordable = !isProjectId(owner);
        Object.assign(
          draft,
          unresolved(
            'unrecordable-identity',
            ownerUnrecordable
              ? `Declare ${kind === 'change' ? 'changes' : 'archive'}.${name}.project with a portable project id in the mapping file; migration never sanitizes an id.`
              : `Rename ${draft.sourceRelative} to a lowercase kebab id in the Store worktree, commit it, and re-plan; migration never sanitizes an id, and the mapping file cannot rename an item.`,
            ownerUnrecordable
              ? `the owner project id '${owner}' is not a portable v2 identifier`
              : `the item name '${name}' is not a lowercase kebab id`
          )
        );
        items.push(draft);
        continue;
      }
      draft.destination = destination;
      draft.destinationRelative = storeRelative(storeRoot, destination);
      items.push(draft);
    }
  }

  // --- Canonical specs, from the provenance graph ---------------------------
  const provenance = await buildSpecProvenance(dependencies, {
    storeRoot,
    changes: inventory.changes,
    archiveEntries: inventory.archiveEntries,
    ownerByKey,
  });

  const sharedSpecResolutions: SharedSpecResolution[] = [];
  for (const capability of inventory.specs) {
    const source = path.join(paths.specs, capability);
    const sourceRelative = storeRelative(storeRoot, source);
    const graph = provenance.get(capability);
    const declaration = mapping?.specs.get(capability);
    const directEvidence = evidenceIndex.byItem.get(evidenceKey('spec', capability)) ?? [];

    const owners = resolveSpecOwners(capability, graph, declaration, directEvidence, evidenceIndex);
    if (owners.state !== 'assigned') {
      items.push({
        kind: 'spec',
        name: capability,
        source,
        sourceRelative,
        evidence: owners.evidence,
        supersededEvidence: [],
        ...(graph === undefined ? {} : { contributors: [...graph.contributors] }),
        ...unresolved(
          owners.reason,
          owners.reason === 'shared-spec'
            ? `Declare specs.${capability}.owner <projectId> or specs.${capability}.split [<projectId>, …] in the mapping file.`
            : `Declare specs.${capability}.owner <projectId> in the mapping file.`
        ),
      });
      continue;
    }

    if (declaration !== undefined && graph !== undefined && graph.contributors.length > 1) {
      sharedSpecResolutions.push({
        capability,
        mode: declaration.mode,
        projects: [...declaration.projects],
        contributors: [...graph.contributors],
      });
    }

    for (const owner of owners.projects) {
      const destination = safeLayoutPath(
        storeRoot,
        { kind: 'project-specs', projectId: owner },
        flavor
      );
      if (destination === null) {
        items.push({
          kind: 'spec',
          name: capability,
          source,
          sourceRelative,
          evidence: owners.evidence,
          supersededEvidence: [],
          ...unresolved(
            'unrecordable-identity',
            `Declare specs.${capability}.owner with a portable project id.`
          ),
        });
        continue;
      }
      const target = path.join(destination, capability);
      items.push({
        kind: 'spec',
        name: capability,
        source,
        sourceRelative,
        owner,
        destination: target,
        destinationRelative: storeRelative(storeRoot, target),
        evidence: owners.evidence,
        // A mapping entry derived evidence outranked. Not empty by
        // construction any more: this is the record that says the operator
        // asserted a different owner and the migration did not take it.
        supersededEvidence: owners.superseded,
        ...(graph === undefined ? {} : { contributors: [...graph.contributors] }),
        ...resolvedState(),
      });
    }
  }

  // --- Store-level design docs: retained unless explicitly reclassified -----
  const retainedDesignDocs: RetainedDesignDoc[] = [];
  for (const name of inventory.designDocs) {
    const source = path.join(paths.designDocs, name);
    const sourceRelative = storeRelative(storeRoot, source);
    const declaredOwner = mapping?.designDocs.get(name);
    if (declaredOwner === undefined) {
      retainedDesignDocs.push({ name, path: source, relative: sourceRelative });
      items.push({
        kind: 'design-doc',
        name,
        source,
        sourceRelative,
        // Retention IS the destination. Stated rather than left as a hole, so
        // the plan reads as a decision instead of an omission.
        destination: source,
        destinationRelative: sourceRelative,
        evidence: [],
        supersededEvidence: [],
        ...resolvedState(),
        reason: 'retained at the Store-level design-doc address; a design document carries no ownership evidence',
        repair: `Assign it with designDocs.${name} in the mapping file if it belongs to one project.`,
      });
      continue;
    }
    const partition = safeLayoutPath(
      storeRoot,
      { kind: 'project-design-docs', projectId: declaredOwner },
      flavor
    );
    if (partition === null) {
      items.push({
        kind: 'design-doc',
        name,
        source,
        sourceRelative,
        evidence: [],
        supersededEvidence: [],
        ...unresolved(
          'unrecordable-identity',
          `Declare designDocs.${name} with a portable project id.`
        ),
      });
      continue;
    }
    const target = path.join(partition, name);
    items.push({
      kind: 'design-doc',
      name,
      source,
      sourceRelative,
      owner: declaredOwner,
      destination: target,
      destinationRelative: storeRelative(storeRoot, target),
      evidence: [
        {
          class: 'E4-explicit-mapping',
          source: mapping?.relative ?? 'mapping',
          projectId: declaredOwner,
          nature: 'asserted',
          detail: `operator reclassification of design doc '${name}'`,
        },
      ],
      supersededEvidence: [],
      ...resolvedState(),
    });
  }

  // --- Membership record → project catalog upgrades -------------------------
  const checkouts = await dependencies.snapshotProjects(input.globalDataDir);
  const catalogUpgrades: CatalogUpgrade[] = [];
  for (const fileName of inventory.membershipRecords) {
    const recordPath = path.join(paths.projectRecords, fileName);
    const relative = storeRelative(storeRoot, recordPath);
    const text = await dependencies.fs.readText(recordPath);
    if (text === null) continue;
    let outcome: ReturnType<typeof upgradeMembershipRecord>;
    try {
      outcome = upgradeMembershipRecord({
        record: parseStoreProjectRecord(text, recordPath),
        checkouts,
      });
    } catch (error) {
      items.push({
        kind: 'membership-record',
        name: fileName,
        source: recordPath,
        sourceRelative: relative,
        evidence: [],
        supersededEvidence: [],
        ...blocked(
          'unrecordable-catalog-field',
          `Repair ${relative} so it parses as a membership record, then re-plan.`,
          error instanceof Error ? error.message : String(error)
        ),
      });
      continue;
    }

    if (outcome.catalogYaml === undefined) {
      items.push({
        kind: 'membership-record',
        name: fileName,
        source: recordPath,
        sourceRelative: relative,
        evidence: [],
        supersededEvidence: [],
        ...blocked(
          'unrecordable-catalog-field',
          // The remedy, not the objecting validator: the operator has to change
          // their own committed record, so the repair says what to change it to.
          `${outcome.blockedRepair ?? `Correct '${outcome.blockedField}' in the record.`} (${relative})`,
          `${outcome.blockedField}: ${outcome.blockedReason}`
        ),
      });
      continue;
    }

    catalogUpgrades.push({
      projectId: outcome.projectId,
      recordPath,
      recordRelative: relative,
      sourceDigest: (await digestTree(dependencies.fs, recordPath)).digest,
      catalogYaml: outcome.catalogYaml,
      ...(outcome.droppedAdoption === undefined
        ? {}
        : { droppedAdoption: outcome.droppedAdoption }),
      binding: outcome.binding,
    });
    items.push({
      kind: 'membership-record',
      name: fileName,
      source: recordPath,
      sourceRelative: relative,
      owner: outcome.projectId,
      destination: recordPath,
      destinationRelative: relative,
      evidence: [],
      supersededEvidence: [],
      ...resolvedState(),
      reason: `upgraded in place to a v2 project catalog with a ${outcome.binding} planning binding`,
      repair: '',
    });
  }

  // --- Target-line catalogs from the mapping only ---------------------------
  const targetLineCatalogs: TargetLineCatalogOutput[] = [];
  const targetLineBlocks: DraftItem[] = [];
  for (const [targetLineId, catalog] of mapping?.targetLines ?? new Map()) {
    const destination = safeLayoutPath(
      storeRoot,
      { kind: 'target-line-catalog', targetLineId },
      flavor
    );
    if (destination === null) continue;
    const yaml = serializeStoreTargetLineCatalogV1(catalog);
    const existing = await dependencies.fs.readText(destination);
    if (existing !== null && existing !== yaml) {
      targetLineBlocks.push({
        kind: 'membership-record',
        name: `target-line:${targetLineId}`,
        source: destination,
        sourceRelative: storeRelative(storeRoot, destination),
        evidence: [],
        supersededEvidence: [],
        ...blocked(
          'target-line-catalog-conflict',
          `Reconcile targetLines.${targetLineId} in the mapping file with ${storeRelative(storeRoot, destination)}.`
        ),
      });
      continue;
    }
    if (existing === null) {
      targetLineCatalogs.push({
        targetLineId,
        destination,
        destinationRelative: storeRelative(storeRoot, destination),
        catalogYaml: yaml,
      });
    }
  }
  items.push(...targetLineBlocks);

  // --- Every declared target line must have a catalog -----------------------
  const knownTargetLines = new Set<string>([
    ...targetLineCatalogs.map((entry) => entry.targetLineId),
    ...(await existingTargetLineIds(dependencies, storeRoot, flavor, collectDeclaredLines(items))),
  ]);
  for (const item of items) {
    if (item.targetLineId === undefined || item.state.kind !== 'resolved') continue;
    if (!knownTargetLines.has(item.targetLineId)) {
      Object.assign(
        item,
        unresolved(
          'missing-target-line',
          `Declare targetLines.${item.targetLineId} with its storeRef and per-project codeRef in the mapping file.`
        )
      );
    }
  }

  // --- Store-level blocks ---------------------------------------------------
  if (mixedLayout) {
    for (const item of items) {
      if (item.kind === 'membership-record') continue;
      Object.assign(
        item,
        blocked(
          'mixed-layout',
          `Run 'rasen store migrate-layout ${context.storeId} --status' and recover the interrupted run before planning again.`
        )
      );
    }
  }

  if (context.storeUid === undefined) {
    const identityRepair = `Run 'rasen store upgrade-identity ${context.storeId} --apply' first.`;
    for (const item of items) {
      if (item.kind !== 'change' || item.state.kind === 'blocked') continue;
      Object.assign(item, blocked('store-identity-missing', identityRepair));
    }
  }

  // --- Apply-token preconditions, as REPORTED blockers ----------------------
  //
  // `applicable` used to be computed from item blockers alone while the apply
  // token separately required a Store identity, a checked-out ref, and a
  // commit. Nothing reconciled the two, and both store-level blocks were
  // stamped onto items that may not exist: a Store with no active Changes
  // carried the identity block nowhere, so it reported zero blockers, computed
  // `applicable: true`, minted no token, and the preview printed "Ready to
  // apply" while `--apply` exited non-zero having printed nothing at all.
  //
  // Every fact the token needs is enumerated HERE and reported as a blocked
  // item on the Store's own metadata, so "this plan is applicable" and "a token
  // can be minted for this plan" are the same statement for every Store shape,
  // including one with no content at all. A precondition added to the token
  // later must be added here too; the invariant below fails loudly if it is not.
  const tokenPreconditions: Array<{ reason: BlockedReason; repair: string }> = [];
  if (context.storeUid === undefined) {
    tokenPreconditions.push({
      reason: 'store-identity-missing',
      repair: `Run 'rasen store upgrade-identity ${context.storeId} --apply', commit the metadata, then re-plan.`,
    });
  }
  if (inventory.checkedOutRef === undefined) {
    tokenPreconditions.push({
      reason: 'ref-not-checked-out',
      repair:
        'Check out the branch you want to migrate in this Store worktree and re-plan; migration only ever writes the ref checked out here.',
    });
  } else if (inventory.headOid === undefined) {
    tokenPreconditions.push({
      reason: 'ref-unborn',
      repair: 'Commit the Store worktree at least once, then re-plan.',
    });
  }
  for (const precondition of tokenPreconditions) {
    items.push({
      kind: 'store-metadata',
      name: FLAT_RELATIVE.storeMetadata,
      source: paths.storeMetadata,
      sourceRelative: FLAT_RELATIVE.storeMetadata,
      evidence: [],
      supersededEvidence: [],
      ...blocked(precondition.reason, precondition.repair),
    });
  }

  // --- Dirty sources and untracked content ----------------------------------
  for (const item of items) {
    if (item.state.kind === 'blocked') continue;
    const relative = item.sourceRelative;
    const tracked = dirty.tracked.filter((entry) => underPath(entry, relative));
    if (tracked.length > 0) {
      Object.assign(
        item,
        blocked(
          'dirty-source',
          `Commit or discard ${tracked.slice(0, 5).join(', ')} in the Store worktree, then re-plan.`,
          tracked.slice(0, 5).join(', ')
        )
      );
      continue;
    }
    const untracked = dirty.untracked.filter((entry) => underPath(entry, relative));
    const ignored = dirty.ignored.filter((entry) => underPath(entry, relative));
    const nonGit = [...new Set([...untracked, ...ignored])].sort();
    if (nonGit.length > 0) {
      item.untracked = nonGit;
      if (item.materialization?.kind === 'generated-tree') {
        Object.assign(
          item,
          blocked(
            'dirty-source',
            'Commit or remove every non-Git entry below this generated source; --include-untracked cannot authorize data loss.',
            `${nonGit.length} untracked or ignored file(s): ${nonGit.slice(0, 5).join(', ')}`
          )
        );
      } else if (!input.includeUntracked) {
        Object.assign(
          item,
          blocked(
            'dirty-source',
            'Re-run with --include-untracked to move them with the tree; Git cannot restore them.',
            `${untracked.length} untracked file(s): ${untracked.slice(0, 5).join(', ')}`
          )
        );
      }
    }
  }

  // --- No-clobber and case-folded destination uniqueness --------------------
  const claimed = new Map<string, DraftItem>();
  for (const item of items) {
    if (item.state.kind !== 'resolved' || item.destination === undefined) continue;
    if (item.kind === 'membership-record') continue;
    if (item.destination === item.source) continue;

    const existing = await dependencies.fs.statKind(item.destination);
    if (existing !== 'absent') {
      Object.assign(
        item,
        blocked(
          'destination-exists',
          `Remove or rename ${item.destinationRelative} in the Store, then re-plan.`,
          `${item.sourceRelative} → ${item.destinationRelative}`
        )
      );
      continue;
    }

    const key = caseFoldKey(item.destination);
    const other = claimed.get(key);
    if (other !== undefined) {
      const detail = `${other.sourceRelative} and ${item.sourceRelative} both resolve to ${item.destinationRelative}`;
      Object.assign(
        item,
        blocked('destination-exists', 'Rename one of the two sources before migrating.', detail)
      );
      Object.assign(
        other,
        blocked('destination-exists', 'Rename one of the two sources before migrating.', detail)
      );
      continue;
    }
    claimed.set(key, item);
  }

  // --- Minted Change identity ----------------------------------------------
  const mintedIdentities: MintedChangeIdentity[] = [];
  if (context.storeUid !== undefined) {
    for (const item of items) {
      if (item.kind !== 'change' || item.state.kind !== 'resolved') continue;
      if (item.owner === undefined || item.targetLineId === undefined) continue;
      const existing = await readExistingIdentity(dependencies, item.source);
      const planningScopeId = derivePlanningScopeId({
        storeUid: context.storeUid,
        projectId: item.owner,
        targetLineId: item.targetLineId,
      });
      if (existing !== null) {
        // An existing v2 identity is VERIFIED, never re-minted: re-minting
        // would silently replace an identity other records already reference.
        try {
          const seed = parseChangeInstanceSeed(existing.instanceSeed);
          const derived = deriveChangeInstanceId({ planningScopeId, instanceSeed: seed });
          if (derived !== existing.instanceId) throw new Error('instance id does not verify');
          mintedIdentities.push({
            changeId: item.name,
            projectId: item.owner,
            targetLineId: item.targetLineId,
            instanceSeed: existing.instanceSeed,
            planningScopeId,
            changeInstanceId: existing.instanceId,
            oldAlias: item.name,
            minted: false,
          });
        } catch (error) {
          Object.assign(
            item,
            unresolved(
              'unrecordable-identity',
              `Repair the identity block in ${item.sourceRelative}/.openspec.yaml: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
          );
        }
        continue;
      }
      const instanceSeed = dependencies.mintInstanceSeed();
      const changeInstanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
      mintedIdentities.push({
        changeId: item.name,
        projectId: item.owner,
        targetLineId: item.targetLineId,
        instanceSeed,
        planningScopeId,
        changeInstanceId,
        oldAlias: item.name,
        minted: true,
      });
    }
  }

  // --- Optional tracked Issue plan inputs ----------------------------------
  // Project dispositions and their canonical Change identities are frozen
  // first.  Migration-only sourceChange selectors are then compiled away and
  // never enter an Issue revision or receipt-owned runtime lookup rule.
  const existingReferenceLines = await listTargetLineEntries(
    dependencies.referenceEvidence,
    storeRoot
  );
  const referenceLines = new Map<string, string>();
  for (const entry of existingReferenceLines) {
    if (entry.catalog !== null) {
      referenceLines.set(entry.targetLineId, entry.catalog.storeRef);
    }
  }
  for (const [targetLineId, catalog] of mapping?.targetLines ?? new Map()) {
    referenceLines.set(targetLineId, catalog.storeRef);
  }

  for (const item of items) {
    if (item.disposition?.kind !== 'store-issue') continue;
    const inputPath = item.disposition.planInput;
    if (inputPath === undefined) continue;
    const loaded = await loadMigrationPlanInput(dependencies, storeRoot, inputPath);
    const directCanonicalNodeIds = new Set<string>();
    const nodeInputs: ExecutionPlanNodeInput[] = loaded.nodes.map((node) => {
      if (node.kind === 'intent') return node;
      if (!('sourceChange' in node)) {
        directCanonicalNodeIds.add(node.nodeId);
        return node;
      }
      const selector = node.sourceChange;
      const claimants =
        mintedIdentities.filter((candidate) => candidate.oldAlias === selector);
      if (claimants.length !== 1) {
        throw new StoreError(
          `Plan input ${loaded.relative} sourceChange '${selector}' resolves to ${claimants.length} active project-change claimant(s) in this migration.`,
          'migration_plan_input_invalid',
          {
            target: loaded.relative,
            fix: 'Reference one exact active sourceChange planned as project-change.',
          }
        );
      }
      const identity = claimants[0]!;
      if (
        identity.projectId !== node.projectId ||
        identity.targetLineId !== node.targetLineId
      ) {
        throw new StoreError(
          `Plan input ${loaded.relative} node '${node.nodeId}' declares ${node.projectId}/${node.targetLineId}, but its Change is ${identity.projectId}/${identity.targetLineId}.`,
          'migration_plan_input_invalid',
          {
            target: loaded.relative,
            fix: 'Make the node projectId and targetLineId exactly match the planned Change identity.',
          }
        );
      }
      return {
        nodeId: node.nodeId,
        kind: 'change' as const,
        projectId: node.projectId,
        targetLineId: node.targetLineId,
        changeInstanceId: identity.changeInstanceId,
        changeAlias: identity.oldAlias,
        ...(node.dependsOn === undefined ? {} : { dependsOn: node.dependsOn }),
      };
    });
    const nodes = normalizePlanNodes(nodeInputs);
    const evidenceNodes = nodes.filter(
      node => node.kind === 'intent' || directCanonicalNodeIds.has(node.nodeId)
    );
    try {
      if (context.storeUid === undefined) {
        throw new Error('the Store has no permanent identity');
      }
      await verifyExecutionPlanReferences(dependencies.referenceEvidence, {
        registeredRoot: storeRoot,
        storeId: context.storeId,
        storeUid: context.storeUid,
        nodes: evidenceNodes,
        catalogs: {
          // The replay states its OWN eligibility set, from its own authority:
          // the migration's frozen member set is by construction the projects
          // whose planning content is migrating into this Store's planning
          // layout, so every member is declared planning-eligible here. The
          // plans being replayed were grandfathered under the rules of their
          // authoring day; retroactively tightening a REPLAY would block
          // v1→v2 migrations on exactly the role drift real stores exhibit
          // (a knowledge-only record that nonetheless carries planning
          // content). The gate stays one code path — the caller supplies the
          // roster, and on this roster the role branch cannot fire.
          projects: evidenceIndex.members.map(projectId => ({
            projectId,
            roles: { planning: true, knowledge: true },
          })),
          targetLines: [...referenceLines]
            .map(([targetLineId, storeRef]) => ({ targetLineId, storeRef }))
            .sort((left, right) => left.targetLineId.localeCompare(right.targetLineId)),
        },
        ...(input.globalDataDir === undefined
          ? {}
          : { globalDataDir: input.globalDataDir }),
      });
    } catch (error) {
      throw new StoreError(
        `Plan input ${loaded.relative} has unverifiable Store references: ${error instanceof Error ? error.message : String(error)}`,
        'migration_plan_input_invalid',
        {
          target: loaded.relative,
          fix: 'Repair unreadable, ambiguous, foreign, unresolved, or scope-conflicting references and re-plan.',
        }
      );
    }
    let compiled: ReturnType<typeof compileMigrationIssueTree>;
    try {
      compiled = compileMigrationIssueTree({
        issueId: item.disposition.issueId,
        title: item.disposition.title,
        state: item.disposition.state,
        reason: item.disposition.reason,
        createdAt,
        nodes,
      });
    } catch (error) {
      throw new StoreError(
        `Plan input ${loaded.relative} cannot compile: ${error instanceof Error ? error.message : String(error)}`,
        'migration_issue_compilation_failed',
        {
          target: loaded.relative,
          fix: 'Correct the node schema, canonical references, or dependency graph and re-plan.',
        }
      );
    }
    item.planInput = {
      path: loaded.path,
      relative: loaded.relative,
      digest: loaded.digest,
    };
    if (item.materialization?.kind === 'generated-tree') {
      item.materialization = {
        ...item.materialization,
        files: compiled.files,
      };
    }
  }

  // --- Digests for revalidation --------------------------------------------
  for (const item of items) {
    if (item.state.kind === 'blocked') continue;
    item.digest = (await digestTree(dependencies.fs, item.source)).digest;
  }

  const requiresV2 = items.some(
    (item) => item.disposition?.kind === 'store-issue'
  );
  if (requiresV2) {
    for (const item of items) {
      if (item.kind === 'change' || item.kind === 'archive-entry') {
        item.sourceLifecycle = item.kind === 'change' ? 'active-change' : 'archive-entry';
        item.disposition ??= {
          kind: 'project-change',
          nature: item.evidence.some((entry) => entry.class === 'E4-explicit-mapping')
            ? 'operator-asserted'
            : 'derived',
        };
      }
      if (item.materialization !== undefined || item.destination === undefined) continue;
      item.materialization =
        item.destination === item.source
          ? {
              kind: 'retain',
              destination: item.destination,
              destinationRelative: item.destinationRelative as string,
            }
          : {
              kind: 'copy-tree',
              destination: item.destination,
              destinationRelative: item.destinationRelative as string,
            };
    }
  }

  items.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      (left.owner ?? '').localeCompare(right.owner ?? '')
  );

  const frozenItems = items.map((item) => Object.freeze({ ...item }) as MigrationItem);
  const blockers = frozenItems.filter((item) => item.state.kind !== 'resolved');
  // Applicability is the item verdict and NOTHING else, because every other
  // precondition is now an item (see the token-precondition block above). A
  // plan with zero items and zero blockers is vacuously all-resolved, which is
  // exactly SS11.3's "apply only once every item is resolved". The old
  // `frozenItems.length > 0` conjunct instead dead-ended an empty legacy flat
  // Store: partition writes refused it for being legacy
  // (`legacy_flat_store_requires_migration`) and named the migration, while the
  // migration refused it for being empty. Its trivial migration publishes the
  // receipt and the layout declaration and nothing else. This does NOT weaken
  // the gate: an unresolved or blocked item still refuses exactly as before.
  const applicable = blockers.length === 0;

  const retirementSet = applicable
    ? [
        ...new Set([
          ...frozenItems
            .filter((item) => item.kind === 'spec' || item.kind === 'change' || item.kind === 'archive-entry')
            .map((item) => item.sourceRelative),
          ...(requiresV2 ? [] : [FLAT_RELATIVE.specs, FLAT_RELATIVE.changes]),
          ...(inventory.hasAdoptionsManifest ? [FLAT_RELATIVE.adoptionsManifest] : []),
        ]),
      ].sort()
    : [];

  const otherFlatRefs: SurveyedRef[] = inventory.refs.filter(
    (ref) => ref.classification === 'flat' && !ref.checkedOut && ref.kind === 'local-branch'
  );

  const body = {
    schemaVersion: requiresV2 ? 2 : MIGRATION_PLAN_SCHEMA_VERSION,
    ...(requiresV2 ? { mappingVersion: mapping?.version ?? 2 } : {}),
    storeId: context.storeId,
    ...(context.storeUid === undefined ? {} : { storeUid: context.storeUid }),
    storeRoot,
    ...(inventory.checkedOutRef === undefined ? {} : { ref: inventory.checkedOutRef }),
    ...(inventory.headOid === undefined ? {} : { headOid: inventory.headOid }),
    inventoryFingerprint: inventory.fingerprint,
    createdAt,
    items: frozenItems,
    catalogUpgrades,
    targetLineCatalogs,
    mintedIdentities,
    sharedSpecResolutions,
    retainedDesignDocs,
    retirementSet,
    otherFlatRefs,
    ...(mapping === undefined
      ? {}
      : { mappingPath: mapping.path, mappingDigest: mapping.digest }),
    ...(input.defaultTargetLine === undefined
      ? {}
      : { defaultTargetLine: input.defaultTargetLine }),
    includeUntracked: input.includeUntracked,
    applicable,
    blockers,
  };

  const planId = canonicalPlanId(body);
  // The three conjuncts after `applicable` are TYPE NARROWING only: each fact
  // they test is a reported blocker above, so an applicable plan has all three.
  const token: MigrationPlanToken | undefined =
    applicable && context.storeUid !== undefined && body.ref !== undefined && body.headOid !== undefined
      ? {
          planId,
          storeUid: context.storeUid,
          ref: body.ref,
          headOid: body.headOid,
          inventoryFingerprint: inventory.fingerprint,
        }
      : undefined;

  // The invariant that makes "applicable" trustworthy, asserted rather than
  // assumed. Reporting a plan as applicable while minting no token is precisely
  // the defect this change closed: the preview said "Ready to apply" and
  // `--apply` refused with no diagnostic. A precondition added to the token
  // without a matching blocker above lands here loudly instead of shipping the
  // same silence again.
  if (applicable && token === undefined) {
    throw new StoreError(
      'A migration plan reported itself applicable but minted no apply token, so an apply-token precondition is not reported as a blocker.',
      'migration_plan_gate_desync',
      {
        target: 'migration.plan',
        fix: 'This is a defect in the migration planner: every apply-token precondition must also be a reported blocked item.',
      }
    );
  }

  return Object.freeze({
    planId,
    ...body,
    ...(token === undefined ? {} : { token }),
  }) as ImmutableMigrationPlan;
}

/**
 * `planId = sha256(canonicalBytes(plan))` over everything except the id and the
 * token, which are derived FROM it. `createdAt` participates, so two plans with
 * the same content and the same clock are byte-identical.
 */
export function canonicalPlanId(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
}

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const EvidenceSchema = z
  .object({
    class: z.enum([
      'E1-recorded-identity',
      'E2-store-records',
      'E3-association',
      'E4-explicit-mapping',
      'spec-provenance',
    ]),
    source: z.string(),
    projectId: z.string(),
    nature: z.enum(['derived', 'asserted']),
    detail: z.string().optional(),
  })
  .strict();
const ItemStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resolved') }).strict(),
  z
    .object({
      kind: z.literal('unresolved'),
      reason: z.enum([
        'unknown-owner',
        'evidence-conflict',
        'shared-spec',
        'non-member-owner',
        'unrecordable-identity',
        'missing-target-line',
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('blocked'),
      reason: z.enum([
        'destination-exists',
        'mixed-layout',
        'store-identity-missing',
        'unrecordable-catalog-field',
        'target-line-catalog-conflict',
        'dirty-source',
        'ref-not-checked-out',
        'ref-unborn',
      ]),
    })
    .strict(),
]);
const CommonItemShape = {
  kind: z.enum([
    'spec',
    'change',
    'archive-entry',
    'design-doc',
    'membership-record',
    'adoptions-manifest',
    'store-metadata',
  ]),
  name: z.string(),
  source: z.string(),
  sourceRelative: z.string(),
  state: ItemStateSchema,
  reason: z.string(),
  repair: z.string(),
  owner: z.string().optional(),
  destination: z.string().optional(),
  destinationRelative: z.string().optional(),
  targetLineId: z.string().optional(),
  evidence: z.array(EvidenceSchema),
  supersededEvidence: z.array(EvidenceSchema),
  contributors: z.array(z.string()).optional(),
  digest: DigestSchema.optional(),
  untracked: z.array(z.string()).optional(),
};
const MigrationItemV1Schema = z.object(CommonItemShape).strict();
const DispositionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('project-change'),
      nature: z.enum(['derived', 'operator-asserted']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('store-issue'),
      nature: z.literal('operator-asserted'),
      issueId: z.string(),
      title: z.string(),
      state: z.enum(['open', 'resolved', 'dropped']),
      reason: z.string().nullable(),
      planInput: z.string().optional(),
    })
    .strict(),
]);
const GeneratedFileSchema = z
  .object({
    role: z.enum(['issue-record', 'execution-plan']),
    relativePath: z.string(),
    content: z.string(),
    digest: DigestSchema,
  })
  .strict();
const MaterializationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('copy-tree'),
      destination: z.string(),
      destinationRelative: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('generated-tree'),
      role: z.literal('store-issue'),
      destination: z.string(),
      destinationRelative: z.string(),
      files: z.array(GeneratedFileSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal('retain'),
      destination: z.string(),
      destinationRelative: z.string(),
    })
    .strict(),
]);
const MigrationItemV2Schema = z
  .object({
    ...CommonItemShape,
    sourceLifecycle: z.enum(['active-change', 'archive-entry']).optional(),
    disposition: DispositionSchema.optional(),
    materialization: MaterializationSchema.optional(),
    planInput: z
      .object({ path: z.string(), relative: z.string(), digest: DigestSchema })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.state.kind === 'resolved' &&
      item.destination !== undefined &&
      item.materialization === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'resolved schema-v2 destination requires explicit materialization',
      });
    }
    if (item.disposition?.kind === 'store-issue') {
      if (item.materialization?.kind !== 'generated-tree') {
        context.addIssue({
          code: 'custom',
          path: ['materialization'],
          message: 'store-issue disposition requires generated-tree materialization',
        });
      }
      if (item.owner !== undefined || item.targetLineId !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['disposition'],
          message: 'store-issue disposition cannot carry project ownership or target line',
        });
      }
    }
    if (
      item.materialization?.kind === 'generated-tree' &&
      (item.disposition?.kind !== 'store-issue' || item.sourceLifecycle === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materialization'],
        message: 'generated-tree requires store-issue disposition and source lifecycle',
      });
    }
    if (item.materialization !== undefined) {
      if (
        item.destination !== item.materialization.destination ||
        item.destinationRelative !== item.materialization.destinationRelative
      ) {
        context.addIssue({
          code: 'custom',
          path: ['materialization'],
          message: 'materialization destination must equal the item destination',
        });
      }
    }
    if (item.materialization?.kind === 'generated-tree') {
      const files = item.materialization.files;
      const issueRecords = files.filter(file => file.role === 'issue-record');
      const plans = files.filter(file => file.role === 'execution-plan');
      const paths = files.map(file => file.relativePath);
      if (
        issueRecords.length !== 1 ||
        issueRecords[0]?.relativePath !== 'issue.yaml' ||
        plans.length > 1 ||
        plans.some(file => file.relativePath !== 'plans/0001.yaml') ||
        new Set(paths).size !== paths.length ||
        paths.some(relative => {
          const normalized = relative.split('\\').join('/');
          return (
            normalized.startsWith('/') ||
            normalized === '..' ||
            normalized.startsWith('../') ||
            normalized.includes('/../')
          );
        })
      ) {
        context.addIssue({
          code: 'custom',
          path: ['materialization', 'files'],
          message: 'generated-tree must contain exact issue.yaml and optional plans/0001.yaml inventory',
        });
      }
    }
  });
const CatalogUpgradeSchema = z
  .object({
    projectId: z.string(),
    recordPath: z.string(),
    recordRelative: z.string(),
    sourceDigest: DigestSchema,
    catalogYaml: z.string(),
    droppedAdoption: z
      .object({
        specs: z.array(z.string()),
        changes: z.array(z.string()),
        adoptedAt: z.string(),
      })
      .strict()
      .optional(),
    binding: z.enum(['bound', 'unbound']),
  })
  .strict();
const TargetLineCatalogSchema = z
  .object({
    targetLineId: z.string(),
    destination: z.string(),
    destinationRelative: z.string(),
    catalogYaml: z.string(),
  })
  .strict();
const MintedIdentitySchema = z
  .object({
    changeId: z.string(),
    projectId: z.string(),
    targetLineId: z.string(),
    instanceSeed: z.string(),
    planningScopeId: z.string(),
    changeInstanceId: z.string(),
    oldAlias: z.string(),
    minted: z.boolean(),
  })
  .strict();
const SharedSpecResolutionSchema = z
  .object({
    capability: z.string(),
    mode: z.enum(['owner', 'split']),
    projects: z.array(z.string()),
    contributors: z.array(z.string()),
  })
  .strict();
const RetainedDesignDocSchema = z
  .object({ name: z.string(), path: z.string(), relative: z.string() })
  .strict();
const SurveyedRefSchema = z
  .object({
    ref: z.string(),
    kind: z.enum(['local-branch', 'remote-tracking', 'other']),
    classification: z.enum(['layout-v2', 'flat', 'no-store-metadata', 'unreadable']),
    checkedOut: z.boolean(),
    notCandidateReason: z.string().optional(),
    migrateFrom: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
const TokenSchema = z
  .object({
    planId: DigestSchema,
    storeUid: z.string(),
    ref: z.string(),
    headOid: z.string(),
    inventoryFingerprint: DigestSchema,
  })
  .strict();
const CommonPlanShape = {
  planId: DigestSchema,
  storeId: z.string(),
  storeUid: z.string().optional(),
  storeRoot: z.string(),
  ref: z.string().optional(),
  headOid: z.string().optional(),
  inventoryFingerprint: DigestSchema,
  createdAt: z.string(),
  catalogUpgrades: z.array(CatalogUpgradeSchema),
  targetLineCatalogs: z.array(TargetLineCatalogSchema),
  mintedIdentities: z.array(MintedIdentitySchema),
  sharedSpecResolutions: z.array(SharedSpecResolutionSchema),
  retainedDesignDocs: z.array(RetainedDesignDocSchema),
  retirementSet: z.array(z.string()),
  otherFlatRefs: z.array(SurveyedRefSchema),
  mappingPath: z.string().optional(),
  mappingDigest: DigestSchema.optional(),
  defaultTargetLine: z.string().optional(),
  includeUntracked: z.boolean(),
  applicable: z.boolean(),
  token: TokenSchema.optional(),
};
const ImmutableMigrationPlanV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...CommonPlanShape,
    items: z.array(MigrationItemV1Schema),
    blockers: z.array(MigrationItemV1Schema),
  })
  .strict();
const ImmutableMigrationPlanV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    mappingVersion: z.literal(2),
    ...CommonPlanShape,
    items: z.array(MigrationItemV2Schema),
    blockers: z.array(MigrationItemV2Schema),
  })
  .strict();

function invalidStoredPlan(message: string): StoreError {
  return new StoreError(message, 'migration_plan_stale', {
    target: 'migration.plan',
    fix: 'Do not edit stored plan bytes; re-run the plan.',
  });
}

/** Strict version dispatch for machine-local immutable plans. */
export function readImmutableMigrationPlan(value: unknown): ImmutableMigrationPlan {
  if (typeof value !== 'object' || value === null) {
    throw new StoreError('Stored migration plan is not an object.', 'migration_plan_stale', {
      target: 'migration.plan',
      fix: 'Re-run the plan.',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2) {
    throw new StoreError(
      `Stored migration plan declares unsupported schemaVersion '${String(candidate.schemaVersion)}'.`,
      'migration_plan_stale',
      { target: 'migration.plan', fix: 'Re-run the plan with this Rasen version.' }
    );
  }
  const parsed =
    candidate.schemaVersion === 1
      ? ImmutableMigrationPlanV1Schema.safeParse(value)
      : ImmutableMigrationPlanV2Schema.safeParse(value);
  if (!parsed.success) {
    throw invalidStoredPlan(
      `Stored migration plan does not match its closed schema v${candidate.schemaVersion}: ${formatZodIssues(parsed.error)}`
    );
  }
  const { planId, token: _token, ...body } = candidate;
  if (canonicalPlanId(body) !== planId) {
    throw new StoreError(
      'Stored migration plan canonical body does not match its planId.',
      'migration_plan_stale',
      { target: 'migration.plan', fix: 'Re-run the plan; stored plans are immutable.' }
    );
  }
  const plan = parsed.data;
  if (
    plan.token !== undefined &&
    (plan.token.planId !== plan.planId ||
      plan.token.storeUid !== plan.storeUid ||
      plan.token.ref !== plan.ref ||
      plan.token.headOid !== plan.headOid ||
      plan.token.inventoryFingerprint !== plan.inventoryFingerprint)
  ) {
    throw invalidStoredPlan('Stored migration plan token disagrees with its canonical plan body.');
  }
  return value as ImmutableMigrationPlan;
}

function underPath(candidate: string, ancestor: string): boolean {
  const normalizedCandidate = candidate.split('\\').join('/');
  const normalizedAncestor = ancestor.split('\\').join('/');
  return (
    normalizedCandidate === normalizedAncestor ||
    normalizedCandidate.startsWith(`${normalizedAncestor}/`)
  );
}

async function collectDirtySources(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string
): Promise<{ tracked: string[]; untracked: string[]; ignored: string[] }> {
  const entries = await dependencies.git.status(storeRoot, [
    FLAT_RELATIVE.planning,
    FLAT_RELATIVE.storeMetadata,
    FLAT_RELATIVE.projectRecords,
    FLAT_RELATIVE.adoptionsManifest,
  ]);
  const tracked: string[] = [];
  const untracked: string[] = [];
  const ignored: string[] = [];
  for (const entry of entries) {
    if (entry.status === 'untracked') untracked.push(entry.path);
    else if (entry.status === 'ignored') ignored.push(entry.path);
    else tracked.push(entry.path);
  }
  return {
    tracked: [...new Set(tracked)].sort(),
    untracked: [...new Set(untracked)].sort(),
    ignored: [...new Set(ignored)].sort(),
  };
}

function safeLayoutPath(
  storeRoot: string,
  address: Parameters<typeof resolveStorePlanningLayoutV2Path>[1],
  flavor: StorePlanningPathFlavor
): string | null {
  try {
    return resolveStorePlanningLayoutV2Path(storeRoot, address, flavor);
  } catch {
    return null;
  }
}

/**
 * A legacy Archive entry keeps its EXISTING directory name. The v2 entry-name
 * form bakes an instance digest into the name, and no legacy entry has a
 * verified instance identity to put there.
 */
function archiveEntryDestination(
  storeRoot: string,
  projectId: string,
  targetLineId: string,
  entryName: string,
  flavor: StorePlanningPathFlavor
): string | null {
  const line = safeLayoutPath(storeRoot, { kind: 'archive-line', projectId, targetLineId }, flavor);
  return line === null ? null : path.join(line, entryName);
}

function collectDeclaredLines(items: readonly DraftItem[]): readonly string[] {
  return [...new Set(items.map((item) => item.targetLineId).filter((id): id is string => id !== undefined))];
}

async function existingTargetLineIds(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  flavor: StorePlanningPathFlavor,
  candidates: readonly string[]
): Promise<readonly string[]> {
  const found: string[] = [];
  for (const targetLineId of candidates) {
    const location = safeLayoutPath(storeRoot, { kind: 'target-line-catalog', targetLineId }, flavor);
    if (location === null) continue;
    if ((await dependencies.fs.statKind(location)) === 'file') found.push(targetLineId);
  }
  return found;
}

async function readExistingIdentity(
  dependencies: StoreLayoutMigrationDependencies,
  changeDir: string
): Promise<{ instanceSeed: string; instanceId: string } | null> {
  const text = await dependencies.fs.readText(path.join(changeDir, '.openspec.yaml'));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return null;
  }
  const identity = (parsed as { identity?: Record<string, unknown> } | null)?.identity;
  if (identity === undefined) return null;
  const instanceSeed = identity.instanceSeed;
  const instanceId = identity.instanceId;
  if (typeof instanceSeed !== 'string' || typeof instanceId !== 'string') return null;
  return { instanceSeed, instanceId };
}

interface SpecOwnerResolution {
  readonly state: 'assigned' | 'unresolved';
  readonly projects: readonly string[];
  readonly reason: UnresolvedReason;
  readonly evidence: OwnershipEvidence[];
  /** A declaration derived evidence outranked. Empty in every other case. */
  readonly superseded: OwnershipEvidence[];
}

/**
 * Who owns a capability, with the same precedence the Change and Archive arms
 * use: derived evidence first, the mapping file only where derived evidence
 * left the item UNRESOLVED.
 *
 * Design D4 — "the mapping file is an operator statement about unknowns, not a
 * licence to relabel recorded history". Returning on the declaration first made
 * specs the one item kind where a stale mapping entry silently relabelled a
 * capability provenance had already assigned, and recorded the disagreement
 * nowhere: `supersededEvidence` was hard-coded empty and `sharedSpecResolutions`
 * only fires for a multi-contributor capability. The identical entry against a
 * Change was, and is, ignored.
 */
function resolveSpecOwners(
  capability: string,
  graph: CapabilityProvenance | undefined,
  declaration: { mode: 'owner' | 'split'; projects: readonly string[] } | undefined,
  directEvidence: readonly OwnershipEvidence[],
  index: CollectedEvidence
): SpecOwnerResolution {
  const assertEvidence = (projects: readonly string[], mappingSource: string): OwnershipEvidence[] =>
    projects.map((projectId) => ({
      class: 'E4-explicit-mapping' as const,
      source: mappingSource,
      projectId,
      nature: 'asserted' as const,
      detail: `operator resolution for capability '${capability}'`,
    }));

  const derived = deriveSpecOwners(capability, graph, directEvidence, index);

  if (derived.state === 'assigned') {
    const agrees =
      declaration !== undefined &&
      declaration.projects.length === derived.projects.length &&
      declaration.projects.every((projectId) => derived.projects.includes(projectId));
    return {
      ...derived,
      // The receipt is the durable explanation of the migration, so an
      // operator assertion that lost to derived evidence has to survive into
      // it rather than vanish.
      superseded:
        declaration === undefined || agrees ? [] : assertEvidence(declaration.projects, 'mapping'),
    };
  }

  if (declaration !== undefined) {
    return {
      state: 'assigned',
      projects: declaration.projects,
      reason: 'unknown-owner',
      evidence: assertEvidence(declaration.projects, 'mapping'),
      superseded: [],
    };
  }

  return derived;
}

function deriveSpecOwners(
  capability: string,
  graph: CapabilityProvenance | undefined,
  directEvidence: readonly OwnershipEvidence[],
  index: CollectedEvidence
): SpecOwnerResolution {
  const unresolvedBy = (reason: UnresolvedReason): SpecOwnerResolution => ({
    state: 'unresolved',
    projects: [],
    reason,
    evidence: [],
    superseded: [],
  });

  if (graph !== undefined) {
    if (graph.hasUnknownContributor) return unresolvedBy('unknown-owner');
    if (graph.contributors.length > 1) return unresolvedBy('shared-spec');
    if (graph.contributors.length === 1) {
      const owner = graph.contributors[0] as string;
      if (!isProjectId(owner)) return unresolvedBy('unrecordable-identity');
      if (!index.members.includes(owner)) return unresolvedBy('non-member-owner');
      return {
        state: 'assigned',
        projects: [owner],
        reason: 'unknown-owner',
        evidence: [
          {
            class: 'spec-provenance',
            source: `provenance:${capability}`,
            projectId: owner,
            nature: 'derived',
            detail: `single contributing project across ${graph.edges.length} delta(s)`,
          },
        ],
        superseded: [],
      };
    }
  }

  const decision = reduceOwnership(directEvidence, index.members);
  if (decision.owner !== undefined) {
    return {
      state: 'assigned',
      projects: [decision.owner],
      reason: 'unknown-owner',
      evidence: [...decision.evidence],
      superseded: [],
    };
  }
  return unresolvedBy(decision.reason ?? 'unknown-owner');
}

/** The refusal `apply` raises when a plan is not applicable. */
export function planGateError(plan: ImmutableMigrationPlan): StoreError {
  const lines = plan.blockers.map(
    (item) =>
      `${item.sourceRelative} [${migrationItemStateLabel(item.state)}] ${item.reason}${
        item.repair.length > 0 ? ` — ${item.repair}` : ''
      }`
  );
  // The mapping file resolves UNRESOLVED ownership. It cannot clear a blocked
  // item, and the Store-identity block is blocked, so a plan held up only by
  // that one used to be answered with 'the mapping file is the only escape
  // hatch' — which is exactly the kind of repair-that-does-not-work this
  // change exists to remove.
  const mappingResolvable = plan.blockers.every((item) => item.state.kind === 'unresolved');
  return new StoreError(
    `Migration cannot apply while ${plan.blockers.length} item(s) are unresolved or blocked:\n  - ${lines.join('\n  - ')}`,
    'migration_plan_blocked',
    {
      target: 'migration.plan',
      fix: mappingResolvable
        ? `Resolve every listed item — the mapping file is the only escape hatch; there is no --force and no partial migration.`
        : `Follow the repair named for each listed item; there is no --force and no partial migration. The mapping file resolves unresolved ownership only, never a blocked item.`,
    }
  );
}
