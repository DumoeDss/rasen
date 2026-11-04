/**
 * ECP-5 Section 6 — product wording and capability discovery.
 *
 * The defect this file pins is the portfolio's recurring one: shipped code
 * behind a stale gate. `analyzeReconcilerSupport` could report five distinct
 * `supported_*` reasons, `EngineSupportPanel` had copy for all of them, and
 * `packages/ui`'s wire mirror declared a union for them — but BOTH discovery
 * call sites (`pipeline show` and the management pipeline-detail endpoint)
 * passed `profile: null`, which short-circuits to
 * `execution_profile_unavailable`. So no read plane could EVER display a
 * supported verdict, and `executable-parallel-pipelines` scenario 1 ("`rasen
 * pipeline show` SHALL report `availableEngines` including `reconciler` with
 * reason `supported_v2_parallel`") was unsatisfiable in production while its
 * kernel-level sibling test passed.
 *
 * The CLI cases are REAL fresh-process runs against the built `dist/` — the
 * only thing that can falsify "the product surface says it".
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { runCLI } from '../../helpers/run-cli.js';
import {
  RECONCILER_SUPPORT_REASON_KEYS,
  getPipelineMessages,
} from '../../../src/commands/pipeline-messages.js';
import { analyzeReconcilerSupport } from '../../../src/core/pipeline-registry/execution-plan-internal.js';
import { resolveDiscoveryReconcilerSupportProfile } from '../../../src/core/pipeline-registry/profile-resolver.js';
import {
  EcpDefinitionModule,
  createCapabilityCatalogSnapshot,
} from '../../../src/core/pipeline-registry/index.js';
import type {
  CapabilityCatalogSnapshot,
  PreparedDefinition,
} from '../../../src/core/pipeline-registry/definition.js';

const BASE_CONFIG = 'schema: spec-driven\n';

/**
 * The v1 parallel-only shape of `executable-parallel-pipelines` scenario 1:
 * a `parallelGroup` and deliberately NO review-loop stage, so the analyzer
 * reaches `supported_v2_parallel` rather than `supported_v2_review_cycle`.
 */
const PARALLEL_ONLY_PIPELINE = `version: 1
name: show-parallel-only
description: v1 pipeline whose only v2 construct is a parallelGroup
stages:
  - id: review
    skill: rasen-review
    role: reviewer
    requires: []
    parallelGroup: experts
    condition: always
  - id: security
    skill: rasen-cso
    role: reviewer
    requires: []
    parallelGroup: experts
    condition: security-relevant
  - id: ship
    skill: rasen-ship
    role: shipper
    requires: [review, security]
`;

describe('ECP-5 section 6: `pipeline show` reports a truthful support reason', () => {
  const repoRoot = process.cwd();
  let testDir: string;
  let env: NodeJS.ProcessEnv;

  const configPath = () => path.join(testDir, 'rasen', 'config.yaml');

  beforeEach(async () => {
    testDir = path.join(repoRoot, 'test-engine-product-surface-tmp');
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'specs'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'rasen', 'changes'), { recursive: true });
    await fs.writeFile(configPath(), BASE_CONFIG);
    env = { XDG_DATA_HOME: path.join(testDir, 'global-data') };
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('reports a v1 parallel-only pipeline as supported_v2_parallel', async () => {
    const pipelineDir = path.join(
      testDir,
      'rasen',
      'pipelines',
      'show-parallel-only'
    );
    await fs.mkdir(pipelineDir, { recursive: true });
    await fs.writeFile(
      path.join(pipelineDir, 'pipeline.yaml'),
      PARALLEL_ONLY_PIPELINE
    );

    const result = await runCLI(
      ['pipeline', 'show', 'show-parallel-only', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());

    // Spec scenario 1, both halves: the engine list AND the reason.
    expect(payload.availableEngines).toContain('reconciler');
    expect(payload.reconcilerSupport).toMatchObject({
      supported: true,
      reason: 'supported_v2_parallel',
    });
  }, 120_000);

  it('reports a review-loop pipeline as supported, not execution_profile_unavailable', async () => {
    const result = await runCLI(['pipeline', 'show', 'bug-fix', '--json'], {
      cwd: testDir,
      env,
      timeoutMs: 60_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.reconcilerSupport.supported).toBe(true);
    expect(payload.reconcilerSupport.reason).toBe('supported_v2_executable');
    // The regression this file exists for: `null` used to make EVERY pipeline
    // report this, whatever its shape.
    expect(payload.reconcilerSupport.reason).not.toBe(
      'execution_profile_unavailable'
    );
  }, 120_000);

  it('still fails closed when a pipeline\'s capability bindings cannot resolve', async () => {
    // `auto-decompose` has a decompose stage — a Dispatch-domain construct
    // the reconciler engine does not execute — so the honest fail-closed
    // verdict is the unsupported-semantics reason (the 0.3.0 boundary
    // crossing; its `issue-dispatch-0.3.0` successor label is unchanged),
    // never a partial binding set reported as supported and never a
    // resolvable-sounding profile-availability reason.
    const result = await runCLI(
      ['pipeline', 'show', 'auto-decompose', '--json'],
      { cwd: testDir, env, timeoutMs: 60_000 }
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.reconcilerSupport.supported).toBe(false);
    expect(payload.reconcilerSupport.reason).toBe(
      'unsupported_pipeline_semantics'
    );
  }, 120_000);

  it('renders the reason as product copy beside its code in the human output', async () => {
    const result = await runCLI(['pipeline', 'show', 'bug-fix'], {
      cwd: testDir,
      env,
      timeoutMs: 60_000,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    // The reason CODE (the token the API and Canvas print) AND product copy.
    expect(result.stdout).toContain('supported_v2_executable');
    expect(result.stdout).toContain(
      'a v2 definition whose Composite bodies and stages all resolve'
    );
    // Task 6.2: the effective engine and its deciding layer, in the terminal
    // rather than only in `--json`.
    expect(result.stdout).toContain('runs.engine=auto');
    expect(result.stdout).toContain('starts on reconciler');
  }, 120_000);
});

describe('ECP-5 section 6: reason-code -> copy table is total', () => {
  // Keyed by the analyzer's own union, so a reason added there without copy
  // here is a type error. This test additionally proves the copy EXISTS in
  // every shipped locale rather than falling through to the key name.
  for (const locale of ['en', 'ja', 'zh-cn'] as const) {
    it(`has non-empty copy for every reason in ${locale}`, () => {
      const messages = getPipelineMessages(locale);
      for (const [reason, key] of Object.entries(
        RECONCILER_SUPPORT_REASON_KEYS
      )) {
        const copy = messages.formatDescriptor(key);
        expect(copy, `${locale}/${reason}`).toBeTruthy();
        expect(copy, `${locale}/${reason}`).not.toBe(key);
        // Copy is prose, not a repetition of the machine token.
        expect(copy, `${locale}/${reason}`).not.toBe(reason);
      }
    });
  }
});

describe('ECP-5 section 6: support analysis is independent of binding order', () => {
  function descriptor(skill: string, digest: string) {
    return {
      id: `skill:${skill}`,
      version: digest,
      availability: 'enabled' as const,
      inputs: [],
      artifacts: [],
      outcomes: ['completed'],
      limits: {},
    };
  }

  function prepared(): {
    prepared: PreparedDefinition;
    catalog: CapabilityCatalogSnapshot;
  } {
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-review', `sha256:${'1'.repeat(64)}`),
      descriptor('rasen-cso', `sha256:${'2'.repeat(64)}`),
      descriptor('rasen-ship', `sha256:${'3'.repeat(64)}`),
    ]);
    const result = EcpDefinitionModule.prepare(
      {
        version: 1,
        name: 'order-independence',
        description: 'v1 parallel-only',
        stages: [
          {
            id: 'review',
            skill: 'rasen-review',
            role: 'reviewer',
            requires: [],
            parallelGroup: 'experts',
            condition: 'always',
          },
          {
            id: 'security',
            skill: 'rasen-cso',
            role: 'reviewer',
            requires: [],
            parallelGroup: 'experts',
            condition: 'security-relevant',
          },
          {
            id: 'ship',
            skill: 'rasen-ship',
            role: 'shipper',
            requires: ['review', 'security'],
          },
        ],
      },
      catalog
    );
    if (!result.ok) throw result.error;
    return { prepared: result.value, catalog };
  }

  it('reports supported for the natural order AND for a reversed one', () => {
    const { prepared: def, catalog } = prepared();
    const discovery = resolveDiscoveryReconcilerSupportProfile(def, catalog);
    expect(discovery).not.toBeNull();
    expect(analyzeReconcilerSupport(def, discovery).reconcilerSupport).toMatchObject(
      { supported: true, reason: 'supported_v2_parallel' }
    );

    // The failure mode that made this whole section report
    // `unsupported_pipeline_shape` on the first attempt: the sealed launch
    // profile arrives sorted by `normalizeProfileInput`, and the three
    // expected-set comparisons silently depended on that. A discovery profile
    // has no such normalization pass, so the analyzer must sort for itself.
    const reversed = {
      profileDigest: discovery!.profileDigest,
      capabilities: [...discovery!.capabilities].reverse(),
    };
    expect(analyzeReconcilerSupport(def, reversed).reconcilerSupport).toMatchObject(
      { supported: true, reason: 'supported_v2_parallel' }
    );
  });

  it('returns null — the fail-closed verdict — when a capability is absent', () => {
    const { prepared: def } = prepared();
    const emptyCatalog = createCapabilityCatalogSnapshot([]);
    expect(resolveDiscoveryReconcilerSupportProfile(def, emptyCatalog)).toBeNull();
    expect(
      analyzeReconcilerSupport(def, null).reconcilerSupport.reason
    ).toBe('execution_profile_unavailable');
  });

  it('reports a decompose-bearing v1 definition as unsupported semantics BEFORE the null-profile short-circuit', () => {
    // The auto-decompose shape (first stage kind: decompose, a review-loop
    // behind it that makes the definition require v2 lowering) analyzed with
    // an EXPLICITLY null profile: the truthful boundary verdict must win over
    // the profile-availability reason, proving the check's ordering — this is
    // the 0.3.0 Dispatch-boundary crossing (issue-autodecompose-graph D2),
    // and the fail-closed launch outcome is unchanged (legacy stays listed).
    const catalog = createCapabilityCatalogSnapshot([
      descriptor('rasen-propose', `sha256:${'a'.repeat(64)}`),
      descriptor('rasen-review-cycle', `sha256:${'b'.repeat(64)}`),
    ]);
    const result = EcpDefinitionModule.prepare(
      {
        version: 1,
        name: 'decompose-bearing',
        description: 'v1 with a decompose first stage and a review loop',
        stages: [
          {
            id: 'decompose',
            kind: 'decompose' as const,
            role: 'planner',
            requires: [],
            gate: false,
            childPipeline: 'small-feature',
            condition: 'needs-decomposition',
          },
          {
            id: 'propose',
            skill: 'rasen-propose',
            role: 'planner',
            requires: ['decompose'],
            gate: true,
          },
          {
            id: 'review-loop',
            skill: 'rasen-review-cycle',
            role: 'fixer',
            requires: ['propose'],
            loop: { kind: 'review-cycle' as const, maxRounds: 3 },
          },
        ],
      },
      catalog
    );
    if (!result.ok) throw result.error;
    const support = analyzeReconcilerSupport(result.value, null);
    expect(support.reconcilerSupport).toMatchObject({
      supported: false,
      reason: 'unsupported_pipeline_semantics',
    });
    expect(support.availableEngines).toContain('legacy');
    // And a decompose-free v1 definition with the SAME null profile still
    // reports the profile reason — `execution_profile_unavailable` stays
    // reachable for genuinely unresolvable bindings.
    const { prepared: def } = prepared();
    expect(
      analyzeReconcilerSupport(def, null).reconcilerSupport.reason
    ).toBe('execution_profile_unavailable');
  });
});
