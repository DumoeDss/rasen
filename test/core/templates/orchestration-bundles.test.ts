import { describe, expect, it } from 'vitest';

import {
  AUTO_ORCHESTRATION_PLAYBOOK,
  GOAL_ORCHESTRATION_PLAYBOOK,
  ORCHESTRATION_PLAYBOOK,
  REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
} from '../../../src/core/templates/workflows/_orchestration.js';

const SHARED_STEPS = [
  'A',
  'A.1',
  'B',
  'B.2',
  'B.3',
  'B.4',
  'C',
  'F',
  'F.1',
  'H',
] as const;

const CANONICAL_STEP_ORDER = [
  'A',
  'A.1',
  'B',
  'B.1',
  'B.2',
  'B.3',
  'B.4',
  'C',
  'D',
  'E',
  'L',
  'F',
  'F.1',
  'G',
  'G.1',
  'H',
] as const;

function stepHeading(step: string): string {
  return `### Step ${step} `;
}

function stepSection(playbook: string, step: string): string {
  const start = playbook.indexOf(stepHeading(step));
  expect(start, `missing Step ${step}`).toBeGreaterThanOrEqual(0);
  const following = playbook.slice(start + stepHeading(step).length);
  const next = following.search(/\n### Step [A-Z]/);
  return next < 0
    ? playbook.slice(start)
    : playbook.slice(start, start + stepHeading(step).length + next);
}

function expectSteps(
  playbook: string,
  included: readonly string[],
  excluded: readonly string[]
): void {
  for (const step of included) {
    expect(playbook, `included Step ${step}`).toContain(stepHeading(step));
  }
  for (const step of excluded) {
    expect(playbook, `excluded Step ${step}`).not.toContain(stepHeading(step));
  }
}

function expectCanonicalOrder(
  playbook: string,
  included: readonly string[]
): void {
  const positions = CANONICAL_STEP_ORDER
    .filter(step => included.includes(step))
    .map(step => playbook.indexOf(stepHeading(step)));

  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

function expectForbiddenSemantics(
  playbook: string,
  forbidden: readonly string[]
): void {
  for (const clause of forbidden) {
    expect(playbook, `forbidden semantic clause: ${clause}`).not.toContain(
      clause
    );
  }
}

function expectOrderedFragments(playbook: string, fragments: readonly string[]): void {
  const positions = fragments.map((fragment) => {
    const position = playbook.indexOf(fragment);
    expect(position, `missing orchestration fragment: ${fragment}`).toBeGreaterThanOrEqual(0);
    return position;
  });
  expect(positions).toEqual([...positions].sort((left, right) => left - right));
}

describe('selective orchestration bundles', () => {
  it('keeps auto byte-stable and complete', () => {
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toBe(ORCHESTRATION_PLAYBOOK);
    expectSteps(
      AUTO_ORCHESTRATION_PLAYBOOK,
      CANONICAL_STEP_ORDER,
      []
    );
    expectCanonicalOrder(
      AUTO_ORCHESTRATION_PLAYBOOK,
      CANONICAL_STEP_ORDER
    );
  });

  it('keeps portfolio state canonical and every child resumable from creation', () => {
    const stepG = AUTO_ORCHESTRATION_PLAYBOOK.slice(
      AUTO_ORCHESTRATION_PLAYBOOK.indexOf('### Step G '),
      AUTO_ORCHESTRATION_PLAYBOOK.indexOf('### Step G.1 ')
    );
    // Children are created under SEMANTIC names; scheduling ids stay in the
    // portfolio record's `node` metadata (`file-placement` capability).
    expect(stepG).toContain(
      'rasen new change <semantic-name> --pipeline <childPipeline>'
    );
    expect(stepG).toContain('Scheduling and DAG-internal identifiers');
    expect(stepG).toContain('"dependsOn": ["<parent>-<what-this-slice-delivers>"]');
    expect(stepG).toContain('"delivery":');
    expect(stepG).toContain('"status": "pending"');
    expect(stepG).toContain('next: portfolio-delivery');
    expect(stepG).toContain('present but invalid portfolio is an error');
    expect(stepG).not.toContain("each child's prerequisites");
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      '**done | skipped | delegated** count as complete for resume'
    );
  });

  it('composes the goal capability set without review, planner, or portfolio rules', () => {
    const included = [...SHARED_STEPS, 'D', 'L'];
    expectSteps(
      GOAL_ORCHESTRATION_PLAYBOOK,
      included,
      ['B.1', 'E', 'G', 'G.1']
    );
    expectCanonicalOrder(GOAL_ORCHESTRATION_PLAYBOOK, included);

    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step B\.1\b/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step E(?:\b|\.)/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step G(?:\b|\.)/);
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('LOOP_BOUND');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('MILESTONE_BOUND');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('review-loop reviewer/fixer');
    expect(GOAL_ORCHESTRATION_PLAYBOOK).not.toContain('persistent planner');
    expectForbiddenSemantics(GOAL_ORCHESTRATION_PLAYBOOK, [
      'portfolio-run.json',
      'For a decomposed parent',
      '`runnableChildren`',
      '`interruptedChildren`',
      '`escalatedChildren`',
      '`completedChildren`',
      'cross-child implementer reuse',
      'other portfolio children',
      'dependent or subsequent child change',
      'a full child pipeline',
      'child change so the main line can move',
      'recommend decomposing',
      'recommend decompose',
      'decompose signal',
      'decompose budget',
      'decompose the obstruction',
      'review `rounds`',
      '`openFindings`',
      'delta re-review',
      'review-cycle\'s single-dispatch-per-round shape',
      'like review-cycle reuses the fixer thread',
    ]);
  });

  it('composes the review-cycle capability set without planner, metadata, goal, or portfolio rules', () => {
    const included = [...SHARED_STEPS, 'E'];
    expectSteps(
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
      included,
      ['B.1', 'D', 'L', 'G', 'G.1']
    );
    expectCanonicalOrder(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK, included);

    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step B\.1\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step D\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step L\b/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toMatch(/Step G(?:\b|\.)/);
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).toContain('LOOP_BOUND');
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toContain('MILESTONE_BOUND');
    expect(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK).not.toContain('persistent planner');
    expectForbiddenSemantics(REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK, [
      'evaluate-gate schema',
      'leaf-return/evaluate-gate contract',
      'goal-loop run artifact',
      'goal-run.json',
      '`loopStallLimit`',
      '`blockedThreshold`',
      '`evaluateSatisfied`',
      '`measurePassed`',
      'goal rounds',
      'portfolio-run.json',
      'For a decomposed parent',
      '`runnableChildren`',
      '`interruptedChildren`',
      '`escalatedChildren`',
      '`completedChildren`',
      'cross-child implementer reuse',
      'other portfolio children',
      'dependent or subsequent child change',
      'a full child pipeline',
      'child change so the main line can move',
      'recommend decomposing',
      'recommend decompose',
      'decompose signal',
      'decompose budget',
      'goal-loop',
    ]);
  });

  it('retains the shared dispatch, isolation, state, resume, and handoff rules', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain('role-isolated worker');
      expect(playbook).toContain('author != verifier');
      expect(playbook).toContain('Maintain run-state');
      expect(playbook).toContain('Resume a run');
      expect(playbook).toContain('Worker self-handoff');
      expect(playbook).toContain('Workers NEVER write run-state');
      expect(playbook).toContain(
        'design-level rework — send the problem back to the planner'
      );
    }
  });

  it('pins all four native/bridge route lifecycles and their identity contracts', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain('`hostRuntime`');
      expect(playbook).toContain('`dispatchMode`');
      expect(playbook).toContain('`spawn_agent`');
      expect(playbook).toContain('`followup_task`');
      expect(playbook).toContain(
        "worker's final `DONE` or `HANDOFF` response is delivered to the LEAD automatically"
      );
      expect(playbook).toContain('do NOT send a duplicate completion message');
      expect(playbook).toContain('`wait_agent`');
      expect(playbook).toContain('one long, barrier-sized event-driven wait');
      expect(playbook).toContain('repeated 30- or 60-second polling cycles');

      // Claude-native and external exec-bridge contracts remain complete.
      expect(playbook).toContain('Task tool (subagent_type: "general-purpose"');
      expect(playbook).toContain('via `SendMessage` to the LEAD');
      expect(playbook).toContain('bridge `claude-print`');
      expect(playbook).toContain('rasen agent dispatch --runtime claude');
      expect(playbook).toContain('--prompt-file <prompt.txt>');
      expect(playbook).toContain('--resume <exact-session-id>');
      expect(playbook).toContain('the receipt then supplies `sessionId`, `cwd`');
      expect(playbook).toContain(
        'do NOT use `SendMessage`, `rasen agent wait`, or the signal-file parking protocol'
      );
      expect(playbook).toContain('codex exec --json --output-schema');
      expect(playbook).toContain('< /dev/null');
      expect(playbook).toContain('codex exec resume <threadId>');
      expect(playbook).toContain('Codex exec mode yields NO turn id');
      expect(playbook).toContain('Claude host → Claude worker `native`');
      expect(playbook).toContain('Claude host → Codex worker `exec-bridge`');
      expect(playbook).toContain('Codex host → Codex worker `native`');
      expect(playbook).toContain('Codex host → Claude worker `exec-bridge`');
      expect(playbook).not.toContain('Codex host → Claude worker `unsupported`');
    }
  });

  it('keeps every review, goal, and resume continuation site dispatch-mode-aware', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      const reviewLoop = stepSection(playbook, 'E');
      expect(reviewLoop).toContain('Claude-native uses `SendMessage` by agentId');
      expect(reviewLoop).toContain('Codex-native uses `followup_task` by agent id');
      expect(reviewLoop).toContain(
        'Claude exec-bridge uses `rasen agent dispatch --resume <sessionId> --cwd <cwd>`'
      );
      expect(reviewLoop).toContain('Codex exec-bridge uses `codex exec resume <threadId>`');
      expect(reviewLoop).toContain('A finding is resolved ONLY after a non-author confirms it');
    }

    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
    ]) {
      const goalLoop = stepSection(playbook, 'L');
      expect(goalLoop).toContain('Claude-native uses `SendMessage` on the same implementer agentId');
      expect(goalLoop).toContain('Codex-native uses `followup_task` on the same idle implementer agent');
      expect(goalLoop).toContain(
        'Claude exec-bridge uses `rasen agent dispatch --resume <sessionId> --cwd <cwd>`'
      );
      expect(goalLoop).toContain('Codex exec-bridge uses `codex exec resume <threadId>`');
      expect(goalLoop).toContain('author ≠ verifier');
    }

    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      const resume = stepSection(playbook, 'F.1');
      expect(resume).toContain('Claude-native `SendMessage`');
      expect(resume).toContain('Codex-native `followup_task`');
      expect(resume).toContain('Claude exec-bridge continuation by exact `sessionId + cwd`');
      expect(resume).toContain('Codex exec-bridge resume by `threadId`');
      expect(resume).toContain('never invent one');
    }
  });

  it('freezes retention before every canonical retain-stage dispatch', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
    ]) {
      expectOrderedFragments(playbook, [
        'canonical ID is `retain`',
        'record it in run-state BEFORE dispatch',
        'Pass the frozen mode in the dispatch instructions',
        'The LEAD is the sole run-state writer',
      ]);
      expect(playbook).toContain(
        'This stage-identity rule applies in every pipeline'
      );
      expect(playbook).toContain(
        'ship → retain → archive for code-producing pipelines, or report only for research'
      );
    }
  });

  it('states the exact binding-aware handoff order in the canonical playbook', () => {
    expectOrderedFragments(AUTO_ORCHESTRATION_PLAYBOOK, [
      'configured `pipelines.<name>.handoff.<stage>` instance',
      'stage YAML `handoff`',
      'runtime-bound threshold scheme',
      'pipeline YAML `handoff.roles[<actual role>]`',
      'pipeline YAML `handoff.threshold`',
      'legacy project `handoff.roles[<actual role>]`',
      'project `handoff.threshold`',
      'inherited-store role',
      'inherited-store scalar',
      'global role',
      'global scalar',
      'model preset',
      'built-in default `0.5`',
    ]);
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      "the worker's explicit effective-runtime row at project, store, then global scope is exhausted before the `default` row at project, store, then global scope"
    );
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      'A binding to a missing or invalid scheme emits a diagnostic and falls through'
    );
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      'Consume the already-resolved threshold, source, binding, and diagnostics from `rasen pipeline show <name> --json`'
    );
  });

  it('states role-runtime reuse and default-only top-level reuse without a legacy-only chain', () => {
    const reuseStart = AUTO_ORCHESTRATION_PLAYBOOK.indexOf(
      'For each reuse role'
    );
    const reuseEnd = AUTO_ORCHESTRATION_PLAYBOOK.indexOf(
      'These are different numbers for a reason'
    );
    const reuseGuidance = AUTO_ORCHESTRATION_PLAYBOOK.slice(reuseStart, reuseEnd);
    expectOrderedFragments(reuseGuidance, [
      "scheme bound to that role's actual effective runtime",
      '`reuseRoles[<role>]` before the scheme scalar',
      'pipeline YAML `reuse.roles[<role>]`',
      'pipeline YAML `reuse.threshold`',
      'model preset',
      'built-in default **0.25**',
    ]);
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      'Planner and implementer therefore may resolve different bindings.'
    );
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      'considers only the `default` binding row at project/store/global (scheme scalar only) > pipeline YAML `reuse.threshold` > built-in default'
    );
    expect(AUTO_ORCHESTRATION_PLAYBOOK).toContain(
      'runtime-specific rows and presets do not apply'
    );
    expect(AUTO_ORCHESTRATION_PLAYBOOK).not.toContain(
      '`handoff.roles[<role>]` > `handoff` > project config role/scalar > global config role/scalar'
    );
  });

  it('keeps binding/store/fallback semantics in every reduced handoff replacement', () => {
    for (const playbook of [
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain(
        "worker's actual dispatched role and effective runtime"
      );
      expect(playbook).toContain('runtime-bound scheme');
      expect(playbook).toContain('explicit runtime project/store/global rows');
      expect(playbook).toContain('inherited-store role/scalar');
      expect(playbook).toContain('Missing or invalid schemes warn and fall through.');
      expect(playbook).not.toContain(
        '`handoff.roles[<role>]` > `handoff` > project config role/scalar > global config role/scalar'
      );
    }
  });

  it('pins the run-start keepalive policy and eligible dispatch boundary', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain('reads the effective `keepalive.enabled` entry ONCE');
      expect(playbook).toContain(
        'ONLY `keepalive.enabled=true` AND Claude `native` dispatch'
      );
      expect(playbook).toContain('dispatch the stage as `ONE_SHOT`');
      expect(playbook).toContain('MUST omit the `rasen agent wait` loop');
      expect(playbook).toContain('the raw switch value');
      expect(playbook).toContain(
        'route gating (Claude-native on, `claude-print` and Codex off'
      );
    }
  });

});
