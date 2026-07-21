import type { SpaceMember } from '../api/types.js';

/**
 * The store-space member chip row (ui-space-redesign-task-board design D4 /
 * board-ui spec): an "All" chip (the full rollup, selected by default) plus
 * one chip per store member. A controlled component — `selected` is the
 * chosen member's `projectId`, or `null` for "All"; the parent (BoardPage)
 * owns the selection state and applies the session-provenance filter. Only a
 * store space renders this row; a project space omits it entirely, so this
 * component makes no space-type decision of its own.
 */
export function MemberChips({
  members,
  selected,
  onSelect,
}: {
  members: SpaceMember[];
  selected: string | null;
  onSelect: (memberId: string | null) => void;
}) {
  return (
    <div class="member-chips" role="group" aria-label="Filter by member" data-testid="member-chips">
      <button
        type="button"
        class={`member-chip${selected === null ? ' member-chip--selected' : ''}`}
        aria-pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        All
      </button>
      {members.map((member) => (
        <button
          key={member.projectId}
          type="button"
          class={`member-chip${selected === member.projectId ? ' member-chip--selected' : ''}`}
          aria-pressed={selected === member.projectId}
          onClick={() => onSelect(member.projectId)}
        >
          {member.name}
        </button>
      ))}
    </div>
  );
}
