import { describe, expect, it } from 'vitest';

import {
  DurableKnowledgeOwnerRefSchema,
  LearnedSkillCandidateSchema,
  LearnedSkillManifestSchema,
  compareDurableOwners,
  durableOwnerKey,
  sameDurableOwner,
  checkLearnedSkillId,
  dedupeEvidence,
  digestContent,
  distinctProjectIds,
  learnedSkillIdCollisionKey,
  validateApplicability,
  LEARNED_SKILL_MAX_EVIDENCE_ENTRIES,
} from '../../../src/core/learned-skills/index.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const evidence = (projectId: string, change = 'add-thing', artifact = 'proposal') => ({
  projectId,
  change,
  artifact,
  digest: DIGEST,
});

describe('learned-skill id validation', () => {
  it('accepts a context-first 3-6 token lowercase kebab-case id', () => {
    expect(checkLearnedSkillId('profile-package-retention-validation').valid).toBe(true);
    expect(checkLearnedSkillId('go-sql-transaction-locking').valid).toBe(true);
    expect(checkLearnedSkillId('type-cli-i18n').valid).toBe(true); // exactly 3 tokens
  });

  it('rejects too few or too many tokens', () => {
    expect(checkLearnedSkillId('go-sql').valid).toBe(false);
    expect(checkLearnedSkillId('a-b-c-d-e-f-g').valid).toBe(false);
  });

  it('rejects ids over 64 characters', () => {
    const long = Array.from({ length: 6 }, () => 'abcdefghijkl').join('-'); // > 64
    expect(long.length).toBeGreaterThan(64);
    expect(checkLearnedSkillId(long).valid).toBe(false);
  });

  it('rejects non-portable ids (uppercase, leading hyphen, underscores)', () => {
    expect(checkLearnedSkillId('Type-Cli-Routing').valid).toBe(false);
    expect(checkLearnedSkillId('-type-cli-routing').valid).toBe(false);
    expect(checkLearnedSkillId('type_cli_routing').valid).toBe(false);
  });

  it('rejects generic memory words and date/change-id-like tokens', () => {
    expect(checkLearnedSkillId('typescript-cli-lesson-routing').valid).toBe(false);
    expect(checkLearnedSkillId('typescript-notes-diagnostic').valid).toBe(false);
    expect(checkLearnedSkillId('typescript-cli-2026-routing').valid).toBe(false);
    expect(checkLearnedSkillId('typescript-cli-20260724-routing').valid).toBe(false);
  });

  it('reports every violated rule at once', () => {
    const result = checkLearnedSkillId('go-lesson');
    expect(result.valid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2); // too few tokens + generic word
  });

  it('folds case and NFC for collision detection', () => {
    expect(learnedSkillIdCollisionKey('go-sql-locking')).toBe(
      learnedSkillIdCollisionKey('GO-SQL-LOCKING')
    );
  });
});

describe('applicability validation', () => {
  it('accepts portable relative markers with all/any composition', () => {
    const check = validateApplicability({ mode: 'all', markers: ['package.json', 'src/index.ts'] });
    expect(check.valid).toBe(true);
    expect(check.normalized).toEqual({ mode: 'all', markers: ['package.json', 'src/index.ts'] });
  });

  it('rejects traversal, absolute, backslash, and device-name markers', () => {
    expect(validateApplicability({ mode: 'all', markers: ['../escape'] }).valid).toBe(false);
    expect(validateApplicability({ mode: 'all', markers: ['/etc/passwd'] }).valid).toBe(false);
    expect(validateApplicability({ mode: 'all', markers: ['src\\index.ts'] }).valid).toBe(false);
    expect(validateApplicability({ mode: 'all', markers: ['con'] }).valid).toBe(false);
  });

  it('rejects an empty marker set and an invalid mode', () => {
    expect(validateApplicability({ mode: 'all', markers: [] }).valid).toBe(false);
    expect(validateApplicability({ mode: 'sometimes', markers: ['package.json'] }).valid).toBe(false);
  });
});

describe('candidate and manifest schemas', () => {
  const validUpsert = {
    version: 1,
    operation: 'upsert' as const,
    scope: 'project' as const,
    id: 'go-sql-transaction-locking',
    knowledgeKey: 'go-sql-tx-locking',
    description: 'Use SELECT ... FOR UPDATE to lock rows in a transaction.',
    instructions: '## When\n...\n## Steps\n...',
    applicability: { mode: 'all' as const, markers: ['go.mod'] },
    evidence: [evidence('project-a')],
  };

  it('accepts a well-formed upsert candidate', () => {
    expect(LearnedSkillCandidateSchema.safeParse(validUpsert).success).toBe(true);
  });

  it('rejects an unknown field (strict) and a malformed digest', () => {
    expect(LearnedSkillCandidateSchema.safeParse({ ...validUpsert, extra: true }).success).toBe(false);
    expect(
      LearnedSkillCandidateSchema.safeParse({
        ...validUpsert,
        evidence: [{ ...evidence('project-a'), digest: 'not-a-digest' }],
      }).success
    ).toBe(false);
  });

  it('accepts a retire candidate without content fields', () => {
    expect(
      LearnedSkillCandidateSchema.safeParse({
        version: 1,
        operation: 'retire',
        scope: 'project',
        id: 'go-sql-transaction-locking',
        retirementReason: 'superseded',
      }).success
    ).toBe(true);
  });

  it('rejects a manifest missing required fields', () => {
    expect(LearnedSkillManifestSchema.safeParse({ version: 1, id: 'x' }).success).toBe(false);
  });
});

describe('evidence dedup and provenance', () => {
  it('deduplicates by stable tuple and preserves order', () => {
    const result = dedupeEvidence([
      evidence('a', 'c1'),
      evidence('a', 'c1'),
      evidence('b', 'c2'),
    ]);
    expect(result.entries).toHaveLength(2);
    expect(result.overflow).toBeUndefined();
  });

  it('caps evidence and summarizes overflow by count and digest', () => {
    const many = Array.from({ length: LEARNED_SKILL_MAX_EVIDENCE_ENTRIES + 3 }, (_unused, index) =>
      evidence(`project-${index}`, `change-${index}`)
    );
    const result = dedupeEvidence(many);
    expect(result.entries).toHaveLength(LEARNED_SKILL_MAX_EVIDENCE_ENTRIES);
    expect(result.overflow?.count).toBe(3);
    expect(result.overflow?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('counts distinct project ids', () => {
    expect(distinctProjectIds([evidence('a'), evidence('a', 'c2'), evidence('b')]).size).toBe(2);
  });

  it('digests content as sha256', () => {
    expect(digestContent('hello')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestContent('hello')).toBe(digestContent('hello'));
    expect(digestContent('a')).not.toBe(digestContent('b'));
  });
});

describe('durable owners and versioned records', () => {
  const UID_A = '11111111-1111-4111-8111-111111111111';
  const UID_B = '22222222-2222-4222-8222-222222222222';

  it('keys a store on its permanent identity, never on its display name', () => {
    const renamed = { type: 'store' as const, uid: UID_A, id: 'renamed' };
    const original = { type: 'store' as const, uid: UID_A, id: 'team' };
    expect(durableOwnerKey(renamed)).toBe(durableOwnerKey(original));
    expect(sameDurableOwner(renamed, original)).toBe(true);

    // Two stores that share a display name are two owners, not one.
    const namesake = { type: 'store' as const, uid: UID_B, id: 'team' };
    expect(sameDurableOwner(original, namesake)).toBe(false);
    expect(durableOwnerKey(original)).not.toBe(durableOwnerKey(namesake));
  });

  it('orders owners identically before and after a rename', () => {
    const before = [
      { type: 'store' as const, uid: UID_B, id: 'aardvark' },
      { type: 'store' as const, uid: UID_A, id: 'zebra' },
    ];
    const after = [
      { type: 'store' as const, uid: UID_B, id: 'zebra' },
      { type: 'store' as const, uid: UID_A, id: 'aardvark' },
    ];
    const order = (owners: typeof before): string[] =>
      [...owners].sort(compareDurableOwners).map(durableOwnerKey);
    // An alphabetical tie-break on a renameable field would swap these.
    expect(order(before)).toEqual(order(after));
  });

  it('accepts a store owner only with a permanent identity', () => {
    expect(
      DurableKnowledgeOwnerRefSchema.safeParse({ type: 'store', uid: UID_A, id: 'team' }).success
    ).toBe(true);
    // A display name alone is not an owner a record may be keyed on.
    expect(DurableKnowledgeOwnerRefSchema.safeParse({ type: 'store', id: 'team' }).success).toBe(
      false
    );
    // Strict: an unknown key is an error, not a tolerated field.
    expect(
      DurableKnowledgeOwnerRefSchema.safeParse({ type: 'store', uid: UID_A, root: '/tmp/store' })
        .success
    ).toBe(false);
  });

  it('parses both manifest versions and rejects a mismatched owner', () => {
    const common = {
      id: 'go-sql-transaction-locking',
      knowledgeKey: 'go-sql-tx-locking',
      status: 'active',
      generatedBy: 'rasen-learned-skill',
      contentDigest: DIGEST,
      description: 'Lock rows in a transaction.',
      applicability: { mode: 'all', markers: ['go.mod'] },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(
      LearnedSkillManifestSchema.safeParse({
        version: 1,
        ...common,
        scope: 'project',
        evidence: [evidence('p1')],
      }).success
    ).toBe(true);
    expect(
      LearnedSkillManifestSchema.safeParse({
        version: 2,
        ...common,
        scope: 'store',
        owner: { type: 'store', uid: UID_A, id: 'team' },
        evidence: [{ owner: { type: 'project', projectId: 'p1' }, change: 'c', artifact: 'review', digest: DIGEST }],
        sources: [{ owner: { type: 'project', projectId: 'p1' }, id: 'go-sql-transaction-locking', knowledgeKey: 'go-sql-tx-locking' }],
      }).success
    ).toBe(true);
    // The declared owner must be the same class as the declared scope.
    expect(
      LearnedSkillManifestSchema.safeParse({
        version: 2,
        ...common,
        scope: 'store',
        owner: { type: 'project', projectId: 'p1' },
        evidence: [],
        sources: [],
      }).success
    ).toBe(false);
  });
});
