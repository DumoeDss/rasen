/**
 * The two caller-facing write operations (design D4): `planLearnedSkillMutation`
 * validates and computes a deterministic plan (identity, ownership, budgets,
 * cross-project gate) without touching disk; `commitLearnedSkillPlan` executes
 * an unblocked plan under a per-registry lock with private staging, digest
 * re-verification, atomic replacement, and rollback. Persistence authority
 * stays in deterministic TypeScript, never in stochastic skill instructions.
 */

import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { acquireFileLock, releaseFileLock, writeFileAtomically } from '../file-state.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import {
  buildCanonicalContent,
  buildManifest,
  dedupeEvidence,
  digestContent,
  distinctProjectIds,
  evidenceTupleKey,
  readCanonicalRecord,
  serializeManifest,
} from './catalog.js';
import {
  LEARNED_SKILL_CONTENT_BUDGET,
  LEARNED_SKILL_CONTEXT_BUDGET,
  LEARNED_SKILL_GLOBAL_PROMOTION_MIN_PROJECTS,
} from './constants.js';
import { checkLearnedSkillId, learnedSkillIdCollisionKey } from './id.js';
import { validateApplicability } from './applicability.js';
import {
  learnedSkillDir,
  probeStoreWritable,
  resolveGlobalStore,
  resolveProjectStore,
  type ResolvedStore,
} from './stores.js';
import type {
  Applicability,
  EvidenceReference,
  LearnedSkillBlock,
  LearnedSkillContext,
  LearnedSkillManifest,
  LearnedSkillMutationRequest,
  LearnedSkillPlan,
  LearnedSkillResult,
  LearnedSkillScope,
} from './types.js';

const bytes = (value: string): number => Buffer.byteLength(value, 'utf8');

function blockedPlan(scope: LearnedSkillScope, id: string, block: LearnedSkillBlock): LearnedSkillPlan {
  return {
    action: 'blocked',
    scope,
    id,
    requiresGlobalApproval: false,
    block,
    summary: `blocked: ${block.message}`,
  };
}

async function resolveStore(
  scope: LearnedSkillScope,
  context: LearnedSkillContext
): Promise<{ ok: true; store: ResolvedStore } | { ok: false; block: LearnedSkillBlock }> {
  if (scope === 'global') return { ok: true, store: resolveGlobalStore(context) };
  const resolution = await resolveProjectStore(context);
  if (!resolution.ok) {
    return { ok: false, block: { code: 'unregistered_project', message: resolution.message } };
  }
  return { ok: true, store: resolution.store };
}

function evidenceEqual(left: readonly EvidenceReference[], right: readonly EvidenceReference[]): boolean {
  if (left.length !== right.length) return false;
  const rightKeys = new Set(right.map(evidenceTupleKey));
  return left.every((entry) => rightKeys.has(evidenceTupleKey(entry)));
}

function applicabilityEqual(left: Applicability, right: Applicability): boolean {
  return (
    left.mode === right.mode &&
    left.markers.length === right.markers.length &&
    left.markers.every((marker, index) => marker === right.markers[index])
  );
}

interface WriteContent {
  id: string;
  knowledgeKey: string;
  description: string;
  instructions: string;
  applicability: Applicability;
  evidence: EvidenceReference[];
}

async function planWrite(
  scope: LearnedSkillScope,
  content: WriteContent,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const isGlobal = scope === 'global';

  const idCheck = checkLearnedSkillId(content.id);
  if (!idCheck.valid) {
    return blockedPlan(scope, content.id, {
      code: 'invalid_id',
      message: `invalid learned-skill id "${content.id}": ${idCheck.violations.join('; ')}`,
    });
  }

  const applicabilityCheck = validateApplicability(content.applicability);
  if (!applicabilityCheck.valid || !applicabilityCheck.normalized) {
    return blockedPlan(scope, content.id, {
      code: 'invalid_applicability',
      message: `invalid applicability: ${applicabilityCheck.violations.join('; ')}`,
    });
  }
  const applicability = applicabilityCheck.normalized;

  const contentBytes = bytes(content.description) + bytes(content.instructions);
  if (contentBytes > LEARNED_SKILL_CONTENT_BUDGET) {
    return blockedPlan(scope, content.id, {
      code: 'content_budget_exceeded',
      message: `generated content for "${content.id}" is ${contentBytes} bytes, over the LEARNED_SKILL_CONTENT_BUDGET of ${LEARNED_SKILL_CONTENT_BUDGET}; bound or split the procedure`,
    });
  }
  const evidenceBytes = bytes(JSON.stringify(content.evidence));
  if (evidenceBytes > LEARNED_SKILL_CONTEXT_BUDGET) {
    return blockedPlan(scope, content.id, {
      code: 'context_budget_exceeded',
      message: `evidence for "${content.id}" is ${evidenceBytes} bytes, over the LEARNED_SKILL_CONTEXT_BUDGET of ${LEARNED_SKILL_CONTEXT_BUDGET}; narrow the evidence or split the candidate`,
    });
  }
  if (content.evidence.length === 0) {
    return blockedPlan(scope, content.id, {
      code: 'invalid_evidence',
      message: `learned skill "${content.id}" must carry at least one evidence reference`,
    });
  }

  const storeResult = await resolveStore(scope, context);
  if (!storeResult.ok) return blockedPlan(scope, content.id, storeResult.block);
  const { store } = storeResult;

  const writable = await probeStoreWritable(store);
  if (!writable.ok) {
    return blockedPlan(scope, content.id, { code: 'store_unwritable', message: writable.message });
  }

  const directory = learnedSkillDir(store, content.id);
  const existing = readCanonicalRecord(directory, scope);
  if (existing.kind === 'unmanaged') {
    return blockedPlan(scope, content.id, {
      code: 'ownership_collision',
      message: `cannot write learned skill "${content.id}": ${existing.reason}`,
    });
  }

  // Merge evidence with any existing managed record so provenance accumulates
  // (idempotent re-runs add nothing new).
  const mergedEvidence = dedupeEvidence([
    ...(existing.kind === 'managed' ? existing.record.manifest.evidence : []),
    ...content.evidence,
  ]);

  const requiresGlobalApproval = isGlobal;
  if (isGlobal) {
    const projects = distinctProjectIds(mergedEvidence.entries);
    if (projects.size < LEARNED_SKILL_GLOBAL_PROMOTION_MIN_PROJECTS) {
      return blockedPlan(scope, content.id, {
        code: 'global_evidence_insufficient',
        message: `global scope requires evidence from at least ${LEARNED_SKILL_GLOBAL_PROMOTION_MIN_PROJECTS} distinct projects (found ${projects.size})`,
      });
    }
  }

  const now = new Date().toISOString();
  const createdAt = existing.kind === 'managed' ? existing.record.manifest.createdAt : now;
  const canonicalContent = buildCanonicalContent(content.id, content.description, content.instructions);
  const contentDigest = digestContent(canonicalContent);
  const manifest = buildManifest({
    id: content.id,
    knowledgeKey: content.knowledgeKey,
    scope,
    contentDigest,
    description: content.description,
    applicability,
    evidence: mergedEvidence,
    createdAt,
    updatedAt: now,
  });

  let action: LearnedSkillPlan['action'];
  if (existing.kind === 'absent') {
    action = 'create';
  } else {
    const prior = existing.record.manifest;
    const unchanged =
      prior.status === 'active' &&
      prior.contentDigest === contentDigest &&
      prior.description === content.description &&
      prior.knowledgeKey === content.knowledgeKey &&
      applicabilityEqual(prior.applicability, applicability) &&
      evidenceEqual(prior.evidence, mergedEvidence.entries);
    action = unchanged ? 'no-op' : 'rewrite';
  }

  if (action === 'no-op') {
    return {
      action,
      scope,
      id: content.id,
      knowledgeKey: content.knowledgeKey,
      requiresGlobalApproval,
      summary: `no change: "${content.id}" already reflects this evidence`,
    };
  }

  return {
    action,
    scope,
    id: content.id,
    knowledgeKey: content.knowledgeKey,
    requiresGlobalApproval,
    summary: `${action} ${scope} learned skill "${content.id}"`,
    commit: {
      scope,
      action,
      directory,
      manifest,
      content: canonicalContent,
      lockPath: `${store.dir}.lock`,
      expectedContentDigest: contentDigest,
    },
  };
}

async function planRetire(
  request: Extract<LearnedSkillMutationRequest, { operation: 'retire' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const { scope, id } = request;
  const idCheck = checkLearnedSkillId(id);
  if (!idCheck.valid) {
    return blockedPlan(scope, id, {
      code: 'invalid_id',
      message: `invalid learned-skill id "${id}": ${idCheck.violations.join('; ')}`,
    });
  }
  const storeResult = await resolveStore(scope, context);
  if (!storeResult.ok) return blockedPlan(scope, id, storeResult.block);
  const directory = learnedSkillDir(storeResult.store, id);
  const existing = readCanonicalRecord(directory, scope);
  if (existing.kind === 'absent') {
    return blockedPlan(scope, id, { code: 'not_found', message: `no learned skill "${id}" to retire` });
  }
  if (existing.kind === 'unmanaged') {
    return blockedPlan(scope, id, {
      code: 'not_managed',
      message: `cannot retire "${id}": ${existing.reason}`,
    });
  }
  if (existing.record.manifest.status === 'retired') {
    return {
      action: 'no-op',
      scope,
      id,
      knowledgeKey: existing.record.manifest.knowledgeKey,
      requiresGlobalApproval: false,
      summary: `no change: "${id}" is already retired`,
    };
  }
  const now = new Date().toISOString();
  const manifest: LearnedSkillManifest = {
    ...existing.record.manifest,
    status: 'retired',
    updatedAt: now,
    retiredAt: now,
    ...(request.retirementReason ? { retirementReason: request.retirementReason } : {}),
  };
  return {
    action: 'retire',
    scope,
    id,
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    summary: `retire ${scope} learned skill "${id}"`,
    commit: {
      scope,
      action: 'retire',
      directory,
      manifest,
      content: existing.record.content,
      lockPath: `${storeResult.store.dir}.lock`,
    },
  };
}

async function planRename(
  request: Extract<LearnedSkillMutationRequest, { operation: 'rename' }>,
  context: LearnedSkillContext
): Promise<LearnedSkillPlan> {
  const { scope, fromId, toId } = request;
  const toCheck = checkLearnedSkillId(toId);
  if (!toCheck.valid) {
    return blockedPlan(scope, toId, {
      code: 'invalid_id',
      message: `invalid target id "${toId}": ${toCheck.violations.join('; ')}`,
    });
  }
  if (learnedSkillIdCollisionKey(fromId) === learnedSkillIdCollisionKey(toId)) {
    return blockedPlan(scope, toId, {
      code: 'invalid_request',
      message: `rename source and target resolve to the same id "${toId}"`,
    });
  }
  const storeResult = await resolveStore(scope, context);
  if (!storeResult.ok) return blockedPlan(scope, toId, storeResult.block);
  const fromDirectory = learnedSkillDir(storeResult.store, fromId);
  const toDirectory = learnedSkillDir(storeResult.store, toId);

  const fromRecord = readCanonicalRecord(fromDirectory, scope);
  if (fromRecord.kind === 'absent') {
    return blockedPlan(scope, toId, { code: 'not_found', message: `no learned skill "${fromId}" to rename` });
  }
  if (fromRecord.kind === 'unmanaged') {
    return blockedPlan(scope, toId, { code: 'not_managed', message: `cannot rename "${fromId}": ${fromRecord.reason}` });
  }
  const toRecord = readCanonicalRecord(toDirectory, scope);
  if (toRecord.kind !== 'absent') {
    return blockedPlan(scope, toId, {
      code: 'ownership_collision',
      message: `target id "${toId}" is already occupied`,
    });
  }

  const now = new Date().toISOString();
  const manifest: LearnedSkillManifest = {
    ...fromRecord.record.manifest,
    id: toId,
    updatedAt: now,
  };
  const canonicalContent = buildCanonicalContent(
    toId,
    fromRecord.record.manifest.description,
    // The body after the frontmatter is the record's instructions; a rename
    // rewrites only the frontmatter `name`, so re-derive from stored content.
    stripFrontmatter(fromRecord.record.content)
  );
  const contentDigest = digestContent(canonicalContent);
  manifest.contentDigest = contentDigest;
  return {
    action: 'rename',
    scope,
    id: toId,
    knowledgeKey: manifest.knowledgeKey,
    requiresGlobalApproval: false,
    summary: `rename ${scope} learned skill "${fromId}" -> "${toId}"`,
    commit: {
      scope,
      action: 'rename',
      directory: toDirectory,
      fromDirectory,
      manifest,
      content: canonicalContent,
      lockPath: `${storeResult.store.dir}.lock`,
      expectedContentDigest: contentDigest,
    },
  };
}

/** Strips a leading `---\n…\n---\n` YAML frontmatter block, returning the body. */
function stripFrontmatter(content: string): string {
  const match = /^---\n[\s\S]*?\n---\n?/.exec(content);
  return match ? content.slice(match[0].length).trim() : content.trim();
}

export async function planLearnedSkillMutation(
  request: LearnedSkillMutationRequest,
  context: LearnedSkillContext = {}
): Promise<LearnedSkillPlan> {
  switch (request.operation) {
    case 'upsert':
      return planWrite(request.scope, request, context);
    case 'promote':
      return planWrite('global', { ...request, applicability: request.applicability }, context);
    case 'retire':
      return planRetire(request, context);
    case 'rename':
      return planRename(request, context);
    default:
      return blockedPlan('project', '', {
        code: 'invalid_request',
        message: 'unknown mutation operation',
      });
  }
}

/** Atomically writes a fresh learned-skill directory (manifest + content) at `directory`. */
function writeCanonicalDirectory(
  directory: string,
  manifest: LearnedSkillManifest,
  content: string,
  expectedContentDigest: string | undefined
): void {
  const parent = path.dirname(directory);
  fs.mkdirSync(parent, { recursive: true });
  const suffix = `${process.pid}-${Math.random().toString(36).slice(2)}`;
  const staging = path.join(parent, `.staging-${path.basename(directory)}-${suffix}`);
  const backup = path.join(parent, `.backup-${path.basename(directory)}-${suffix}`);

  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    const contentPath = path.join(staging, 'SKILL.md');
    fs.writeFileSync(path.join(staging, 'learned-skill.yaml'), serializeManifest(manifest), { mode: 0o600 });
    fs.writeFileSync(contentPath, content, { mode: 0o600 });

    // Re-verify the staged content digest before swapping it into place.
    if (expectedContentDigest !== undefined) {
      const staged = fs.readFileSync(contentPath, 'utf-8');
      if (digestContent(staged) !== expectedContentDigest) {
        throw new Error(`staged content digest mismatch for ${directory}`);
      }
    }

    const targetExists = fs.existsSync(directory);
    if (!targetExists) {
      fs.renameSync(staging, directory);
      return;
    }
    // Rewrite: move the current record aside, swap in the new one, then remove
    // the backup. Restore the backup if the swap fails.
    fs.renameSync(directory, backup);
    try {
      fs.renameSync(staging, directory);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      fs.renameSync(backup, directory);
      throw error;
    }
    fs.rmSync(backup, { recursive: true, force: true });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function commitLearnedSkillPlan(
  plan: LearnedSkillPlan,
  context: LearnedSkillContext = {}
): Promise<LearnedSkillResult> {
  if (plan.block) {
    return { outcome: 'blocked', scope: plan.scope, id: plan.id, block: plan.block };
  }
  if (plan.action === 'no-op' || !plan.commit) {
    return { outcome: 'no-op', scope: plan.scope, id: plan.id };
  }
  // Global create/promotion consent is a commit-time gate: the plan is valid,
  // but writing global state requires explicit approval (design D4/D5).
  if (plan.requiresGlobalApproval && context.approveGlobal !== true) {
    return {
      outcome: 'blocked',
      scope: plan.scope,
      id: plan.id,
      block: {
        code: 'global_approval_required',
        message: `writing the global learned skill "${plan.id}" requires explicit approval`,
      },
    };
  }

  const payload = plan.commit;
  const lock = await acquireFileLock({
    lockPath: payload.lockPath,
    errorFor: (_kind, info) =>
      new Error(`learned-skill registry is busy or unwritable (${info.lockPath})`),
  });
  try {
    // Re-verify the ownership precondition UNDER the lock. The plan-time read
    // was unlocked, so the target may have changed in the plan→commit window (a
    // human-authored directory appearing on the id, a concurrent writer, or a
    // deletion). Never clobber whatever now occupies the id — enforce the
    // action's precondition or abort without writing (design D7/D8).
    const current = readCanonicalRecord(payload.directory, payload.scope);
    const changedUnderLock = ((): LearnedSkillBlock | undefined => {
      if (payload.action === 'create' || payload.action === 'rename') {
        if (current.kind !== 'absent') {
          return {
            code: 'ownership_collision',
            message: `cannot ${payload.action} learned skill "${plan.id}": "${payload.directory}" was occupied after planning; re-run to merge or resolve the collision`,
          };
        }
      } else if (current.kind === 'absent') {
        return {
          code: 'not_found',
          message: `learned skill "${plan.id}" disappeared after planning; nothing to ${payload.action}`,
        };
      } else if (current.kind === 'unmanaged') {
        return { code: 'not_managed', message: `cannot ${payload.action} "${plan.id}": ${current.reason}` };
      }
      if (payload.action === 'rename' && payload.fromDirectory) {
        const from = readCanonicalRecord(payload.fromDirectory, payload.scope);
        if (from.kind === 'absent') {
          return { code: 'not_found', message: `rename source for "${plan.id}" disappeared after planning` };
        }
        if (from.kind === 'unmanaged') {
          return { code: 'not_managed', message: `cannot rename into "${plan.id}": source ${from.reason}` };
        }
      }
      return undefined;
    })();
    if (changedUnderLock) {
      return { outcome: 'blocked', scope: plan.scope, id: plan.id, block: changedUnderLock };
    }

    if (payload.action === 'retire') {
      // Retirement flips canonical status while preserving content + provenance.
      // Atomic write (temp + rename) so a crash mid-write cannot corrupt the
      // manifest and permanently wedge the record as unmanaged.
      await writeFileAtomically(
        FileSystemUtils.joinPath(payload.directory, 'learned-skill.yaml'),
        serializeManifest(payload.manifest!)
      );
      return {
        outcome: 'retired',
        scope: plan.scope,
        id: plan.id,
        status: 'retired',
        directory: payload.directory,
      };
    }

    writeCanonicalDirectory(
      payload.directory,
      payload.manifest!,
      payload.content!,
      payload.expectedContentDigest
    );

    if (payload.action === 'rename' && payload.fromDirectory) {
      fs.rmSync(payload.fromDirectory, { recursive: true, force: true });
      return { outcome: 'renamed', scope: plan.scope, id: plan.id, status: 'active', directory: payload.directory };
    }

    return {
      outcome: payload.action === 'create' ? 'created' : 'rewritten',
      scope: plan.scope,
      id: plan.id,
      status: 'active',
      directory: payload.directory,
    };
  } finally {
    await releaseFileLock(lock, payload.lockPath);
  }
}
