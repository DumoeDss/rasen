# board-ui Delta

## ADDED Requirements

### Requirement: The worktree strip reads as one structured control group

The board's worktrees panel SHALL present its worktrees as one visually structured control group: a labeled strip of uniform-height chips in a single aligned row (wrapping when space demands), where every chip presents its facts in the same fixed order — worktree name, checked-out branch, a main-checkout badge when applicable, the active-change count, and the live-session indicator when present. A chip missing an optional fact SHALL omit it without breaking the shared height or alignment. The selected chip SHALL remain clearly distinguished. This is a presentation contract only — the panel's data, selection behavior, and routing are unchanged.

#### Scenario: Chips align with a fixed anatomy

- **WHEN** the board shows several worktrees whose names, branches, and counts differ in length
- **THEN** all chips render at a uniform height in one aligned, labeled strip, each presenting its facts in the same order rather than as differently shaped free-floating pills

#### Scenario: Optional facts collapse cleanly

- **WHEN** one worktree is the main checkout with no live sessions and another is a linked worktree with live sessions
- **THEN** each chip shows only its applicable facts while both chips keep the same height and segment order
