import { parse as parseYaml } from 'yaml';

/**
 * The single syntax-loader seam for authored Pipeline YAML and JSON text.
 * It deliberately knows nothing about Definition versions or runtime policy.
 */
export function parsePipelineSourceDocument(sourceText: string): unknown {
  return parseYaml(sourceText);
}
