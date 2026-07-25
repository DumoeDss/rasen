import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  digestContent,
  type CanonicalLearnedSkill,
  type EffectiveLearnedSkillPlan,
} from '../../src/core/learned-skills/index.js';
import {
  reconcileGlobalLearnedSkillsForTool,
  reconcileProjectLearnedSkillsForTool,
  renderMaterializedSkill,
} from '../../src/core/learned-skill-materialization.js';
import {
  getProjectLearnedLedgerPath,
  readProjectLearnedLedger,
} from '../../src/core/project-learned-skill-ledger.js';
import {
  persistToolLearnedArtifacts,
  readWorkflowArtifactLedger,
  sha256File,
  storedArtifactFile,
  writeWorkflowArtifactLedger,
  type WorkflowArtifactLedger,
} from '../../src/core/workflow-artifact-ledger.js';
import {
  getGlobalLearnedLedgerPath,
  persistGlobalLearnedArtifacts,
  readGlobalLearnedArtifacts,
} from '../../src/core/global-learned-skill-ledger.js';

const ID = 'typescript-cli-routing';

describe('typed learned-skill ledgers', () => {
  let projectRoot: string;
  let skillsRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-ledger-'));
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    skillsRoot = path.join(projectRoot, '.claude', 'skills');
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function plan(): EffectiveLearnedSkillPlan {
    const content = '---\nname: typed\n---\n\nUse typed provenance.\n';
    const record: CanonicalLearnedSkill = {
      identity: { owner: { type: 'project', id: 'web' }, id: ID },
      scope: 'project',
      directory: path.join(projectRoot, 'canonical', ID),
      content,
      evidence: [],
      manifest: {
        version: 2,
        scope: 'project',
        owner: { type: 'project', id: 'web' },
        id: ID,
        knowledgeKey: 'typescript-cli-routing-key',
        status: 'active',
        generatedBy: 'rasen-learned-skill',
        contentDigest: digestContent(content),
        description: 'Route TypeScript CLI diagnostics.',
        applicability: { mode: 'all', markers: ['package.json'] },
        evidence: [],
        sources: [],
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      },
    };
    const resolutionDigest = digestContent(
      JSON.stringify({
        id: ID,
        effectiveScope: 'project',
        sources: [record.identity],
        knowledgeKey: record.manifest.knowledgeKey,
        canonicalContentDigest: record.manifest.contentDigest,
        content,
      })
    );
    return {
      status: 'ready',
      project: { type: 'project', id: 'web', root: projectRoot },
      skills: [
        {
          id: ID,
          effectiveScope: 'project',
          sources: [record.identity],
          knowledgeKey: record.manifest.knowledgeKey,
          canonicalContentDigest: record.manifest.contentDigest,
          resolutionDigest,
          canonicalRecord: record,
        },
      ],
      globalRecords: [],
      stores: [],
      conflicts: [],
      unavailableStores: [],
      deferred: [],
      planningErrors: [],
    };
  }

  function seedLegacy(targetContent: string, trackedContent = targetContent): string {
    const target = path.join(skillsRoot, ID, 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, targetContent);
    const trackedSha = digestContent(trackedContent);
    const ledger: WorkflowArtifactLedger = {
      version: 1,
      workflows: ['custom-flow'],
      tools: {
        claude: {
          workflows: {
            'custom-flow': {
              source: 'user',
              digest: `sha256:${'a'.repeat(64)}`,
              files: [],
            },
          },
          learned: {
            [ID]: {
              skillScope: 'project',
              contentDigest: plan().skills[0]!.canonicalContentDigest,
              file: {
                ...storedArtifactFile(projectRoot, target),
                sha256: trackedSha,
              },
            },
          },
        },
      },
    };
    writeWorkflowArtifactLedger(projectRoot, ledger);
    return target;
  }

  it('migrates legacy ownership write-new-before-clear and preserves workflows', () => {
    const effective = plan();
    const target = seedLegacy(renderMaterializedSkill(effective.skills[0]!));

    const result = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: effective,
    });

    expect(result.created).toHaveLength(0);
    const typed = readProjectLearnedLedger(projectRoot)!;
    expect(typed.tools.claude.learned[ID]?.sources).toEqual([
      { owner: { type: 'project', id: 'web' }, id: ID },
    ]);
    expect(typed.tools.claude.learned[ID]?.file.sha256).toBe(sha256File(target));
    const workflow = readWorkflowArtifactLedger(projectRoot)!;
    expect(workflow.workflows).toEqual(['custom-flow']);
    expect(workflow.tools.claude.workflows['custom-flow']).toBeDefined();
    expect(workflow.tools.claude.learned).toBeUndefined();

    // Simulate an interrupted older duplicate: typed ownership stays
    // authoritative and retry clears only the legacy learned section.
    persistToolLearnedArtifacts(projectRoot, 'claude', {
      [ID]: {
        skillScope: 'project',
        contentDigest: effective.skills[0]!.canonicalContentDigest,
        file: {
          ...storedArtifactFile(projectRoot, target),
          sha256: sha256File(target)!,
        },
      },
    });
    const typedPath = getProjectLearnedLedgerPath(projectRoot);
    const typedBefore = fs.readFileSync(typedPath, 'utf8');
    const typedMtimeBefore = fs.statSync(typedPath).mtimeMs;
    const retry = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: effective,
    });
    expect(retry.created).toHaveLength(0);
    expect(retry.updated).toHaveLength(0);
    expect(readWorkflowArtifactLedger(projectRoot)?.tools.claude.learned).toBeUndefined();
    expect(fs.readFileSync(typedPath, 'utf8')).toBe(typedBefore);
    expect(fs.statSync(typedPath).mtimeMs).toBe(typedMtimeBefore);
  });

  it('never claims a user-modified legacy file', () => {
    const effective = plan();
    const target = seedLegacy('user changed\n', 'old generated bytes\n');

    const result = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: effective,
    });

    expect(result.skipped.map((skip) => skip.reason)).toEqual(['collision']);
    expect(fs.readFileSync(target, 'utf8')).toBe('user changed\n');
    expect(readProjectLearnedLedger(projectRoot)?.tools.claude).toBeUndefined();
    expect(readWorkflowArtifactLedger(projectRoot)?.tools.claude.learned).toBeUndefined();
  });

  it('rejects a tampered typed ledger before learned target writes', () => {
    fs.writeFileSync(
      getProjectLearnedLedgerPath(projectRoot),
      JSON.stringify({ version: 1, stores: {}, tools: { claude: { learned: { [ID]: {} } } } })
    );
    const target = path.join(skillsRoot, ID, 'SKILL.md');

    expect(() =>
      reconcileProjectLearnedSkillsForTool({
        projectRoot,
        toolId: 'claude',
        toolLabel: 'Claude Code',
        skillsRoot,
        plan: plan(),
      })
    ).toThrow(/Project learned ledger is invalid/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('preserves an out-of-home project-ledger target instead of hashing or deleting it', () => {
    const outside = path.join(projectRoot, 'precious-outside.txt');
    fs.writeFileSync(outside, 'matching generated bytes\n');
    const digest = digestContent('matching generated bytes\n');
    const effective = plan();
    fs.writeFileSync(
      getProjectLearnedLedgerPath(projectRoot),
      `${JSON.stringify({
        version: 1,
        stores: {},
        tools: {
          claude: {
            learned: {
              [ID]: {
                effectiveScope: 'project',
                sources: [{ owner: { type: 'project', id: 'web' }, id: ID }],
                canonicalContentDigest: effective.skills[0]!.canonicalContentDigest,
                resolutionDigest: effective.skills[0]!.resolutionDigest,
                file: { scope: 'absolute', path: outside, sha256: digest },
              },
            },
          },
        },
      }, null, 2)}\n`
    );

    const result = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: { ...effective, skills: [] },
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toMatchObject([{ id: ID, reason: 'ledger-invalid' }]);
    expect(fs.readFileSync(outside, 'utf8')).toBe('matching generated bytes\n');
    expect(readProjectLearnedLedger(projectRoot)?.tools.claude.learned[ID]).toBeDefined();
  });

  it('rejects a typed ledger whose source id does not match its map key', () => {
    const effective = plan();
    fs.writeFileSync(
      getProjectLearnedLedgerPath(projectRoot),
      JSON.stringify({
        version: 1,
        stores: {},
        tools: {
          claude: {
            learned: {
              [ID]: {
                effectiveScope: 'project',
                sources: [
                  { owner: { type: 'project', id: 'web' }, id: 'different-id' },
                ],
                canonicalContentDigest: effective.skills[0]!.canonicalContentDigest,
                resolutionDigest: effective.skills[0]!.resolutionDigest,
                file: {
                  scope: 'project',
                  path: `.claude/skills/${ID}/SKILL.md`,
                  sha256: `sha256:${'c'.repeat(64)}`,
                },
              },
            },
          },
        },
      })
    );

    expect(() => readProjectLearnedLedger(projectRoot)).toThrow(
      /source ids must match their ledger map key/
    );
  });

  it('strictly reads v1 global entries and rewrites explicit typed global v2', () => {
    const globalDataDir = path.join(projectRoot, 'global');
    const target = path.join(globalDataDir, 'hermes', ID, 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'global\n');
    const digest = digestContent('global\n');
    fs.mkdirSync(globalDataDir, { recursive: true });
    fs.writeFileSync(
      getGlobalLearnedLedgerPath(globalDataDir),
      `${JSON.stringify({
        version: 1,
        tools: {
          hermes: {
            learned: {
              [ID]: { contentDigest: digest, path: target, sha256: digest },
            },
          },
        },
      })}\n`
    );

    const normalized = readGlobalLearnedArtifacts(globalDataDir, 'hermes');
    expect(normalized[ID]?.sources).toEqual([{ owner: { type: 'global' }, id: ID }]);
    persistGlobalLearnedArtifacts(globalDataDir, 'hermes', normalized);
    const persisted = JSON.parse(
      fs.readFileSync(getGlobalLearnedLedgerPath(globalDataDir), 'utf8')
    ) as Record<string, unknown>;
    expect(persisted.version).toBe(2);
  });

  it('rejects relative global paths and preserves out-of-home absolute targets', () => {
    const globalDataDir = path.join(projectRoot, 'global-path-safety');
    fs.mkdirSync(globalDataDir, { recursive: true });
    const ledgerPath = getGlobalLearnedLedgerPath(globalDataDir);
    const digest = digestContent('precious global bytes\n');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        version: 1,
        tools: {
          hermes: {
            learned: {
              [ID]: { contentDigest: digest, path: `relative/${ID}/SKILL.md`, sha256: digest },
            },
          },
        },
      })
    );
    expect(() => readGlobalLearnedArtifacts(globalDataDir, 'hermes')).toThrow(
      /global learned artifact paths must be absolute/
    );

    const outside = path.join(projectRoot, 'precious-global.txt');
    fs.writeFileSync(outside, 'precious global bytes\n');
    fs.writeFileSync(
      ledgerPath,
      JSON.stringify({
        version: 2,
        tools: {
          hermes: {
            learned: {
              [ID]: {
                effectiveScope: 'global',
                sources: [{ owner: { type: 'global' }, id: ID }],
                canonicalContentDigest: digest,
                resolutionDigest: digest,
                path: outside,
                sha256: digest,
              },
            },
          },
        },
      })
    );

    const result = reconcileGlobalLearnedSkillsForTool({
      toolId: 'hermes',
      toolLabel: 'Hermes',
      skillsRoot: path.join(globalDataDir, 'hermes-skills'),
      globalRecords: [],
      globalDataDir,
    });
    expect(result.removed).toEqual([]);
    expect(result.skipped).toMatchObject([{ id: ID, reason: 'ledger-invalid' }]);
    expect(fs.readFileSync(outside, 'utf8')).toBe('precious global bytes\n');
    expect(readGlobalLearnedArtifacts(globalDataDir, 'hermes')[ID]).toBeDefined();
  });

  it('rejects invalid and non-global machine-global ownership', () => {
    const globalDataDir = path.join(projectRoot, 'invalid-global');
    fs.mkdirSync(globalDataDir, { recursive: true });
    fs.writeFileSync(
      getGlobalLearnedLedgerPath(globalDataDir),
      JSON.stringify({ version: 2, tools: { hermes: { learned: { [ID]: {} } } } })
    );
    expect(() => readGlobalLearnedArtifacts(globalDataDir, 'hermes')).toThrow(
      /Global learned ledger is invalid/
    );

    fs.rmSync(getGlobalLearnedLedgerPath(globalDataDir), { force: true });
    fs.writeFileSync(
      getGlobalLearnedLedgerPath(globalDataDir),
      JSON.stringify({
        version: 2,
        tools: {
          hermes: {
            learned: {
              [ID]: {
                effectiveScope: 'global',
                sources: [{ owner: { type: 'global' }, id: 'different-id' }],
                canonicalContentDigest: `sha256:${'a'.repeat(64)}`,
                resolutionDigest: `sha256:${'b'.repeat(64)}`,
                path: path.join(globalDataDir, ID, 'SKILL.md'),
                sha256: `sha256:${'c'.repeat(64)}`,
              },
            },
          },
        },
      })
    );
    expect(() => readGlobalLearnedArtifacts(globalDataDir, 'hermes')).toThrow(
      /source id must match its ledger map key/
    );

    fs.rmSync(getGlobalLearnedLedgerPath(globalDataDir), { force: true });
    expect(() =>
      persistGlobalLearnedArtifacts(
        globalDataDir,
        'hermes',
        {
          [ID]: {
            effectiveScope: 'global',
            sources: [{ owner: { type: 'project', id: 'web' }, id: ID }],
            canonicalContentDigest: `sha256:${'a'.repeat(64)}`,
            resolutionDigest: `sha256:${'b'.repeat(64)}`,
            path: path.join(globalDataDir, ID, 'SKILL.md'),
            sha256: `sha256:${'c'.repeat(64)}`,
          },
        } as unknown as Parameters<typeof persistGlobalLearnedArtifacts>[2]
      )
    ).toThrow(/rejected non-global/);
  });

  it('never removes a Hermes copy through a replaced symlink or junction directory', () => {
    const base = plan();
    const projectRecord = base.skills[0]!.canonicalRecord;
    const globalRecord: CanonicalLearnedSkill = {
      ...projectRecord,
      identity: { owner: { type: 'global' }, id: ID },
      scope: 'global',
      manifest: {
        ...projectRecord.manifest,
        scope: 'global',
        owner: { type: 'global' },
      },
    };
    const globalDataDir = path.join(projectRoot, 'global-junction');
    const hermesRoot = path.join(globalDataDir, 'hermes-skills');
    reconcileGlobalLearnedSkillsForTool({
      toolId: 'hermes',
      toolLabel: 'Hermes',
      skillsRoot: hermesRoot,
      globalRecords: [globalRecord],
      globalDataDir,
    });
    const managedDir = path.join(hermesRoot, ID);
    const relocated = path.join(globalDataDir, 'relocated-hermes-skill');
    fs.renameSync(managedDir, relocated);
    fs.symlinkSync(
      relocated,
      managedDir,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const relocatedFile = path.join(relocated, 'SKILL.md');
    const before = fs.readFileSync(relocatedFile, 'utf8');

    const result = reconcileGlobalLearnedSkillsForTool({
      toolId: 'hermes',
      toolLabel: 'Hermes',
      skillsRoot: hermesRoot,
      globalRecords: [],
      globalDataDir,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toMatchObject([{ id: ID, reason: 'ledger-invalid' }]);
    expect(fs.readFileSync(relocatedFile, 'utf8')).toBe(before);
    expect(readGlobalLearnedArtifacts(globalDataDir, 'hermes')[ID]).toBeDefined();
  });

  it('defers destructive cleanup for unavailable prior stores but permits a project winner', () => {
    const base = plan();
    const projectRecord = base.skills[0]!.canonicalRecord;
    const storeRecord: CanonicalLearnedSkill = {
      ...projectRecord,
      identity: { owner: { type: 'store', id: 'team' }, id: ID },
      scope: 'store',
      manifest: {
        ...projectRecord.manifest,
        version: 2,
        scope: 'store',
        owner: { type: 'store', id: 'team' },
      },
    };
    const storePlan: EffectiveLearnedSkillPlan = {
      ...base,
      stores: [
        {
          status: 'member',
          store: { type: 'store', id: 'team' },
          catalog: [storeRecord],
        },
      ],
      skills: [
        {
          ...base.skills[0]!,
          effectiveScope: 'store',
          sources: [storeRecord.identity],
          resolutionDigest: digestContent('store-resolution'),
          canonicalRecord: storeRecord,
        },
      ],
    };
    reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: storePlan,
    });
    const target = path.join(skillsRoot, ID, 'SKILL.md');
    const before = fs.readFileSync(target, 'utf8');
    const unavailable = {
      status: 'unavailable' as const,
      store: { type: 'store' as const, id: 'team' },
      diagnostic: 'store:team is offline',
      relevant: true,
      relevance: ['previous-source' as const],
    };
    const degraded: EffectiveLearnedSkillPlan = {
      ...base,
      status: 'degraded',
      skills: [],
      stores: [unavailable],
      unavailableStores: [unavailable],
    };

    const deferred = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: degraded,
    });
    expect(deferred.deferred).toMatchObject([{ id: ID, action: 'remove' }]);
    expect(fs.readFileSync(target, 'utf8')).toBe(before);

    const promoted = reconcileProjectLearnedSkillsForTool({
      projectRoot,
      toolId: 'claude',
      toolLabel: 'Claude Code',
      skillsRoot,
      plan: { ...base, status: 'degraded', stores: [unavailable], unavailableStores: [unavailable] },
    });
    expect(promoted.updated.map((item) => item.id)).toEqual([ID]);
    expect(readProjectLearnedLedger(projectRoot)?.tools.claude.learned[ID]?.effectiveScope).toBe(
      'project'
    );
  });

  it.each(['config-pointer', 'frozen-planning-root'] as const)(
    'defers removal and non-project replacement for unavailable %s evidence not named by the prior source',
    (relevance) => {
      const base = plan();
      const projectRecord = base.skills[0]!.canonicalRecord;
      const priorRecord: CanonicalLearnedSkill = {
        ...projectRecord,
        identity: { owner: { type: 'store', id: 'other' }, id: ID },
        scope: 'store',
        manifest: {
          ...projectRecord.manifest,
          scope: 'store',
          owner: { type: 'store', id: 'other' },
        },
      };
      const priorPlan: EffectiveLearnedSkillPlan = {
        ...base,
        skills: [
          {
            ...base.skills[0]!,
            effectiveScope: 'store',
            sources: [priorRecord.identity],
            resolutionDigest: digestContent('other-store-resolution'),
            canonicalRecord: priorRecord,
          },
        ],
      };
      reconcileProjectLearnedSkillsForTool({
        projectRoot,
        toolId: 'claude',
        toolLabel: 'Claude Code',
        skillsRoot,
        plan: priorPlan,
      });
      const target = path.join(skillsRoot, ID, 'SKILL.md');
      const before = fs.readFileSync(target, 'utf8');
      const unavailable = {
        status: 'unavailable' as const,
        store: { type: 'store' as const, id: 'team' },
        diagnostic: `store:team ${relevance} membership/reference cannot be resolved`,
        relevant: true,
        relevance: [relevance],
      };
      const removal = reconcileProjectLearnedSkillsForTool({
        projectRoot,
        toolId: 'claude',
        toolLabel: 'Claude Code',
        skillsRoot,
        plan: {
          ...base,
          status: 'degraded',
          skills: [],
          stores: [unavailable],
          unavailableStores: [unavailable],
        },
      });
      expect(removal.deferred).toMatchObject([
        {
          id: ID,
          action: 'remove',
          stores: [{ type: 'store', id: 'team' }],
        },
      ]);
      expect(fs.readFileSync(target, 'utf8')).toBe(before);

      const globalRecord: CanonicalLearnedSkill = {
        ...projectRecord,
        identity: { owner: { type: 'global' }, id: ID },
        scope: 'global',
        manifest: {
          ...projectRecord.manifest,
          scope: 'global',
          owner: { type: 'global' },
        },
      };
      const replacement = reconcileProjectLearnedSkillsForTool({
        projectRoot,
        toolId: 'claude',
        toolLabel: 'Claude Code',
        skillsRoot,
        plan: {
          ...base,
          status: 'degraded',
          stores: [unavailable],
          unavailableStores: [unavailable],
          skills: [
            {
              ...base.skills[0]!,
              effectiveScope: 'global',
              sources: [globalRecord.identity],
              resolutionDigest: digestContent('global-resolution'),
              canonicalRecord: globalRecord,
            },
          ],
        },
      });
      expect(replacement.deferred).toMatchObject([
        {
          id: ID,
          action: 'replace',
          stores: [{ type: 'store', id: 'team' }],
        },
      ]);
      expect(fs.readFileSync(target, 'utf8')).toBe(before);
    }
  );

  it('blocks every learned file and ledger mutation on an effective conflict', () => {
    const base = plan();
    const target = path.join(skillsRoot, ID, 'SKILL.md');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'existing user bytes\n');
    const blocked: EffectiveLearnedSkillPlan = {
      ...base,
      status: 'blocked',
      skills: [],
      conflicts: [
        {
          id: ID,
          kind: 'effective',
          participants: [
            {
              source: { owner: { type: 'store', id: 'a' }, id: ID },
              knowledgeKey: 'a',
              canonicalContentDigest: `sha256:${'a'.repeat(64)}`,
            },
            {
              source: { owner: { type: 'store', id: 'b' }, id: ID },
              knowledgeKey: 'b',
              canonicalContentDigest: `sha256:${'b'.repeat(64)}`,
            },
          ],
          guidance: 'align, rename, or retire',
        },
      ],
    };

    for (const toolId of ['claude', 'codex']) {
      const result = reconcileProjectLearnedSkillsForTool({
        projectRoot,
        toolId,
        toolLabel: toolId,
        skillsRoot,
        plan: blocked,
      });
      expect(result.conflicts).toHaveLength(1);
    }
    expect(fs.readFileSync(target, 'utf8')).toBe('existing user bytes\n');
    expect(readProjectLearnedLedger(projectRoot)).toBeNull();
  });

  it('keeps Hermes global reconciliation independent from a project-local conflict', () => {
    const base = plan();
    const projectRecord = base.skills[0]!.canonicalRecord;
    const globalRecord: CanonicalLearnedSkill = {
      ...projectRecord,
      identity: { owner: { type: 'global' }, id: ID },
      scope: 'global',
      manifest: {
        ...projectRecord.manifest,
        version: 2,
        scope: 'global',
        owner: { type: 'global' },
      },
    };
    const blocked: EffectiveLearnedSkillPlan = {
      ...base,
      status: 'blocked',
      skills: [],
      globalRecords: [globalRecord],
      conflicts: [
        {
          id: ID,
          kind: 'effective',
          participants: [
            {
              source: { owner: { type: 'store', id: 'a' }, id: ID },
              knowledgeKey: 'a',
              canonicalContentDigest: `sha256:${'a'.repeat(64)}`,
            },
            {
              source: { owner: { type: 'store', id: 'b' }, id: ID },
              knowledgeKey: 'b',
              canonicalContentDigest: `sha256:${'b'.repeat(64)}`,
            },
          ],
          guidance: 'align, rename, or retire',
        },
      ],
    };
    const globalDataDir = path.join(projectRoot, 'global-independent');
    const hermesRoot = path.join(globalDataDir, 'hermes-skills');
    const result = reconcileGlobalLearnedSkillsForTool({
      toolId: 'hermes',
      toolLabel: 'Hermes',
      skillsRoot: hermesRoot,
      globalRecords: [globalRecord],
      plan: blocked,
      globalDataDir,
    });

    expect(result.created.map((item) => item.id)).toEqual([ID]);
    expect(result.conflicts).toHaveLength(1);
    expect(fs.existsSync(path.join(hermesRoot, ID, 'SKILL.md'))).toBe(true);
  });
});
