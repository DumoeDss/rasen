import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MarkdownParser } from '../core/parsers/markdown-parser.js';
import type { Spec } from '../core/schemas/index.js';
import type { RootOutput } from '../core/root-selection.js';
import { isInteractive } from '../utils/interactive.js';
import { getSpecIds } from '../utils/item-discovery.js';
import { WORKSPACE_DIR_NAME } from '../core/config.js';

const SPECS_DIR = `${WORKSPACE_DIR_NAME}/specs`;

interface ShowOptions {
  json?: boolean;
  // JSON-only filters (raw-first text has no filters)
  requirements?: boolean;
  scenarios?: boolean; // --no-scenarios sets this to false (JSON only)
  requirement?: string; // JSON only
  noInteractive?: boolean;
  rootOutput?: RootOutput;
}

function parseSpecFromFile(specPath: string, specId: string): Spec {
  const content = readFileSync(specPath, 'utf-8');
  const parser = new MarkdownParser(content);
  return parser.parseSpec(specId);
}

function validateRequirementIndex(spec: Spec, requirementOpt?: string): number | undefined {
  if (!requirementOpt) return undefined;
  const index = Number.parseInt(requirementOpt, 10);
  if (!Number.isInteger(index) || index < 1 || index > spec.requirements.length) {
    throw new Error(`Requirement ${requirementOpt} not found`);
  }
  return index - 1; // convert to 0-based
}

function filterSpec(spec: Spec, options: ShowOptions): Spec {
  const requirementIndex = validateRequirementIndex(spec, options.requirement);
  const includeScenarios = options.scenarios !== false && !options.requirements;

  const filteredRequirements = (requirementIndex !== undefined
    ? [spec.requirements[requirementIndex]]
    : spec.requirements
  ).map(req => ({
    text: req.text,
    scenarios: includeScenarios ? req.scenarios : [],
  }));

  const metadata = spec.metadata ?? { version: '1.0.0', format: 'openspec' as const };

  return {
    name: spec.name,
    overview: spec.overview,
    requirements: filteredRequirements,
    metadata,
  };
}

/**
 * Print the raw markdown content for a spec file without any formatting.
 * Raw-first behavior ensures text mode is a passthrough for deterministic output.
 */
function printSpecTextRaw(specPath: string): void {
  const content = readFileSync(specPath, 'utf-8');
  console.log(content);
}

export class SpecCommand {
  private specsDir: string;
  private rootPath?: string;

  // rootPath is set only by root-aware callers (top-level `show`).
  constructor(rootPath?: string) {
    this.rootPath = rootPath;
    this.specsDir = rootPath ? join(rootPath, WORKSPACE_DIR_NAME, 'specs') : SPECS_DIR;
  }

  async show(specId?: string, options: ShowOptions = {}): Promise<void> {
    if (!specId) {
      const canPrompt = isInteractive(options);
      const specIds = await getSpecIds(this.rootPath ?? process.cwd());
      if (canPrompt && specIds.length > 0) {
        const { select } = await import('@inquirer/prompts');
        specId = await select({
          message: 'Select a spec to show',
          choices: specIds.map(id => ({ name: id, value: id })),
        });
      } else {
        throw new Error('Missing required argument <spec-id>');
      }
    }

    const specPath = join(this.specsDir, specId, 'spec.md');
    if (!existsSync(specPath)) {
      // Root-aware callers get the absolute path; a rootPath-less construction
      // keeps the historical forward-slash relative message on all platforms.
      const displayPath = this.rootPath ? specPath : `openspec/specs/${specId}/spec.md`;
      throw new Error(`Spec '${specId}' not found at ${displayPath}`);
    }

    if (options.json) {
      if (options.requirements && options.requirement) {
        throw new Error('Options --requirements and --requirement cannot be used together');
      }
      const parsed = parseSpecFromFile(specPath, specId);
      const filtered = filterSpec(parsed, options);
      const output = {
        id: specId,
        title: parsed.name,
        overview: parsed.overview,
        requirementCount: filtered.requirements.length,
        requirements: filtered.requirements,
        metadata: parsed.metadata ?? { version: '1.0.0', format: 'openspec' as const },
        ...(options.rootOutput ? { root: options.rootOutput } : {}),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }
    printSpecTextRaw(specPath);
  }
}
