# Planning boundary — final cross-platform evidence

This is a dependency-boundary note for the future
`session-cache-optimization-acceptance-evidence` proposal. It does not start or
replace that child's proposal, design, specification, or tasks.

## Inherited registry review gate

Registry review P2 requires real Windows and POSIX evidence for
platform-sensitive path identity, junction/symlink handling, owner-death
locking, atomic replacement, and restart behavior. The registry child can
close its local-delivery task with native Windows focused coverage and
platform-injected POSIX semantics, but that evidence is not equivalent to
execution on a POSIX runner and must not be presented as such.

The acceptance child SHALL retain this requirement as a final portfolio gate:

- wait until host, registry, CLI, scheduler, and acceptance changes form the
  final integrated tree;
- let the parent create the portfolio's single commit/push or PR delivery;
- require the repository's existing GitHub matrix to pass on that exact commit,
  including `linux-bash`, `linux-bash-node24`, and every Windows PowerShell
  shard; and
- record the exact commit SHA, workflow/run URLs, required job names, and
  successful conclusions in the acceptance evidence artifact.

Evidence from a partial child push, a different SHA, WSL/Docker emulation, or
platform-injected unit tests does not close this gate. A failure routes back to
the owning child; the cross-platform requirement cannot be waived by the
acceptance slice.
