import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  prepareAgentCliSpawn,
  spawnAgentCli,
} from '../../src/core/agent-cli-process.js';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'claude'
);
const fakeBinary = path.join(
  fixtureDir,
  process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs'
);

beforeAll(() => {
  if (process.platform !== 'win32') fs.chmodSync(fakeBinary, 0o755);
});

function spawnAndRead(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnAgentCli(
      fakeBinary,
      ['-p', '--output-format', 'json'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        stdinPayload: prompt,
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`fixture exited ${String(code)}: ${stderr}`));
    });
  });
}

describe('shared agent CLI process helper', () => {
  it('keeps direct executable launches shell-free and hidden', () => {
    const prepared = prepareAgentCliSpawn('/tmp/claude', ['--version'], 'linux');
    expect(prepared).toMatchObject({
      command: '/tmp/claude',
      args: ['--version'],
      windowsOptions: { shell: false, windowsHide: true },
    });
  });

  it('routes a Windows .cmd shim through the escaped cmd.exe path', () => {
    const prepared = prepareAgentCliSpawn(
      'C:\\Program Files\\Claude & Co\\claude.cmd',
      ['--model', 'sonnet & echo nope'],
      'win32',
      { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
    );
    expect(prepared.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(prepared.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(prepared.windowsOptions).toEqual({
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  });

  it('round-trips multiline CJK and metacharacters through stdin followed by EOF', async () => {
    const prompt = 'MODE=success 第一行\n第二行 \"quotes\" & | > < ^ % !';
    const envelope = JSON.parse(await spawnAndRead(prompt)) as {
      structured_output: { summary: string };
    };
    const summary = JSON.parse(envelope.structured_output.summary) as { prompt: string };
    expect(summary.prompt).toBe(prompt);
  });

  it('rejects an oversized stdin payload before spawning', () => {
    expect(() =>
      spawnAgentCli(fakeBinary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        stdinPayload: '12345',
        maxStdinBytes: 4,
      })
    ).toThrow(/limit is 4 bytes/);
  });
});
