import { parseDocument } from 'yaml';
import { z } from 'zod';

import type { WorkflowDiagnostic } from './types.js';

const PortableStringArraySchema = z.array(z.string()).default([]);

const DisabledCommandSchema = z.strictObject({
  enabled: z.literal(false),
});

const EnabledCommandSchema = z.strictObject({
  enabled: z.literal(true),
  name: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1),
});

const WorkflowManifestSchema = z.strictObject({
  version: z.literal(1),
  id: z.string(),
  command: z.discriminatedUnion('enabled', [DisabledCommandSchema, EnabledCommandSchema]).optional(),
  files: z
    .strictObject({
      sidecars: PortableStringArraySchema,
      scripts: PortableStringArraySchema,
    })
    .default({ sidecars: [], scripts: [] }),
  requires: z
    .strictObject({
      workflows: PortableStringArraySchema,
      skills: PortableStringArraySchema,
    })
    .default({ workflows: [], skills: [] }),
  recommends: z
    .strictObject({
      workflows: PortableStringArraySchema,
    })
    .default({ workflows: [] }),
});

const SkillFrontmatterSchema = z.strictObject({
  name: z.string(),
  description: z.string().min(1),
  license: z.string().min(1).optional(),
  compatibility: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type WorkflowManifest = z.infer<typeof WorkflowManifestSchema>;
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface ParsedSkillDocument {
  frontmatter: SkillFrontmatter;
  instructions: string;
}

function issuePath(path: PropertyKey[]): string | undefined {
  if (path.length === 0) return undefined;
  return path.map(String).join('.');
}

function parseStrictYaml(
  content: string,
  logicalPath: string
): { value?: unknown; diagnostics: WorkflowDiagnostic[] } {
  const document = parseDocument(content, {
    schema: 'core',
    strict: true,
    uniqueKeys: true,
    prettyErrors: false,
  });

  if (document.errors.length > 0) {
    return {
      diagnostics: document.errors.map((error) => ({
        code: 'yaml_invalid',
        severity: 'error',
        message: error.message,
        path: logicalPath,
      })),
    };
  }

  try {
    return { value: document.toJS({ maxAliasCount: 0 }), diagnostics: [] };
  } catch (error) {
    return {
      diagnostics: [
        {
          code: 'yaml_alias_forbidden',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
          path: logicalPath,
        },
      ],
    };
  }
}

export function parseWorkflowManifest(content: string): {
  manifest?: WorkflowManifest;
  diagnostics: WorkflowDiagnostic[];
} {
  const parsed = parseStrictYaml(content, 'workflow.yaml');
  if (!parsed.value) return { diagnostics: parsed.diagnostics };

  const result = WorkflowManifestSchema.safeParse(parsed.value);
  if (!result.success) {
    return {
      diagnostics: result.error.issues.map((issue) => ({
        code: 'manifest_schema_invalid',
        severity: 'error',
        message: issue.message,
        path: issuePath(issue.path) ?? 'workflow.yaml',
      })),
    };
  }
  return { manifest: result.data, diagnostics: [] };
}

export function parseSkillDocument(content: string): {
  skill?: ParsedSkillDocument;
  diagnostics: WorkflowDiagnostic[];
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
  if (!match) {
    return {
      diagnostics: [
        {
          code: 'skill_frontmatter_missing',
          severity: 'error',
          message: 'SKILL.md must start with a complete YAML frontmatter block',
          path: 'SKILL.md',
        },
      ],
    };
  }

  const parsed = parseStrictYaml(match[1], 'SKILL.md');
  if (!parsed.value) return { diagnostics: parsed.diagnostics };
  const frontmatter = SkillFrontmatterSchema.safeParse(parsed.value);
  if (!frontmatter.success) {
    return {
      diagnostics: frontmatter.error.issues.map((issue) => ({
        code: 'skill_frontmatter_invalid',
        severity: 'error',
        message: issue.message,
        path: issuePath(issue.path) ?? 'SKILL.md',
      })),
    };
  }
  if (match[2].trim().length === 0) {
    return {
      diagnostics: [
        {
          code: 'skill_instructions_empty',
          severity: 'error',
          message: 'SKILL.md must contain instruction text after the frontmatter',
          path: 'SKILL.md',
        },
      ],
    };
  }

  return {
    skill: { frontmatter: frontmatter.data, instructions: match[2] },
    diagnostics: [],
  };
}
