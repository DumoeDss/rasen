/**
 * Core template types for skills and slash commands.
 */

export interface SkillTemplate {
  name: string;
  description: string;
  instructions: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** When true, the generated skill is installed user-invoked: its frontmatter carries `disable-model-invocation: true` so only a human typing its name can invoke it. */
  disableModelInvocation?: boolean;
}

export interface CommandTemplate {
  name: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
}
