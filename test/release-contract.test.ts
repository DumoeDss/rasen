import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RASEN_HISTORY_END,
  RASEN_HISTORY_START,
  extractRasenHistory,
  extractReleaseNotes,
  loadReleaseContract,
  parseCanonicalVersion,
  validateLockstepVersions,
  versionFromReleaseTag,
} from '../scripts/release-contract.mjs';
import { npmInvocationForPlatform } from '../scripts/npm-command.mjs';
import { verifyUiPackMetadata } from '../scripts/paired-pack-check.mjs';

const tempDirs: string[] = [];

function makeRoot({
  cli = '0.1.5',
  ui = '0.1.5',
  changelog = `${RASEN_HISTORY_START}\n\n## 0.1.5\n\nPaired release.\n\n## 0.1.4\n\nOlder.\n\n${RASEN_HISTORY_END}\n\n## 1.5.0\n\nUpstream.`,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-release-contract-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'packages', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: cli }));
  fs.writeFileSync(
    path.join(root, 'packages', 'ui', 'package.json'),
    JSON.stringify({ version: ui }),
  );
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('release version contract', () => {
  it('accepts one canonical three-component version across CLI, UI, and tag', () => {
    expect(parseCanonicalVersion('0.1.5')).toBe('0.1.5');
    expect(versionFromReleaseTag('rasen-v0.1.5')).toBe('0.1.5');
    expect(
      validateLockstepVersions({
        cliVersion: '0.1.5',
        uiVersion: '0.1.5',
        releaseTag: 'rasen-v0.1.5',
      }),
    ).toBe('0.1.5');
  });

  it.each(['0.1.5.1', '01.1.5', '0.01.5', '0.1.05', '0.1', 'v0.1.5', '0.1.5-ui.1'])(
    'rejects non-canonical version %s',
    (version) => {
      expect(() => parseCanonicalVersion(version)).toThrow(/canonical SemVer/);
    },
  );

  it('rejects CLI/UI drift and tag drift', () => {
    expect(() =>
      validateLockstepVersions({ cliVersion: '0.1.5', uiVersion: '0.1.6' }),
    ).toThrow(/CLI\/UI version mismatch/);
    expect(() =>
      validateLockstepVersions({
        cliVersion: '0.1.5',
        uiVersion: '0.1.5',
        releaseTag: 'rasen-v0.1.6',
      }),
    ).toThrow(/tag\/package version mismatch/);
  });
});

describe('curated release notes', () => {
  it('extracts only the bounded Rasen history and one matching section', () => {
    const changelog = `${RASEN_HISTORY_START}\n## 0.1.5\n\nNew.\n\n## 0.1.4\n\nOld.\n${RASEN_HISTORY_END}\n## 1.5.0\n\nUpstream.`;
    const history = extractRasenHistory(changelog);
    expect(history).toContain('## 0.1.5');
    expect(history).not.toContain('## 1.5.0');
    expect(extractReleaseNotes(history, '0.1.5')).toBe('## 0.1.5\n\nNew.');
  });

  it('rejects missing, duplicate, reversed, and empty markers', () => {
    expect(() => extractRasenHistory('## 0.1.5')).toThrow(/missing/);
    expect(() =>
      extractRasenHistory(
        `${RASEN_HISTORY_START}\n${RASEN_HISTORY_START}\n## 0.1.5\n${RASEN_HISTORY_END}`,
      ),
    ).toThrow(/duplicate/);
    expect(() =>
      extractRasenHistory(`${RASEN_HISTORY_END}\n## 0.1.5\n${RASEN_HISTORY_START}`),
    ).toThrow(/out of order/);
    expect(() =>
      extractRasenHistory(`${RASEN_HISTORY_START}\n\n${RASEN_HISTORY_END}`),
    ).toThrow(/empty/);
  });

  it('rejects a missing, duplicate, or empty release section', () => {
    expect(() => extractReleaseNotes('## 0.1.4\n\nOld.', '0.1.5')).toThrow(/found 0/);
    expect(() =>
      extractReleaseNotes('## 0.1.5\n\nOne.\n\n## 0.1.5\n\nTwo.', '0.1.5'),
    ).toThrow(/found 2/);
    expect(() => extractReleaseNotes('## 0.1.5', '0.1.5')).toThrow(/empty/);
  });

  it('loads the paired manifests and matching release notes from cross-platform paths', () => {
    const contract = loadReleaseContract({
      rootDir: makeRoot(),
      releaseTag: 'rasen-v0.1.5',
    });
    expect(contract.version).toBe('0.1.5');
    expect(contract.notes).toContain('Paired release.');
    expect(contract.history).not.toContain('Upstream.');
  });
});

describe('UI pack metadata', () => {
  it('requires the shared version and dist/index.html', () => {
    expect(() =>
      verifyUiPackMetadata(
        { version: '0.1.5', files: [{ path: 'package.json' }, { path: 'dist/index.html' }] },
        '0.1.5',
      ),
    ).not.toThrow();
    expect(() =>
      verifyUiPackMetadata({ version: '0.1.5', files: [{ path: 'package.json' }] }, '0.1.5'),
    ).toThrow(/dist\/index\.html/);
    expect(() =>
      verifyUiPackMetadata(
        { version: '0.1.4', files: [{ path: 'package.json' }, { path: 'dist/index.html' }] },
        '0.1.5',
      ),
    ).toThrow(/version mismatch/);
  });
});

describe('cross-platform npm execution', () => {
  it('runs the npm JavaScript CLI through Node on Windows and the binary elsewhere', () => {
    const windows = npmInvocationForPlatform('win32', 'C:\\node\\node.exe');
    expect(windows.command).toBe('C:\\node\\node.exe');
    expect(windows.argsPrefix).toEqual([
      path.win32.join('C:\\node', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]);
    expect(npmInvocationForPlatform('linux', '/usr/bin/node')).toEqual({
      command: 'npm',
      argsPrefix: [],
    });
    expect(npmInvocationForPlatform('darwin', '/usr/local/bin/node')).toEqual({
      command: 'npm',
      argsPrefix: [],
    });
  });
});
