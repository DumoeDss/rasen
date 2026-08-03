import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { Digest, EvidenceRef, JsonValue } from '../contracts.js';
import type { CanonicalRunRecord } from './record.js';
import { domainDigest } from './identity.js';
import { verifyEvidenceBinding, verifyEvidenceRefIdentity } from './evidence.js';
import {
  assertSafeRunPath,
  createNodeSafePathPlumbing,
  SafePathError,
} from './safe-path.js';

// ---------------------------------------------------------------------------
// Evidence schema constants
// ---------------------------------------------------------------------------

export const GAUNTLET_INSPECTION_EVIDENCE_SCHEMA =
  'gauntlet-inspection-evidence/1';
export const GAUNTLET_COMPARISON_EVIDENCE_SCHEMA =
  'gauntlet-comparison-evidence/1';
export const GAUNTLET_CONVERGENCE_ATTESTATION_SCHEMA =
  'gauntlet-convergence-attestation/1';
export const GAUNTLET_ACTOR_ATTESTATION_SCHEMA = 'gauntlet-actor-attestation/1';

// ---------------------------------------------------------------------------
// Domain errors (parallel to TaskLoopDomainError)
// ---------------------------------------------------------------------------

export type GauntletDomainErrorCode =
  | 'gauntlet_input_missing'
  | 'gauntlet_input_invalid'
  | 'gauntlet_bar_missing'
  | 'gauntlet_bar_unprovable'
  | 'gauntlet_bar_mismatch'
  | 'gauntlet_critic_reused'
  | 'gauntlet_evidence_missing'
  | 'gauntlet_false_satisfaction'
  | 'gauntlet_subjective_bar_rejected'
  | 'gauntlet_delivery_guard'
  | 'gauntlet_reconciler_required'
  | 'gauntlet_pipeline_identity'
  | 'gauntlet_smoothing_target_invalid';

export class GauntletDomainError extends Error {
  constructor(
    readonly code: GauntletDomainErrorCode,
    message: string,
    readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = 'GauntletDomainError';
  }
}

// ---------------------------------------------------------------------------
// Canonical reference bar + gauntlet launch input
// ---------------------------------------------------------------------------

/**
 * The frozen reference quality bar: a concrete, inspectable exemplar whose
 * artifacts are resolvable through a pluggable BarAdapter. The bar participates
 * in launch identity and remains unchanged for the Run's lifetime.
 */
export interface ReferenceBar {
  readonly format: 'gauntlet-reference-bar/1';
  /** Adapter domain (e.g. 'code/runnable'). */
  readonly domain: string;
  /** Paths or URLs to the reference artifacts. */
  readonly referenceTargets: readonly string[];
  /** Concrete, inspectable comparison axis (e.g. 'observable-behavior/output'). */
  readonly comparisonAxis: string;
}

/**
 * The canonical gauntlet-loop launch input, parallel to TaskLoopInput.
 * Stored under `inputs.gauntlet` in the Canonical Run Record.
 */
export interface GauntletInput {
  readonly format: 'gauntlet-loop-input/1';
  readonly goal: string;
  readonly artifactTargets: readonly string[];
  readonly bar: ReferenceBar;
  readonly constraints: readonly string[];
}

export interface DecodeGauntletInputOptions {
  readonly projectRoot?: string;
}

// ---------------------------------------------------------------------------
// BarAdapter seam (Decision 6)
// ---------------------------------------------------------------------------

export interface BarObservation {
  /** Observation kind: 'source', 'structure', 'output', 'behavior', etc. */
  readonly kind: string;
  /** Content digest of the observation data. */
  readonly digest: Digest;
  /** Anonymized summary (provenance stripped). */
  readonly summary: string;
}

/**
 * The anonymized, inspectable presentation of a target artifact. Two
 * InspectionResults (candidate and reference) feed into `compare` for the
 * blind A/B judgment.
 */
export interface InspectionResult {
  readonly format: 'gauntlet-inspection/1';
  readonly domain: string;
  /** sha256 of the raw target content (pre-anonymization). */
  readonly targetDigest: Digest;
  /** sha256 of the anonymized presentation. */
  readonly anonymizedDigest: Digest;
  readonly observations: readonly BarObservation[];
  /** Shuffled labels (A, B, C...) assigned during anonymization. */
  readonly anonymizedLabels: readonly string[];
}

/**
 * The mechanical comparison of two InspectionResults. The critic uses this as
 * structured input; the qualitative A/B verdict is the critic's judgment.
 */
export interface BarComparison {
  readonly verdict: 'candidate' | 'reference' | 'tie';
  /** Empty when verdict is 'candidate' or 'tie'. */
  readonly biggestGap: string;
  /** Digests backing the comparison observations. */
  readonly evidenceDigests: readonly Digest[];
}

/**
 * Pluggable seam for domain-specific reference quality bars. v1 ships one
 * implementation (CodeRunnableBarAdapter); additional adapters (visual, prose)
 * arrive without engine changes.
 */
export interface BarAdapter {
  readonly domain: string;
  /**
   * Inspect a target, producing an anonymized inspection result.
   * The workspaceTree is provided for staleness detection.
   * Throws GauntletDomainError on missing target.
   */
  inspect(target: string, workspaceTree?: string): InspectionResult;
  /**
   * Compare a candidate inspection against a reference inspection,
   * producing a mechanical blind A/B verdict.
   */
  compare(
    candidate: InspectionResult,
    reference: InspectionResult
  ): BarComparison;
}

// ---------------------------------------------------------------------------
// Judge result types (slot into GoalCycle's evaluate position)
// ---------------------------------------------------------------------------

export type SatisfactionSource = 'bar-reached' | 'attestation-evidenced';

/**
 * Convergence attestation evidence. Only present when satisfactionSource is
 * 'attestation-evidenced' (the convergence-judge case — group 2 implements
 * the judge Action; the type is here so bar/judge types accommodate both
 * satisfaction sources).
 */
export interface ConvergenceAttestation {
  readonly attestationDigest: Digest;
  readonly userActorDigest: Digest;
  readonly issuedAt: string;
}

/**
 * Gauntlet judge result, slotted into GoalCycle's evaluate-judge/1 contract.
 * Distinguishes a bar-reached judgment (critic blind A/B) from an
 * attestation-evidenced one (user convergence through-judge).
 */
export interface GauntletJudgeResult {
  readonly contract: 'goal-cycle/evaluate-judge/1';
  readonly satisfied: boolean;
  /** Present only when satisfied is true. Distinguishes the satisfaction source. */
  readonly satisfactionSource?: SatisfactionSource;
  /** Blind A/B verdict from the critic's comparison. */
  readonly verdict: 'candidate' | 'reference' | 'tie';
  /** The single largest remaining gap. Present when not satisfied. */
  readonly biggestGap?: string;
  readonly gaps: readonly string[];
  readonly criteria: readonly {
    readonly id: string;
    readonly satisfied: boolean;
    readonly evidence: string;
    readonly evidenceDigests: readonly Digest[];
  }[];
  /** Only for attestation-evidenced satisfaction (convergence-judge). */
  readonly attestation?: ConvergenceAttestation;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

const ReferenceBarSchema = z.strictObject({
  format: z.literal('gauntlet-reference-bar/1'),
  domain: z.string().trim().min(1).max(128),
  referenceTargets: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
  comparisonAxis: z.string().trim().min(1).max(4096),
});

const GauntletInputSchema = z.strictObject({
  format: z.literal('gauntlet-loop-input/1'),
  goal: z.string().trim().min(1).max(16_384),
  artifactTargets: z.array(z.string().trim().min(1).max(4096)).min(1).max(64),
  bar: ReferenceBarSchema,
  constraints: z.array(z.string().trim().min(1).max(4096)).max(64),
});

const GauntletJudgeResultSchema = z.strictObject({
  contract: z.literal('goal-cycle/evaluate-judge/1'),
  satisfied: z.boolean(),
  satisfactionSource: z
    .enum(['bar-reached', 'attestation-evidenced'])
    .optional(),
  verdict: z.enum(['candidate', 'reference', 'tie']),
  biggestGap: z.string().trim().min(1).max(4096).optional(),
  gaps: z.array(z.string().trim().min(1).max(4096)).max(1),
  criteria: z
    .array(
      z.strictObject({
        id: z.string().regex(SAFE_ID),
        satisfied: z.boolean(),
        evidence: z.string().trim().min(1).max(16_384),
        evidenceDigests: z
          .array(z.string().regex(DIGEST_RE))
          .min(1)
          .max(64),
      })
    )
    .max(256),
  attestation: z
    .strictObject({
      attestationDigest: z.string().regex(DIGEST_RE),
      userActorDigest: z.string().regex(DIGEST_RE),
      issuedAt: z.string().trim().min(1).max(128),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function zodIssues(error: z.ZodError): readonly string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length === 0 ? '/' : `/${issue.path.join('/')}`;
    return `${at}: ${issue.message}`;
  });
}

function isOpaqueTarget(target: string): boolean {
  return /^https?:\/\//i.test(target) || /^runtime:/i.test(target);
}

function validateLocalTarget(target: string, projectRoot: string): void {
  if (isOpaqueTarget(target)) return;
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, target);
  try {
    assertSafeRunPath(root, resolved, createNodeSafePathPlumbing());
  } catch (error) {
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Gauntlet target is not physically authorized under the project root: ${target}.`,
      error instanceof SafePathError ? [error.code] : []
    );
  }
}

/**
 * Reject subjective comparison axes. Rasen SHALL NOT replace a missing bar
 * with subjective adjectives (spec: "Uninspectable bar blocks admission").
 */
const SUBJECTIVE_AXIS_PATTERNS: readonly RegExp[] = [
  /^\s*(?:good|clean|nice|beautiful|elegant|simple|readable|high-quality)\s*(?:code|design|quality|ui|ux)?\s*$/i,
  /^\s*(?:quality|subjective|undefined|tbd|todo)\s*$/i,
];

function isSubjectiveAxis(axis: string): boolean {
  return SUBJECTIVE_AXIS_PATTERNS.some((pattern) => pattern.test(axis));
}

function sha256Content(content: string): Digest {
  return `sha256:${createHash('sha256').update(content).digest('hex')}` as Digest;
}

// ---------------------------------------------------------------------------
// Decode gauntlet input (parallel to decodeTaskLoopInput)
// ---------------------------------------------------------------------------

/** Decode, validate, and deeply freeze the canonical gauntlet launch input. */
export function decodeGauntletInput(
  value: unknown,
  options: DecodeGauntletInputOptions
): GauntletInput {
  if (value === undefined || value === null) {
    throw new GauntletDomainError(
      'gauntlet_input_missing',
      'Gauntlet launch input is required before work can be admitted.'
    );
  }
  const parsed = GauntletInputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      issues.join('; '),
      issues
    );
  }
  if (parsed.data.bar.referenceTargets.length === 0) {
    throw new GauntletDomainError(
      'gauntlet_bar_missing',
      'Gauntlet requires at least one concrete reference target.'
    );
  }
  if (isSubjectiveAxis(parsed.data.bar.comparisonAxis)) {
    throw new GauntletDomainError(
      'gauntlet_subjective_bar_rejected',
      'Gauntlet comparison axis must be concrete and inspectable, not a subjective adjective. Rasen does not substitute a subjective bar.'
    );
  }
  if (options.projectRoot !== undefined) {
    for (const target of parsed.data.artifactTargets) {
      validateLocalTarget(target, options.projectRoot);
    }
    for (const target of parsed.data.bar.referenceTargets) {
      validateLocalTarget(target, options.projectRoot);
    }
  }
  return deepFreeze({
    format: parsed.data.format,
    goal: parsed.data.goal,
    artifactTargets: [...parsed.data.artifactTargets],
    bar: {
      format: parsed.data.bar.format,
      domain: parsed.data.bar.domain,
      referenceTargets: [...parsed.data.bar.referenceTargets],
      comparisonAxis: parsed.data.bar.comparisonAxis,
    },
    constraints: [...parsed.data.constraints],
  });
}

// ---------------------------------------------------------------------------
// Canonical digests
// ---------------------------------------------------------------------------

export function referenceBarDigest(bar: ReferenceBar): Digest {
  return domainDigest('gauntlet-reference-bar/1', bar);
}

export function gauntletContractDigest(contract: GauntletInput): Digest {
  return domainDigest('gauntlet-loop-input/1', contract);
}

export function readGauntletInput(
  inputs: Readonly<Record<string, JsonValue>>,
  options: DecodeGauntletInputOptions
): GauntletInput {
  return decodeGauntletInput(inputs.gauntlet, options);
}

// ---------------------------------------------------------------------------
// v1 Code/Runnable BarAdapter (resolves Open Question C4)
// ---------------------------------------------------------------------------

/**
 * Pluggable filesystem/execution surface for the code/runnable inspector.
 * Tests inject synthetic plumbing; the runtime uses the node implementation.
 */
export interface CodeInspectorPlumbing {
  /** Read target content. Returns null if the target does not exist. */
  readonly readTarget: (target: string) => string | null;
  /**
   * Optionally run the target and capture observable output.
   * Returns null if the target cannot be run.
   */
  readonly runTarget?: (
    target: string
  ) => {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  } | null;
}

/** Node.js filesystem plumbing for the code/runnable inspector. */
export function createNodeCodeInspectorPlumbing(
  projectRoot: string
): CodeInspectorPlumbing {
  return Object.freeze({
    readTarget(target: string): string | null {
      try {
        const resolved = path.resolve(projectRoot, target);
        return readFileSync(resolved, 'utf8');
      } catch {
        return null;
      }
    },
    // v1: execution is manual. The critic runs programs and captures output
    // as evidence. Automatic execution is a v2 candidate.
  });
}

/**
 * Deterministic shuffle seeded by a content digest. Used for anonymized
 * presentation order (the "blind" in blind A/B).
 */
function seededShuffle<T>(items: readonly T[], seedDigest: string): readonly T[] {
  const result = [...items];
  let state = parseInt(seedDigest.slice(0, 8), 16);
  const next = (): number => {
    // LCG (glibc parameters) for deterministic pseudo-random ordering.
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return Object.freeze(result);
}

/**
 * Strip provenance (comments, imports, path references) from source content
 * and shuffle structural blocks deterministically. This is the anonymization
 * that makes blind A/B meaningful for the code domain (C4 resolution).
 */
function anonymizeContent(content: string): {
  readonly anonymized: string;
  readonly digest: Digest;
} {
  const lines = content.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return false;
    if (trimmed.startsWith('//')) return false;
    if (trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('/*')) return false;
    if (trimmed.startsWith('*')) return false;
    if (trimmed.startsWith('import ')) return false;
    if (trimmed.startsWith('require(')) return false;
    if (trimmed.startsWith('from ')) return false;
    return true;
  });

  // Split into structural blocks (declarations).
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of filtered) {
    const trimmed = line.trim();
    if (
      /^(?:export\s+)?(?:function|class|const|let|var|interface|type|enum|struct|fn|def|public|private|protected|static)\b/.test(
        trimmed
      )
    ) {
      if (current.length > 0) blocks.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  const contentHash = createHash('sha256').update(content).digest('hex');
  const shuffled = seededShuffle(blocks, contentHash);
  const anonymized = shuffled.map((block) => block.join('\n')).join('\n\n');
  return { anonymized, digest: sha256Content(anonymized) };
}

/**
 * v1 BarAdapter for the code/runnable domain. Implements C4's provisional
 * resolution: anonymized/shuffled artifact presentation with observable
 * behavior/output as the blind comparison axis.
 */
export class CodeRunnableBarAdapter implements BarAdapter {
  readonly domain = 'code/runnable';

  constructor(private readonly plumbing: CodeInspectorPlumbing) {}

  inspect(target: string, workspaceTree?: string): InspectionResult {
    const content = this.plumbing.readTarget(target);
    if (content === null) {
      throw new GauntletDomainError(
        'gauntlet_bar_missing',
        `Gauntlet reference target not found or not readable: ${target}`
      );
    }
    const targetDigest = sha256Content(content);
    const { anonymized, digest: anonymizedDigest } =
      anonymizeContent(content);

    // Structural observations.
    const lines = content.split('\n');
    const declarationCount = (
      content.match(
        /(?:function|class|const|let|var|interface|type|enum|struct|fn|def)\b/g
      ) || []
    ).length;
    const structureFingerprint = `lines=${lines.length};decls=${declarationCount}`;
    const structureDigest = sha256Content(structureFingerprint);

    const observations: BarObservation[] = [
      {
        kind: 'source',
        digest: anonymizedDigest,
        summary: `Anonymized source (${lines.length} lines, ${declarationCount} declarations)`,
      },
      {
        kind: 'structure',
        digest: structureDigest,
        summary: `${declarationCount} declarations, ${lines.length} lines`,
      },
    ];

    // Observable behavior/output (the blind axis) — only if the target is runnable.
    if (this.plumbing.runTarget !== undefined) {
      const output = this.plumbing.runTarget(target);
      if (output !== null) {
        const outputContent = `exit=${output.exitCode}\nstdout=${output.stdout}\nstderr=${output.stderr}`;
        observations.push({
          kind: 'output',
          digest: sha256Content(outputContent),
          summary: `exit=${output.exitCode}, stdout=${output.stdout.length}b, stderr=${output.stderr.length}b`,
        });
      }
    }

    // Staleness check: if a workspace tree is provided, the observation
    // captures the digest at this tree, not a future one.
    const labels = observations.map((_, index) =>
      String.fromCharCode(65 + index)
    );

    return deepFreeze({
      format: 'gauntlet-inspection/1',
      domain: this.domain,
      targetDigest,
      anonymizedDigest,
      observations: Object.freeze(observations),
      anonymizedLabels: Object.freeze(labels),
      ...(workspaceTree !== undefined
        ? { workspaceTree }
        : {}),
    }) as InspectionResult;
  }

  compare(
    candidate: InspectionResult,
    reference: InspectionResult
  ): BarComparison {
    const candidateOutput = candidate.observations.find(
      (obs) => obs.kind === 'output'
    );
    const referenceOutput = reference.observations.find(
      (obs) => obs.kind === 'output'
    );

    // Primary axis: observable behavior/output.
    if (candidateOutput !== undefined && referenceOutput !== undefined) {
      if (candidateOutput.digest === referenceOutput.digest) {
        return {
          verdict: 'tie',
          biggestGap: '',
          evidenceDigests: [candidateOutput.digest, referenceOutput.digest],
        };
      }
      return {
        verdict: 'reference',
        biggestGap:
          'Candidate observable output does not match the reference behavior.',
        evidenceDigests: [candidateOutput.digest, referenceOutput.digest],
      };
    }

    // Fallback axis: structural completeness.
    const candidateStruct = candidate.observations.filter(
      (obs) => obs.kind === 'structure'
    );
    const referenceStruct = reference.observations.filter(
      (obs) => obs.kind === 'structure'
    );
    const candidateCount = candidateStruct.length;
    const referenceCount = referenceStruct.length;

    const allDigests = [
      ...candidate.observations.map((obs) => obs.digest),
      ...reference.observations.map((obs) => obs.digest),
    ];

    if (candidateCount >= referenceCount && candidateCount > 0) {
      return {
        verdict: 'candidate',
        biggestGap: '',
        evidenceDigests: allDigests,
      };
    }
    return {
      verdict: 'reference',
      biggestGap: `Reference has ${referenceCount} structural observation(s); candidate has ${candidateCount}.`,
      evidenceDigests: allDigests,
    };
  }
}

// ---------------------------------------------------------------------------
// Judge result validation (parallel to validateTaskLoopJudgment)
// ---------------------------------------------------------------------------

export interface ValidateGauntletJudgmentInput {
  readonly contract: GauntletInput;
  readonly result: unknown;
  readonly rawEvidence: readonly EvidenceRef[];
  readonly criticSessionIdentity: string;
  readonly priorCriticSessionIdentities: readonly string[];
  readonly evidenceContext?: Readonly<{
    record: CanonicalRunRecord;
    actionId: string;
    treeDigest: Digest;
  }>;
}

function verifyGauntletEvidenceRef(
  ref: EvidenceRef,
  context: NonNullable<ValidateGauntletJudgmentInput['evidenceContext']>,
  schema: string
): void {
  try {
    verifyEvidenceRefIdentity(ref);
    verifyEvidenceBinding(ref, {
      planningSpaceId: context.record.change.planningSpaceId,
      changeInstanceId: context.record.change.instanceId,
      projectId: context.record.change.projectId,
      changeId: context.record.change.changeId,
      runId: context.record.runId,
      actionId: context.actionId as EvidenceRef['binding']['actionId'],
      schema,
      treeDigest: context.treeDigest,
    });
  } catch (error) {
    throw new GauntletDomainError(
      'gauntlet_evidence_missing',
      `Gauntlet evidence is not bound to the expected Run, Action, schema, and workspace tree: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Apply gauntlet-specific checks around the generic evaluate-judge wire result.
 * Validates the blind A/B verdict, satisfaction source, evidence binding, and
 * critic freshness.
 */
export function validateGauntletJudgment(
  input: ValidateGauntletJudgmentInput
): GauntletJudgeResult {
  // Fresh-critic guard (parallel to task-loop's critic-reuse guard).
  if (
    input.priorCriticSessionIdentities.includes(input.criticSessionIdentity)
  ) {
    throw new GauntletDomainError(
      'gauntlet_critic_reused',
      'Every gauntlet round requires a critic identity not used by an earlier round.'
    );
  }

  const parsed = GauntletJudgeResultSchema.safeParse(input.result);
  if (!parsed.success) {
    const issues = zodIssues(parsed.error);
    throw new GauntletDomainError(
      'gauntlet_input_invalid',
      `Gauntlet judgment is malformed: ${issues.join('; ')}`,
      issues
    );
  }

  // Verify evidence identity and binding.
  const evidenceByDigest = new Map<string, EvidenceRef>();
  for (const ref of input.rawEvidence) {
    try {
      verifyEvidenceRefIdentity(ref);
    } catch (error) {
      throw new GauntletDomainError(
        'gauntlet_evidence_missing',
        `Gauntlet evidence identity is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (evidenceByDigest.has(ref.evidenceDigest)) {
      throw new GauntletDomainError(
        'gauntlet_evidence_missing',
        `Gauntlet evidence digest ${ref.evidenceDigest} is duplicated.`
      );
    }
    evidenceByDigest.set(ref.evidenceDigest, ref);
    if (input.evidenceContext !== undefined) {
      verifyGauntletEvidenceRef(
        ref,
        input.evidenceContext,
        GAUNTLET_COMPARISON_EVIDENCE_SCHEMA
      );
    }
  }

  // Verify criterion evidence digests map to committed evidence.
  const mappedDigests = new Set<string>();
  for (const criterion of parsed.data.criteria) {
    if (
      !input.contract.artifactTargets.some((target) =>
        criterion.evidence.includes(target)
      ) &&
      !input.contract.bar.referenceTargets.some((target) =>
        criterion.evidence.includes(target)
      )
    ) {
      throw new GauntletDomainError(
        'gauntlet_evidence_missing',
        `Gauntlet criterion ${criterion.id} does not identify a frozen artifact or reference target.`
      );
    }
    for (const digest of criterion.evidenceDigests) {
      if (!evidenceByDigest.has(digest)) {
        throw new GauntletDomainError(
          'gauntlet_evidence_missing',
          `Gauntlet criterion ${criterion.id} refers to evidence ${digest} that is not committed by this judge Action.`
        );
      }
      mappedDigests.add(digest);
    }
  }
  if (
    input.rawEvidence.length === 0 ||
    mappedDigests.size !== evidenceByDigest.size
  ) {
    throw new GauntletDomainError(
      'gauntlet_evidence_missing',
      'Every committed judge evidence ref must map explicitly to at least one frozen criterion.'
    );
  }

  const data = parsed.data;

  // --- Satisfaction validation rules ---

  if (data.satisfied) {
    // Satisfied: must have a satisfaction source.
    if (data.satisfactionSource === undefined) {
      throw new GauntletDomainError(
        'gauntlet_false_satisfaction',
        'A satisfied gauntlet judgment must declare its satisfaction source (bar-reached or attestation-evidenced).'
      );
    }

    if (data.satisfactionSource === 'bar-reached') {
      // Bar-reached: verdict must be candidate or tie, no gaps.
      if (
        data.verdict !== 'candidate' &&
        data.verdict !== 'tie'
      ) {
        throw new GauntletDomainError(
          'gauntlet_false_satisfaction',
          `Bar-reached satisfaction requires verdict 'candidate' or 'tie', got '${data.verdict}'.`
        );
      }
      if (data.gaps.length !== 0 || data.biggestGap !== undefined) {
        throw new GauntletDomainError(
          'gauntlet_false_satisfaction',
          'Bar-reached satisfaction requires zero remaining gaps.'
        );
      }
      // Bar-reached: the bar is intentionally unreachable; an honest bar-reached
      // claim is rare and must be backed by real evidence.
    } else {
      // Attestation-evidenced: attestation must be present.
      if (data.attestation === undefined) {
        throw new GauntletDomainError(
          'gauntlet_false_satisfaction',
          'Attestation-evidenced satisfaction requires a convergence attestation.'
        );
      }
      // The A/B verdict and gaps carry the last comparison for audit.
      // Criteria need not all be satisfied — attestation overrides.
    }
  } else {
    // Unsatisfied: verdict must be 'reference', exactly one gap.
    if (data.satisfactionSource !== undefined) {
      throw new GauntletDomainError(
        'gauntlet_false_satisfaction',
        `An unsatisfied gauntlet judgment must not declare satisfactionSource '${data.satisfactionSource}'.`
      );
    }
    if (data.verdict !== 'reference') {
      throw new GauntletDomainError(
        'gauntlet_false_satisfaction',
        `An unsatisfied gauntlet judgment requires verdict 'reference', got '${data.verdict}'.`
      );
    }
    if (
      data.gaps.length !== 1 ||
      data.biggestGap !== data.gaps[0]
    ) {
      throw new GauntletDomainError(
        'gauntlet_false_satisfaction',
        'An unsatisfied gauntlet judgment requires exactly one largest gap.'
      );
    }
    if (data.attestation !== undefined) {
      throw new GauntletDomainError(
        'gauntlet_false_satisfaction',
        'An unsatisfied gauntlet judgment must not carry a convergence attestation.'
      );
    }
  }

  const { attestation: rawAttestation, ...rest } = data;
  return deepFreeze({
    ...rest,
    gaps: [...data.gaps],
    criteria: data.criteria.map((criterion) => ({
      ...criterion,
      evidenceDigests: criterion.evidenceDigests.map(
        (digest) => digest as Digest
      ),
    })),
    ...(rawAttestation !== undefined
      ? {
          attestation: {
            attestationDigest: rawAttestation.attestationDigest as Digest,
            userActorDigest: rawAttestation.userActorDigest as Digest,
            issuedAt: rawAttestation.issuedAt,
          } as ConvergenceAttestation,
        }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Bar inspectability guard (task 1.5)
// ---------------------------------------------------------------------------

/**
 * Assert that the frozen reference bar is inspectable before any work is
 * admitted. Rejects an uninspectable or missing bar with a stable gauntlet code.
 * Rasen SHALL NOT substitute a subjective bar or start a spec workflow.
 */
export function assertGauntletBarInspectable(
  input: GauntletInput,
  adapter?: BarAdapter
): void {
  // Structural checks (already enforced by decodeGauntletInput, but this is
  // the belt-and-suspenders guard called explicitly before work).
  if (input.bar.referenceTargets.length === 0) {
    throw new GauntletDomainError(
      'gauntlet_bar_missing',
      'Gauntlet requires at least one concrete reference target before admitting a builder.'
    );
  }
  if (isSubjectiveAxis(input.bar.comparisonAxis)) {
    throw new GauntletDomainError(
      'gauntlet_subjective_bar_rejected',
      'Gauntlet comparison axis is subjective. Rasen does not substitute a subjective bar.'
    );
  }

  // If an adapter is provided, verify it can inspect every reference target.
  // This is the concrete "inspectable" check — the bar must resolve through
  // the BarAdapter, not be a subjective adjective.
  if (adapter !== undefined) {
    if (adapter.domain !== input.bar.domain) {
      throw new GauntletDomainError(
        'gauntlet_bar_unprovable',
        `Gauntlet bar domain '${input.bar.domain}' does not match available adapter '${adapter.domain}'.`
      );
    }
    for (const target of input.bar.referenceTargets) {
      let inspection: InspectionResult;
      try {
        inspection = adapter.inspect(target);
      } catch (error) {
        throw new GauntletDomainError(
          'gauntlet_bar_unprovable',
          `Gauntlet reference target ${target} is not inspectable: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (inspection.observations.length === 0) {
        throw new GauntletDomainError(
          'gauntlet_bar_unprovable',
          `Gauntlet reference target ${target} produced no inspectable observations.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plan identity helpers (parallel to task-loop's isTaskLoopRun)
// ---------------------------------------------------------------------------

export function gauntletDomainResultFromJudge(
  result: GauntletJudgeResult
): readonly {
  readonly id: string;
  readonly satisfied: boolean;
  readonly evidence: string;
}[] {
  return result.criteria;
}
