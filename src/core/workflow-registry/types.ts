import type { CommandContent } from '../command-generation/types.js';
import type { SkillTemplate } from '../templates/types.js';

export type WorkflowSourceKind = 'built-in' | 'user';

/**
 * Role classification for a workflow definition. `task` is an inner-loop
 * operation invoked directly; `driver` is an outer-loop engine that consumes
 * pipelines; `internal` is a sub-unit invoked only by a driver. The union is
 * left open (a future `expert` member is anticipated) — avoid exhaustive
 * `switch`/`never` handling over this type.
 */
export type WorkflowKind = 'task' | 'driver' | 'internal';

export interface WorkflowDependencySet {
  workflows: string[];
  skills: string[];
  pipelines: string[];
  schemas: string[];
}

export interface WorkflowRecommendations {
  workflows: string[];
}

export interface WorkflowFileEntry {
  path: string;
  content: string;
  sha256: string;
}

export interface WorkflowSkillDefinition {
  dirName: string;
  template: SkillTemplate;
}

export interface WorkflowCommandDefinition {
  content: CommandContent;
}

/**
 * Shared read model for packaged and user-installed workflows.
 *
 * Built-ins keep their templates inline and therefore have no sourcePath or
 * materialized file list. User definitions retain their validated source tree
 * so generation and package export never need to reinterpret the manifest.
 */
export interface WorkflowDefinition {
  id: string;
  source: WorkflowSourceKind;
  sourcePath?: string;
  manifestVersion: number;
  kind: WorkflowKind;
  skill: WorkflowSkillDefinition;
  command?: WorkflowCommandDefinition;
  requires: WorkflowDependencySet;
  recommends: WorkflowRecommendations;
  files: WorkflowFileEntry[];
  digest: string;
}

export type WorkflowDiagnosticSeverity = 'error' | 'warning';

export interface WorkflowDiagnostic {
  code: string;
  severity: WorkflowDiagnosticSeverity;
  message: string;
  path?: string;
  sourcePath?: string;
  details?: Record<string, string | number | boolean | string[]>;
}

export interface InvalidWorkflowRecord {
  id: string;
  source: 'user';
  sourcePath: string;
  diagnostics: WorkflowDiagnostic[];
}

