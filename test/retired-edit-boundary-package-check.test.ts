import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { verifyRetiredEditBoundaryPackage } from '../scripts/retired-edit-boundary-package-check.mjs';

const tempDirs: string[] = [];

const CLEAN_PACKAGE_FILES: Record<string, string> = {
  'dist/cli/index.js': "program.command('agent');\n",
  'dist/commands/agent.d.ts': 'export declare class AgentCommand {}\n',
  'dist/commands/agent.js': 'export class AgentCommand {}\n',
  'dist/core/completions/command-registry.js': "export const commands = [{ name: 'agent' }];\n",
  'dist/core/index.d.ts': "export type { RuntimeAdapter } from './runtime-adapters.js';\n",
  'dist/core/index.js': "export { resolveRuntimeAdapter } from './runtime-adapters.js';\n",
  'dist/core/runtime-adapters.d.ts': "export type RuntimeAdapterId = 'claude' | 'codex';\n",
  'dist/core/runtime-adapters.js': "export const runtimeAdapters = ['claude', 'codex'];\n",
  'dist/core/init.js': 'cleanupRetiredEditBoundaryArtifacts(projectRoot);\n',
  'dist/core/update.js': 'cleanupRetiredEditBoundaryArtifacts(projectRoot);\n',
  'dist/core/legacy-cleanup.d.ts':
    'export declare function cleanupLegacyEditBoundaryState(): Promise<void>;\n',
  'dist/core/legacy-cleanup.js':
    "export const legacyStateName = 'freeze-dir.txt';\n",
  'dist/core/retired-edit-boundary.d.ts':
    'export declare const RETIRED_CODEX_EDIT_BOUNDARY_HANDLER: { command: string };\n',
  'dist/core/retired-edit-boundary.js':
    "export const handler = 'rasen agent edit-boundary check --runtime codex';\n",
  'docs/history.md':
    'The historical edit-boundary implementation exposed EditBoundary types.\n',
};

function makePackageFixture(
  overrides: Record<string, string | null> = {}
): { root: string; metadata: { files: Array<{ path: string }> } } {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rasen-retired-boundary-pack-')
  );
  tempDirs.push(root);
  const files = { ...CLEAN_PACKAGE_FILES, ...overrides };
  const packageFiles: Array<{ path: string }> = [];
  for (const [packagePath, content] of Object.entries(files)) {
    if (content === null) continue;
    const target = path.join(root, ...packagePath.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    packageFiles.push({ path: packagePath });
  }
  return { root, metadata: { files: packageFiles } };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('retired edit-boundary packed-payload guard', () => {
  it('keeps the importable guard free of a shebang for Windows Node 20', () => {
    const guardPath = path.join(
      process.cwd(),
      'scripts',
      'retired-edit-boundary-package-check.mjs'
    );

    expect(fs.readFileSync(guardPath, 'utf8')).not.toMatch(/^#!/);
  });

  it('allows exact migration payloads and historical docs while runtime surfaces stay clean', () => {
    const fixture = makePackageFixture();

    expect(() =>
      verifyRetiredEditBoundaryPackage(fixture.metadata, fixture.root)
    ).not.toThrow();
  });

  it.each([
    [
      'CLI command',
      'dist/cli/index.js',
      "program.command('edit-boundary');\n",
    ],
    [
      'AgentCommand method',
      'dist/commands/agent.js',
      'export class AgentCommand { setEditBoundary() {} }\n',
    ],
    [
      'completion entry',
      'dist/core/completions/command-registry.js',
      "export const commands = [{ name: 'edit-boundary' }];\n",
    ],
    [
      'public type export',
      'dist/core/index.d.ts',
      "export type { EditBoundaryResult } from './edit-boundary.js';\n",
    ],
    [
      'public runtime export',
      'dist/core/index.js',
      'export { resolveEditBoundaryEnforcement } from "./runtime-adapters.js";\n',
    ],
    [
      'adapter classification',
      'dist/core/runtime-adapters.d.ts',
      "export type EditBoundaryEnforcement = 'hard' | 'soft';\n",
    ],
    [
      'adapter implementation',
      'dist/core/runtime-adapters.js',
      'export function resolveEditBoundaryEnforcement() {}\n',
    ],
  ])('rejects a bare retired %s surface', (_label, packagePath, content) => {
    const fixture = makePackageFixture({ [packagePath]: content });

    expect(() =>
      verifyRetiredEditBoundaryPackage(fixture.metadata, fixture.root)
    ).toThrow(
      new RegExp(
        `${packagePath.replaceAll('/', '\\/')}.*(?:edit-boundary|EditBoundary)`
      )
    );
  });

  it.each([
    'dist/core/edit-boundary.d.ts',
    'dist/core/edit-boundary.js',
    'dist/core/edit-boundary-hooks.d.ts',
    'dist/core/edit-boundary-hooks.js',
  ])('rejects the forbidden live module %s from package metadata', (packagePath) => {
    const fixture = makePackageFixture({ [packagePath]: 'export {};\n' });

    expect(() =>
      verifyRetiredEditBoundaryPackage(fixture.metadata, fixture.root)
    ).toThrow(/package still contains live edit-boundary modules/);
  });

  it.each(['dist/core/init.js', 'dist/core/update.js'])(
    'requires retirement cleanup from %s',
    (packagePath) => {
      const fixture = makePackageFixture({ [packagePath]: 'export {};\n' });

      expect(() =>
        verifyRetiredEditBoundaryPackage(fixture.metadata, fixture.root)
      ).toThrow(`${packagePath} does not invoke retirement cleanup`);
    }
  );
});
