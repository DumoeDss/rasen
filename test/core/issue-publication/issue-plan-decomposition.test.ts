/**
 * `issue-autodecompose-graph` task 2.1/2.3 — the decomposition publication
 * channel: the strict document reader's refusals, and the orchestration end to
 * end through `publishPlan` (whose graph checks, planning-member target gate,
 * suggestion registry check, ordinal/digest discipline, and lock are all
 * inherited — these tests exercise them through the channel, not in
 * parallel). The document is read-only input: every test that publishes also
 * pins that its bytes did not move.
 */
import * as fs from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createStoreWorkspaceFixture,
  type StoreWorkspaceFixture,
} from '../../helpers/store-workspace-fixture.js';
import {
  publishPlanFromDecomposition,
  parseDecompositionDocument,
} from '../../../src/core/issue-publication/index.js';
import {
  StoreIssuesModule,
  productionStoreIssueDependencies,
  withDeterministicIssueClock,
} from '../../../src/core/store/issues/index.js';
import { StoreError } from '../../../src/core/store/errors.js';

const NOW = '2026-08-21T00:00:00.000Z';
const PROJECT = 'elftia';
const KNOWLEDGE_ONLY = 'elftia-docs';
const LINE = 'line-0.2';

/** A three-node decomposition with edges, suggestions, and rationale. */
function decompositionYaml(): string {
  return `nodes:
  - nodeId: widget-surface
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Author the widget surface
    dependsOn: []
    suggestedPipeline: small-feature
    rationale: the surface must exist before any consumer can build on it
  - nodeId: widget-consumers
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Migrate the two consumers onto the surface
    dependsOn: [widget-surface]
    suggestedPipeline: small-feature
    uncertainty: unsure whether the second consumer can migrate without a compat shim
  - nodeId: widget-docs
    kind: intent
    projectId: ${PROJECT}
    targetLineId: ${LINE}
    summary: Document the surface
    dependsOn: [widget-surface]
    lifecycle: optional
    suggestedPipeline: small-feature
    rationale: docs follow the surface, not the migration
`;
}

describe('parseDecompositionDocument (pure reader)', () => {
  it('compiles intent nodes with suggestions and rationale, carrying the authored lifecycle onto the node', () => {
    const nodes = parseDecompositionDocument(decompositionYaml(), 'doc.yaml');
    expect(nodes).toHaveLength(3);
    expect(nodes.every(node => node.kind === 'intent')).toBe(true);
    expect(nodes[0]).toMatchObject({
      nodeId: 'widget-surface',
      suggestedPipeline: 'small-feature',
      rationale: 'the surface must exist before any consumer can build on it',
    });
    expect(nodes[1]?.uncertainty).toContain('compat shim');
    // The authored `lifecycle: optional` compiles ONTO the intent node
    // (review-flow D1): the revision — not the document — is the durable
    // record of the required/optional proposal. A silent node carries no
    // lifecycle key at all (absent reads required downstream).
    expect(nodes[2]).toMatchObject({ nodeId: 'widget-docs', lifecycle: 'optional' });
    expect('lifecycle' in (nodes[0] as object)).toBe(false);
  });

  it('refuses a change-kind node toward the portfolio source, naming the node', () => {
    const document = decompositionYaml().replace(
      '  - nodeId: widget-consumers\n    kind: intent',
      '  - nodeId: widget-consumers\n    kind: change'
    );
    let thrown: unknown;
    try {
      parseDecompositionDocument(document, 'doc.yaml');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreError);
    const error = thrown as StoreError;
    expect(error.diagnostic.code).toBe('issue_plan_decomposition_change_node');
    expect(error.message).toContain('widget-consumers');
    expect(error.message).toContain('--from-portfolio');
  });

  it('refuses a node without a suggestedPipeline, and one with neither rationale nor uncertainty', () => {
    const missingPipeline = decompositionYaml().replace(
      '    suggestedPipeline: small-feature\n    rationale: the surface must exist before any consumer can build on it',
      '    rationale: the surface must exist before any consumer can build on it'
    );
    const missingBoth = decompositionYaml().replace(
      '    suggestedPipeline: small-feature\n    uncertainty: unsure whether the second consumer can migrate without a compat shim',
      '    suggestedPipeline: small-feature'
    );
    for (const [document, field] of [
      [missingPipeline, 'suggestedPipeline'],
      [missingBoth, 'rationale'],
    ] as const) {
      let thrown: unknown;
      try {
        parseDecompositionDocument(document, 'doc.yaml');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(StoreError);
      const error = thrown as StoreError;
      expect(error.diagnostic.code).toBe('issue_plan_decomposition_field_missing');
      expect(error.message).toContain('widget-');
      expect(error.message).toContain(field);
    }
  });

  it('refuses a lifecycle outside the proposal vocabulary, and an unknown field', () => {
    const cancelled = decompositionYaml().replace(
      '    lifecycle: optional',
      '    lifecycle: cancelled'
    );
    expect(() => parseDecompositionDocument(cancelled, 'doc.yaml')).toThrow(
      /lifecycle|invalid/i
    );
    const unknown = decompositionYaml().replace(
      '    suggestedPipeline: small-feature\n    rationale: docs follow the surface, not the migration',
      '    suggestedPipeline: small-feature\n    rationale: docs follow the surface, not the migration\n    cohort: one'
    );
    expect(() => parseDecompositionDocument(unknown, 'doc.yaml')).toThrow(/cohort/);
  });
});

describe('publishPlanFromDecomposition (orchestration)', () => {
  let f: StoreWorkspaceFixture;
  let documentPath: string;
  let issueUids: Map<string, string>;
  const KNOWN = (name: string): boolean => name === 'small-feature';

  beforeEach(async () => {
    f = await createStoreWorkspaceFixture({
      prefix: 'rasen-plan-decomp-',
      projects: [PROJECT, KNOWLEDGE_ONLY],
      knowledgeOnlyProjects: [KNOWLEDGE_ONLY],
      storeBranches: ['release/0.2'],
      lines: [
        { id: 'main', storeRef: 'refs/heads/main' },
        { id: LINE, storeRef: 'refs/heads/release/0.2' },
      ],
    });
    documentPath = f.beside('decomposition.yaml');
    f.write(documentPath, decompositionYaml());
    issueUids = new Map();
  });

  afterEach(() => {
    f.cleanup();
  });

  function issues(): StoreIssuesModule {
    return new StoreIssuesModule({
      dependencies: withDeterministicIssueClock(productionStoreIssueDependencies, NOW),
    });
  }

  async function createIssue(issueId: string): Promise<void> {
    const created = await issues().create({
      store: f.storeId,
      startPath: f.storeRoot,
      globalDataDir: f.globalDataDir,
      issueId,
      title: 'decomposition test',
    });
    issueUids.set(issueId, created.identity.uid);
  }

  const issueAt = (issueSelector: string, ...segments: string[]): string =>
    f.at('rasen', 'issues', issueUids.get(issueSelector)!, ...segments);

  async function refusalCode(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
    let thrown: unknown;
    try {
      await run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StoreError);
    const error = thrown as StoreError;
    return { code: error.diagnostic.code, message: error.message };
  }

  it('publishes the document as intent nodes with suggestions and rationale, leaving it byte-identical', async () => {
    await createIssue('decomp-1');
    const before = fs.readFileSync(documentPath, 'utf8');
    const result = await publishPlanFromDecomposition(
      {
        issueId: 'decomp-1',
        documentPath,
        store: f.storeId,
        startPath: f.projectRoot(PROJECT),
        globalDataDir: f.globalDataDir,
        pipelineKnown: KNOWN,
      },
      { issues: issues() }
    );
    expect(result.revision.revisionId).toBe('0001');
    expect(result.revision.nodes).toHaveLength(3);
    const consumers = result.revision.nodes.find(node => node.nodeId === 'widget-consumers');
    expect(consumers).toMatchObject({
      kind: 'intent',
      suggestedPipeline: 'small-feature',
      dependsOn: ['widget-surface'],
    });
    expect(result.source).toEqual({
      kind: 'decomposition',
      documentPath,
      nodeCount: 3,
    });
    expect(fs.readFileSync(documentPath, 'utf8')).toBe(before);
  });

  it('publication adds a revision, never rewrites one', async () => {
    await createIssue('decomp-2');
    const first = await publishPlanFromDecomposition(
      {
        issueId: 'decomp-2',
        documentPath,
        store: f.storeId,
        startPath: f.projectRoot(PROJECT),
        globalDataDir: f.globalDataDir,
        pipelineKnown: KNOWN,
      },
      { issues: issues() }
    );
    const firstBytes = fs.readFileSync(
      issueAt('decomp-2', 'plans', '0001.yaml'),
      'utf8'
    );
    const second = await publishPlanFromDecomposition(
      {
        issueId: 'decomp-2',
        documentPath,
        store: f.storeId,
        startPath: f.projectRoot(PROJECT),
        globalDataDir: f.globalDataDir,
        pipelineKnown: KNOWN,
      },
      { issues: issues() }
    );
    expect(second.revision.revisionId).toBe('0002');
    expect(second.revision.supersedes).toBe('0001');
    // The earlier revision's bytes never change.
    expect(
      fs.readFileSync(issueAt('decomp-2', 'plans', '0001.yaml'), 'utf8')
    ).toBe(firstBytes);
  });

  it('refuses a document that does not read back as unreadable, never as absent', async () => {
    await createIssue('decomp-3');
    const refusal = await refusalCode(() =>
      publishPlanFromDecomposition(
        {
          issueId: 'decomp-3',
          documentPath: f.beside('no-such-decomposition.yaml'),
          store: f.storeId,
          startPath: f.projectRoot(PROJECT),
          globalDataDir: f.globalDataDir,
          pipelineKnown: KNOWN,
        },
        { issues: issues() }
      )
    );
    expect(refusal.code).toBe('issue_plan_decomposition_unreadable');
    expect(refusal.message).toContain('no-such-decomposition.yaml');
    expect(
      fs.existsSync(issueAt('decomp-3', 'plans', '0001.yaml'))
    ).toBe(false);
  });

  it('refuses a knowledge-only target under the same planning-member rule, naming the project and its roles', async () => {
    await createIssue('decomp-4');
    f.write(
      documentPath,
      decompositionYaml().replaceAll(`projectId: ${PROJECT}`, `projectId: ${KNOWLEDGE_ONLY}`)
    );
    const refusal = await refusalCode(() =>
      publishPlanFromDecomposition(
        {
          issueId: 'decomp-4',
          documentPath,
          store: f.storeId,
          startPath: f.projectRoot(PROJECT),
          globalDataDir: f.globalDataDir,
          pipelineKnown: KNOWN,
        },
        { issues: issues() }
      )
    );
    expect(refusal.code).toBe('issue_reference_target_not_planning_member');
    expect(refusal.message).toContain(KNOWLEDGE_ONLY);
    expect(
      fs.existsSync(issueAt('decomp-4', 'plans', '0001.yaml'))
    ).toBe(false);
  });

  it('refuses an unknown suggested pipeline through the channel, naming node and pipeline', async () => {
    await createIssue('decomp-5');
    f.write(
      documentPath,
      decompositionYaml().replaceAll('suggestedPipeline: small-feature', 'suggestedPipeline: no-such-pipeline')
    );
    let thrown: unknown;
    try {
      await publishPlanFromDecomposition(
        {
          issueId: 'decomp-5',
          documentPath,
          store: f.storeId,
          startPath: f.projectRoot(PROJECT),
          globalDataDir: f.globalDataDir,
          pipelineKnown: KNOWN,
        },
        { issues: issues() }
      );
    } catch (error) {
      thrown = error;
    }
    // The registry check is publishPlan's (StorePlanningValidationError, not
    // StoreError) — inherited through the channel, naming a node from the
    // document (the first offender in canonical node order) and the pipeline.
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(
      ['widget-surface', 'widget-consumers', 'widget-docs'].some(id => message.includes(id))
    ).toBe(true);
    expect(message).toContain('no-such-pipeline');
    expect(
      fs.existsSync(issueAt('decomp-5', 'plans', '0001.yaml'))
    ).toBe(false);
  });
});
