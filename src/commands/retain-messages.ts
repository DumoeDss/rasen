import { getCliLocale } from '../core/cli-locale.js';
import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import type { LocaleCatalog } from '../locales/index.js';
import type { CliLocale } from '../utils/locale.js';

/**
 * Localized message surface for the `rasen retain` command group. Rasen-owned
 * framing is localized; a core diagnostic's detail is passed through as data,
 * matching how the knowledge and pipeline surfaces treat block detail.
 */
interface RetainMessageValues {
  changeLabel: { change: string };
  retentionMode: { mode: string };
  frozenRetentionMode: { mode: string };
  runStateDir: { path: string };
  ownerLabel: { owner: string };
  planningRootLabel: { planningRoot: string };
  contextPrepared: { version: number };
  contextReused: { version: number };
  noPipeline: undefined;
  pipelineLabel: { pipeline: string };
  planningRootMismatch: { changeRoot: string; identityRoot: string };
  invalidRunState: { path: string; reason: string };
  writeRefused: { path: string; reason: string };
  nextApply: { path: string };
  ownerSelectorConflict: undefined;
}

export type RetainMessageKey = keyof RetainMessageValues;

type RetainMessageArguments<K extends RetainMessageKey> =
  RetainMessageValues[K] extends undefined ? [] : [values: RetainMessageValues[K]];

export class RetainMessages {
  constructor(
    readonly locale: CliLocale,
    private readonly catalog: LocaleCatalog
  ) {}

  format<K extends RetainMessageKey>(key: K, ...args: RetainMessageArguments<K>): string {
    const template = this.catalog.retain.messages[key];
    const values = (args[0] ?? {}) as Record<string, string | number>;
    return formatLocaleMessage(template, values);
  }
}

export function getRetainMessages(locale: CliLocale = getCliLocale()): RetainMessages {
  return new RetainMessages(locale, getLocaleCatalog(locale));
}
