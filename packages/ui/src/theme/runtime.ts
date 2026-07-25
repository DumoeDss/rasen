import editorialJson from './manifests/editorial.json' with { type: 'json' };
import crtJson from './manifests/crt.json' with { type: 'json' };
import * as client from '../api/client.js';
import {
  THEME_EFFECTS,
  validateThemeManifest,
  type ThemeManifest,
  type ThemeTokenValue,
} from './manifest.js';

const DIRECT_TOKEN_PROPERTIES: Record<string, readonly string[]> = {
  canvas: ['--bg'], surface: ['--surface'], surfaceMuted: ['--surface-muted'], surfaceRaised: ['--surface-warm'],
  text: ['--fg'], textSecondary: ['--fg-2'], textMuted: ['--muted'], metadata: ['--meta'],
  border: ['--border'], borderSoft: ['--border-soft'], borderStrong: ['--border-strong'],
  accent: ['--accent'], accentOn: ['--accent-on'], focus: ['--focus'],
  success: ['--success', '--success-fg'], successBackground: ['--success-bg'],
  warning: ['--warn', '--warn-fg'], warningBackground: ['--warn-bg'],
  danger: ['--danger', '--danger-fg'], dangerBackground: ['--danger-bg'],
  headingFont: ['--font-serif'], bodyFont: ['--font-sans'], monoFont: ['--font-mono'],
  baseSize: ['--text-base'], headingSize: ['--text-xl'],
};
const DERIVED_TOKEN_PROPERTIES = [
  '--accent-hover', '--accent-active', '--accent-tint', '--chevron',
  '--focus-ring', '--ring', '--ring-hover',
  '--radius', '--radius-lg', '--radius-xl', '--radius-pill',
  '--shadow', '--shadow-pop',
] as const;
const THEME_OWNED_PROPERTIES = [
  ...new Set([
    ...Object.values(DIRECT_TOKEN_PROPERTIES).flat(),
    ...DERIVED_TOKEN_PROPERTIES,
  ]),
];
const FONT_VALUES: Record<string, string> = {
  'editorial-serif': 'Georgia, "Times New Roman", serif',
  'system-sans': 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  'system-mono': 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  'display-heavy': '"Arial Black", "Helvetica Neue", sans-serif',
};
const ELEVATION_VALUES: Record<string, { shadow: string; pop: string }> = {
  flat: {
    shadow: 'none',
    pop: 'none',
  },
  ring: {
    shadow: '0 0 0 1px var(--border)',
    pop: '0 0 0 1px var(--border-strong)',
  },
  soft: {
    shadow: '0 1px 2px #00000012, 0 4px 24px #00000018',
    pop: '0 12px 32px -8px #0000002e, 0 2px 8px #00000014',
  },
};

function builtIn(value: unknown): ThemeManifest {
  const result = validateThemeManifest(value);
  if (!result.ok) throw new Error(`Invalid bundled theme: ${result.details.map((d) => d.path).join(', ')}`);
  return result.manifest;
}

export const EDITORIAL_THEME = builtIn(editorialJson);
export const CRT_THEME = builtIn(crtJson);
export const DEFAULT_THEME = CRT_THEME;
export const BUILT_IN_THEMES: readonly ThemeManifest[] = [EDITORIAL_THEME, CRT_THEME];

let catalog: ThemeManifest[] = [...BUILT_IN_THEMES];
let activeTheme: ThemeManifest = EDITORIAL_THEME;
let warningCode: string | null = null;
let mediaQuery: MediaQueryList | null = null;
let mediaListener: (() => void) | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

export function subscribeTheme(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function getThemeSnapshot() {
  return { catalog: [...catalog], activeTheme, warningCode };
}
export function clearThemeWarning(): void {
  warningCode = null;
  notify();
}

function normalizedTokens(theme: ThemeManifest, scheme: 'light' | 'dark'): Record<string, ThemeTokenValue> {
  const editorial = EDITORIAL_THEME.tokens[scheme] ?? {};
  const selected = theme.tokens[scheme] ?? theme.tokens[theme.mode === 'light' ? 'light' : 'dark'] ?? {};
  return { ...editorial, ...selected };
}

function cssValue(key: string, value: ThemeTokenValue): string {
  if (key.endsWith('Font')) return FONT_VALUES[String(value)];
  if (key === 'baseSize' || key === 'headingSize') return `${value}px`;
  return String(value);
}

function chevronValue(color: string): string {
  const encodedColor = color.replace('#', '%23');
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.75 4.5 6 7.75 9.25 4.5' fill='none' stroke='${encodedColor}' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`;
}

function tokenDeclarations(key: string, value: ThemeTokenValue): Array<readonly [string, string]> {
  const declarations: Array<readonly [string, string]> =
    (DIRECT_TOKEN_PROPERTIES[key] ?? []).map(
      (property): readonly [string, string] => [property, cssValue(key, value)]
    );
  if (key === 'accent') {
    declarations.push(
      ['--accent-hover', 'color-mix(in oklab, var(--accent), black 8%)'],
      ['--accent-active', 'color-mix(in oklab, var(--accent), black 14%)'],
      ['--accent-tint', 'color-mix(in oklab, var(--accent), transparent 88%)'],
      ['--chevron', chevronValue(String(value))]
    );
  } else if (key === 'focus') {
    declarations.push(['--focus-ring', '0 0 0 3px color-mix(in srgb, var(--focus), transparent 75%)']);
  } else if (key === 'border') {
    declarations.push(['--ring', '0 0 0 1px var(--border)']);
  } else if (key === 'borderStrong') {
    declarations.push(['--ring-hover', '0 0 0 1px var(--border-strong)']);
  } else if (key === 'radius') {
    const radius = Number(value);
    declarations.push(
      ['--radius', `${radius}px`],
      ['--radius-pill', radius === 0 ? '0px' : '9999px']
    );
  } else if (key === 'largeRadius') {
    const radius = Number(value);
    declarations.push(
      ['--radius-lg', `${radius}px`],
      ['--radius-xl', `${radius === 0 ? 0 : radius + 4}px`]
    );
  } else if (key === 'elevation') {
    const elevation = ELEVATION_VALUES[String(value)];
    declarations.push(
      ['--shadow', elevation.shadow],
      ['--shadow-pop', elevation.pop]
    );
  }
  return declarations;
}

function preferredScheme(theme: ThemeManifest): 'light' | 'dark' {
  if (theme.mode !== 'adaptive') return theme.mode;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function activateTheme(theme: ThemeManifest): void {
  const validation = validateThemeManifest(theme);
  const next = validation.ok ? validation.manifest : EDITORIAL_THEME;
  const root = document.documentElement;
  for (const property of THEME_OWNED_PROPERTIES) root.style.removeProperty(property);
  for (const effect of THEME_EFFECTS) root.removeAttribute(`data-theme-effect-${effect}`);

  const scheme = preferredScheme(next);
  for (const [key, value] of Object.entries(normalizedTokens(next, scheme))) {
    for (const [property, css] of tokenDeclarations(key, value)) {
      root.style.setProperty(property, css);
    }
  }
  root.style.colorScheme = next.mode === 'adaptive' ? 'light dark' : next.mode;
  root.dataset.themeId = next.id;
  for (const effect of next.effects) root.setAttribute(`data-theme-effect-${effect}`, '');
  activeTheme = next;

  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;
  if (next.mode === 'adaptive') {
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => activateTheme(next);
    mediaQuery.addEventListener('change', mediaListener);
  }
  notify();
}

function decodeCatalog(value: unknown): ThemeManifest[] {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { themes?: unknown }).themes)) {
    throw new Error('Malformed theme catalog.');
  }
  const imported: ThemeManifest[] = [];
  for (const valueTheme of (value as { themes: unknown[] }).themes) {
    const decoded = validateThemeManifest(valueTheme);
    if (decoded.ok && !BUILT_IN_THEMES.some((theme) => theme.id === decoded.manifest.id)) imported.push(decoded.manifest);
  }
  const seen = new Set(BUILT_IN_THEMES.map((theme) => theme.id.toLowerCase()));
  catalog = [...BUILT_IN_THEMES, ...imported.filter((theme) => {
    const key = theme.id.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
  notify();
  return catalog;
}

export async function refreshThemeCatalog(): Promise<ThemeManifest[]> {
  return decodeCatalog(await client.listThemes());
}

export async function initializeTheme(timeoutMs = 1500): Promise<void> {
  activateTheme(EDITORIAL_THEME);
  warningCode = null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, timeoutMs);
    });
    const [keyResponse, catalogResponse] = await Promise.race([
      Promise.all([
        client.getKey('ui.theme', undefined, controller.signal),
        client.listThemes(controller.signal),
      ]),
      timeout,
    ]);
    decodeCatalog(catalogResponse);
    const configured = typeof keyResponse.entry.value === 'string' ? keyResponse.entry.value : DEFAULT_THEME.id;
    const selected = catalog.find((theme) => theme.id === configured);
    if (!selected) {
      warningCode = 'theme_unavailable';
      activateTheme(EDITORIAL_THEME);
    } else {
      activateTheme(selected);
    }
  } catch {
    warningCode = 'theme_service_failed';
    activateTheme(EDITORIAL_THEME);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    notify();
  }
}
