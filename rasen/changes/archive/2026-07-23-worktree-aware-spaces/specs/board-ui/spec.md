# board-ui Delta

## ADDED Requirements

### Requirement: Project space board shows worktrees and switches its data source

When a project space's repository has more than one worktree (per the live worktree inventory), the board SHALL render a worktrees panel listing each worktree with its path tail, checked-out branch, active-change count, and a live-session count derived from session provenance (sessions whose working directory lies within that worktree's root — the same attribution rule as the store board's member chips, introducing no new persisted state). The panel SHALL let the user switch the board's data source to a specific worktree: the board's changes and runs then reflect that worktree's own branch-local planning state, addressed through the worktree's root path selector. The default data source SHALL be the main checkout. Exactly one worktree's state SHALL be shown at a time — the board SHALL NOT aggregate changes across worktrees, because same-named changes on different branches would misrepresent each other. The selected worktree SHALL be carried in the board route's query string so it survives a reload, while the space identity (route prefix, pins, header switcher, session space attribution) remains the project's — a worktree is never a separate space. A project space with a single worktree, a non-git root, or an unavailable inventory SHALL render the board exactly as before, with no panel.

#### Scenario: Panel lists worktrees with per-worktree facts

- **WHEN** the board loads a project space whose repository has a main checkout and a linked worktree on branch `feat/x` with two active changes and one running session working inside it
- **THEN** a worktrees panel shows both worktrees with path tail and branch, `2` active changes and one live session on the `feat/x` worktree

#### Scenario: Board defaults to the main checkout

- **WHEN** the board loads a multi-worktree project space with no worktree selection in the URL
- **THEN** the changes and runs shown are the main checkout's

#### Scenario: Switching shows only that worktree's state

- **WHEN** the user selects a linked worktree in the panel
- **THEN** the board refetches and shows that worktree's branch-local changes and runs only, with no entries from any other worktree mixed in

#### Scenario: Selection survives reload without changing the space

- **WHEN** the user reloads the board after selecting a worktree
- **THEN** the same worktree's state is shown, the route's space prefix is unchanged, and the header switcher still shows the project space

#### Scenario: Single-worktree project shows no panel

- **WHEN** the board loads a project space whose repository has only its main checkout (or is not a git repository)
- **THEN** no worktrees panel is rendered and the board behaves exactly as before
