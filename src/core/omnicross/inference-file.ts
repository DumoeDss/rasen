import * as fs from 'node:fs';
import { TextDecoder } from 'node:util';
import { z } from 'zod';

import {
  FrozenInferenceRouteSchema,
  OmniCrossRouteError,
  RouteAttemptIdentitySchema,
  type FrozenInferenceRoute,
  type RouteAttemptIdentity,
} from './contracts.js';

export const RASEN_INFERENCE_FILE_SCHEMA = 'rasen.inference/1' as const;
export const MAX_INFERENCE_FILE_BYTES = 64 * 1024;

export const InferenceFileSchema = z
  .object({
    schemaVersion: z.literal(RASEN_INFERENCE_FILE_SCHEMA),
    route: FrozenInferenceRouteSchema,
    attempt: RouteAttemptIdentitySchema,
  })
  .strict();
export type InferenceFile = Readonly<z.infer<typeof InferenceFileSchema>>;

function invalid(message: string): never {
  throw new OmniCrossRouteError({
    kind: 'invalid-input',
    message,
    retryable: false,
  });
}

/** Bounded, strict UTF-8 read. The file is credential-free and safe to persist in ephemera. */
export function readInferenceFile(filePath: string): InferenceFile {
  let bytes: Buffer;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return invalid(`Inference file is not a regular file: ${filePath}`);
    if (stat.size === 0 || stat.size > MAX_INFERENCE_FILE_BYTES) {
      return invalid(`Inference file must be between 1 and ${MAX_INFERENCE_FILE_BYTES} bytes.`);
    }
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    return invalid(`Inference file is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid('Inference file is not valid UTF-8.');
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (error) {
    return invalid(`Inference file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = InferenceFileSchema.safeParse(json);
  if (!parsed.success) {
    return invalid(`Inference file contract is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return Object.freeze(parsed.data);
}

export interface InferenceCrossCheck {
  readonly runtime: 'claude' | 'codex';
  readonly model?: string;
  readonly resumeSessionId?: string;
  readonly route?: FrozenInferenceRoute;
  readonly attempt?: RouteAttemptIdentity;
}

export function crossCheckInferenceFile(
  file: InferenceFile,
  expected: InferenceCrossCheck
): void {
  if (file.route.runtime !== expected.runtime) {
    return invalid(`Inference runtime ${file.route.runtime} does not match dispatch runtime ${expected.runtime}.`);
  }
  if (!expected.model || file.route.model !== expected.model) {
    return invalid('The dispatch model must be present and exactly match the frozen inference model.');
  }
  if (
    expected.resumeSessionId !== undefined &&
    file.attempt.sessionId !== expected.resumeSessionId
  ) {
    return invalid('The resume identity does not match the frozen inference attempt attribution.');
  }
  if (expected.route !== undefined) {
    assertSameFrozenInferenceIdentity(file.route, expected.route);
  }
  if (
    expected.attempt !== undefined &&
    JSON.stringify(file.attempt) !== JSON.stringify(expected.attempt)
  ) {
    return invalid('Inference attempt attribution does not match the admitted attempt.');
  }
}

export function sameUpstream(
  left: FrozenInferenceRoute['upstream'],
  right: FrozenInferenceRoute['upstream']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertSameFrozenInferenceIdentity(
  left: FrozenInferenceRoute,
  right: FrozenInferenceRoute
): void {
  if (
    left.broker !== right.broker ||
    left.runtime !== right.runtime ||
    left.model !== right.model ||
    !sameUpstream(left.upstream, right.upstream) ||
    left.connection.endpoint !== right.connection.endpoint ||
    left.connection.controlTokenEnv !== right.connection.controlTokenEnv ||
    left.connection.requestTimeoutMs !== right.connection.requestTimeoutMs ||
    left.connection.leaseTtlSeconds !== right.connection.leaseTtlSeconds ||
    left.connection.configRevision !== right.connection.configRevision
  ) {
    return invalid('Frozen inference identity does not match the admitted route.');
  }
}

export function createInferenceFile(
  route: FrozenInferenceRoute,
  attempt: RouteAttemptIdentity
): InferenceFile {
  return Object.freeze(
    InferenceFileSchema.parse({
      schemaVersion: RASEN_INFERENCE_FILE_SCHEMA,
      route,
      attempt,
    })
  );
}
