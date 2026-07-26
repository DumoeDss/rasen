/**
 * The ONE rule for which checkout applicability is decided in.
 *
 * Two entry points ask this question — `resolveLearnedSkillRoots` (context.ts)
 * and `resolveEffectiveLearnedSkillPlan` (effective.ts) — and they used to
 * answer it differently: one fell back to `process.cwd()`, the other to the
 * resolved project's root. For a session that resolved its project by explicit
 * selector, those are different directories, so the two paths could disagree
 * about the same session.
 *
 * The stated order, from `session-runtime-context`, is: explicit selector →
 * session context → working directory, and "a later step SHALL NOT be
 * consulted once an earlier one has answered". By the time either entry point
 * runs, an owner has ALREADY been resolved through that order. So:
 *
 *   1. the checkout the session recorded — carried on the execution context as
 *      `evaluationRoot`;
 *   2. the checkout already resolved for the work — the project owner's root;
 *   3. the current directory, and only here.
 *
 * Step 3 is live, not dead code: a Store or global owner has no project
 * checkout, so nothing earlier can answer for it.
 *
 * This module deliberately holds nothing else, and imports only the type, so
 * both entry points can share it without either importing the other.
 */

import type { LearnedSkillExecutionContext } from './types.js';

export function resolveEvaluationCheckout(
  execution: LearnedSkillExecutionContext
): string {
  if (execution.evaluationRoot !== undefined) return execution.evaluationRoot;
  if (execution.owner.type === 'project') return execution.owner.root;
  return process.cwd();
}
