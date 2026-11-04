/**
 * `issue-plan-publication` — the single public entry point.
 *
 * The compilers and the child-name resolution are pure over their inputs; the
 * orchestrations compose the resume placement seam, the store query's evidence
 * readers, and the `StoreIssues.publishPlan` mutation without giving
 * `store/issues` or `pipeline-registry` any upward dependency (design D1/D2).
 * `pipeline-registry` is imported read-only — its readers are reused, its
 * frozen surface untouched. The decomposition channel composes the same
 * mutation over the pure document reader, adding no second publication
 * discipline (design D3).
 */
export type {
  IssuePlanDecompositionRefusalCode,
  IssuePlanPortfolioRefusalCode,
  IssuePlanPublicationRefusalCode,
  IssuePlanPublicationResult,
  IssuePlanPublicationSource,
  IssuePlanSourceCode,
  PublishPlanFromDecompositionInput,
  PublishPlanFromPortfolioInput,
  ResolvedChildIdentity,
} from './types.js';
export {
  compilePortfolioChildren,
  planNodeForChild,
  type PortfolioChildNode,
} from './compiler.js';
export {
  parseDecompositionDocument,
} from './decomposition.js';
export {
  childNameRefusal,
  gatherChildEvidence,
  resolveChildByName,
  type ChildEvidenceSnapshot,
  type ChildNameClaimant,
  type ChildNameResolution,
} from './resolution.js';
export {
  publishPlanFromDecomposition,
  publishPlanFromPortfolio,
  type PublishPlanFromDecompositionOptions,
  type PublishPlanFromPortfolioOptions,
} from './orchestration.js';
