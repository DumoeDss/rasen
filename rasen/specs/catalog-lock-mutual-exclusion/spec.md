# catalog-lock-mutual-exclusion Specification

## Purpose
Serializes read-modify-write transactions on the project knowledge catalog so concurrent writers (bundle import, learned-skill mutation) never interleave or evict each other's work. A dead owner's lock is reclaimed atomically rather than by a path delete that could remove a live owner's lock.
## Requirements
### Requirement: Concurrent stealers of a dead-owner lock do not delete each other's live lock

When two or more processes attempt to acquire a lock whose owner PID is provably dead (the kernel returns ESRCH), exactly one process SHALL claim the dead lock and create its own live lock. Every other process SHALL discover that the lock path no longer holds the dead-owner token and SHALL wait or retry. No process SHALL delete or move a lock file whose content it has not verified as the dead-owner token it originally read.

#### Scenario: Two concurrent stealers of the same dead-owner lock

- **WHEN** two processes concurrently attempt to acquire a lock whose owner PID has exited (ESRCH)
- **THEN** exactly one process acquires the lock
- **AND** the other process either acquires after the first releases, or times out at the deadline
- **AND** at no point do both processes hold the lock simultaneously
- **AND** neither process removes the other's subsequently-created live lock file

#### Scenario: A stealer that renames a replaced lock restores it and waits

- **WHEN** a process reads a dead-owner lock token, but another stealer replaces the lock between the read and the claim attempt
- **THEN** the process detects that the file it moved does not contain the token it originally read
- **AND** it restores the moved file to the lock path when no new lock has appeared there
- **AND** it does not create its own lock in that cycle
- **AND** it waits and retries until the deadline

### Requirement: A filesystem failure during stale-lock claim does not produce a busy-loop

When the filesystem operation that claims a stale lock fails (permission error, delete-pending state, or any other recoverable error), the lock acquisition loop SHALL continue to respect its deadline and poll interval. The loop SHALL NOT skip its sleep or deadline check as a side effect of a swallowed failure.

#### Scenario: Rename or unlink failure during steal respects the deadline

- **WHEN** the filesystem operation that claims a stale lock consistently fails with a permission or I/O error
- **THEN** the acquisition loop sleeps for its configured poll interval between each attempt
- **AND** it throws a timeout error after the configured deadline elapses
- **AND** it does not spin at CPU capacity without sleeping

### Requirement: All writers sharing one catalog lock path use the same liveness protocol

Every writer that serializes access to the same project knowledge catalog lock path SHALL use the same owner-aware liveness protocol to judge whether an existing lock is stale. No writer SHALL evict a lock based on a wall-clock age heuristic (such as mtime threshold) when another writer sharing that lock path uses process-liveness-based stale detection.

#### Scenario: A slow catalog writer is not evicted by a faster writer using a different staleness check

- **WHEN** one writer holds the catalog lock for longer than 30 seconds (for example, importing a large knowledge bundle across a slow disk)
- **AND** a second writer sharing the same lock path attempts to acquire the lock
- **THEN** the second writer detects the first writer's PID is still alive
- **AND** it waits or times out without removing the live lock
- **AND** the first writer's transaction completes without its lock being deleted out from under it

#### Scenario: A learned-skill mutation and a bundle import on the same catalog use the same lock

- **WHEN** a learned-skill mutation and a knowledge-bundle import target the same project knowledge catalog
- **THEN** both operations acquire their lock through the same owner-aware protocol
- **AND** neither operation's lock-acquisition logic uses a wall-clock age heuristic to declare the other's lock stale
