// @vitest-environment jsdom
/**
 * Live re-localization (ui-i18n design D5; spec req 2): after a successful
 * `putKey('language', …)` the Config page calls `refreshLocale()`, which
 * re-reads the effective value and updates the locale store — the whole tree
 * re-renders in the new locale with no full page reload (no token re-entry, no
 * route change). This test exercises the mechanism end-to-end: a subscribed
 * component renders in the initial locale, then swaps to the new locale's text
 * after `refreshLocale`, without touching the router.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return { ...actual, getKey: vi.fn() };
});

import { getLocaleCatalog } from '../../src/i18n/catalog.js';
import {
  __resetLocaleForTesting,
  getCurrentLocale,
  refreshLocale,
  useT,
} from '../../src/i18n/store.js';
import * as client from '../../src/api/client.js';

/** A subscriber component that renders a translated string via `useT()`. */
function Probe() {
  const t = useT();
  return (
    <span data-testid="probe" data-locale={getCurrentLocale()}>
      {t('nav.board')}
    </span>
  );
}

describe('live re-localization (spec req 2)', () => {
  let container: HTMLElement;
  let originalZhBoard: string;

  beforeEach(() => {
    __resetLocaleForTesting();
    container = document.createElement('div');
    document.body.appendChild(container);
    // Inject a DISTINCT zh-cn value so the re-render is observable as text
    // (the shipped catalog may mirror en until localized). Restored in afterEach.
    const zh = getLocaleCatalog('zh-cn');
    originalZhBoard = zh['nav.board'];
    zh['nav.board'] = '看板';
  });

  afterEach(() => {
    getLocaleCatalog('zh-cn')['nav.board'] = originalZhBoard;
    render(null, container);
    document.body.removeChild(container);
    __resetLocaleForTesting();
    vi.resetAllMocks();
  });

  it('refreshLocale updates the active locale and re-renders subscribers in place, with no reload', async () => {
    await act(async () => {
      render(<Probe />, container);
    });
    // Initial render: default locale en → "Board".
    expect(getCurrentLocale()).toBe('en');
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toBe('Board');

    // Simulate the Config page's post-putKey path: refreshLocale re-reads the
    // effective `language` value (here mocked to 'zh-cn') and re-resolves.
    (client.getKey as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      entry: { value: 'zh-cn' },
    });

    await act(async () => {
      await refreshLocale();
    });

    // The store flipped to zh-cn and the subscriber re-rendered WITHOUT a
    // reload — same DOM node, new text. (No router / LocationProvider is
    // mounted here, proving the re-render is driven by the store, not the URL.)
    expect(getCurrentLocale()).toBe('zh-cn');
    const probe = container.querySelector('[data-testid="probe"]')!;
    expect(probe.textContent).toBe('看板');
  });

  it('a failed read leaves the locale unchanged (graceful degradation)', async () => {
    await act(async () => {
      render(<Probe />, container);
    });
    expect(getCurrentLocale()).toBe('en');

    (client.getKey as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));
    await act(async () => {
      await refreshLocale();
    });

    // A failed re-read must not flip the locale or wipe the rendered text.
    expect(getCurrentLocale()).toBe('en');
    expect(container.querySelector('[data-testid="probe"]')!.textContent).toBe('Board');
  });
});
