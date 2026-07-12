/**
 * Client-side prompt template inlining.
 *
 * codex-cli {@link CODEX_CLI_VERSION_PREMISE} rejects `$CODEX_HOME/prompts/*.md`
 * custom prompts on both invocation surfaces — silently (a hallucinated
 * response) on `codex exec`, with `Unrecognized command` on the TUI
 * (`docs/codex-parity/experiments/E06`). Because the exec-side failure is
 * silent, inlining a rasen-generated command `.md` into the dispatch prompt
 * client-side is mandatory, not an optimization. This is a pluggable
 * interface (design D6) so a future native `skills/SKILL.md` mechanism
 * (round-3 open question) can replace the default implementation without
 * changing call sites.
 */
import type { CODEX_CLI_VERSION_PREMISE } from './codex-home.js';

/** A pure string-in, string-out template inlining step. */
export interface TemplateInliner {
  inline(templateSource: string, args: string): string;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const ARGUMENTS_PLACEHOLDER = '$ARGUMENTS';

/**
 * Default inliner: strip a leading YAML frontmatter block (`--- … ---`) if
 * present, substitute every `$ARGUMENTS` occurrence with `args`, and — when
 * the body has no `$ARGUMENTS` placeholder and `args` is non-empty — append
 * the args on a trailing `ARGUMENTS: <args>` line so they are never silently
 * dropped (matching how Claude Code hands slash-command args to a skill
 * body).
 */
export function inlineCommandTemplate(templateSource: string, args: string): string {
  const body = templateSource.replace(FRONTMATTER_RE, '');

  if (body.includes(ARGUMENTS_PLACEHOLDER)) {
    return body.split(ARGUMENTS_PLACEHOLDER).join(args);
  }

  if (args.length > 0) {
    const trimmed = body.replace(/\s+$/, '');
    return `${trimmed}\n\nARGUMENTS: ${args}`;
  }

  return body;
}
