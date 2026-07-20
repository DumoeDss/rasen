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
import { sessionDetailFixture, sessionsListFixture } from '../fixtures/sessions-list.js';

export { configListFixture, projectsListFixture, healthFixture, errorsFixture };
export { sessionDetailFixture, sessionsListFixture };

describe('fixture ↔ mirror-type drift tripwire', () => {
  it('config-list fixture has plausible entries', () => {
    expect(configListFixture.entries.length).toBeGreaterThan(0);
    for (const entry of configListFixture.entries) {
      expect(['default', 'global', 'project', 'env-override']).toContain(entry.source);
      expect(['boolean', 'number', 'string', 'enum', 'array', 'threshold']).toContain(
        entry.definition.type
      );
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

  it('sessions-list fixture covers live/exited/absent-join/invalid-join shapes (slice3-sessions-ui mirror drift alarm)', () => {
    expect(sessionsListFixture.sessions.length).toBeGreaterThan(0);
    for (const entry of sessionsListFixture.sessions) {
      expect(['auto', 'goal']).toContain(entry.session.kind);
      expect(['starting', 'running', 'exiting', 'exited']).toContain(entry.session.state);
      expect(['ok', 'error', 'absent']).toContain(
        entry.runState.kind === 'absent' ? 'absent' : entry.runState.kind
      );
    }

    const live = sessionsListFixture.sessions.find((e) => e.session.id === 'sess-live-with-progress')!;
    expect(live.runState.kind).toBe('ok');

    const exited = sessionsListFixture.sessions.find((e) => e.session.id === 'sess-exited-killed')!;
    expect(exited.session.terminationReason).toBe('killed');
    expect(exited.session.exitSignal).toBe('SIGTERM');

    const absentJoin = sessionsListFixture.sessions.find((e) => e.session.id === 'sess-no-change')!;
    expect(absentJoin.runState.kind).toBe('absent');

    const invalidJoin = sessionsListFixture.sessions.find((e) => e.session.id === 'sess-invalid-run-state')!;
    expect(invalidJoin.runState.kind === 'ok' && invalidJoin.runState.autoRun.kind).toBe('invalid');
  });

  it('session-detail fixture carries the record plus stdout/stderr tails', () => {
    expect(sessionDetailFixture.session.id).toBe('sess-live-with-progress');
    expect(typeof sessionDetailFixture.tails.stdout).toBe('string');
    expect(typeof sessionDetailFixture.tails.stderr).toBe('string');
  });
});
