/**
 * `issue-plan-publication` — the single public entry point.
 *
 * The compiler and the child-name resolution are pure over their inputs; the
 * orchestration composes the resume placement seam, the store query's evidence
 * readers, and the `StoreIssues.publishPlan` mutation without giving
 * `store/issues` or `pipeline-registry` any upward dependency (design D1/D2).
 * `pipeline-registry` is imported read-only — its readers are reused, its
 * frozen surface untouched.
 */
export type {
  IssuePlanPortfolioRefusalCode,
  IssuePlanPublicationRefusalCode,
  IssuePlanPublicationResult,
  IssuePlanPublicationSource,
  IssuePlanSourceCode,
  PublishPlanFromPortfolioInput,
  ResolvedChildIdentity,
} from './types.js';
export {
  compilePortfolioChildren,
  planNodeForChild,
  type PortfolioChildNode,
} from './compiler.js';
export {
  childNameRefusal,
  gatherChildEvidence,
  resolveChildByName,
  type ChildEvidenceSnapshot,
  type ChildNameClaimant,
  type ChildNameResolution,
} from './resolution.js';
export {
  publishPlanFromPortfolio,
  type PublishPlanFromPortfolioOptions,
} from './orchestration.js';
