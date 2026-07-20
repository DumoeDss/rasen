import { TextDecoder } from 'node:util';

import type { WorkflowDefinition } from '../workflow-registry/types.js';
import {
  checkPortableRelativePath,
  isPortableWorkflowId,
  portablePathCollisionKey,
} from '../workflow-registry/path-policy.js';
import { canonicalBytes, canonicalJson } from './canonical.js';
import {
  computeFileDigest,
  computePackageDigest,
  computePackagedWorkflowDigest,
} from './digest.js';
import { preflightJson, type JsonPreflightIssue } from './json-preflight.js';
import { WORKFLOW_PACKAGE_LIMITS } from './limits.js';
import {
  RasenPackageSchema,
  type PackageFile,
  type PackageWithoutDigest,
  type PackagedProfile,
  type PackagedWorkflow,
  type ProfilePackage,
  type RasenPackage,
  type RasenPackageKind,
  type WorkflowPackage,
} from './schema.js';

export class WorkflowPackageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: Record<string, string | number | JsonPreflightIssue[]>
  ) {
    super(message);
    this.name = 'WorkflowPackageError';
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizePackagedWorkflows(
  definitions: readonly WorkflowDefinition[]
): PackagedWorkflow[] {
  if (definitions.length > WORKFLOW_PACKAGE_LIMITS.maxWorkflows) {
    throw new WorkflowPackageError('Workflow count exceeds package limit', 'workflow_limit_exceeded');
  }
  return definitions
    .map((definition) => {
      if (definition.source !== 'user') {
        throw new WorkflowPackageError(
          `Built-in workflow "${definition.id}" cannot be embedded`,
          'builtin_workflow_forbidden'
        );
      }
      const files: PackageFile[] = definition.files
        .map((file) => ({
          path: file.path,
          encoding: 'utf8' as const,
          sha256: computeFileDigest(file.content),
          content: file.content,
        }))
        .sort((left, right) => compareStrings(left.path, right.path));
      return {
        id: definition.id,
        digest: computePackagedWorkflowDigest(definition.id, files),
        files,
      };
    })
    .sort((left, right) => compareStrings(left.id, right.id));
}

function finishPackage(packageWithoutDigest: PackageWithoutDigest): RasenPackage {
  const packageDigest = computePackageDigest(packageWithoutDigest.kind, packageWithoutDigest);
  return { ...packageWithoutDigest, packageDigest } as RasenPackage;
}

export function createWorkflowPackage(
  roots: readonly string[],
  definitions: readonly WorkflowDefinition[]
): WorkflowPackage {
  return finishPackage({
    format: 'rasen-package',
    formatVersion: 1,
    kind: 'workflow',
    roots: [...roots],
    workflows: normalizePackagedWorkflows(definitions),
  }) as WorkflowPackage;
}

export function createProfilePackage(
  name: string,
  profile: PackagedProfile,
  roots: readonly string[],
  definitions: readonly WorkflowDefinition[]
): ProfilePackage {
  return finishPackage({
    format: 'rasen-package',
    formatVersion: 1,
    kind: 'profile',
    name,
    profile: {
      version: profile.version,
      delivery: profile.delivery,
      workflows: [...profile.workflows],
    },
    roots: [...roots],
    workflows: normalizePackagedWorkflows(definitions),
  }) as ProfilePackage;
}

export function encodePackage(packageValue: RasenPackage): Buffer {
  validatePackageDomain(packageValue);
  return canonicalBytes(packageValue);
}

function failPreflight(code: string, message: string, details?: Record<string, string | number | JsonPreflightIssue[]>): never {
  throw new WorkflowPackageError(message, code, details);
}

function validatePackageDomain(packageValue: RasenPackage): void {
  if (packageValue.workflows.length > WORKFLOW_PACKAGE_LIMITS.maxWorkflows) {
    failPreflight('workflow_limit_exceeded', 'Workflow count exceeds package limit', {
      actual: packageValue.workflows.length,
      limit: WORKFLOW_PACKAGE_LIMITS.maxWorkflows,
    });
  }
  if (packageValue.kind === 'workflow' && packageValue.roots.length === 0) {
    failPreflight('package_roots_empty', 'Workflow package must contain at least one root');
  }

  const workflowIds = new Set<string>();
  let entryCount = 0;
  let totalContentBytes = 0;
  for (const workflow of packageValue.workflows) {
    if (!isPortableWorkflowId(workflow.id)) {
      failPreflight('workflow_id_invalid', `Workflow ID "${workflow.id}" is not portable`);
    }
    if (workflowIds.has(workflow.id)) {
      failPreflight('workflow_duplicate', `Duplicate workflow ID "${workflow.id}"`);
    }
    workflowIds.add(workflow.id);
    entryCount += workflow.files.length;
    if (entryCount > WORKFLOW_PACKAGE_LIMITS.maxEntries) {
      failPreflight('entry_limit_exceeded', 'File entry count exceeds package limit', {
        actual: entryCount,
        limit: WORKFLOW_PACKAGE_LIMITS.maxEntries,
      });
    }

    const paths = new Set<string>();
    const collisionKeys = new Map<string, string>();
    for (const file of workflow.files) {
      const pathCheck = checkPortableRelativePath(file.path);
      if (!pathCheck.valid) failPreflight(pathCheck.code!, pathCheck.message!);
      if (paths.has(file.path)) {
        failPreflight('file_path_duplicate', `Duplicate file path "${file.path}"`);
      }
      paths.add(file.path);
      const collisionKey = portablePathCollisionKey(file.path);
      const collision = collisionKeys.get(collisionKey);
      if (collision) {
        failPreflight(
          'file_path_collision',
          `File path "${file.path}" collides with "${collision}"`
        );
      }
      collisionKeys.set(collisionKey, file.path);

      const bytes = Buffer.from(file.content, 'utf8');
      if (bytes.length > WORKFLOW_PACKAGE_LIMITS.maxFileBytes) {
        failPreflight('file_limit_exceeded', `File "${file.path}" exceeds package limit`, {
          actual: bytes.length,
          limit: WORKFLOW_PACKAGE_LIMITS.maxFileBytes,
        });
      }
      totalContentBytes += bytes.length;
      if (totalContentBytes > WORKFLOW_PACKAGE_LIMITS.maxTotalContentBytes) {
        failPreflight('content_limit_exceeded', 'Decoded content exceeds package limit', {
          actual: totalContentBytes,
          limit: WORKFLOW_PACKAGE_LIMITS.maxTotalContentBytes,
        });
      }
      const expectedFileDigest = computeFileDigest(file.content);
      if (file.sha256 !== expectedFileDigest) {
        failPreflight('file_digest_mismatch', `Digest mismatch for "${file.path}"`);
      }
    }
    if (!paths.has('workflow.yaml') || !paths.has('SKILL.md')) {
      failPreflight(
        'workflow_required_file_missing',
        `Workflow "${workflow.id}" must contain workflow.yaml and SKILL.md`
      );
    }
    const expectedWorkflowDigest = computePackagedWorkflowDigest(workflow.id, workflow.files);
    if (workflow.digest !== expectedWorkflowDigest) {
      failPreflight('workflow_digest_mismatch', `Digest mismatch for workflow "${workflow.id}"`);
    }
  }

  const roots = new Set<string>();
  for (const root of packageValue.roots) {
    if (roots.has(root)) failPreflight('package_root_duplicate', `Duplicate root "${root}"`);
    roots.add(root);
    if (!workflowIds.has(root)) {
      failPreflight('package_root_missing', `Root "${root}" is not embedded in the package`);
    }
  }
  if (packageValue.kind === 'profile') {
    const selected = new Set(packageValue.profile.workflows);
    for (const root of packageValue.roots) {
      if (!selected.has(root)) {
        failPreflight('profile_root_not_selected', `Profile does not select package root "${root}"`);
      }
    }
  }

  const { packageDigest, ...packageWithoutDigest } = packageValue;
  const expectedPackageDigest = computePackageDigest(
    packageValue.kind,
    packageWithoutDigest as PackageWithoutDigest
  );
  if (packageDigest !== expectedPackageDigest) {
    failPreflight('package_digest_mismatch', 'Package digest does not match its content');
  }
}

export function decodePackage(
  bytes: Uint8Array,
  expectedKind?: RasenPackageKind
): RasenPackage {
  if (bytes.byteLength > WORKFLOW_PACKAGE_LIMITS.maxPackageBytes) {
    failPreflight('package_too_large', 'Package exceeds byte limit', {
      actual: bytes.byteLength,
      limit: WORKFLOW_PACKAGE_LIMITS.maxPackageBytes,
    });
  }
  if (bytes.byteLength === 0) failPreflight('package_empty', 'Package is empty');
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    failPreflight('package_bom_forbidden', 'Package must not contain a UTF-8 BOM');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    failPreflight('package_utf8_invalid', 'Package is not valid UTF-8');
  }
  const preflightIssues = preflightJson(text);
  if (preflightIssues.length > 0) {
    failPreflight('package_json_invalid', 'Package failed strict JSON preflight', {
      issues: preflightIssues,
    });
  }

  let unknownValue: unknown;
  try {
    unknownValue = JSON.parse(text);
  } catch (error) {
    failPreflight(
      'package_json_invalid',
      error instanceof Error ? error.message : String(error)
    );
  }
  const schemaResult = RasenPackageSchema.safeParse(unknownValue);
  if (!schemaResult.success) {
    failPreflight('package_schema_invalid', 'Package does not match the strict schema', {
      issues: schemaResult.error.issues.map((issue) => ({
        code: 'schema_issue',
        message: issue.message,
        details: { path: issue.path.map(String).join('.') },
      })),
    });
  }
  const packageValue = schemaResult.data;
  if (expectedKind && packageValue.kind !== expectedKind) {
    failPreflight(
      'package_kind_mismatch',
      `Expected a ${expectedKind} package, received ${packageValue.kind}`
    );
  }
  if (canonicalJson(packageValue) !== text) {
    failPreflight('package_non_canonical', 'Package bytes are not RFC 8785 canonical JSON');
  }
  validatePackageDomain(packageValue);
  return packageValue;
}

