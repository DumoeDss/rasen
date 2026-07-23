import type { SkillTemplate } from '../templates/types.js';

export type WorkflowSourceKind = 'built-in' | 'user';

/**
 * Role classification for a workflow definition. `task` is an inner-loop
 * operation invoked directly; `driver` is an outer-loop engine that consumes
 * pipelines; `internal` is a sub-unit invoked only by a driver; `expert` is a
 * review/analysis skill installed alongside workflows rather than run as one.
 * Avoid exhaustive `switch`/`never` handling over this type — new members may
 * be added.
 */
export type WorkflowKind = 'task' | 'driver' | 'internal' | 'expert';

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
  /**
   * Author-declared presentation metadata from the manifest's `skill:` block
   * (user workflows only). `title` is the human-readable display name pickers
   * show verbatim, never translated. Built-ins leave all three unset and
   * source presentation from the locale catalogs instead.
   */
  title?: string;
  category?: string;
  tags?: string[];
  skill: WorkflowSkillDefinition;
  requires: WorkflowDependencySet;
  recommends: WorkflowRecommendations;
  files: WorkflowFileEntry[];
  digest: string;
  /**
   * For `kind: 'expert'` definitions whose sidecar reference files live under
   * another expert's directory (e.g. `qa-only` reads `skills/experts/qa/`).
   * Undefined for every non-expert definition and for experts with no alias.
   */
  sidecarSourceId?: string;
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

