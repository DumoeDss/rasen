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
    expect(stepG).toContain(
      'rasen new change <child-id> --pipeline <childPipeline>'
    );
    expect(stepG).toContain('"dependsOn": ["<parent>-a"]');
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

  it('branches Codex native, exec-bridge, and Claude-native worker lifecycles', () => {
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
      expect(playbook).toContain('codex exec --json --output-schema');
      expect(playbook).toContain('< /dev/null');
      expect(playbook).toContain('codex exec resume <threadId>');
      expect(playbook).toContain('Exec mode yields NO turn id');
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
      expect(reviewLoop).toContain('exec-bridge uses `codex exec resume <threadId>`');
    }

    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
    ]) {
      const goalLoop = stepSection(playbook, 'L');
      expect(goalLoop).toContain('Claude-native uses `SendMessage` on the same implementer agentId');
      expect(goalLoop).toContain('Codex-native uses `followup_task` on the same idle implementer agent');
      expect(goalLoop).toContain('exec-bridge uses `codex exec resume <threadId>`');
    }

    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      const resume = stepSection(playbook, 'F.1');
      expect(resume).toContain('Claude-native `SendMessage`');
      expect(resume).toContain('Codex-native `followup_task`');
      expect(resume).toContain('exec-bridge resume by `threadId`');
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

  /**
   * ECP-5 Section 3 — Step E convergence. Step E used to OWN the review->fix
   * mechanics in prompt text (round counting, the cap, actor separation, clean
   * determination) while `src/core/change-run` enforced the same rules with real
   * rejection paths. These tests pin the split: a reconciler-engine branch that
   * drives the canonical Run, and a legacy-engine branch that keeps every
   * legacy mechanic, explicitly labeled.
   */
  describe('ECP-5: Step E engine convergence', () => {
    const reviewLoopBundles = [
      AUTO_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ];

    it('drives the reconciler branch through the canonical Run', () => {
      for (const playbook of reviewLoopBundles) {
        const stepE = stepSection(playbook, 'E');
        expect(stepE).toContain('#### E.1 — Reconciler engine');
        expect(stepE).toContain('pipeline resume-run');
        expect(stepE).toContain('rasen pipeline start <change> <pipeline> --json');
        // ECP-5 (task 7.7): this asserted the phantom `--action-id` flag,
        // so the guard test itself carried the defect. The real invocation:
        expect(stepE).toContain(
          'rasen pipeline complete <change> --run <runId> --from <receipt.json> --json'
        );
        // Progress is READ from the canonical section, not tallied.
        expect(stepE).toContain('`review-cycle` section');
        expect(stepE).toContain('rasen pipeline status <change> <pipeline> --json');
      }
    });

    it('keeps the legacy branch complete and explicitly labeled', () => {
      for (const playbook of reviewLoopBundles) {
        const stepE = stepSection(playbook, 'E');
        expect(stepE).toContain('#### E.2 — Legacy engine');
        expect(stepE).toContain('**This is the legacy-engine path.**');
        // Every legacy mechanic survives: a run whose engine is legacy has no
        // canonical Run to own them, so deleting them would break it outright.
        expect(stepE).toContain('**Review**');
        expect(stepE).toContain('**Triage by fix size**');
        expect(stepE).toContain('**Fix** via the routed actor');
        expect(stepE).toContain('**Re-review the delta with a non-author**');
        expect(stepE).toContain('**Loop or terminate**');
        expect(stepE).toContain(
          'A finding is resolved ONLY after a non-author confirms it'
        );
        expect(stepE).toContain(
          'Never report clean while a Blocker or Major finding is open'
        );
        // The reconciler branch is stated BEFORE the legacy one.
        expect(stepE.indexOf('#### E.1')).toBeLessThan(stepE.indexOf('#### E.2'));
      }
    });

    it('deletes the prompt-owned duplicates of kernel-enforced rules', () => {
      for (const playbook of [
        AUTO_ORCHESTRATION_PLAYBOOK,
        GOAL_ORCHESTRATION_PLAYBOOK,
        REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
      ]) {
        // The round-cap DEFAULT is no longer owned by prompt text; the number
        // lives in the pipeline definition and the Step H counter table.
        // Replacement evidence: test/core/change-run/review-cycle.test.ts.
        expect(playbook).not.toContain('Default cap: 3');
      }
      for (const playbook of reviewLoopBundles) {
        const stepE = stepSection(playbook, 'E');
        // Under the reconciler engine the LEAD keeps no second copy of any
        // rule the Record already rejects. Replacement evidence, in order:
        // review-cycle.test.ts (cap), facade-settle-completeness.test.ts
        // (clean/ship guard), review-cycle-runtime.test.ts (same-actor
        // rejection), facade-runtime.test.ts (pre-commit validation).
        const reconcilerBranch = stepE.slice(
          stepE.indexOf('#### E.1'),
          stepE.indexOf('#### E.2')
        );
        expect(reconcilerBranch).toContain('do not count rounds');
        expect(reconcilerBranch).toContain('do not decide clean');
        expect(reconcilerBranch).toContain(
          'do not check author != verifier as a verdict'
        );
        expect(reconcilerBranch).toContain(
          'do not judge whether a returned result is well-formed'
        );
        // Staffing distinct workers is still the LEAD's — the Record can
        // reject a same-actor commit but cannot put a different worker on it.
        expect(reconcilerBranch).toContain('Staffing distinct workers remains YOURS');
      }
    });

    it('names commands that actually exist on the CLI', () => {
      // ECP-5 (task 7.7), found by the dogfood: the converged Step E told the
      // LEAD to run `rasen pipeline complete <change>` with a per-action flag. There
      // IS no `--action-id` flag — `complete` takes `--run <runId> --from
      // <body>`, with the actionId inside the completion — so a LEAD following
      // the converged path literally failed at step 3. A prompt that names a
      // nonexistent invocation is a product defect, not a wording nit; it is
      // the same class as the deletions above, one level down.
      for (const playbook of [
        AUTO_ORCHESTRATION_PLAYBOOK,
        GOAL_ORCHESTRATION_PLAYBOOK,
        REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
        ORCHESTRATION_PLAYBOOK,
      ]) {
        expect(playbook).not.toContain('--action-id');
      }
      for (const playbook of reviewLoopBundles) {
        const stepE = stepSection(playbook, 'E');
        const reconcilerBranch = stepE.slice(
          stepE.indexOf('#### E.1'),
          stepE.indexOf('#### E.2')
        );
        expect(reconcilerBranch).toContain(
          'rasen pipeline complete <change> --run <runId> --from <receipt.json> --json'
        );
        // …and it says where the next action actually comes from, since
        // `resume-run` correctly reports zero in a healthy sequential drive.
        expect(reconcilerBranch).toContain('RECOVERY seam');
      }
    });

    it('bounds reconciler-engine run-state to bookkeeping and labeled projections', () => {
      for (const playbook of [
        AUTO_ORCHESTRATION_PLAYBOOK,
        GOAL_ORCHESTRATION_PLAYBOOK,
        REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
      ]) {
        const stepF = stepSection(playbook, 'F');
        expect(stepF).toContain('**Run-state boundary by engine.**');
        expect(stepF).toContain('AUTHORITATIVE record of progression');
        expect(stepF).toContain(
          'MUST NEVER be read back to make a progression decision the Run owns'
        );
        expect(stepF).toContain("engine: { effective: 'reconciler'|'legacy'");

        // Resume honors the owning engine and never re-homes a Run.
        const resume = stepSection(playbook, 'F.1');
        expect(resume).toContain('Resume under the OWNING engine');
        expect(resume).toContain('rasen pipeline resume-run <change> <pipeline> --json');
        expect(resume).toContain('never override the frontier');
      }
    });
  });

  it('pins the run-start keepalive policy and eligible dispatch boundary', () => {
    for (const playbook of [
      AUTO_ORCHESTRATION_PLAYBOOK,
      GOAL_ORCHESTRATION_PLAYBOOK,
      REVIEW_CYCLE_ORCHESTRATION_PLAYBOOK,
    ]) {
      expect(playbook).toContain('reads the effective `keepalive.enabled` entry ONCE');
      expect(playbook).toContain('ONLY `keepalive.enabled=true` AND runtime `claude`');
      expect(playbook).toContain('dispatch the stage as `ONE_SHOT`');
      expect(playbook).toContain('MUST omit the `rasen agent wait` loop');
      expect(playbook).toContain('the raw switch value');
      expect(playbook).toContain('runtime gating (Claude on, Codex off by default');
    }
  });

});
