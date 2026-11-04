/**
 * `issue-plan-publication` — the compiled plan-publication channels'
 * contracts (the portfolio→plan channel and the decomposition→plan channel).
 *
 * Each channel is a COMPOSITION over `StoreIssues.publishPlan`, not a store
 * mutation: it compiles a source into plan node inputs and hands them to the
 * existing publication discipline (ordinal, digest, immutable history, one
 * lock) unchanged. Everything this module types is therefore either an INPUT
 * to that composition or a refusal that answers "why this source did not
 * become a revision".
 *
 * The refusal taxonomy is deliberately TWO-shaped:
 *
 *   - the codes these channels MINT (`issue_plan_portfolio_*`,
 *     `issue_plan_decomposition_*`, `issue_plan_source_*`) are new and live
 *     here, because the closed `StoreIssueErrorCode` union belongs to the
 *     mutation vocabulary below the composition;
 *   - the reference-resolution codes REUSE the existing `issue_reference_*`
 *     family and `store_query_ref_unreadable`, so one family of diagnostics
 *     answers for every publication source — manual `--from-file` names the
 *     instance id it was given; the portfolio channel names the CHILD and the
 *     name-keyed search that found (or did not find) it (design D2); the
 *     decomposition channel publishes intent nodes only, so its refusals are
 *     about the DOCUMENT's own shape.
 */
import type { ExecutionPlanResult } from '../store/issues/types.js';

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

/**
 * One portfolio publication: the Issue receiving the revision, the parent
 * Change whose portfolio run-state is compiled, and the same Store selector /
 * machine context every Issue mutation accepts.
 *
 * `startPath` is the working directory the command runs from. The parent is
 * resolved from it exactly the way `rasen pipeline resume` resolves a change —
 * publication is a read of the run-state through the one placement seam, so it
 * inherits resume's placement rules rather than inventing a second locator.
 */
export interface PublishPlanFromPortfolioInput {
  readonly issueId: string;
  readonly parent: string;
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
}

/**
 * One decomposition publication: the Issue receiving the revision, the
 * decomposition document to read, and the same Store selector / machine
 * context every Issue mutation accepts.
 *
 * The document path is caller-supplied (a decomposition is produced by an
 * agent with a working directory, typically the change's evidence directory)
 * — this channel defines no placement surface of its own. The document is
 * read-only input: publication leaves its bytes identical, mirroring the
 * portfolio run-state rule.
 */
export interface PublishPlanFromDecompositionInput {
  readonly issueId: string;
  readonly documentPath: string;
  readonly store?: string;
  readonly startPath: string;
  readonly globalDataDir?: string;
  /**
   * Registry membership test for node `suggestedPipeline` values, threaded to
   * `publishPlan` — the same injected seam the CLI composes for
   * `store issue start --pipeline`.
   */
  readonly pipelineKnown?: (name: string) => boolean;
}

// -----------------------------------------------------------------------------
// Refusal taxonomy
// -----------------------------------------------------------------------------

/** The portfolio-location refusals, each naming what was searched or read. */
export type IssuePlanPortfolioRefusalCode =
  /** The working directory resolves no planning root, so no placement chain exists. */
  | 'issue_plan_portfolio_root_unresolvable'
  /** No run-state anywhere in the chain; every location searched is listed. */
  | 'issue_plan_portfolio_absent'
  /** A run-state exists but does not read back. Never treated as absent. */
  | 'issue_plan_portfolio_invalid'
  /** The record's own parent disagrees with the parent the operator named. */
  | 'issue_plan_portfolio_parent_mismatch'
  /** The record reads back with no children — there is nothing to publish. */
  | 'issue_plan_portfolio_children_empty';

/** The CLI source-exclusivity refusals for the `plan` command. */
export type IssuePlanSourceCode =
  | 'issue_plan_source_conflict'
  | 'issue_plan_source_required';

/** The decomposition-document refusals, each naming the node and field. */
export type IssuePlanDecompositionRefusalCode =
  /**
   * The document does not read back — absent file, unreadable bytes. Never
   * treated as absent-and-skipped: a document the operator named is a fact.
   */
  | 'issue_plan_decomposition_unreadable'
  /** The document reads but is not a decomposition document (not YAML, no `nodes:`, an unknown field, a node shape outside the vocabulary). */
  | 'issue_plan_decomposition_invalid'
  /** A node names an existing Change instance — `--from-portfolio`'s question. */
  | 'issue_plan_decomposition_change_node'
  /** A node is missing its suggested pipeline, or carries neither a rationale nor an uncertainty. */
  | 'issue_plan_decomposition_field_missing';

/**
 * Every refusal code this channel can refuse with. The `issue_reference_*`
 * family and `store_query_ref_unreadable` are the existing codes, restated
 * here so the union documents the whole surface a caller must be ready to
 * answer; the underlying strings stay owned by `store/issues`.
 */
export type IssuePlanPublicationRefusalCode =
  | IssuePlanPortfolioRefusalCode
  | IssuePlanDecompositionRefusalCode
  | IssuePlanSourceCode
  | 'issue_reference_unresolved'
  | 'issue_reference_uncommitted'
  | 'issue_reference_ambiguous'
  | 'issue_reference_foreign_store'
  | 'store_query_ref_unreadable';

// -----------------------------------------------------------------------------
// Results
// -----------------------------------------------------------------------------

/**
 * Where a published revision came from. Carries the located source PATH as a
 * machine-local locator (never authority), the same status every write report
 * gives a local path.
 */
export type IssuePlanPublicationSource =
  | {
      readonly kind: 'portfolio';
      readonly parent: string;
      /** The absolute path the run-state was read from. */
      readonly statePath: string;
      readonly childCount: number;
    }
  | {
      readonly kind: 'decomposition';
      /** The absolute path the decomposition document was read from. */
      readonly documentPath: string;
      readonly nodeCount: number;
    };

/** The `publishPlan` result, plus the source block a portfolio publication reports. */
export type IssuePlanPublicationResult = ExecutionPlanResult & {
  readonly source: IssuePlanPublicationSource;
};

/**
 * The committed identity one portfolio child resolved to: exactly the fields a
 * plan's change node names a Change instance by. Derived from committed Store
 * evidence only — never from the run-state, which carries no instance ids.
 */
export interface ResolvedChildIdentity {
  readonly changeInstanceId: string;
  readonly projectId: string;
  readonly targetLineId: string;
}
