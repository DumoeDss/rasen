/**
 * The decomposition document reader (design D3) — pure over the document's
 * bytes: same bytes in, same node inputs out, no filesystem, no clock.
 *
 * A decomposition is the OPPOSITE shape of a portfolio run: nothing exists
 * yet, everything is proposal. The strictness below is what makes
 * "machine-proposed" a meaningful provenance distinct from manual
 * `--from-file` authoring, where the guidance fields stay optional:
 *
 *   - every node is `kind: intent` — binding EXISTING Changes is
 *     `--from-portfolio`'s question, and a change-kind node is refused
 *     pointing there rather than silently re-typed;
 *   - every node carries a `suggestedPipeline` and at least one of a
 *     `rationale`/`uncertainty` — an unsuggested or unexplained proposal is
 *     not a reviewable one;
 *   - a node MAY carry `lifecycle: required | 'optional'` (absent reads
 *     `required`). The authored lifecycle is compiled ONTO the published
 *     intent node: the REVISION, not the document, is the durable record of
 *     the required/optional proposal, so the review surface, the revision
 *     delta, and every later consumer read one record instead of reconciling
 *     two. The document stays byte-identical as authored input.
 *
 * Everything else — normalization, duplicate/cycle/dangling-dependency
 * refusal, the planning-member target gate, the registry check on the
 * suggestion — is `publishPlan`'s existing discipline, inherited unchanged
 * through the compiled inputs (design D3: no parallel implementation).
 */
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { StoreError } from '../store/errors.js';
import { formatZodIssues } from '../zod-issues.js';
import type { ExecutionPlanIntentNodeInput } from '../store/issues/types.js';

/**
 * The document node's authoring shape: the intent-node fields plus the two
 * proposal-only additions (`lifecycle` and the REQUIRED guidance fields).
 * Strict, because the document is machine-authored and an unknown field is a
 * vocabulary drift the refusals should name rather than absorb.
 */
const DecompositionNodeSchema = z
  .object({
    nodeId: z.string(),
    kind: z.string(),
    projectId: z.string(),
    targetLineId: z.string(),
    summary: z.string(),
    dependsOn: z.array(z.string()).optional(),
    lifecycle: z.enum(['required', 'optional']).optional(),
    suggestedPipeline: z.string().optional(),
    rationale: z.string().optional(),
    uncertainty: z.string().optional(),
  })
  .strict();

const DecompositionDocumentSchema = z
  .object({
    nodes: z.array(DecompositionNodeSchema),
  })
  .strict();

function decompositionError(
  code: 'issue_plan_decomposition_unreadable' | 'issue_plan_decomposition_invalid',
  message: string,
  details: { target?: string; fix?: string } = {}
): StoreError {
  return new StoreError(message, code, {
    ...(details.target === undefined ? {} : { target: details.target }),
    ...(details.fix === undefined ? {} : { fix: details.fix }),
  });
}

/** Whether a guidance value is present and non-blank. */
function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/**
 * Parses a decomposition document's bytes into the intent-node inputs the
 * Issue's next revision publishes. Refuses, in this order, each way a
 * document is not a decomposition: unreadable-shaped YAML or a shape outside
 * the vocabulary (`issue_plan_decomposition_invalid`), a node that names an
 * existing Change instance (`issue_plan_decomposition_change_node`, naming
 * `--from-portfolio`), and a node missing its suggestion or both of its
 * rationale/uncertainty (`issue_plan_decomposition_field_missing`). Every
 * refusal names the node and the field it is about.
 */
export function parseDecompositionDocument(
  content: string,
  documentPath: string
): readonly ExecutionPlanIntentNodeInput[] {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (error) {
    throw decompositionError(
      'issue_plan_decomposition_invalid',
      `The decomposition document at ${documentPath} does not parse as YAML: ${
        error instanceof Error ? error.message : String(error)
      }.`,
      { target: documentPath, fix: 'Repair the document; a record that exists but does not parse is reported, never treated as absent.' }
    );
  }
  const result = DecompositionDocumentSchema.safeParse(raw);
  if (!result.success) {
    throw decompositionError(
      'issue_plan_decomposition_invalid',
      `The decomposition document at ${documentPath} is not a decomposition document: ${formatZodIssues(
        result.error
      )}.`,
      {
        target: documentPath,
        fix: 'Author the document as "nodes:" followed by one "- nodeId/kind: intent/projectId/targetLineId/summary/suggestedPipeline/(rationale|uncertainty)" item per proposed piece of work.',
      }
    );
  }

  const nodes: ExecutionPlanIntentNodeInput[] = [];
  for (const node of result.data.nodes) {
    const nodeId = node.nodeId.trim().length > 0 ? node.nodeId : '(unnamed node)';
    if (node.kind === 'change') {
      throw new StoreError(
        `The decomposition document at ${documentPath} carries node '${nodeId}' with kind: change; a decomposition proposes work that does not exist yet, and binding existing Change instances is --from-portfolio's question.`,
        'issue_plan_decomposition_change_node',
        {
          target: documentPath,
          fix: `Remove the change-kind node from the decomposition, or publish with --from-portfolio to bind '${nodeId}' as the existing Change it names.`,
        }
      );
    }
    if (!present(node.suggestedPipeline)) {
      throw new StoreError(
        `The decomposition document at ${documentPath} carries node '${nodeId}' without a suggestedPipeline; a machine-proposed node names the pipeline it proposes to run.`,
        'issue_plan_decomposition_field_missing',
        {
          target: documentPath,
          fix: `Add suggestedPipeline: <pipeline name> to node '${nodeId}' (validated against the pipeline registry at publication).`,
        }
      );
    }
    if (!present(node.rationale) && !present(node.uncertainty)) {
      throw new StoreError(
        `The decomposition document at ${documentPath} carries node '${nodeId}' with neither a rationale nor an uncertainty; a proposal a reviewer cannot see the reasoning behind is not reviewable.`,
        'issue_plan_decomposition_field_missing',
        {
          target: documentPath,
          fix: `Add a rationale (why the work exists as this node) or an uncertainty (what the decomposer was unsure about) to node '${nodeId}'.`,
        }
      );
    }
    nodes.push({
      nodeId: node.nodeId,
      kind: 'intent',
      projectId: node.projectId,
      targetLineId: node.targetLineId,
      summary: node.summary,
      ...(node.dependsOn === undefined ? {} : { dependsOn: node.dependsOn }),
      // The authored `lifecycle` compiles ONTO the intent node: the revision —
      // not the document — is the durable record of the required/optional
      // proposal. An explicit `required` forwards too and canonicalizes to
      // omission downstream, exactly as a change node's does.
      ...(node.lifecycle === undefined ? {} : { lifecycle: node.lifecycle }),
      suggestedPipeline: node.suggestedPipeline,
      ...(present(node.rationale) ? { rationale: node.rationale } : {}),
      ...(present(node.uncertainty) ? { uncertainty: node.uncertainty } : {}),
    });
  }
  return nodes;
}
