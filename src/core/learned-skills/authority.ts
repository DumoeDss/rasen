/**
 * Authoritative source and membership facts for store/global publication.
 * Candidate identities are locators only; managed canonical records and live
 * typed registry facts supply authority.
 */
import { FileSystemUtils } from '../../utils/file-system.js';
import { readProjectConfig } from '../project-config.js';
import { assembleReferenceIndex } from '../references.js';
import { resolveLearnedSkillExecutionContext } from './context.js';
import { digestContent, readCanonicalRecord, serializeManifest } from './catalog.js';
import { learnedSkillDir, resolveCanonicalStore } from './stores.js';
import type {
  LearnedSkillContext,
  NormalizedEvidenceReference,
  PromotionSourceLocator,
  PromotionSourceSnapshot,
} from './types.js';

export interface StoreMemberProject {
  owner: { type: 'project'; id: string };
  root: string;
}

export interface StoreMemberQuery {
  store: { type: 'store'; id: string; root: string };
  members: StoreMemberProject[];
  diagnostics: Array<{ code: string; message: string }>;
}

function globalDataDir(context: LearnedSkillContext): string | undefined {
  return context.execution?.globalDataDir ?? context.globalDataDir;
}

/** One-level typed project membership only; unprefixed/store references never qualify. */
export async function queryStoreMemberProjects(
  context: LearnedSkillContext
): Promise<StoreMemberQuery> {
  const resolution = await resolveCanonicalStore('store', context);
  if (!resolution.ok || resolution.store.owner.type !== 'store') {
    throw new Error(resolution.ok ? 'Store owner resolution failed.' : resolution.message);
  }
  const store = resolution.store;
  const storeOwner = store.owner as { type: 'store'; id: string };
  const references = readProjectConfig(store.root)?.references ?? [];
  const index = await assembleReferenceIndex({
    references,
    resolvedRoot: {
      path: store.root,
      changesDir: FileSystemUtils.joinPath(store.root, 'rasen', 'changes'),
      specsDir: FileSystemUtils.joinPath(store.root, 'rasen', 'specs'),
      archiveDir: FileSystemUtils.joinPath(store.root, 'rasen', 'changes', 'archive'),
      defaultSchema: 'spec-driven',
      source: 'store',
      storeId: storeOwner.id,
      storeType: 'store',
    },
    includeSpecs: false,
    ...(globalDataDir(context) ? { globalDataDir: globalDataDir(context) } : {}),
  });
  const members = new Map<string, StoreMemberProject>();
  const diagnostics: StoreMemberQuery['diagnostics'] = [];
  for (const entry of index) {
    if (entry.type !== 'project') continue;
    if (entry.root) {
      try {
        const execution = await resolveLearnedSkillExecutionContext({
          launchDirectory: store.root,
          selector: { project: entry.store_id },
          requestedScope: 'project',
          ...(globalDataDir(context) ? { globalDataDir: globalDataDir(context) } : {}),
        });
        if (execution.owner.type === 'project') {
          members.set(execution.owner.id, {
            owner: { type: 'project', id: execution.owner.id },
            root: execution.owner.root,
          });
        }
      } catch (error) {
        diagnostics.push({
          code: 'reference_project_identity_unhealthy',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const diagnostic of entry.status) {
      diagnostics.push({ code: diagnostic.code, message: diagnostic.message });
    }
  }
  return {
    store: { type: 'store', id: storeOwner.id, root: store.root },
    members: [...members.values()].sort((left, right) =>
      left.owner.id.localeCompare(right.owner.id)
    ),
    diagnostics,
  };
}

export interface ResolvedPromotionSources {
  snapshots: PromotionSourceSnapshot[];
  evidence: NormalizedEvidenceReference[];
}

/** Resolves exact active managed source records and verifies identity/key/digest. */
export async function resolvePromotionSources(
  locators: readonly PromotionSourceLocator[],
  targetKnowledgeKey: string,
  context: LearnedSkillContext
): Promise<ResolvedPromotionSources> {
  const snapshots: PromotionSourceSnapshot[] = [];
  const evidence: NormalizedEvidenceReference[] = [];
  for (const locator of locators) {
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory:
        context.execution?.owner.type === 'project' ||
        context.execution?.owner.type === 'store'
          ? context.execution.owner.root
          : process.cwd(),
      selector:
        locator.owner.type === 'project'
          ? { project: locator.owner.id }
          : { store: locator.owner.id },
      requestedScope: locator.owner.type,
      ...(globalDataDir(context) ? { globalDataDir: globalDataDir(context) } : {}),
    });
    const sourceContext: LearnedSkillContext = {
      execution,
      ...(globalDataDir(context) ? { globalDataDir: globalDataDir(context) } : {}),
    };
    const resolution = await resolveCanonicalStore(locator.owner.type, sourceContext);
    if (!resolution.ok) {
      throw new Error(
        `source ${locator.owner.type}:${locator.owner.id}/${locator.id} is unavailable: ${resolution.message}`
      );
    }
    const read = readCanonicalRecord(
      learnedSkillDir(resolution.store, locator.id),
      locator.owner.type,
      resolution.store.owner
    );
    if (read.kind !== 'managed') {
      const reason = read.kind === 'absent' ? 'record not found' : read.reason;
      throw new Error(
        `source ${locator.owner.type}:${locator.owner.id}/${locator.id} is ineligible: ${reason}`
      );
    }
    const record = read.record;
    if (record.manifest.status !== 'active') {
      throw new Error(
        `source ${locator.owner.type}:${locator.owner.id}/${locator.id} is retired`
      );
    }
    if (record.manifest.knowledgeKey !== locator.knowledgeKey) {
      throw new Error(
        `source ${locator.owner.type}:${locator.owner.id}/${locator.id} has knowledge key "${record.manifest.knowledgeKey}", expected "${locator.knowledgeKey}"`
      );
    }
    if (record.manifest.knowledgeKey !== targetKnowledgeKey) {
      throw new Error(
        `source ${record.identity.owner.type}:${record.identity.owner.type === 'global' ? '' : record.identity.owner.id + '/'}${record.identity.id} has knowledge key "${record.manifest.knowledgeKey}", which does not match promotion target key "${targetKnowledgeKey}"`
      );
    }
    if (record.identity.owner.type === 'global') {
      throw new Error('global learned skills cannot be promotion sources');
    }
    const canonicalLocator: PromotionSourceLocator = {
      owner: {
        type: record.identity.owner.type,
        id: record.identity.owner.id,
      },
      id: record.identity.id,
      knowledgeKey: record.manifest.knowledgeKey,
    };
    snapshots.push({
      locator: canonicalLocator,
      identity: record.identity,
      contentDigest: record.manifest.contentDigest,
      manifestDigest: digestContent(serializeManifest(record.manifest)),
      updatedAt: record.manifest.updatedAt,
    });
    evidence.push(...record.evidence);
  }
  return { snapshots, evidence };
}

export function promotionSnapshotsEqual(
  expected: readonly PromotionSourceSnapshot[],
  actual: readonly PromotionSourceSnapshot[]
): boolean {
  if (expected.length !== actual.length) return false;
  return expected.every((left, index) => {
    const right = actual[index];
    return (
      right !== undefined &&
      left.identity.owner.type === right.identity.owner.type &&
      (left.identity.owner.type === 'global' ||
        (right.identity.owner.type !== 'global' &&
          left.identity.owner.id === right.identity.owner.id)) &&
      left.identity.id === right.identity.id &&
      left.contentDigest === right.contentDigest &&
      left.manifestDigest === right.manifestDigest &&
      left.updatedAt === right.updatedAt
    );
  });
}
