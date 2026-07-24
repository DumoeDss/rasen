export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const THEME_EFFECTS = ['scanlines', 'uppercase-headings', 'terminal-navigation', 'uppercase-metadata'] as const;
export type ThemeEffect = (typeof THEME_EFFECTS)[number];
export type ThemeMode = 'adaptive' | 'light' | 'dark';
export type ThemeTokenValue = string | number;

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  mode: ThemeMode;
  tokens: { light?: Record<string, ThemeTokenValue>; dark?: Record<string, ThemeTokenValue> };
  effects: ThemeEffect[];
}

export interface ThemeValidationDetail { path: string; code: string; message: string }
export type ThemeValidationResult =
  | { ok: true; manifest: ThemeManifest }
  | { ok: false; details: ThemeValidationDetail[] };

type Definition =
  | { kind: 'color' }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'choice'; values: readonly string[] };

export const THEME_TOKEN_DEFINITIONS: Readonly<Record<string, Definition>> = {
  canvas: { kind: 'color' }, surface: { kind: 'color' }, surfaceMuted: { kind: 'color' },
  surfaceRaised: { kind: 'color' }, text: { kind: 'color' }, textSecondary: { kind: 'color' },
  textMuted: { kind: 'color' }, metadata: { kind: 'color' }, border: { kind: 'color' },
  borderSoft: { kind: 'color' }, borderStrong: { kind: 'color' }, accent: { kind: 'color' },
  accentOn: { kind: 'color' }, focus: { kind: 'color' }, success: { kind: 'color' },
  successBackground: { kind: 'color' }, warning: { kind: 'color' }, warningBackground: { kind: 'color' },
  danger: { kind: 'color' }, dangerBackground: { kind: 'color' },
  headingFont: { kind: 'choice', values: ['editorial-serif', 'system-sans', 'system-mono', 'display-heavy'] },
  bodyFont: { kind: 'choice', values: ['system-sans', 'system-mono'] },
  monoFont: { kind: 'choice', values: ['system-mono'] },
  baseSize: { kind: 'number', min: 12, max: 20 }, headingSize: { kind: 'number', min: 16, max: 36 },
  radius: { kind: 'number', min: 0, max: 24 }, largeRadius: { kind: 'number', min: 0, max: 32 },
  elevation: { kind: 'choice', values: ['flat', 'ring', 'soft'] },
};

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

function decodeSet(value: unknown, path: string, details: ThemeValidationDetail[]) {
  if (value === undefined) return undefined;
  const source = object(value);
  if (!source) {
    details.push({ path, code: 'invalid_type', message: 'Token set must be an object.' });
    return undefined;
  }
  const result: Record<string, ThemeTokenValue> = {};
  for (const [key, tokenValue] of Object.entries(source)) {
    if (!Object.hasOwn(THEME_TOKEN_DEFINITIONS, key)) {
      details.push({ path: `${path}.${key}`, code: 'unknown_token', message: `Unknown theme token "${key}".` });
      continue;
    }
    const def = THEME_TOKEN_DEFINITIONS[key];
    const valid =
      def.kind === 'color'
        ? typeof tokenValue === 'string' && /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(tokenValue)
        : def.kind === 'number'
          ? typeof tokenValue === 'number' && Number.isFinite(tokenValue) && tokenValue >= def.min && tokenValue <= def.max
          : typeof tokenValue === 'string' && def.values.includes(tokenValue);
    if (!valid) details.push({ path: `${path}.${key}`, code: 'invalid_token', message: `Invalid value for "${key}".` });
    else result[key] = tokenValue as ThemeTokenValue;
  }
  return result;
}

/** Self-contained browser-side decoder; intentionally imports no root source. */
export function validateThemeManifest(value: unknown): ThemeValidationResult {
  const source = object(value);
  if (!source) return { ok: false, details: [{ path: '$', code: 'invalid_type', message: 'Theme manifest must be an object.' }] };
  const details: ThemeValidationDetail[] = [];
  const allowed = ['schemaVersion', 'id', 'name', 'description', 'mode', 'tokens', 'effects'];
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) details.push({ path: key, code: 'unknown_field', message: `Unknown field "${key}".` });
  }
  if (source.schemaVersion !== 1) details.push({ path: 'schemaVersion', code: 'unsupported_version', message: `Unsupported schema version ${String(source.schemaVersion)}; supported version is 1.` });
  if (typeof source.id !== 'string' || !THEME_ID_PATTERN.test(source.id)) details.push({ path: 'id', code: 'invalid_identifier', message: 'Theme id must match [a-z][a-z0-9-]{0,63}.' });
  if (typeof source.name !== 'string' || source.name.trim().length < 1 || source.name.length > 80) details.push({ path: 'name', code: 'invalid_metadata', message: 'Name must contain 1 to 80 characters.' });
  if (source.description !== undefined && (typeof source.description !== 'string' || source.description.length > 240)) details.push({ path: 'description', code: 'invalid_metadata', message: 'Description must contain at most 240 characters.' });
  if (source.mode !== 'adaptive' && source.mode !== 'light' && source.mode !== 'dark') details.push({ path: 'mode', code: 'invalid_mode', message: 'Mode must be adaptive, light, or dark.' });
  const tokenEnvelope = object(source.tokens);
  let light: Record<string, ThemeTokenValue> | undefined;
  let dark: Record<string, ThemeTokenValue> | undefined;
  if (!tokenEnvelope) details.push({ path: 'tokens', code: 'invalid_type', message: 'Tokens must be an object.' });
  else {
    for (const key of Object.keys(tokenEnvelope)) if (key !== 'light' && key !== 'dark') details.push({ path: `tokens.${key}`, code: 'unknown_field', message: `Unknown field "${key}".` });
    light = decodeSet(tokenEnvelope.light, 'tokens.light', details);
    dark = decodeSet(tokenEnvelope.dark, 'tokens.dark', details);
    if (source.mode === 'adaptive' && (!light || !dark)) details.push({ path: 'tokens', code: 'mode_tokens', message: 'Adaptive themes require light and dark token sets.' });
    if (source.mode === 'light' && (!light || dark)) details.push({ path: 'tokens', code: 'mode_tokens', message: 'Fixed light themes require only light tokens.' });
    if (source.mode === 'dark' && (!dark || light)) details.push({ path: 'tokens', code: 'mode_tokens', message: 'Fixed dark themes require only dark tokens.' });
  }
  const effects: ThemeEffect[] = [];
  if (source.effects !== undefined) {
    if (!Array.isArray(source.effects)) details.push({ path: 'effects', code: 'invalid_type', message: 'Effects must be an array.' });
    else source.effects.forEach((effect, index) => {
      if (typeof effect !== 'string' || !(THEME_EFFECTS as readonly string[]).includes(effect)) details.push({ path: `effects.${index}`, code: 'unknown_effect', message: `Unknown effect "${String(effect)}".` });
      else if (!effects.includes(effect as ThemeEffect)) effects.push(effect as ThemeEffect);
    });
  }
  if (details.length) return { ok: false, details };
  return { ok: true, manifest: {
    schemaVersion: 1, id: source.id as string, name: (source.name as string).trim(),
    ...(source.description === undefined ? {} : { description: source.description as string }),
    mode: source.mode as ThemeMode, tokens: { ...(light ? { light } : {}), ...(dark ? { dark } : {}) }, effects,
  } };
}
