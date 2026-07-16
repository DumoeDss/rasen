/**
 * Compile-time drift tripwire (design.md D5/D9) for the hand-maintained
 * mirror in `src/api/types.ts`. The actual tripwire lives in the
 * `satisfies <ResponseType>` annotations in `test/fixtures/*.ts` (no
 * `as`/`as unknown as` cast anywhere in that directory) — those files fail
 * `tsc --noEmit` / `pnpm typecheck` outright if `src/api/types.ts` diverges
 * from the CLI's `src/core/config-api/wire-types.ts` in a way that breaks
 * assignability. This file is the runtime half: a light structural sanity
 * check plus the single place every other test imports fixtures from, so a
 * fresh cast can't quietly bypass the tripwire elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { configListFixture } from '../fixtures/config-list.js';
import { projectsListFixture } from '../fixtures/projects-list.js';
import { healthFixture } from '../fixtures/health.js';
import { errorsFixture } from '../fixtures/errors.js';

export { configListFixture, projectsListFixture, healthFixture, errorsFixture };

describe('fixture ↔ mirror-type drift tripwire', () => {
  it('config-list fixture has plausible entries', () => {
    expect(configListFixture.entries.length).toBeGreaterThan(0);
    for (const entry of configListFixture.entries) {
      expect(['default', 'global', 'project', 'env-override']).toContain(entry.source);
      expect(['boolean', 'number', 'string', 'enum', 'array']).toContain(entry.definition.type);
    }
  });

  it('the warnings entry is the negative case the API actually returns (m1 fixed)', () => {
    const repoMode = configListFixture.entries.find((e) => e.definition.key === 'repoMode')!;
    expect(repoMode.warnings).toBeDefined();
    expect(repoMode.source).toBe('global'); // only a raw GLOBAL value can carry a warning

    const autopilotGates = configListFixture.entries.find((e) => e.definition.key === 'autopilot.gates')!;
    expect(autopilotGates.warnings).toBeUndefined(); // invalid project values are dropped, never warned
    expect(autopilotGates.source).toBe('default');
  });

  it('projects-list fixture is a plain array', () => {
    expect(Array.isArray(projectsListFixture.projects)).toBe(true);
  });

  it('health fixture reports ok: true', () => {
    expect(healthFixture.ok).toBe(true);
  });

  it('every recorded error case has a code/message and invalid_scope carries a fix', () => {
    for (const [name, recorded] of Object.entries(errorsFixture)) {
      expect(typeof recorded.status).toBe('number');
      expect(typeof recorded.body.error.code).toBe('string');
      expect(typeof recorded.body.error.message).toBe('string');
      if (name === 'invalid_scope') {
        expect(recorded.body.error.fix).toBeDefined();
      }
    }
  });
});
