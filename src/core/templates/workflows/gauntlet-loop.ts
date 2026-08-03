import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from './store-selection.js';

const GAUNTLET_LOOP_INSTRUCTIONS = `Execute exactly one phase of an internal gauntlet-loop round over the real artifact targets against a frozen reference quality bar.

${STORE_SELECTION_GUIDANCE}

The canonical Action input contains \`gauntlet\` (the frozen contract: goal, artifactTargets, reference bar, constraints), contract digest, round, and phase-specific context. It replaces proposal/design/specs/tasks/goal-plan for this lifecycle. Never create those planning artifacts and never switch or fall back to another Pipeline.

## Shared rules

- Work only against the frozen goal, artifactTargets, reference bar, and constraints. Never weaken or rewrite them.
- Inspect the real artifact targets and direct file/test/render/runtime/measurement evidence. A prose summary is not evidence.
- Do one phase, return one structured canonical completion, and stop. The reconciler owns iteration, budget, resume, and terminal state.
- Never spawn subagents. Builder, critic, lead, meta-critic, and smoothing context separation is owned by the LEAD/reconciler.

## Roles

### Gauntlet lead

- Hold the frozen goal and reference bar as the north star. The lead does not modify them (they are launch-identity frozen).
- Decide when to transition from Phase 0 (flat serial foundation) to Phase 1+ (per-wave polish). This decision is sovereign over the meta-critic's advisory signal.
- Decompose the artifact at exactly one level per wave. Pieces are never recursively sub-decomposed into sub-pieces.
- Decide whether to run an optional fresh smoothing pass between waves.
- Converge the Run via attestation when the artifact meets the user's judgment — the attestation drives a final convergence-judge Action (fresh session), not a bypass terminal.

### Piece-builder (work phase)

- Inspect and materially improve the real targets for the assigned piece. For round > 1, focus on only the supplied prior \`largestGap\` and the frozen reference bar.
- Run the smallest direct checks that produce raw evidence for changed targets.
- Return \`goal-cycle/work-result/1\` with distinct beforeTree/afterTree values and a bound delta EvidenceRef.
- Do not declare the bar satisfied. Builder completion claims are non-authoritative.

### Piece-critic (judge phase — fresh role-separated critic)

- Start from the frozen contract, target locations, afterTree, and rawEvidence in the Action input. Independently inspect the real artifacts/evidence; do not seek or grade builder reasoning or summaries.
- Perform a blind A/B comparison against the reference bar where the BarAdapter supports it. Return at most the single largest remaining gap.
- Return \`goal-cycle/evaluate-judge/1\`. Set \`satisfied: true\` only when the bar is genuinely reached (verdict candidate/tie, zero gaps, raw evidence exists) with \`satisfactionSource: 'bar-reached'\`.
- Otherwise set \`satisfied: false\`, verdict \`reference\`, return exactly one gap, repeat it in \`largestGap\`, and provide one explicit testable \`passCondition\` for the next builder.
- Never judge a round you built. Every round requires a critic identity not used by an earlier gauntlet judgment.

### Meta-critic (wave-level blind A/B — advisory to the lead)

- Inspect the whole artifact across all pieces in the wave against the reference bar.
- Perform a blind A/B comparison and return the single largest cross-piece gap.
- The meta-critic's advisory signal is input to the lead, not authority. The lead's transition decision is sovereign.
- Subject to the same fresh-critic and critic-reuse guard as the piece-critic.

### Smoothing (optional fresh pass between waves)

- Run in a fresh context over the WHOLE artifact for cross-piece cohesion.
- Does NOT redesign individual pieces. Addresses integration seams, consistency, and coherence only.
- Returns \`goal-cycle/work-result/1\` scoped to the whole artifact targets, not individual piece targets.

## Convergence

A user MAY issue a convergence attestation at any phase. The attestation drives a final convergence-judge Action (fresh session, subject to the critic-reuse guard) that records an auditable satisfied result whose evidence is the attestation. The satisfied source is semantically "user-converged via attestation," NOT "bar reached." Ship becomes ready only after this convergence-judge satisfaction, and archive only after ship.

Blocked, failed, exhausted, backstop-suspended, cancelled, or explicitly stopped loops remain non-deliverable. \`--no-gate\` cannot waive input, bar, evidence, fresh-critic, blind-A/B, terminal, ship, or archive guards.`;

export function getGauntletLoopSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen-gauntlet-loop',
    description:
      'Internal gauntlet-loop phased builder/critic/lead/meta-critic/smoothing contract over real artifacts against a frozen reference bar; blind A/B judgment, one-gap feedback, and convergence-through-judge delivery.',
    instructions: GAUNTLET_LOOP_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires rasen CLI reconciler engine.',
    metadata: { author: 'rasen', version: '1.0' },
  };
}
