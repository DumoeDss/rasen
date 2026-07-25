// @vitest-environment jsdom
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import squareFlatJson from '../../../../test/fixtures/themes/square-flat.json';

vi.mock('../../src/api/client.js', () => ({
  getKey: vi.fn(),
  listThemes: vi.fn(),
}));

import * as client from '../../src/api/client.js';
import {
  activateTheme,
  CRT_THEME,
  EDITORIAL_THEME,
  getThemeSnapshot,
  initializeTheme,
} from '../../src/theme/runtime.js';
import { validateThemeManifest } from '../../src/theme/manifest.js';

describe('theme activation', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    document.documentElement.removeAttribute('style');
    for (const attribute of [...document.documentElement.attributes]) {
      if (attribute.name.startsWith('data-theme')) document.documentElement.removeAttribute(attribute.name);
    }
    localStorage.clear();
    vi.resetAllMocks();
  });

  it('applies only mapped tokens and named effects, then clears all previous state', () => {
    activateTheme(CRT_THEME);
    expect(document.documentElement.dataset.themeId).toBe('crt');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0a0a0a');
    expect(document.documentElement.hasAttribute('data-theme-effect-scanlines')).toBe(true);
    expect(document.documentElement.hasAttribute('data-theme-effect-uppercase-headings')).toBe(true);

    activateTheme(EDITORIAL_THEME);
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#f5f4ed');
    expect(document.documentElement.hasAttribute('data-theme-effect-scanlines')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--not-a-token')).toBe('');
  });

  it('drives square cards, dialogs, popovers, and controls through stable variables', () => {
    const decoded = validateThemeManifest(squareFlatJson);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    activateTheme(decoded.manifest);

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--radius')).toBe('0px');
    expect(style.getPropertyValue('--radius-lg')).toBe('0px');
    expect(style.getPropertyValue('--radius-xl')).toBe('0px');
    expect(style.getPropertyValue('--radius-pill')).toBe('0px');
    expect(style.getPropertyValue('--shadow')).toBe('none');
    expect(style.getPropertyValue('--shadow-pop')).toBe('none');
    expect(style.getPropertyValue('--accent-hover')).toContain('var(--accent)');
    expect(style.getPropertyValue('--focus-ring')).toContain('var(--focus)');
    expect(style.getPropertyValue('--chevron')).toContain('%232455aa');

    const css = fs.readFileSync(path.join(process.cwd(), 'src', 'style.css'), 'utf8');
    expect(css).not.toContain('data-theme-id');
    expect(css).toMatch(/\.board-card\s*\{[^}]*var\(--radius-lg\)[^}]*var\(--ring\)/s);
    expect(css).toMatch(/\.new-change-dialog,[^{]+\{[^}]*var\(--radius-xl\)[^}]*var\(--shadow-pop\)/s);
    expect(css).toMatch(/\.running-sessions-menu__list\s*\{[^}]*var\(--radius-xl\)[^}]*var\(--shadow-pop\)/s);
    expect(css).toMatch(/button\s*\{[^}]*var\(--radius-lg\)[^}]*var\(--ring\)/s);
  });

  it('activates a valid configured built-in before initialization completes', async () => {
    (client.getKey as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { value: 'crt' } });
    (client.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue({ themes: [], skipped: [] });
    await initializeTheme();
    expect(document.documentElement.dataset.themeId).toBe('crt');
    expect(getThemeSnapshot().warningCode).toBeNull();
  });

  it('ignores the retired localStorage theme value in favor of global config', async () => {
    localStorage.setItem('rasen-ui-theme-variant', 'crt');
    (client.getKey as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { value: 'editorial' } });
    (client.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue({ themes: [], skipped: [] });
    await initializeTheme();
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(localStorage.getItem('rasen-ui-theme-variant')).toBe('crt');
  });

  it('renders Editorial on missing, malformed, API, and timeout paths without rewriting preference', async () => {
    (client.getKey as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { value: 'gone-theme' } });
    (client.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue({ themes: [], skipped: [] });
    await initializeTheme();
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(getThemeSnapshot().warningCode).toBe('theme_unavailable');

    (client.getKey as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { value: 'crt' } });
    (client.listThemes as ReturnType<typeof vi.fn>).mockResolvedValue({ malformed: true });
    await initializeTheme();
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    expect(getThemeSnapshot().warningCode).toBe('theme_service_failed');

    (client.getKey as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (client.listThemes as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    await initializeTheme(1);
    expect(document.documentElement.dataset.themeId).toBe('editorial');
    const configSignal = (client.getKey as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[2] as AbortSignal;
    const catalogSignal = (client.listThemes as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as AbortSignal;
    expect(configSignal).toBe(catalogSignal);
    expect(configSignal.aborted).toBe(true);
  });
});
