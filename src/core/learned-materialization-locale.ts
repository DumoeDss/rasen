import { formatLocaleMessage, getLocaleCatalog } from '../locales/index.js';
import { resolveCliLocale } from '../utils/locale.js';

type LearnedMaterializationMessageKey =
  keyof ReturnType<typeof getLocaleCatalog>['learnedMaterialization'];

export function learnedMaterializationMessage(
  key: LearnedMaterializationMessageKey,
  values: Record<string, string | number> = {}
): string {
  return formatLocaleMessage(
    getLocaleCatalog(resolveCliLocale()).learnedMaterialization[key],
    values
  );
}
