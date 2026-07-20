import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../../../src/core/workflow-registry/types.js';
import {
  canonicalBytes,
  canonicalJson,
  computePackageDigest,
  computePackagedWorkflowDigest,
  createProfilePackage,
  createWorkflowPackage,
  decodePackage,
  encodePackage,
  preflightJson,
  WorkflowPackageError,
  WORKFLOW_PACKAGE_LIMITS,
  type PackageWithoutDigest,
  type RasenPackage,
} from '../../../src/core/workflow-package/index.js';

const canonicalVector = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../fixtures/workflow-package/canonical-workflow-v1.json', import.meta.url)
    ),
    'utf8'
  )
) as {
  canonical: string;
  files: Record<string, string>;
  workflowDigest: string;
  packageDigest: string;
};

function definition(id: string, dependencies: string[] = []): WorkflowDefinition {
  return {
    id,
    source: 'user',
    sourcePath: `/staging/${id}`,
    manifestVersion: 1,
    kind: 'task',
    skill: {
      dirName: `rasen-${id}`,
      template: {
        name: `rasen-${id}`,
        description: `Run ${id}.`,
        instructions: `Complete ${id}.\n`,
      },
    },
    requires: { workflows: dependencies, skills: [] },
    recommends: { workflows: [] },
    files: [
      {
        path: 'workflow.yaml',
        content: dependencies.length === 0
          ? `version: 1\nid: ${id}\n`
          : `version: 1\nid: ${id}\nrequires:\n  workflows: ${JSON.stringify(dependencies)}\n  skills: []\n`,
        sha256: 'ignored',
      },
      {
        path: 'SKILL.md',
        content: `---\nname: rasen-${id}\ndescription: Run ${id}.\n---\n\nComplete ${id}.\n`,
        sha256: 'ignored',
      },
    ],
    digest: 'ignored',
  };
}

function expectPackageError(fn: () => unknown, code: string): WorkflowPackageError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkflowPackageError);
    expect((error as WorkflowPackageError).code).toBe(code);
    return error as WorkflowPackageError;
  }
  throw new Error('Expected WorkflowPackageError');
}

function escapedContentDefinition(id: string): WorkflowDefinition {
  const base = definition(id);
  const escapedContent = '\n'.repeat(WORKFLOW_PACKAGE_LIMITS.maxFileBytes);
  return {
    ...base,
    files: [
      ...base.files,
      ...Array.from({ length: 8 }, (_, index) => ({
        path: `escaped-${index}.txt`,
        content: escapedContent,
        sha256: 'ignored',
      })),
    ],
  };
}

function recomputePackageDigests<T extends RasenPackage>(packageValue: T): T {
  for (const workflow of packageValue.workflows) {
    workflow.digest = computePackagedWorkflowDigest(workflow.id, workflow.files);
  }
  const { packageDigest: _previousDigest, ...packageWithoutDigest } = packageValue;
  packageValue.packageDigest = computePackageDigest(
    packageValue.kind,
    packageWithoutDigest as PackageWithoutDigest
  );
  return packageValue;
}

describe('.rasenpkg codec', () => {
  it('matches the published canonical digest vector', () => {
    const packageValue = createWorkflowPackage(['alpha'], [definition('alpha')]);

    expect(encodePackage(packageValue).toString('utf8')).toBe(canonicalVector.canonical);
    expect(Object.fromEntries(
      packageValue.workflows[0].files.map((file) => [file.path, file.sha256])
    )).toEqual(canonicalVector.files);
    expect(packageValue.workflows[0].digest).toBe(canonicalVector.workflowDigest);
    expect(packageValue.packageDigest).toBe(canonicalVector.packageDigest);
  });

  it('round-trips deterministic canonical workflow package bytes', () => {
    const packageValue = createWorkflowPackage(
      ['team-release'],
      [definition('team-release', ['dependency']), definition('dependency')]
    );
    const bytes = encodePackage(packageValue);
    const decoded = decodePackage(bytes, 'workflow');

    expect(decoded).toEqual(packageValue);
    expect(bytes.toString('utf8')).toBe(canonicalJson(packageValue));
    expect(bytes.at(-1)).not.toBe(0x0a);
    expect(packageValue.workflows.map((workflow) => workflow.id)).toEqual([
      'dependency',
      'team-release',
    ]);
    expect(packageValue.workflows[0].files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'workflow.yaml',
    ]);
  });

  it('round-trips a profile package without changing its profile order', () => {
    const packageValue = createProfilePackage(
      'team',
      { version: 1, delivery: 'both', workflows: ['apply', 'team-release'] },
      ['team-release'],
      [definition('team-release')]
    );

    expect(decodePackage(encodePackage(packageValue), 'profile')).toEqual(packageValue);
    expect(packageValue.profile.workflows).toEqual(['apply', 'team-release']);
  });

  it.each([
    {
      kind: 'workflow',
      create: () => createWorkflowPackage(
        ['escaped'],
        [escapedContentDefinition('escaped')]
      ),
    },
    {
      kind: 'profile',
      create: () => createProfilePackage(
        'escaped',
        { version: 1, delivery: 'both', workflows: ['escaped'] },
        ['escaped'],
        [escapedContentDefinition('escaped')]
      ),
    },
  ])('rejects a canonical $kind package expanded past the byte limit by escaping', ({ create }) => {
    const packageValue = create();
    const decodedContentBytes = packageValue.workflows
      .flatMap((workflow) => workflow.files)
      .reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0);

    expect(decodedContentBytes).toBeLessThanOrEqual(
      WORKFLOW_PACKAGE_LIMITS.maxTotalContentBytes
    );
    const error = expectPackageError(() => encodePackage(packageValue), 'package_too_large');
    expect(error.message).toBe('Package exceeds byte limit');
    expect(error.details).toEqual({
      actual: expect.any(Number),
      limit: WORKFLOW_PACKAGE_LIMITS.maxPackageBytes,
    });
    expect(error.details?.actual).toBeGreaterThan(WORKFLOW_PACKAGE_LIMITS.maxPackageBytes);
  });

  it('rejects invalid profile package names and duplicate profile workflow IDs', () => {
    const invalidName = createProfilePackage(
      '../team',
      { version: 1, delivery: 'both', workflows: ['team-release'] },
      ['team-release'],
      [definition('team-release')]
    );
    expectPackageError(
      () => decodePackage(canonicalBytes(invalidName), 'profile'),
      'package_schema_invalid'
    );

    const duplicate = createProfilePackage(
      'team',
      { version: 1, delivery: 'both', workflows: ['team-release', 'team-release'] },
      ['team-release'],
      [definition('team-release')]
    );
    expectPackageError(
      () => decodePackage(canonicalBytes(duplicate), 'profile'),
      'profile_workflow_duplicate'
    );
  });

  it('rejects non-canonical whitespace and key ordering', () => {
    const value = createWorkflowPackage(['alpha'], [definition('alpha')]);
    const nonCanonical = Buffer.from(JSON.stringify(value, null, 2), 'utf8');

    expectPackageError(() => decodePackage(nonCanonical), 'package_non_canonical');
  });

  it('rejects a non-normalized workflow array even when all digests match it', () => {
    const value = createWorkflowPackage(
      ['alpha', 'zeta'],
      [definition('alpha'), definition('zeta')]
    );
    const reordered = structuredClone(value);
    reordered.workflows.reverse();
    recomputePackageDigests(reordered);

    expectPackageError(
      () => decodePackage(canonicalBytes(reordered)),
      'package_workflows_not_normalized'
    );
  });

  it('rejects a non-normalized file array even when all digests match it', () => {
    const reordered = structuredClone(
      createWorkflowPackage(['alpha'], [definition('alpha')])
    );
    reordered.workflows[0].files.reverse();
    recomputePackageDigests(reordered);

    expectPackageError(
      () => decodePackage(canonicalBytes(reordered)),
      'package_files_not_normalized'
    );
  });

  it('rejects a non-normalized workflow-package root array with a matching digest', () => {
    const reordered = structuredClone(
      createWorkflowPackage(
        ['zeta', 'alpha'],
        [definition('zeta'), definition('alpha')]
      )
    );
    reordered.roots.reverse();
    recomputePackageDigests(reordered);

    expectPackageError(
      () => decodePackage(canonicalBytes(reordered)),
      'package_roots_not_normalized'
    );
  });

  it('rejects non-normalized profile selections and dependency-expanded roots', () => {
    const value = createProfilePackage(
      'team',
      {
        version: 1,
        delivery: 'both',
        workflows: ['team-release', 'base', 'apply'],
      },
      ['team-release', 'base'],
      [definition('team-release', ['base']), definition('base')]
    );
    expect(value.profile.workflows).toEqual(['apply', 'base', 'team-release']);
    expect(value.roots).toEqual(['base', 'team-release']);

    const selectionReordered = structuredClone(value);
    selectionReordered.profile.workflows.reverse();
    recomputePackageDigests(selectionReordered);
    expectPackageError(
      () => decodePackage(canonicalBytes(selectionReordered)),
      'profile_workflows_not_normalized'
    );

    const rootsReordered = structuredClone(value);
    rootsReordered.roots.reverse();
    recomputePackageDigests(rootsReordered);
    expectPackageError(
      () => decodePackage(canonicalBytes(rootsReordered)),
      'package_roots_not_normalized'
    );
  });

  it('rejects file, workflow, and package digest tampering', () => {
    const value = createWorkflowPackage(['alpha'], [definition('alpha')]);
    const fileTampered = structuredClone(value);
    fileTampered.workflows[0].files[0].content += 'tamper';
    expectPackageError(
      () => decodePackage(canonicalBytes(fileTampered)),
      'file_digest_mismatch'
    );

    const workflowTampered = structuredClone(value);
    workflowTampered.workflows[0].digest = `sha256:${'0'.repeat(64)}`;
    expectPackageError(
      () => decodePackage(canonicalBytes(workflowTampered)),
      'workflow_digest_mismatch'
    );

    const packageTampered = structuredClone(value);
    packageTampered.packageDigest = `sha256:${'0'.repeat(64)}`;
    expectPackageError(
      () => decodePackage(canonicalBytes(packageTampered)),
      'package_digest_mismatch'
    );
  });

  it('rejects BOM, invalid UTF-8, empty, and oversized inputs before parsing', () => {
    expectPackageError(() => decodePackage(Buffer.alloc(0)), 'package_empty');
    expectPackageError(
      () => decodePackage(Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])),
      'package_bom_forbidden'
    );
    expectPackageError(
      () => decodePackage(Buffer.from([0xc3, 0x28])),
      'package_utf8_invalid'
    );
    expectPackageError(
      () => decodePackage(new Uint8Array(WORKFLOW_PACKAGE_LIMITS.maxPackageBytes + 1)),
      'package_too_large'
    );
  });

  it('rejects schema additions and package kind mismatches', () => {
    const value = createWorkflowPackage(['alpha'], [definition('alpha')]);
    const withUnknown = { ...value, unknown: true };

    expectPackageError(
      () => decodePackage(canonicalBytes(withUnknown)),
      'package_schema_invalid'
    );
    expectPackageError(
      () => decodePackage(encodePackage(value), 'profile'),
      'package_kind_mismatch'
    );
  });

  it('rejects duplicate and colliding paths before materialization', () => {
    const value = createWorkflowPackage(['alpha'], [definition('alpha')]);
    const duplicate = structuredClone(value);
    duplicate.workflows[0].files.push({ ...duplicate.workflows[0].files[0] });
    expectPackageError(
      () => decodePackage(canonicalBytes(duplicate)),
      'file_path_duplicate'
    );

    const collision = structuredClone(value);
    collision.workflows[0].files.push({
      ...collision.workflows[0].files[0],
      path: 'skill.md',
    });
    expectPackageError(
      () => decodePackage(canonicalBytes(collision)),
      'file_path_collision'
    );
  });

  it('rejects missing and duplicate package roots', () => {
    const value = createWorkflowPackage(['alpha'], [definition('alpha')]);
    const missing = structuredClone(value);
    missing.roots = ['missing'];
    expectPackageError(
      () => decodePackage(canonicalBytes(missing)),
      'package_root_missing'
    );

    const duplicate = structuredClone(value);
    duplicate.roots = ['alpha', 'alpha'];
    expectPackageError(
      () => decodePackage(canonicalBytes(duplicate)),
      'package_root_duplicate'
    );
  });

  it('rejects embedded workflows outside the root dependency closure', () => {
    const packageValue = createWorkflowPackage(
      ['alpha'],
      [definition('alpha'), definition('hidden')]
    );

    expectPackageError(
      () => encodePackage(packageValue),
      'package_workflow_unreachable'
    );
  });

  it('rejects required user dependencies that are not embedded', () => {
    const packageValue = createWorkflowPackage(
      ['alpha'],
      [definition('alpha', ['missing-user'])]
    );

    expectPackageError(
      () => encodePackage(packageValue),
      'package_dependency_missing'
    );
  });
});

describe('strict JSON preflight', () => {
  it.each([
    ['{"a":1,"a":2}', 'json_duplicate_key'],
    ['{"__proto__":1}', 'json_dangerous_key'],
    ['{"a":1,}', 'json_syntax_invalid'],
    ['{/*comment*/"a":1}', 'json_syntax_invalid'],
    ['{"a":9007199254740992}', 'json_unsafe_integer'],
    ['{"a":"\\ud800"}', 'json_lone_surrogate'],
  ])('rejects %s with %s', (source, code) => {
    expect(preflightJson(source).map((issue) => issue.code)).toContain(code);
  });

  it('enforces maximum nesting depth', () => {
    const source = `${'['.repeat(WORKFLOW_PACKAGE_LIMITS.maxJsonDepth + 1)}0${']'.repeat(
      WORKFLOW_PACKAGE_LIMITS.maxJsonDepth + 1
    )}`;
    expect(preflightJson(source).map((issue) => issue.code)).toContain('json_depth_exceeded');
  });
});
