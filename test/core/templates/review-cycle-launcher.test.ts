/**
 * Thin-launcher invariant test (task 10.4 of `ecp-review-cycle`).
 *
 * Asserts that the rewritten `rasen-review-cycle` skill instructions contain
 * NO prompt-owned mechanical state: no round-counter variable, no phase-
 * transition logic, no max-rounds checking code, no author != verifier
 * checking, no escalation ladder.
 *
 * The skill is a LAUNCHER: it launches the canonical Run and reads progress
 * from the ChangeRunView. All mechanical progression is owned by the
 * reconciler. This test guards against regression — a future edit that
 * reintroduces prompt-owned state will fail here.
 */
import { describe, expect, it } from 'vitest';
import { getReviewCycleSkillTemplate } from '../../../src/core/templates/workflows/review-cycle.js';

describe('rasen-review-cycle thin launcher (10.4)', () => {
  const template = getReviewCycleSkillTemplate();
  const instructions = template.instructions;

  it('exports a valid skill template with the expected name', () => {
    expect(template.name).toBe('rasen-review-cycle');
    expect(template.instructions.length).toBeGreaterThan(100);
  });

  it('does NOT contain a round-counter variable declaration', () => {
    // Matches: `let r = 1`, `let round = 0`, `const round =`, `r = 1`, etc.
    // Does NOT match natural language like "round counting" or "round 1".
    const roundCounterPattern = /(?:let|const|var)\s+(?:r|round|rounds)\s*=/i;
    expect(roundCounterPattern.test(instructions)).toBe(false);
  });

  it('does NOT contain a round-increment operation', () => {
    // Matches: `round++`, `r++`, `rounds += 1`, `r += 1`
    const incrementPattern = /(?:round|r|rounds)\s*(?:\+\+|\+=\s*1)/i;
    expect(incrementPattern.test(instructions)).toBe(false);
  });

  it('does NOT contain conditional phase-transition logic', () => {
    // Matches: `if (phase`, `switch (phase`, `nextPhase =`, `phase = 'triage'`
    // (code that assigns or branches on phase). Does NOT match natural language
    // like "the correct phase" or "admitted phase action".
    const phaseTransitionPattern =
      /(?:nextPhase\s*=|switch\s*\(\s*phase|if\s*\(\s*phase\s*[=<>])/i;
    expect(phaseTransitionPattern.test(instructions)).toBe(false);
  });

  it('does NOT contain max-rounds checking code', () => {
    // Matches: `if (round >= maxRounds)`, `if (r >= cap)`, `if (rounds >= max)`
    // Does NOT match "maxRounds reached" in prose.
    const maxRoundsCheckPattern =
      /if\s*\(\s*(?:round|r|rounds)\s*>=?\s*(?:maxRounds|max|cap)/i;
    expect(maxRoundsCheckPattern.test(instructions)).toBe(false);
  });

  it('does NOT contain author != verifier checking code', () => {
    // Matches: `if (author === verifier`, `author !== verifier`,
    // `if (fixer === verifier`
    const actorCheckPattern =
      /if\s*\(\s*(?:author|fixer)\s*[!=]==?\s*(?:verifier|reviewer)/i;
    expect(actorCheckPattern.test(instructions)).toBe(false);
  });

  it('does NOT contain an escalation-ladder data structure', () => {
    // Matches: arrays/objects that define an escalation sequence like
    // `escalateTo`, `escalationLevel`, `escalationLadder`
    const escalationLadderPattern =
      /(?:escalationLadder|escalationLevel|escalateTo)\s*[=:]/i;
    expect(escalationLadderPattern.test(instructions)).toBe(false);
  });

  it('DOES reference the canonical Run launch commands', () => {
    // The thin launcher MUST tell the agent to use the canonical pipeline
    // commands — these are the primary interface to the reconciler.
    expect(instructions).toContain('rasen pipeline start');
    expect(instructions).toContain('rasen pipeline status');
  });

  it('DOES reference the ChangeRunView as the single source of truth', () => {
    // The skill reads progress from the canonical view, not from its own state.
    expect(instructions).toContain('ChangeRunView');
    // Or the equivalent concept of reading the review-cycle section.
    expect(instructions).toContain('review-cycle');
  });

  it('DOES delegate each review pass to rasen-review', () => {
    expect(instructions).toContain('rasen-review');
  });
});
