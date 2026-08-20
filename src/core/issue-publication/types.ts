/**
 * `issue-plan-publication` — the portfolio→plan publication channel's
 * contracts.
 *
 * The channel is a COMPOSITION over `StoreIssues.publishPlan`, not a store
 * mutation: it compiles a parent Change's portfolio run-state into plan node
 * inputs and hands them to the existing publication discipline (ordinal,
 * digest, immutable history, one lock) unchanged (design D1/D3). Everything
 * this module types is therefore either an INPUT to that composition or a
 * refusal that answers "why this portfolio did not become a revision".
 *
 * The refusal taxonomy is deliberately TWO-shaped:
 *
 *   - the codes this channel MINTS (`issue_plan_portfolio_*`,
 *     `issue_plan_source_*`) are new and live here, because the closed
 *     `StoreIssueErrorCode` union belongs to the five-mutation vocabulary this
 *     change does not touch;
 *   - the child-resolution codes REUSE the existing `issue_reference_*` family
 *     and `store_query_ref_unreadable`, so one family of diagnostics answers
 *     for both publication sources — manual `--from-file` names the instance
 *     id it was given; this channel names the CHILD and the name-keyed search
 *     that found (or did not find) it (design D2).
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

/**
 * Every refusal code this channel can refuse with. The `issue_reference_*`
 * family and `store_query_ref_unreadable` are the existing codes, restated
 * here so the union documents the whole surface a caller must be ready to
 * answer; the underlying strings stay owned by `store/issues`.
 */
export type IssuePlanPublicationRefusalCode =
  | IssuePlanPortfolioRefusalCode
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
 * Where a published revision came from. Carries the located run-state PATH as
 * a machine-local locator (never authority), the same status every write
 * report gives a local path.
 */
export interface IssuePlanPublicationSource {
  readonly kind: 'portfolio';
  readonly parent: string;
  /** The absolute path the run-state was read from. */
  readonly statePath: string;
  readonly childCount: number;
}

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
