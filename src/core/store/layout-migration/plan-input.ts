import * as path from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { formatZodIssues } from '../../zod-issues.js';
import { StoreError } from '../errors.js';
import type { ExecutionPlanNodeInput } from '../issues/types.js';
import type { StoreLayoutMigrationDependencies } from './dependencies.js';
import { sha256Hex, storeRelative } from './flat-source.js';
import { hasTypicalMojibake } from './strict-text.js';

const Base = {
  nodeId: z.string().min(1),
  projectId: z.string().min(1),
  targetLineId: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
};

const CanonicalChangeNode = z
  .object({
    ...Base,
    kind: z.literal('change'),
    changeInstanceId: z.string().min(1),
    changeAlias: z.string().min(1).optional(),
  })
  .strict();

const SourceChangeNode = z
  .object({
    ...Base,
    kind: z.literal('change'),
    sourceChange: z.string().min(1),
  })
  .strict();

const IntentNode = z
  .object({
    ...Base,
    kind: z.literal('intent'),
    summary: z.string().min(1).max(500),
  })
  .strict();

const InputSchema = z
  .object({ nodes: z.array(z.union([CanonicalChangeNode, SourceChangeNode, IntentNode])) })
  .strict();

export type MigrationPlanInputNode =
  | ExecutionPlanNodeInput
  | {
      readonly nodeId: string;
      readonly kind: 'change';
      readonly projectId: string;
      readonly targetLineId: string;
      readonly sourceChange: string;
      readonly dependsOn?: readonly string[];
    };

export interface LoadedMigrationPlanInput {
  readonly path: string;
  readonly relative: string;
  readonly digest: string;
  readonly nodes: readonly MigrationPlanInputNode[];
}

function inputError(message: string): StoreError {
  return new StoreError(message, 'migration_plan_input_invalid', {
    target: 'migration.plan-input',
    fix: 'Use a tracked, clean, strict UTF-8 plan file inside the Store and re-plan.',
  });
}

function decodeStrict(bytes: Buffer, target: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw inputError(`Plan input ${target} has a UTF-8 BOM.`);
  }
  const text = bytes.toString('utf8');
  if (text.includes('\ufffd') || !Buffer.from(text, 'utf8').equals(bytes)) {
    throw inputError(`Plan input ${target} is not strict UTF-8.`);
  }
  if (hasTypicalMojibake(text)) {
    throw inputError(`Plan input ${target} contains a mojibake sentinel.`);
  }
  return text;
}

export async function loadMigrationPlanInput(
  dependencies: StoreLayoutMigrationDependencies,
  storeRoot: string,
  inputPath: string
): Promise<LoadedMigrationPlanInput> {
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(storeRoot, inputPath);
  let canonicalRoot: string;
  let canonicalCandidate: string;
  try {
    canonicalRoot = await dependencies.fs.canonicalizeExistingPath(storeRoot);
    canonicalCandidate = await dependencies.fs.canonicalizeExistingPath(candidate);
  } catch (error) {
    throw inputError(
      `Plan input ${candidate} cannot be resolved: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const containment = path.relative(canonicalRoot, canonicalCandidate);
  if (
    containment.length === 0 ||
    containment === '..' ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    throw inputError(`Plan input ${candidate} is outside the Store worktree ${storeRoot}.`);
  }
  const relative = storeRelative(storeRoot, candidate);
  await dependencies.checkpoint({ kind: 'plan-input-read', path: candidate });
  const bytes = await dependencies.fs.readBytes(candidate);
  if (bytes === null) throw inputError(`Plan input ${relative} does not exist as a file.`);
  const text = decodeStrict(bytes, relative);
  const headText = await dependencies.git.showBlob(storeRoot, 'HEAD', relative);
  if (headText === null) {
    throw inputError(`Plan input ${relative} is not tracked at Store HEAD.`);
  }
  const status = await dependencies.git.status(storeRoot, [relative]);
  if (status.length > 0 || !Buffer.from(headText, 'utf8').equals(bytes)) {
    throw inputError(
      `Plan input ${relative} is not byte-identical across Store HEAD, index, and worktree.`
    );
  }

  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw inputError(
      `Plan input ${relative} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = InputSchema.safeParse(raw);
  if (!parsed.success) {
    throw inputError(`Plan input ${relative} is invalid: ${formatZodIssues(parsed.error)}`);
  }
  return Object.freeze({
    path: candidate,
    relative,
    digest: sha256Hex(bytes),
    nodes: Object.freeze(parsed.data.nodes),
  });
}
