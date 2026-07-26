/**
 * Three roots, three different answers, one project.
 *
 * The failure this file exists to prevent: two clones of one project producing
 * two catalogs on one machine, so resolution answers differently depending on
 * where the command happened to run.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  digestContent,
  resolveEffectiveLearnedSkillPlan,
  resolveLearnedSkillExecutionContext,
  resolveLearnedSkillRoots,
  serializeManifest,
} from '../../../src/core/learned-skills/index.js';
import { reconcileProjectLearnedSkillsForTool } from '../../../src/core/learned-skill-materialization.js';
import { readProjectLearnedLedger } from '../../../src/core/project-learned-skill-ledger.js';
import { resolveProjectHome } from '../../../src/core/project-home.js';
import { resolveProjectKnowledgeHome } from '../../../src/core/project-knowledge-home.js';
import { buildRuntimeContext } from '../../../src/core/session-runtime-context.js';
import { writeStoreMetadataState } from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { registerStore } from '../../../src/core/store/registry.js';

const ID = 'typescript-cli-routing';
const BODY = '---\nname: shared\n---\n\nUse the stable route.\n';

describe('one project, several checkouts', () => {
  let tempDir: string;
  let globalDataDir: string;

  beforeEach(() => {
    tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-multi-')));
    globalDataDir = path.join(tempDir, 'data');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function healthyRoot(root: string): string {
    fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    return fs.realpathSync.native(root);
  }

  async function makeCheckout(name: string, projectId?: string, markers: string[] = ['package.json']) {
    const root = healthyRoot(path.join(tempDir, name));
    if (projectId !== undefined) {
      fs.writeFileSync(
        path.join(root, 'rasen', 'config.yaml'),
        `schema: spec-driven\nprojectId: ${projectId}\n`
      );
    }
    for (const marker of markers) fs.writeFileSync(path.join(root, marker), '{}\n');
    const home = await resolveProjectHome(root, { globalDataDir });
    return { root, projectId: home!.projectId };
  }

  function writeCanonicalRecord(projectId: string, markers: string[]): void {
    const directory = path.join(
      resolveProjectKnowledgeHome(projectId, { globalDataDir }).catalogDir,
      ID
    );
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'learned-skill.yaml'),
      serializeManifest({
        version: 2,
        scope: 'project',
        owner: { type: 'project', projectId },
        id: ID,
        knowledgeKey: 'typescript-cli-routing-key',
        status: 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(BODY),
        description: 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers },
        evidence: [],
        sources: [],
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      })
    );
    fs.writeFileSync(path.join(directory, 'SKILL.md'), BODY);
  }

  async function planIn(root: string) {
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: root,
      requestedScope: 'mixed',
      globalDataDir,
      sessionContext: null,
    });
    return resolveEffectiveLearnedSkillPlan({ execution });
  }

  it('shares one stored catalog while evaluating and generating in each checkout', async () => {
    const first = await makeCheckout('main-checkout');
    // The second clone has the SAME identity and does NOT carry the marker the
    // record needs, so the two checkouts must answer differently.
    const second = await makeCheckout('second-clone', first.projectId, []);
    writeCanonicalRecord(first.projectId, ['package.json']);

    const planOne = await planIn(first.root);
    const planTwo = await planIn(second.root);

    // ONE canonical location for the project.
    expect(planOne.canonicalOwnerRoot).toBe(planTwo.canonicalOwnerRoot);
    expect(planOne.canonicalOwnerRoot).toBe(
      resolveProjectKnowledgeHome(first.projectId, { globalDataDir }).root
    );
    // TWO evaluation roots, and two different answers.
    expect(planOne.evaluationRoot).toBe(first.root);
    expect(planTwo.evaluationRoot).toBe(second.root);
    expect(planOne.skills.map((skill) => skill.id)).toEqual([ID]);
    expect(planTwo.skills).toEqual([]);

    // Files land in the checkout being worked on, never in the storage location.
    reconcileProjectLearnedSkillsForTool({
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot: path.join(planOne.evaluationRoot, '.claude', 'skills'),
      plan: planOne,
    });
    expect(fs.existsSync(path.join(first.root, '.claude', 'skills', ID, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(second.root, '.claude', 'skills', ID, 'SKILL.md'))).toBe(false);
    expect(
      fs.existsSync(path.join(planOne.canonicalOwnerRoot, '.claude'))
    ).toBe(false);
    // Ownership is recorded beside the files it claims — the checkout.
    expect(readProjectLearnedLedger(first.root)?.tools.claude?.learned[ID]).toBeDefined();
    expect(readProjectLearnedLedger(second.root)).toBeNull();
  });

  it('resolves the three roots together and keeps them distinct', async () => {
    const checkout = await makeCheckout('main-checkout');
    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: checkout.root,
      requestedScope: 'mixed',
      globalDataDir,
      sessionContext: null,
    });

    const roots = await resolveLearnedSkillRoots(execution);

    expect(roots.ok).toBe(true);
    if (!roots.ok) return;
    expect(roots.roots.canonicalOwnerRoot).toBe(
      resolveProjectKnowledgeHome(checkout.projectId, { globalDataDir }).root
    );
    expect(roots.roots.evaluationRoot).toBe(checkout.root);
    expect(roots.roots.materializationRoot).toBe(checkout.root);
    expect(roots.roots.canonicalOwnerRoot).not.toBe(roots.roots.evaluationRoot);
  });

  it('follows the session\'s recorded execution checkout, not the directory it was launched from', async () => {
    const first = await makeCheckout('main-checkout');
    const second = await makeCheckout('second-clone', first.projectId, []);
    writeCanonicalRecord(first.projectId, ['package.json']);
    const store = healthyRoot(path.join(tempDir, 'planning-store'));
    const uid = mintStoreUid();
    await writeStoreMetadataState(store, { version: 2, uid, id: 'planning' });
    await registerStore({ id: 'planning', localPath: store, globalDataDir });

    // A Store session: planning happens in the Store, execution in the SECOND
    // clone — while the command is launched from the FIRST.
    const sessionContext = buildRuntimeContext({
      sessionId: 'session-1',
      space: { type: 'store', id: 'planning', root: store },
      execution: { kind: 'project', projectId: second.projectId, root: second.root },
    });
    expect(sessionContext).toBeDefined();

    const execution = await resolveLearnedSkillExecutionContext({
      launchDirectory: first.root,
      requestedScope: 'mixed',
      globalDataDir,
      sessionContext,
    });

    // The session's execution choice and the knowledge context agree.
    expect(execution.owner).toMatchObject({ type: 'project', id: second.projectId });
    expect(execution.evaluationRoot).toBe(second.root);
    expect(execution.planningRoot).toMatchObject({ type: 'store', id: 'planning' });
    expect(execution.source).toBe('session-context');

    // And the answer is the second clone's, not the launch directory's.
    const plan = await resolveEffectiveLearnedSkillPlan({ execution });
    expect(plan.evaluationRoot).toBe(second.root);
    expect(plan.skills).toEqual([]);
  });

  it('builds every expected path with platform path resolution', async () => {
    const checkout = await makeCheckout('main-checkout');
    const home = resolveProjectKnowledgeHome(checkout.projectId, { globalDataDir });
    writeCanonicalRecord(checkout.projectId, ['package.json']);

    const plan = await planIn(checkout.root);
    const result = reconcileProjectLearnedSkillsForTool({
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot: path.join(checkout.root, '.claude', 'skills'),
      plan,
    });

    expect(result.created[0]?.targetPath).toBe(
      path.join(checkout.root, '.claude', 'skills', ID, 'SKILL.md')
    );
    expect(plan.canonicalOwnerRoot).toBe(home.root);
    // The ownership record stores a portable, root-relative POSIX path so the
    // same record reads correctly on either platform.
    expect(readProjectLearnedLedger(checkout.root)?.tools.claude?.learned[ID]?.file.path).toBe(
      `.claude/skills/${ID}/SKILL.md`
    );
  });
});
