## ADDED Requirements

### Requirement: A split planning truth refusal names the offending root and a workable repair

When a project is bound to a Store but still carries its own project-local planning content, the resolver SHALL refuse the mutating intent fail-closed, and that refusal SHALL name both the directory whose local planning content caused it and a repair that actually resolves it. The named directory SHALL be the root the resolver tested, which is not necessarily the working directory the command was invoked from: a linked worktree still holding planning content SHALL be named as itself, so that following the repair on one root and then meeting the same refusal on another is diagnosable from the message rather than only from the source. The repair SHALL name adopting that root's planning into the bound Store, and SHALL also name the command that resolves the split in the opposite direction, because either direction is a legitimate resolution and the refusal cannot know which one the operator intends. Naming a repair SHALL NOT introduce a force, an override, or a partial write.

#### Scenario: Finalization blocked by split truth names root and repair

- **WHEN** a Change finalization resolves a Store-bound project whose root still holds project-local planning content
- **THEN** the refusal carries code `split_planning_truth` and names that root's path
- **AND** it names adopting that planning into the bound Store as the repair, and names the opposite-direction command as the alternative
- **AND** nothing is written

#### Scenario: Creation blocked by split truth names root and repair

- **WHEN** Change creation resolves a Store-bound project whose root still holds project-local planning content
- **THEN** the refusal carries code `split_planning_truth`, names that root's path, and names the same two directions of repair
- **AND** nothing is written

#### Scenario: The named root is the one that holds the content, not the invocation directory

- **WHEN** the resolver tests a project root other than the working directory the command was invoked from, and that root is the one holding local planning content
- **THEN** the refusal names that root rather than the invocation directory
