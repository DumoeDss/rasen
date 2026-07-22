import type { SessionListEntry, SpaceWorktreeEntry } from '../api/types.js';
import { isUnderRoot } from '../board/columns.js';

/** The tail segment (basename) of a path, for a compact worktree label. */
function pathTail(root: string): string {
  const normalized = root.replace(/[/\\]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * The project-space worktrees panel (worktree-aware-spaces D4 / board-ui spec):
 * a chip strip (sibling of {@link MemberChips}) listing each worktree — its path
 * tail, checked-out branch, active-change count, and a client-side live-session
 * count (sessions whose `cwd` lies within that worktree's root, the same
 * provenance rule the store board's member chips use). The selected chip is the
 * board's data source; the main checkout is the default. Controlled — the parent
 * (BoardPage) owns the selection (carried in the board route's `?wt=` query) and
 * re-scopes the board's changes/runs fetch. Exactly one worktree's state is ever
 * shown; the panel never aggregates. Only a project space with more than one
 * worktree renders it, so it makes no space-type decision of its own.
 */
export function WorktreePanel({
  worktrees,
  sessions,
  selectedRoot,
  onSelect,
}: {
  worktrees: SpaceWorktreeEntry[];
  sessions: SessionListEntry[];
  /** The `?wt=` root, or null for the default (main checkout). */
  selectedRoot: string | null;
  onSelect: (root: string | null) => void;
}) {
  return (
    <div class="worktree-panel" role="group" aria-label="Switch worktree" data-testid="worktree-panel">
      {worktrees.map((worktree) => {
        const selected = worktree.isMain
          ? selectedRoot === null || selectedRoot === worktree.root
          : selectedRoot === worktree.root;
        const liveSessions = sessions.filter((entry) => isUnderRoot(entry.session.cwd, worktree.root)).length;
        return (
          <button
            key={worktree.root}
            type="button"
            class={`worktree-chip${selected ? ' worktree-chip--selected' : ''}`}
            aria-pressed={selected}
            data-testid="worktree-chip"
            title={worktree.root}
            onClick={() => onSelect(worktree.isMain ? null : worktree.root)}
          >
            <span class="worktree-chip__label">{pathTail(worktree.root)}</span>
            <span class="worktree-chip__branch">{worktree.branch ?? 'detached'}</span>
            {worktree.isMain && <span class="worktree-chip__main">main</span>}
            <span class="worktree-chip__changes">{worktree.activeChangeCount} changes</span>
            {liveSessions > 0 && (
              <span class="worktree-chip__sessions" data-testid="worktree-sessions">
                ⦿ {liveSessions}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
