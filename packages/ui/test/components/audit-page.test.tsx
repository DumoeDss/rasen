// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    listAuditReports: vi.fn(),
    discoverAuditSessions: vi.fn(),
    getAuditReport: vi.fn(),
    runSessionAudit: vi.fn(),
    importAuditFile: vi.fn(),
  };
});

import { AuditPage } from '../../src/components/AuditPage.js';
import * as client from '../../src/api/client.js';

function descriptor(id: string, runtime: 'claude' | 'codex' | 'zed' = 'claude', modifiedAt = 1) {
  return {
    id,
    runtime,
    sessionId: `${id}-session`,
    generatedAt: '2026-07-24T00:00:00.000Z',
    sessionStart: null,
    sessionEnd: null,
    memberCount: 1,
    modifiedAt,
  };
}

function detail(id: string) {
  return {
    descriptor: descriptor(id),
    report: {
      schema: 'rasen-token-audit/2',
      generatedAt: '2026-07-24T00:00:00.000Z',
      session: { id: `${id}-session`, runtime: 'claude' },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flush(times = 8) {
  for (let index = 0; index < times; index++) await Promise.resolve();
}

describe('AuditPage', () => {
  let container: HTMLElement;
  let originalMatchMedia: typeof globalThis.matchMedia | undefined;

  beforeEach(() => {
    originalMatchMedia = globalThis.matchMedia;
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listAuditReports as any).mockResolvedValue({
      reports: [descriptor('new.json', 'claude', 2), descriptor('old.json', 'codex', 1)],
      skipped: 2,
    });
    (client.discoverAuditSessions as any).mockResolvedValue({
      sessions: [
        { runtime: 'claude', sessionId: 'native-one', label: 'Native one', updatedAt: 2 },
      ],
      diagnostics: [
        { runtime: 'claude', available: true },
        { runtime: 'codex', available: true },
        { runtime: 'zed', available: false, message: 'database missing' },
      ],
      limit: 50,
    });
    (client.getAuditReport as any).mockImplementation((id: string) => Promise.resolve(detail(id)));
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
    if (originalMatchMedia) globalThis.matchMedia = originalMatchMedia;
    else delete (globalThis as { matchMedia?: typeof globalThis.matchMedia }).matchMedia;
  });

  async function mount() {
    await act(async () => {
      render(<AuditPage />, container);
      await flush();
    });
    await act(async () => {
      await flush();
    });
  }

  it('selects the newest saved report, discloses skipped/unavailable data, and sends it after viewer readiness', async () => {
    await mount();
    expect(container.textContent).toContain('2 unsupported analytics entries were skipped');
    expect(container.textContent).toContain('zed: unavailable');
    expect(client.getAuditReport).toHaveBeenCalledWith('new.json');
    const active = container.querySelector('.audit-result--active');
    expect(active?.textContent).toContain('new.json-session');

    const frame = container.querySelector('[data-testid="audit-viewer-frame"]') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: location.origin,
        source: frame.contentWindow,
        data: { type: 'rasen-audit-ready' },
      }));
      await flush();
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'rasen-audit-report',
        report: expect.objectContaining({ session: expect.objectContaining({ id: 'new.json-session' }) }),
      }),
      '*'
    );
  });

  it('imports user-selected bytes, disables actions while busy, and selects the returned report', async () => {
    const pending = deferred<ReturnType<typeof detail>>();
    (client.importAuditFile as any).mockReturnValue(pending.promise);
    (client.listAuditReports as any)
      .mockResolvedValueOnce({
        reports: [descriptor('new.json', 'claude', 2), descriptor('old.json', 'codex', 1)],
        skipped: 2,
      })
      .mockResolvedValue({
        reports: [descriptor('imported.json', 'claude', 3), descriptor('new.json', 'claude', 2)],
        skipped: 0,
      });
    await mount();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['{}\n'], 'picked.jsonl', { type: 'application/json' });

    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(client.importAuditFile).toHaveBeenCalledWith(file);
    expect((container.querySelector('[data-testid="audit-analyze"]') as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('Uploading and analyzing');

    pending.resolve(detail('imported.json'));
    await act(async () => {
      await flush();
    });
    const frame = container.querySelector('[data-testid="audit-viewer-frame"]') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'null',
        source: frame.contentWindow,
        data: { type: 'rasen-audit-ready' },
      }));
      await flush();
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'rasen-audit-report',
        report: expect.objectContaining({ session: expect.objectContaining({ id: 'imported.json-session' }) }),
      }),
      '*'
    );
  });

  it('switches saved reports without running an audit and ignores a late stale detail response', async () => {
    const first = deferred<ReturnType<typeof detail>>();
    const second = deferred<ReturnType<typeof detail>>();
    (client.getAuditReport as any).mockImplementation((id: string) =>
      id === 'new.json' ? first.promise : second.promise
    );
    await mount();

    const oldButton = Array.from(container.querySelectorAll('.audit-result')).find((button) =>
      button.textContent?.includes('old.json-session')
    ) as HTMLButtonElement;
    await act(async () => {
      oldButton.click();
      await flush();
    });
    second.resolve(detail('old.json'));
    await act(async () => {
      await flush();
    });
    first.resolve(detail('new.json'));
    await act(async () => {
      await flush();
    });

    expect(container.querySelector('.audit-result--active')?.textContent).toContain('old.json-session');
    expect(client.runSessionAudit).not.toHaveBeenCalled();
  });

  it('preserves the existing report when native analysis fails and selects a successful retry result', async () => {
    (client.listAuditReports as any).mockReset()
      .mockResolvedValueOnce({
        reports: [descriptor('new.json', 'claude', 2), descriptor('old.json', 'codex', 1)],
        skipped: 2,
      })
      .mockResolvedValue({
        reports: [descriptor('created.json', 'claude', 3), descriptor('new.json', 'claude', 2)],
        skipped: 0,
      });
    (client.runSessionAudit as any)
      .mockRejectedValueOnce(new Error('format changed'))
      .mockResolvedValueOnce(detail('created.json'));
    await mount();
    const analyze = container.querySelector('[data-testid="audit-analyze"]') as HTMLButtonElement;

    await act(async () => {
      analyze.click();
      await flush();
    });
    await act(async () => {
      await flush();
    });
    expect(container.textContent).toContain('Failed to analyze the selected session');
    expect(container.querySelector('.audit-result--active')?.textContent).toContain('new.json-session');

    await act(async () => {
      analyze.click();
      await flush();
    });
    await act(async () => {
      await flush();
    });
    expect(client.runSessionAudit).toHaveBeenLastCalledWith('claude', 'native-one');
    expect(container.querySelector('.audit-result--active')?.textContent).toContain('created.json-session');
  });

  it('collapses and expands saved results without losing focus, selection, or report width', async () => {
    await mount();
    const master = container.querySelector('.audit-master-detail') as HTMLElement;
    const region = container.querySelector('#audit-saved-results') as HTMLElement;
    const toggle = container.querySelector('.audit-results__toggle') as HTMLButtonElement;
    expect(master.dataset.resultsExpanded).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('audit-saved-results');
    expect(toggle.getAttribute('aria-label')).toBe('Collapse saved results');
    expect(region.hidden).toBe(false);

    toggle.focus();
    await act(async () => {
      toggle.click();
      await flush();
    });
    expect(document.activeElement).toBe(toggle);
    expect(master.classList.contains('audit-master-detail--collapsed')).toBe(true);
    expect(master.dataset.resultsExpanded).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Expand saved results');
    expect(region.hidden).toBe(true);
    expect(container.querySelector('.audit-result--active')?.textContent).toContain('new.json-session');
    expect(client.getAuditReport).toHaveBeenCalledTimes(1);

    await act(async () => {
      toggle.click();
      await flush();
    });
    expect(document.activeElement).toBe(toggle);
    expect(master.classList.contains('audit-master-detail--collapsed')).toBe(false);
    expect(region.hidden).toBe(false);
    expect(container.querySelector('.audit-result--active')?.textContent).toContain('new.json-session');
  });

  it('starts with the saved-results rail collapsed on a narrow viewport and can restore the full-width list', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? false : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    await mount();

    const master = container.querySelector('.audit-master-detail') as HTMLElement;
    const toggle = container.querySelector('.audit-results__toggle') as HTMLButtonElement;
    expect(master.classList.contains('audit-master-detail--collapsed')).toBe(true);
    expect(toggle.getAttribute('aria-label')).toBe('Expand saved results');

    await act(async () => {
      toggle.click();
      await flush();
    });
    expect(master.classList.contains('audit-master-detail--collapsed')).toBe(false);
    expect((container.querySelector('#audit-saved-results') as HTMLElement).hidden).toBe(false);
  });
});
