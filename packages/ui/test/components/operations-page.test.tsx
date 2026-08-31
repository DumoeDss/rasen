// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getStoreProjects: vi.fn(),
    listSpaces: vi.fn(),
    getStoreChangeIssueLinks: vi.fn(),
    listSessions: vi.fn(),
    listRuns: vi.fn(),
  };
});

vi.mock('../../src/components/OperationsSection.js', () => ({
  RunOperationsPanel: (props: {
    projectId?: string;
    selector?: string;
    runsResponse: RunsResponse | null;
  }) => (
    <div
      data-testid="run-operations-panel"
      data-project-id={props.projectId}
      data-selector={props.selector}
    >
      {(props.runsResponse?.reconcilerRuns ?? []).map(run => run.runId).join(',')}
    </div>
  ),
}));

vi.mock('../../src/components/SessionRow.js', () => ({
  SessionRow: ({ entry }: { entry: SessionListEntry }) => (
    <div data-testid="session-row" data-session-id={entry.session.id}>{entry.session.task}</div>
  ),
}));

import * as client from '../../src/api/client.js';
import type {
  RunsResponse,
  SessionListEntry,
  SessionsResponse,
  SpacesResponse,
  StoreChangeIssueLinksResponse,
  StoreProjectsResponse,
} from '../../src/api/types.js';
import { OperationsPage } from '../../src/components/OperationsPage.js';

const PROJECT_A_ROOT = 'C:\\checkouts\\project-a';
const STORE_X_UID = '11111111-2222-4333-8444-555555555555';
const STORE_B_UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const projects = {
  storeId: 'store_x',
  storeUid: STORE_X_UID,
  complete: true,
  unsearchedRefs: [],
  problems: [],
  projects: [
    {
      projectId: 'project-a',
      roles: { planning: true, knowledge: true },
      diagnostic: null,
      targetLines: ['main', 'release'],
      activeChangeCount: 2,
      archivedChangeCount: 0,
    },
    {
      projectId: 'project-b',
      roles: { planning: false, knowledge: true },
      diagnostic: null,
      targetLines: ['main'],
      activeChangeCount: 0,
      archivedChangeCount: 0,
    },
  ],
} satisfies StoreProjectsResponse;

const spaces = {
  spaces: [{
    type: 'store',
    id: 'store_x',
    uid: STORE_X_UID,
    name: 'Store X',
    root: 'C:\\planning\\store-x',
    members: [
      { projectId: 'project-a', name: 'App A', root: PROJECT_A_ROOT },
      { projectId: 'project-b', name: 'App B' },
    ],
  }],
} satisfies SpacesResponse;

function liveSession(input: {
  id: string;
  task: string;
  changeName?: string;
  execution?: SessionListEntry['session']['execution'];
  cwd?: string;
  targetLineId?: string;
}): SessionListEntry {
  return {
    session: {
      id: input.id,
      kind: 'auto',
      task: input.task,
      cwd: input.cwd ?? '/actual/cwd',
      state: 'running',
      startedAt: 1,
      lastOutputAt: 2,
      ...(input.changeName === undefined ? {} : { changeName: input.changeName }),
      ...(input.execution === undefined ? {} : { execution: input.execution }),
      space: {
        type: 'store',
        id: 'store_x',
        root: 'C:\\planning\\store-x',
        ...(input.targetLineId === undefined
          ? {}
          : { planning: { projectId: 'project-a', targetLineId: input.targetLineId } }),
      },
    },
    runState: { kind: 'absent' },
  };
}

const exactSession = liveSession({
  id: 'session-exact',
  task: 'exact session',
  changeName: 'shared-change',
  execution: { kind: 'project', projectId: 'project-a', root: 'D:\\frozen\\project-a' },
  cwd: 'C:\\actual\\process-cwd',
  targetLineId: 'main',
});
const planningSession = liveSession({
  id: 'session-planning',
  task: 'planning only',
  changeName: 'shared-change',
  execution: { kind: 'planning-only' },
});
const ambiguousSession = liveSession({
  id: 'session-ambiguous',
  task: 'ambiguous session',
  changeName: 'ambiguous-change',
  execution: { kind: 'project', projectId: 'project-a', root: PROJECT_A_ROOT },
});
const failedSession: SessionListEntry = {
  session: {
    ...liveSession({
      id: 'session-failed',
      task: 'failed session',
      execution: { kind: 'project', projectId: 'project-a', root: PROJECT_A_ROOT },
    }).session,
    state: 'exited',
    terminationReason: 'signal',
    exitSignal: 'SIGTERM',
  },
  runState: { kind: 'absent' },
};

const links = {
  complete: true,
  unsearchedRefs: [],
  problems: [],
  entries: [
    {
      occurrence: {
        kind: 'active',
        change: {
          changeId: 'shared-change',
          changeInstanceId: 'change-main',
          projectId: 'project-a',
          targetLineId: 'main',
          foundAtRef: 'refs/heads/main',
          localLocator: null,
        },
      },
      association: 'linked',
      eligibility: 'already-linked',
      issues: [{ issueId: 'issue-a', title: 'Issue A', state: 'open', revisionId: '0001', nodeIds: ['node-a'] }],
    },
    ...['main', 'release'].map((targetLineId, index) => ({
      occurrence: {
        kind: 'active' as const,
        change: {
          changeId: 'ambiguous-change',
          changeInstanceId: `ambiguous-${index}`,
          projectId: 'project-a',
          targetLineId,
          foundAtRef: `refs/heads/${targetLineId}`,
          localLocator: null,
        },
      },
      association: 'unlinked' as const,
      eligibility: 'attachable' as const,
      issues: [],
    })),
  ],
} satisfies StoreChangeIssueLinksResponse;

const firstRuns = {
  runs: [],
  reconcilerRuns: [{
    runId: 'run-one',
    changeId: 'shared-change',
    planningSpaceId: 'planning-one',
    engine: 'reconciler',
    recordVersion: 1,
    status: 'waiting',
    sourceState: 'active',
    waits: 1,
  }],
  nextCursor: 'opaque-cursor',
  hasMore: true,
} satisfies RunsResponse;

async function flush(times = 24): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

async function mount(container: HTMLElement): Promise<void> {
  window.history.pushState({}, '', '/s/store_x/operations');
  await act(async () => {
    render(<LocationProvider><OperationsPage /></LocationProvider>, container);
    await flush();
  });
  await act(async () => { await flush(); });
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await flush();
  });
}

function RoutedOperations() {
  const { route } = useLocation();
  return (
    <>
      <button data-testid="route-store-b" onClick={() => route('/s/store_b/operations')}>
        route store B
      </button>
      <Router>{[
        <Route path="/s/:storeId/operations" component={OperationsPage} />
      ]}</Router>
    </>
  );
}

async function advancePolling(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
    await flush(40);
  });
  await act(async () => { await flush(); });
}

describe('OperationsPage', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(client.getStoreProjects).mockResolvedValue(projects);
    vi.mocked(client.listSpaces).mockResolvedValue(spaces);
    vi.mocked(client.getStoreChangeIssueLinks).mockResolvedValue(links);
    vi.mocked(client.listSessions).mockImplementation(async selector => ({
      sessions: selector === 'store:store_x'
        ? [exactSession, planningSession]
        : [exactSession, ambiguousSession, failedSession],
    }));
    vi.mocked(client.listRuns).mockResolvedValue(firstRuns);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
  });

  it('fans out by roster member, dedupes Sessions, separates cwd/execution, and preserves exact/ambiguous attribution', async () => {
    await mount(container);

    expect(client.listSessions).toHaveBeenCalledWith('store:store_x');
    expect(client.listSessions).toHaveBeenCalledWith(`project:${PROJECT_A_ROOT}`);
    expect(client.listRuns).toHaveBeenCalledWith(`project:${PROJECT_A_ROOT}`);
    expect(client.listSessions).not.toHaveBeenCalledWith('project:undefined');
    expect(container.querySelectorAll('[data-session-id="session-exact"]')).toHaveLength(2);
    expect(container.querySelectorAll('.operations-page__session[data-session-id="session-exact"]')).toHaveLength(1);

    const groupOrder = [...container.querySelectorAll('[data-session-group]')]
      .map(group => group.getAttribute('data-session-group'));
    expect(groupOrder).toEqual(['active', 'abnormal']);
    expect(container.textContent).toContain('C:\\actual\\process-cwd');
    expect(container.textContent).toContain('project-a · D:\\frozen\\project-a');
    expect(container.textContent).toContain('issue-a');
    expect(container.textContent).toContain('Change attribution is ambiguous (2 candidates).');

    const panel = container.querySelector('[data-testid="run-operations-panel"]')!;
    expect(panel.getAttribute('data-project-id')).toBe('project-a');
    expect(panel.getAttribute('data-selector')).toBe(`project:${PROJECT_A_ROOT}`);
    expect(container.querySelector('[data-project-id="project-b"]')?.textContent).toContain(
      'No usable checkout is available on this machine.'
    );

    await click([...container.querySelectorAll('.member-chip')].find(button => button.textContent === 'App A')!);
    expect(container.querySelector('.operations-page__session[data-session-id="session-planning"]')).toBeNull();
    expect(container.querySelector('.operations-page__session[data-session-id="session-exact"]')).not.toBeNull();
    expect(localStorage.getItem('rasen.operations.project')).toBeNull();
  });

  it('keeps successful sources visible, retries a failed member locally, and appends an opaque cursor page', async () => {
    let memberSessionAttempts = 0;
    vi.mocked(client.getStoreChangeIssueLinks).mockRejectedValueOnce(new Error('links unavailable'));
    vi.mocked(client.listSessions).mockImplementation(async selector => {
      if (selector === 'store:store_x') return { sessions: [planningSession] };
      memberSessionAttempts += 1;
      if (memberSessionAttempts === 1) throw new Error('member sessions unavailable');
      return { sessions: [exactSession] };
    });
    vi.mocked(client.listRuns).mockImplementation(async (_selector, options) => {
      if (options?.cursor === 'opaque-cursor') {
        return {
          runs: [],
          reconcilerRuns: [{
            ...firstRuns.reconcilerRuns![0]!,
            runId: 'run-two',
            recordVersion: 2,
          }],
          hasMore: false,
        };
      }
      return firstRuns;
    });

    await mount(container);
    expect(container.textContent).toContain('Failed to load Change-to-Issue links.');
    expect(container.textContent).toContain('sessions: Failed to load Sessions.');
    expect(container.textContent).toContain('run-one');

    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Retry member sources')!);
    expect(container.textContent).not.toContain('sessions: Failed to load Sessions.');
    expect(container.querySelector('.operations-page__session[data-session-id="session-exact"]')).not.toBeNull();

    await click([...container.querySelectorAll('button')].find(button => button.textContent === 'Load more')!);
    expect(client.listRuns).toHaveBeenCalledWith(
      `project:${PROJECT_A_ROOT}`,
      { cursor: 'opaque-cursor' }
    );
    expect(container.querySelector('[data-testid="run-operations-panel"]')?.textContent).toContain('run-two');
  });

  it('retains each successful source when automatic polling later fails', async () => {
    vi.useFakeTimers();
    await mount(container);
    expect(container.querySelector('.operations-page__session[data-session-id="session-exact"]')).not.toBeNull();
    expect(container.textContent).toContain('run-one');
    expect(container.textContent).toContain('issue-a');

    vi.mocked(client.getStoreChangeIssueLinks).mockRejectedValue(new Error('links unavailable'));
    vi.mocked(client.listSessions).mockRejectedValue(new Error('sessions unavailable'));
    vi.mocked(client.listRuns).mockRejectedValue(new Error('runs unavailable'));
    await advancePolling();

    expect(container.querySelector('.operations-page__session[data-session-id="session-exact"]')).not.toBeNull();
    expect(container.textContent).toContain('run-one');
    expect(container.textContent).toContain('issue-a');
    expect(container.textContent).toContain('sessions: Failed to load Sessions.');
    expect(container.textContent).toContain('runs: Failed to load Runs.');
    expect(container.textContent).toContain('Failed to load Change-to-Issue links.');

    vi.mocked(client.getStoreProjects).mockRejectedValueOnce(new Error('roster unavailable'));
    await advancePolling();

    expect(container.textContent).toContain('Failed to load the Store project roster.');
    expect(container.textContent).toContain('App A');
    expect(container.querySelector('.operations-page__session[data-session-id="session-exact"]')).not.toBeNull();
    expect(container.textContent).toContain('run-one');
    expect(container.textContent).toContain('issue-a');
  });

  it('does not poll for live work hidden by the selected project filter', async () => {
    vi.useFakeTimers();
    await mount(container);

    await click([...container.querySelectorAll('.member-chip')]
      .find(button => button.textContent === 'App B')!);
    expect(container.querySelector('[data-testid="operations-session"]')).toBeNull();
    const sessionCalls = vi.mocked(client.listSessions).mock.calls.length;
    const runCalls = vi.mocked(client.listRuns).mock.calls.length;
    const rosterCalls = vi.mocked(client.getStoreProjects).mock.calls.length;

    await advancePolling();

    expect(vi.mocked(client.listSessions)).toHaveBeenCalledTimes(sessionCalls);
    expect(vi.mocked(client.listRuns)).toHaveBeenCalledTimes(runCalls);
    expect(vi.mocked(client.getStoreProjects)).toHaveBeenCalledTimes(rosterCalls);
  });

  it('starts 3-second polling only while active or non-terminal work is displayed', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    await mount(container);
    expect(interval.mock.calls.some(call => call[1] === 3000)).toBe(true);

    render(null, container);
    interval.mockClear();
    const settled: SessionListEntry = {
      session: {
        ...exactSession.session,
        state: 'exited',
        terminationReason: 'exit',
        exitCode: 0,
      },
      runState: { kind: 'absent' },
    };
    vi.mocked(client.listSessions).mockResolvedValue({ sessions: [settled] } satisfies SessionsResponse);
    vi.mocked(client.listRuns).mockResolvedValue({
      runs: [],
      reconcilerRuns: [{ ...firstRuns.reconcilerRuns![0]!, terminal: { outcome: 'landed' } }],
      hasMore: false,
    });
    await mount(container);
    expect(interval.mock.calls.some(call => call[1] === 3000)).toBe(false);
  });

  it('discards late Store A retry and load-more results after a same-component route to Store B with overlapping project ids', async () => {
    const projectBRoot = 'D:\\checkouts\\project-a';
    const projectsB: StoreProjectsResponse = {
      ...projects,
      storeId: 'store_b',
      storeUid: STORE_B_UID,
    };
    const spacesAB: SpacesResponse = {
      spaces: [
        spaces.spaces[0]!,
        {
          type: 'store',
          id: 'store_b',
          uid: STORE_B_UID,
          name: 'Store B',
          root: 'D:\\planning\\store-b',
          members: [{ projectId: 'project-a', name: 'App B/A', root: projectBRoot }],
        },
      ],
    };
    const runsB: RunsResponse = {
      runs: [],
      reconcilerRuns: [{ ...firstRuns.reconcilerRuns![0]!, runId: 'run-store-b', recordVersion: 9 }],
      hasMore: false,
    };
    const lateRetryRuns: RunsResponse = {
      runs: [],
      reconcilerRuns: [{ ...firstRuns.reconcilerRuns![0]!, runId: 'run-late-retry', recordVersion: 7 }],
      hasMore: false,
    };
    const latePageRuns: RunsResponse = {
      runs: [],
      reconcilerRuns: [{ ...firstRuns.reconcilerRuns![0]!, runId: 'run-late-page', recordVersion: 8 }],
      hasMore: false,
    };
    let resolveRetrySessions!: (value: SessionsResponse) => void;
    let resolveRetryRuns!: (value: RunsResponse) => void;
    let resolvePageRuns!: (value: RunsResponse) => void;
    const retrySessions = new Promise<SessionsResponse>(resolve => { resolveRetrySessions = resolve; });
    const retryRuns = new Promise<RunsResponse>(resolve => { resolveRetryRuns = resolve; });
    const pageRuns = new Promise<RunsResponse>(resolve => { resolvePageRuns = resolve; });
    let projectASessionReads = 0;
    let projectARunReads = 0;

    vi.mocked(client.getStoreProjects).mockImplementation(currentSelector =>
      Promise.resolve(currentSelector === 'store:store_b' ? projectsB : projects)
    );
    vi.mocked(client.listSpaces).mockResolvedValue(spacesAB);
    vi.mocked(client.listSessions).mockImplementation(currentSelector => {
      if (currentSelector === `project:${PROJECT_A_ROOT}`) {
        projectASessionReads += 1;
        if (projectASessionReads === 1) return Promise.reject(new Error('initial Store A session failure'));
        return retrySessions;
      }
      if (currentSelector === `project:${projectBRoot}`) return Promise.resolve({ sessions: [] });
      return Promise.resolve({ sessions: [] });
    });
    vi.mocked(client.listRuns).mockImplementation((currentSelector, options) => {
      if (currentSelector === `project:${projectBRoot}`) return Promise.resolve(runsB);
      if (options?.cursor === 'opaque-cursor') return pageRuns;
      projectARunReads += 1;
      return projectARunReads === 1 ? Promise.resolve(firstRuns) : retryRuns;
    });

    window.history.pushState({}, '', '/s/store_x/operations');
    await act(async () => {
      render(<LocationProvider><RoutedOperations /></LocationProvider>, container);
      await flush();
    });
    await act(async () => { await flush(); });
    expect(container.textContent).toContain('run-one');
    expect(container.textContent).toContain('sessions: Failed to load Sessions.');

    await click([...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Retry member sources')!);
    await click([...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Load more')!);

    await click(container.querySelector('[data-testid="route-store-b"]')!);
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      await flush(40);
    });
    expect(container.textContent).not.toContain('run-one');
    expect(container.querySelector('[data-testid="run-operations-panel"]')?.getAttribute('data-selector'))
      .toBe(`project:${projectBRoot}`);
    expect(container.textContent).toContain('run-store-b');

    resolveRetrySessions({ sessions: [exactSession] });
    resolveRetryRuns(lateRetryRuns);
    resolvePageRuns(latePageRuns);
    await act(async () => { await flush(40); });

    expect(container.textContent).toContain('run-store-b');
    expect(container.textContent).not.toContain('run-late-retry');
    expect(container.textContent).not.toContain('run-late-page');
    expect(container.textContent).not.toContain('run-one');
    expect(container.querySelector('[data-testid="run-operations-panel"]')?.getAttribute('data-selector'))
      .toBe(`project:${projectBRoot}`);
  });
});
