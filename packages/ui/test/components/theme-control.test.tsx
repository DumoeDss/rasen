// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/api/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/client.js')>();
  return {
    ...actual,
    getKey: vi.fn(),
    listThemes: vi.fn(),
    importTheme: vi.fn(),
    putKey: vi.fn(),
  };
});

import * as client from '../../src/api/client.js';
import { ThemeControl } from '../../src/components/ThemeControl.js';
import { __resetLocaleForTesting, setLocale } from '../../src/i18n/store.js';
import {
  activateTheme,
  EDITORIAL_THEME,
  initializeTheme,
} from '../../src/theme/runtime.js';
import type { WireConfigEntry } from '../../src/api/types.js';

const entry: WireConfigEntry = {
  definition: {
    key: 'ui.theme',
    scopes: ['global'],
    type: 'string',
    defaultValue: 'editorial',
    description: 'Theme',
    group: 'Appearance',
    constraints: { type: 'string' },
  },
  value: 'editorial',
  source: 'global',
  scopeValues: { global: 'editorial' },
};
const forestTheme = {
  schemaVersion: 1 as const,
  id: 'forest-paper',
  name: 'Forest Paper',
  mode: 'light' as const,
  tokens: { light: { canvas: '#f1f4ec', accent: '#386641' } },
  effects: [],
};

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Global theme control', () => {
  let container: HTMLElement;

  beforeEach(() => {
    __resetLocaleForTesting();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    (client.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue({ themes: [], skipped: [] });
    activateTheme(EDITORIAL_THEME);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    vi.resetAllMocks();
    __resetLocaleForTesting();
  });

  it('lists bundled themes and writes/activates a selected theme live', async () => {
    const updated = vi.fn();
    (client.putKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      entry: { ...entry, value: 'crt', scopeValues: { global: 'crt' } },
      store: null,
    });
    await act(async () => {
      render(<ThemeControl entry={entry} spaceSelector="project:demo" onEntryUpdated={updated} />, container);
      await flush();
    });
    const select = container.querySelector('[data-testid="theme-selector"]') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['editorial', 'crt']);
    select.value = 'crt';
    await act(async () => {
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(client.putKey).toHaveBeenCalledWith('ui.theme', { scope: 'global', value: 'crt' }, 'project:demo');
    expect(document.documentElement.dataset.themeId).toBe('crt');
    expect(updated).toHaveBeenCalled();
  });

  it('refreshes after import without auto-selecting and re-localizes a stable error code', async () => {
    (client.importTheme as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new client.ApiError(400, {
        error: { code: 'invalid_theme', message: 'invalid', details: [{ path: 'effects.0', code: 'unknown_effect', message: 'bad' }] },
      }));
    await act(async () => {
      render(<ThemeControl entry={entry} spaceSelector="project:demo" onEntryUpdated={vi.fn()} />, container);
      await flush();
    });
    const input = container.querySelector('[data-testid="theme-import"]') as HTMLInputElement;
    const file = new File(['{}'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(container.querySelector('[data-testid="theme-error"]')?.textContent).toContain('unsupported effect');
    await act(async () => setLocale('zh-cn'));
    expect(container.querySelector('[data-testid="theme-error"]')?.textContent).toContain('不支持的效果');
  });

  it('activates an imported configured theme without rewriting its already-correct saved id', async () => {
    const configuredEntry: WireConfigEntry = {
      ...entry,
      value: 'forest-paper',
      scopeValues: { global: 'forest-paper' },
    };
    (client.getKey as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: configuredEntry });
    (client.listThemes as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ themes: [], skipped: [] })
      .mockResolvedValueOnce({ themes: [], skipped: [] })
      .mockResolvedValueOnce({ themes: [forestTheme], skipped: [] });
    (client.importTheme as ReturnType<typeof vi.fn>).mockResolvedValue({ theme: forestTheme });

    await initializeTheme();
    expect(document.documentElement.dataset.themeId).toBe('editorial');

    await act(async () => {
      render(
        <ThemeControl
          entry={configuredEntry}
          spaceSelector="project:demo"
          onEntryUpdated={vi.fn()}
        />,
        container
      );
      await flush();
    });
    const input = container.querySelector('[data-testid="theme-import"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([JSON.stringify(forestTheme)], 'forest-paper.json', { type: 'application/json' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });

    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(client.putKey).not.toHaveBeenCalled();
    const activate = container.querySelector('[data-testid="theme-activate"]') as HTMLButtonElement;
    expect(activate.disabled).toBe(false);
    expect(activate.textContent).toContain('Activate');

    await act(async () => {
      activate.click();
      await flush();
    });
    expect(document.documentElement.dataset.themeId).toBe('forest-paper');
    expect(client.putKey).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="theme-activate"]')).toBeNull();
  });
});
