import { useEffect, useState } from 'preact/hooks';

/**
 * Test affordance: switch the visual theme variant between the warm-editorial
 * default and the CRT-terminal identity. Persists to localStorage and stamps
 * `data-theme-variant` on the document root, which the stylesheet's
 * `:root[data-theme-variant="crt"]` token override keys off. Not part of the
 * product surface — a fixed corner toggle for comparing directions.
 */
export type ThemeVariant = 'warm' | 'crt';

const STORAGE_KEY = 'rasen-ui-theme-variant';

export function readThemeVariant(): ThemeVariant {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'crt' ? 'crt' : 'warm';
  } catch {
    return 'warm';
  }
}

export function applyThemeVariant(variant: ThemeVariant): void {
  document.documentElement.dataset.themeVariant = variant;
}

export function ThemeToggle() {
  const [variant, setVariant] = useState<ThemeVariant>(readThemeVariant);

  useEffect(() => {
    applyThemeVariant(variant);
    try {
      localStorage.setItem(STORAGE_KEY, variant);
    } catch {
      // A blocked localStorage just means the choice doesn't persist — the
      // toggle still works for the current session.
    }
  }, [variant]);

  return (
    <button
      type="button"
      class="theme-toggle"
      data-testid="theme-toggle"
      onClick={() => setVariant((v) => (v === 'warm' ? 'crt' : 'warm'))}
      title="Test: switch visual theme"
    >
      Theme: {variant === 'warm' ? 'Editorial' : 'Terminal'}
    </button>
  );
}
