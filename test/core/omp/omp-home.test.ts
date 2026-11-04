import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveOmpAgentDir } from '../../../src/core/omp/omp-home.js';

/**
 * Every expectation is built with `path.join` from an injected home, so the
 * assertions hold on Windows (where the separator and the drive prefix differ)
 * without a second expected-value table. Each case mirrors one live
 * `omp config path` reading taken against `OMP_CLI_VERSION_PREMISE`; the
 * transcripts are in the change's verification report.
 */
const HOME = path.join(path.sep === '\\' ? 'C:\\' : '/', 'home', 'tester');

function agentDir(env: NodeJS.ProcessEnv): string {
  return resolveOmpAgentDir(env, HOME);
}

describe('resolveOmpAgentDir', () => {
  it('defaults to <home>/.omp/agent when nothing overrides it', () => {
    expect(agentDir({})).toBe(path.join(HOME, '.omp', 'agent'));
  });

  it('honors PI_CODING_AGENT_DIR as a full replacement path', () => {
    const relocated = path.join(path.sep === '\\' ? 'D:\\' : '/', 'srv', 'omp-agent');
    expect(agentDir({ PI_CODING_AGENT_DIR: relocated })).toBe(relocated);
  });

  it('resolves a relative PI_CODING_AGENT_DIR to an absolute path', () => {
    expect(path.isAbsolute(agentDir({ PI_CODING_AGENT_DIR: 'relative/agent' }))).toBe(true);
  });

  it('renames the config root from PI_CONFIG_DIR', () => {
    expect(agentDir({ PI_CONFIG_DIR: '.omptest' })).toBe(
      path.join(HOME, '.omptest', 'agent')
    );
  });

  it('joins an absolute-looking PI_CONFIG_DIR under home, as Oh My Pi does', () => {
    // Live: `PI_CONFIG_DIR=/tmp/ompcfg omp config path` prints
    // `~/tmp/ompcfg/agent`. PI_CONFIG_DIR is a dirname, not a path, and
    // `path.join` reproduces that swallowing of the leading separator exactly.
    expect(agentDir({ PI_CONFIG_DIR: `${path.sep}tmp${path.sep}ompcfg` })).toBe(
      path.join(HOME, 'tmp', 'ompcfg', 'agent')
    );
  });

  it('relocates to a named profile from OMP_PROFILE', () => {
    expect(agentDir({ OMP_PROFILE: 'work' })).toBe(
      path.join(HOME, '.omp', 'profiles', 'work', 'agent')
    );
  });

  it('accepts PI_PROFILE as the legacy selector', () => {
    expect(agentDir({ PI_PROFILE: 'legacy' })).toBe(
      path.join(HOME, '.omp', 'profiles', 'legacy', 'agent')
    );
  });

  it('lets a DEFINED-but-empty OMP_PROFILE shadow PI_PROFILE', () => {
    // The documented precedence, and the case a truthiness check gets wrong:
    // live, `OMP_PROFILE= PI_PROFILE=legacy omp config path` prints the DEFAULT
    // agent directory, not `legacy`'s.
    expect(agentDir({ OMP_PROFILE: '', PI_PROFILE: 'legacy' })).toBe(
      path.join(HOME, '.omp', 'agent')
    );
  });

  it("treats 'default' and whitespace as the default profile", () => {
    expect(agentDir({ OMP_PROFILE: 'default' })).toBe(path.join(HOME, '.omp', 'agent'));
    expect(agentDir({ OMP_PROFILE: '   ' })).toBe(path.join(HOME, '.omp', 'agent'));
  });

  it('ignores PI_CODING_AGENT_DIR under a named profile', () => {
    // The asymmetry that makes a single "agent dir override" branch wrong:
    // named profiles ignore the override entirely.
    expect(
      agentDir({ OMP_PROFILE: 'work', PI_CODING_AGENT_DIR: path.join(path.sep, 'srv', 'x') })
    ).toBe(path.join(HOME, '.omp', 'profiles', 'work', 'agent'));
  });

  it('combines a renamed config root with a named profile', () => {
    expect(agentDir({ PI_CONFIG_DIR: '.omptest', OMP_PROFILE: 'work' })).toBe(
      path.join(HOME, '.omptest', 'profiles', 'work', 'agent')
    );
  });
});
