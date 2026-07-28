import { describe, expect, it } from 'vitest';

import {
  canonicalBytes,
  computePackageDigest,
  computePackagedPipelineDigest,
  createPipelinePackage,
  decodePackage,
  encodePackage,
  preflightPackageVersion,
  readCliVersion,
  WorkflowPackageError,
  type PackageWithoutDigest,
  type PipelinePackageInput,
} from '../../../src/core/workflow-package/index.js';

function pipelineInput(name: string, extra: string[] = []): PipelinePackageInput {
  return {
    name,
    files: [
      {
        path: 'pipeline.yaml',
        content: [
          `name: ${name}`,
          'stages:',
          '  - id: implement',
          '    skill: rasen-apply-change',
          '    role: implementer',
          '    requires: []',
          ...extra,
          '',
        ].join('\n'),
      },
    ],
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

describe('.rasenpkg pipeline kind', () => {
  it('round-trips a single-pipeline package deterministically', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    const bytes = encodePackage(packageValue);
    const decoded = decodePackage(bytes, 'pipeline');

    expect(decoded).toEqual(packageValue);
    expect(packageValue.kind).toBe('pipeline');
    expect(packageValue.workflows).toEqual([]);
    expect(packageValue.roots).toEqual(['solo']);
    expect(packageValue.pipelines[0].name).toBe('solo');
    expect(packageValue.pipelines[0].digest).toBe(
      computePackagedPipelineDigest('solo', packageValue.pipelines[0].files)
    );
    expect(packageValue.minRasenVersion).toBe(readCliVersion());
  });

  it('accepts both hyphen and colon skill-reference forms in stage skill fields', () => {
    const mixed: PipelinePackageInput = {
      name: 'mixed',
      files: [
        {
          path: 'pipeline.yaml',
          content: [
            'name: mixed',
            'stages:',
            '  - id: apply',
            '    skill: rasen-apply-change',
            '    role: implementer',
            '    requires: []',
            '  - id: verify',
            '    skill: rasen-review',
            '    role: reviewer',
            '    requires: [apply]',
            '',
          ].join('\n'),
        },
      ],
    };
    const packageValue = createPipelinePackage(['mixed'], [mixed]);
    expect(() => encodePackage(packageValue)).not.toThrow();
    expect(decodePackage(encodePackage(packageValue), 'pipeline')).toEqual(packageValue);
  });

  it('round-trips multiple pipelines in normalized order', () => {
    const packageValue = createPipelinePackage(
      ['zeta', 'alpha'],
      [pipelineInput('zeta'), pipelineInput('alpha')]
    );
    expect(packageValue.roots).toEqual(['alpha', 'zeta']);
    expect(packageValue.pipelines.map((p) => p.name)).toEqual(['alpha', 'zeta']);
    expect(decodePackage(encodePackage(packageValue), 'pipeline')).toEqual(packageValue);
  });

  it('rejects a structurally invalid pipeline.yaml (duplicate stage ids)', () => {
    const broken: PipelinePackageInput = {
      name: 'broken',
      files: [
        {
          path: 'pipeline.yaml',
          content: [
            'name: broken',
            'stages:',
            '  - id: same',
            '    skill: rasen-apply-change',
            '    requires: []',
            '  - id: same',
            '    skill: rasen-ship',
            '    requires: []',
            '',
          ].join('\n'),
        },
      ],
    };
    const packageValue = createPipelinePackage(['broken'], [broken]);
    expectPackageError(() => encodePackage(packageValue), 'pipeline_invalid');
  });

  it('rejects a pipeline.yaml whose declared name does not match its packaged name', () => {
    const mismatched: PipelinePackageInput = {
      name: 'declared',
      files: [
        {
          path: 'pipeline.yaml',
          content: 'name: other\nstages:\n  - id: a\n    skill: rasen-apply-change\n    requires: []\n',
        },
      ],
    };
    const packageValue = createPipelinePackage(['declared'], [mismatched]);
    expectPackageError(() => encodePackage(packageValue), 'packaged_pipeline_name_mismatch');
  });

  it('rejects a path-traversal file path inside a packaged pipeline (package-codec call site)', () => {
    const traversal: PipelinePackageInput = {
      name: 'traversal',
      files: [
        {
          path: 'pipeline.yaml',
          content: 'name: traversal\nstages:\n  - id: a\n    skill: rasen-apply-change\n    requires: []\n',
        },
        {
          // Never valid inside a package: escapes the pipeline's own directory.
          path: '../../etc/passwd',
          content: 'should never be staged',
        },
      ],
    };
    const packageValue = createPipelinePackage(['traversal'], [traversal]);
    expectPackageError(() => encodePackage(packageValue), 'path_traversal');
  });

  it('rejects a missing pipeline.yaml entry', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    const stripped = structuredClone(packageValue);
    stripped.pipelines[0].files = [];
    expectPackageError(() => decodePackage(canonicalBytes(stripped)), 'pipeline_required_file_missing');
  });

  it('rejects roots that do not name every packaged pipeline (and vice versa)', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    const extraRoot = structuredClone(packageValue);
    extraRoot.roots = ['solo', 'ghost'];
    expectPackageError(() => decodePackage(canonicalBytes(extraRoot)), 'package_root_missing');

    const missingRoot = structuredClone(packageValue);
    missingRoot.roots = [];
    expectPackageError(() => decodePackage(canonicalBytes(missingRoot)), 'package_roots_empty');
  });

  it('rejects pipeline and package digest tampering', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);

    const fileTampered = structuredClone(packageValue);
    fileTampered.pipelines[0].files[0].content += '\n# tampered\n';
    expectPackageError(() => decodePackage(canonicalBytes(fileTampered)), 'file_digest_mismatch');

    const pipelineDigestTampered = structuredClone(packageValue);
    pipelineDigestTampered.pipelines[0].digest = `sha256:${'0'.repeat(64)}`;
    expectPackageError(
      () => decodePackage(canonicalBytes(pipelineDigestTampered)),
      'pipeline_digest_mismatch'
    );

    const packageDigestTampered = structuredClone(packageValue);
    packageDigestTampered.packageDigest = `sha256:${'0'.repeat(64)}`;
    expectPackageError(
      () => decodePackage(canonicalBytes(packageDigestTampered)),
      'package_digest_mismatch'
    );
  });

  it('rejects a package kind mismatch against an expected workflow/profile kind', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    expectPackageError(
      () => decodePackage(encodePackage(packageValue), 'workflow'),
      'package_kind_mismatch'
    );
  });

  it('rejects a malformed minRasenVersion at the schema level', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    const malformed = structuredClone(packageValue);
    malformed.minRasenVersion = 'banana';
    const { packageDigest: _digest, ...withoutDigest } = malformed;
    malformed.packageDigest = computePackageDigest('pipeline', withoutDigest as PackageWithoutDigest);

    expectPackageError(() => decodePackage(canonicalBytes(malformed)), 'package_schema_invalid');
  });
});

describe('package version preflight', () => {
  it('passes through packages with no minRasenVersion/unsupported formatVersion set', () => {
    expect(preflightPackageVersion({ formatVersion: 1 })).toBeNull();
    expect(preflightPackageVersion({})).toBeNull();
  });

  it('rejects a package requiring a newer rasen with a clear message', () => {
    const issue = preflightPackageVersion({ minRasenVersion: '999.0.0' }, '0.1.4');
    expect(issue).not.toBeNull();
    expect(issue?.code).toBe('package_requires_newer_rasen');
    expect(issue?.message).toContain('999.0.0');
    expect(issue?.message).toContain('0.1.4');
  });

  it('accepts a package requiring an older or equal rasen version', () => {
    expect(preflightPackageVersion({ minRasenVersion: '0.0.1' }, '0.1.4')).toBeNull();
    expect(preflightPackageVersion({ minRasenVersion: '0.1.4' }, '0.1.4')).toBeNull();
  });

  it('rejects an unsupported formatVersion', () => {
    const issue = preflightPackageVersion({ formatVersion: 2 });
    expect(issue).not.toBeNull();
    expect(issue?.code).toBe('package_format_unsupported');
  });

  it('decodePackage surfaces the version preflight before strict schema validation', () => {
    const packageValue = createPipelinePackage(['solo'], [pipelineInput('solo')]);
    const withFutureRequirement = {
      ...structuredClone(packageValue),
      minRasenVersion: '999.0.0',
    };
    // Recompute the package digest so this is not rejected for a DIFFERENT
    // reason (digest mismatch) before the version preflight gets a chance to run.
    const { packageDigest: _digest, ...withoutDigest } = withFutureRequirement;
    withFutureRequirement.packageDigest = computePackageDigest(
      'pipeline',
      withoutDigest as PackageWithoutDigest
    );

    expectPackageError(
      () => decodePackage(canonicalBytes(withFutureRequirement)),
      'package_requires_newer_rasen'
    );
  });
});
