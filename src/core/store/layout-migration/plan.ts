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

import { canonicalJson } from '../../canonical-json.js';
import { StoreError } from '../errors.js';
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
import { isProjectId, isTargetLineId } from '../planning-validation.js';
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
  'unrecordable-identity': 'the named project id fails the v2 portable identifier contract',
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
}

function unresolved(reason: UnresolvedReason, repair: string): Pick<DraftItem, 'state' | 'reason' | 'repair'> {
  return { state: { kind: 'unresolved', reason }, reason: UNRESOLVED_TEXT[reason], repair };
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

      let owner = decision.owner;
      const chain: OwnershipEvidence[] = [...decision.evidence];
      if (declaration !== undefined && decision.reason !== undefined) {
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
        Object.assign(
          draft,
          unresolved(
            reason,
            `Declare ${kind === 'change' ? 'changes' : 'archive'}.${name}.project in the mapping file.`
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
        declaration?.targetLine,
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
        Object.assign(
          draft,
          unresolved(
            'unrecordable-identity',
            `Rename the item or declare a portable owner in the mapping file; migration never sanitizes an id.`
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
    for (const item of items) {
      if (item.kind !== 'change' || item.state.kind === 'blocked') continue;
      Object.assign(
        item,
        blocked(
          'store-identity-missing',
          `Run 'rasen store upgrade-identity ${context.storeId} --apply' first.`
        )
      );
    }
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
    if (untracked.length > 0) {
      item.untracked = untracked;
      if (!input.includeUntracked) {
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

  // --- Digests for revalidation --------------------------------------------
  for (const item of items) {
    if (item.state.kind === 'blocked') continue;
    item.digest = (await digestTree(dependencies.fs, item.source)).digest;
  }

  items.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.name.localeCompare(right.name) ||
      (left.owner ?? '').localeCompare(right.owner ?? '')
  );

  const frozenItems = items.map((item) => Object.freeze({ ...item }) as MigrationItem);
  const blockers = frozenItems.filter((item) => item.state.kind !== 'resolved');
  const applicable = blockers.length === 0 && frozenItems.length > 0;

  const retirementSet = applicable
    ? [
        ...new Set([
          ...frozenItems
            .filter((item) => item.kind === 'spec' || item.kind === 'change' || item.kind === 'archive-entry')
            .map((item) => item.sourceRelative),
          FLAT_RELATIVE.specs,
          FLAT_RELATIVE.changes,
          ...(inventory.hasAdoptionsManifest ? [FLAT_RELATIVE.adoptionsManifest] : []),
        ]),
      ].sort()
    : [];

  const otherFlatRefs: SurveyedRef[] = inventory.refs.filter(
    (ref) => ref.classification === 'flat' && !ref.checkedOut && ref.kind === 'local-branch'
  );

  const body = {
    schemaVersion: MIGRATION_PLAN_SCHEMA_VERSION,
    storeId: context.storeId,
    ...(context.storeUid === undefined ? {} : { storeUid: context.storeUid }),
    storeRoot,
    ...(inventory.checkedOutRef === undefined ? {} : { ref: inventory.checkedOutRef }),
    ...(inventory.headOid === undefined ? {} : { headOid: inventory.headOid }),
    inventoryFingerprint: inventory.fingerprint,
    createdAt: dependencies.now().toISOString(),
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
): Promise<{ tracked: string[]; untracked: string[] }> {
  const entries = await dependencies.git.status(storeRoot, [
    FLAT_RELATIVE.planning,
    FLAT_RELATIVE.storeMetadata,
    FLAT_RELATIVE.projectRecords,
    FLAT_RELATIVE.adoptionsManifest,
  ]);
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const entry of entries) {
    if (entry.status === 'untracked') untracked.push(entry.path);
    else tracked.push(entry.path);
  }
  return { tracked: [...new Set(tracked)].sort(), untracked: [...new Set(untracked)].sort() };
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
  return new StoreError(
    plan.blockers.length === 0
      ? 'There is nothing to migrate: no flat planning content was inventoried for this ref.'
      : `Migration cannot apply while ${plan.blockers.length} item(s) are unresolved or blocked:\n  - ${lines.join('\n  - ')}`,
    'migration_plan_blocked',
    {
      target: 'migration.plan',
      fix: 'Resolve every listed item — the mapping file is the only escape hatch; there is no --force and no partial migration.',
    }
  );
}
