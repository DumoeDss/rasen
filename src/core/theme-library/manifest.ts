export const THEME_SCHEMA_VERSION = 1 as const;
export const THEME_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export const THEME_EFFECTS = [
  'scanlines',
  'uppercase-headings',
  'terminal-navigation',
  'uppercase-metadata',
] as const;
export const BUILT_IN_THEME_IDS = ['editorial', 'crt'] as const;

export type ThemeMode = 'adaptive' | 'light' | 'dark';
export type ThemeEffect = (typeof THEME_EFFECTS)[number];
export type ThemeTokenValue = string | number;

export interface ThemeManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  mode: ThemeMode;
  tokens: {
    light?: Record<string, ThemeTokenValue>;
    dark?: Record<string, ThemeTokenValue>;
  };
  effects: ThemeEffect[];
}

export interface ThemeValidationDetail {
  path: string;
  code: string;
  message: string;
}

export type ThemeValidationResult =
  | { ok: true; manifest: ThemeManifest }
  | { ok: false; details: ThemeValidationDetail[] };

type TokenKind =
  | { kind: 'color' }
  | { kind: 'font'; values: readonly string[] }
  | { kind: 'number'; min: number; max: number }
  | { kind: 'elevation'; values: readonly string[] };

/**
 * The complete public v1 token vocabulary. Values cross this table before they
 * can reach the UI; neither a manifest key nor a value is treated as CSS.
 */
export const THEME_TOKEN_DEFINITIONS: Readonly<Record<string, TokenKind>> = {
  canvas: { kind: 'color' },
  surface: { kind: 'color' },
  surfaceMuted: { kind: 'color' },
  surfaceRaised: { kind: 'color' },
  text: { kind: 'color' },
  textSecondary: { kind: 'color' },
  textMuted: { kind: 'color' },
  metadata: { kind: 'color' },
  border: { kind: 'color' },
  borderSoft: { kind: 'color' },
  borderStrong: { kind: 'color' },
  accent: { kind: 'color' },
  accentOn: { kind: 'color' },
  focus: { kind: 'color' },
  success: { kind: 'color' },
  successBackground: { kind: 'color' },
  warning: { kind: 'color' },
  warningBackground: { kind: 'color' },
  danger: { kind: 'color' },
  dangerBackground: { kind: 'color' },
  headingFont: { kind: 'font', values: ['editorial-serif', 'system-sans', 'system-mono', 'display-heavy'] },
  bodyFont: { kind: 'font', values: ['system-sans', 'system-mono'] },
  monoFont: { kind: 'font', values: ['system-mono'] },
  baseSize: { kind: 'number', min: 12, max: 20 },
  headingSize: { kind: 'number', min: 16, max: 36 },
  radius: { kind: 'number', min: 0, max: 24 },
  largeRadius: { kind: 'number', min: 0, max: 32 },
  elevation: { kind: 'elevation', values: ['flat', 'ring', 'soft'] },
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rejectUnknown(
  value: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  details: ThemeValidationDetail[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      details.push({
        path: prefix ? `${prefix}.${key}` : key,
        code: 'unknown_field',
        message: `Unknown field "${key}".`,
      });
    }
  }
}

function validateTokenSet(
  value: unknown,
  path: string,
  details: ThemeValidationDetail[]
): Record<string, ThemeTokenValue> | undefined {
  if (value === undefined) return undefined;
  const input = record(value);
  if (!input) {
    details.push({ path, code: 'invalid_type', message: 'Token set must be an object.' });
    return undefined;
  }
  const output: Record<string, ThemeTokenValue> = {};
  for (const [key, tokenValue] of Object.entries(input)) {
    const tokenPath = `${path}.${key}`;
    if (!Object.hasOwn(THEME_TOKEN_DEFINITIONS, key)) {
      details.push({ path: tokenPath, code: 'unknown_token', message: `Unknown theme token "${key}".` });
      continue;
    }
    const definition = THEME_TOKEN_DEFINITIONS[key];
    if (definition.kind === 'color') {
      if (typeof tokenValue !== 'string' || !/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(tokenValue)) {
        details.push({ path: tokenPath, code: 'invalid_token', message: 'Color must be #RRGGBB or #RRGGBBAA.' });
        continue;
      }
    } else if (definition.kind === 'number') {
      if (
        typeof tokenValue !== 'number' ||
        !Number.isFinite(tokenValue) ||
        tokenValue < definition.min ||
        tokenValue > definition.max
      ) {
        details.push({
          path: tokenPath,
          code: 'invalid_token',
          message: `Number must be between ${definition.min} and ${definition.max}.`,
        });
        continue;
      }
    } else if (
      typeof tokenValue !== 'string' ||
      !definition.values.includes(tokenValue)
    ) {
      details.push({
        path: tokenPath,
        code: 'invalid_token',
        message: `Value must be one of: ${definition.values.join(', ')}.`,
      });
      continue;
    }
    output[key] = tokenValue as ThemeTokenValue;
  }
  return output;
}

/** Decode a closed v1 manifest and return field-addressed validation details. */
export function validateThemeManifest(value: unknown): ThemeValidationResult {
  const details: ThemeValidationDetail[] = [];
  const input = record(value);
  if (!input) {
    return { ok: false, details: [{ path: '$', code: 'invalid_type', message: 'Theme manifest must be an object.' }] };
  }
  rejectUnknown(input, ['schemaVersion', 'id', 'name', 'description', 'mode', 'tokens', 'effects'], '', details);

  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    details.push({
      path: 'schemaVersion',
      code: 'unsupported_version',
      message: `Unsupported schema version ${String(input.schemaVersion)}; supported version is ${THEME_SCHEMA_VERSION}.`,
    });
  }
  if (typeof input.id !== 'string' || !THEME_ID_PATTERN.test(input.id)) {
    details.push({
      path: 'id',
      code: 'invalid_identifier',
      message: 'Theme id must match [a-z][a-z0-9-]{0,63}.',
    });
  }
  if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 80) {
    details.push({ path: 'name', code: 'invalid_metadata', message: 'Name must contain 1 to 80 characters.' });
  }
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 240)) {
    details.push({ path: 'description', code: 'invalid_metadata', message: 'Description must contain at most 240 characters.' });
  }
  if (input.mode !== 'adaptive' && input.mode !== 'light' && input.mode !== 'dark') {
    details.push({ path: 'mode', code: 'invalid_mode', message: 'Mode must be adaptive, light, or dark.' });
  }

  const tokenEnvelope = record(input.tokens);
  let light: Record<string, ThemeTokenValue> | undefined;
  let dark: Record<string, ThemeTokenValue> | undefined;
  if (!tokenEnvelope) {
    details.push({ path: 'tokens', code: 'invalid_type', message: 'Tokens must be an object.' });
  } else {
    rejectUnknown(tokenEnvelope, ['light', 'dark'], 'tokens', details);
    light = validateTokenSet(tokenEnvelope.light, 'tokens.light', details);
    dark = validateTokenSet(tokenEnvelope.dark, 'tokens.dark', details);
    if (input.mode === 'adaptive' && (!light || !dark)) {
      details.push({ path: 'tokens', code: 'mode_tokens', message: 'Adaptive themes require light and dark token sets.' });
    }
    if (input.mode === 'light' && !light) {
      details.push({ path: 'tokens.light', code: 'mode_tokens', message: 'Light themes require a light token set.' });
    }
    if (input.mode === 'dark' && !dark) {
      details.push({ path: 'tokens.dark', code: 'mode_tokens', message: 'Dark themes require a dark token set.' });
    }
    if (input.mode === 'light' && dark) {
      details.push({ path: 'tokens.dark', code: 'mode_tokens', message: 'A fixed light theme cannot declare dark tokens.' });
    }
    if (input.mode === 'dark' && light) {
      details.push({ path: 'tokens.light', code: 'mode_tokens', message: 'A fixed dark theme cannot declare light tokens.' });
    }
  }

  const effects: ThemeEffect[] = [];
  if (input.effects === undefined) {
    // Effects are optional in authored data and normalized to an empty list.
  } else if (!Array.isArray(input.effects)) {
    details.push({ path: 'effects', code: 'invalid_type', message: 'Effects must be an array.' });
  } else {
    for (let i = 0; i < input.effects.length; i++) {
      const effect = input.effects[i];
      if (typeof effect !== 'string' || !(THEME_EFFECTS as readonly string[]).includes(effect)) {
        details.push({
          path: `effects.${i}`,
          code: 'unknown_effect',
          message: `Unknown effect "${String(effect)}".`,
        });
      } else if (!effects.includes(effect as ThemeEffect)) {
        effects.push(effect as ThemeEffect);
      }
    }
  }

  if (details.length > 0) return { ok: false, details };
  return {
    ok: true,
    manifest: {
      schemaVersion: THEME_SCHEMA_VERSION,
      id: input.id as string,
      name: (input.name as string).trim(),
      ...(input.description === undefined ? {} : { description: input.description as string }),
      mode: input.mode as ThemeMode,
      tokens: { ...(light ? { light } : {}), ...(dark ? { dark } : {}) },
      effects,
    },
  };
}

