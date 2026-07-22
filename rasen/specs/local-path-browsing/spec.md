# local-path-browsing Specification

## Purpose
Provide a strictly read-only, loopback-bound management endpoint that enumerates local filesystem directories so the web UI's space-creation picker can browse to a target directory without granting the browser any filesystem access of its own.

## Requirements

### Requirement: Local directory enumeration for the space-creation picker

The management server SHALL serve `GET /api/v1/local-paths` as a GET-only management endpoint returning, for a directory, `{ path, parent, separator, entries }`: the canonical absolute path, the canonical parent path (null at a filesystem root), the platform path separator, and the directory's entries as `{ name, isDir, isGitRepo }` sorted directories-first then alphabetically. `isGitRepo` SHALL be true when the entry contains a `.git` directory or a `.git` file (worktrees and submodules use a file). The endpoint SHALL be strictly read-only — it creates, writes, and registers nothing — and SHALL answer under the same loopback bind, bearer-token, and no-CORS posture as every management path. Paths SHALL be canonicalized cross-platform (Windows drive-letter case and separator variants resolve to one canonical form; responses use the platform's native separators).

#### Scenario: Directory listing with git detection

- **WHEN** a client requests `GET /api/v1/local-paths?path=<absolute dir>` with a valid token and the directory contains a git repository subdirectory
- **THEN** the response lists that entry with `isDir: true` and `isGitRepo: true`, plain directories with `isGitRepo: false`, and files with `isDir: false`

#### Scenario: Git worktree checkout is detected

- **WHEN** a listed subdirectory is a git worktree checkout whose `.git` is a file, not a directory
- **THEN** that entry still reports `isGitRepo: true`

#### Scenario: Read-only guarantee

- **WHEN** the endpoint serves any request
- **THEN** no directory, file, registry entry, or identity is created or modified

#### Scenario: Token required

- **WHEN** a request arrives without a valid bearer token
- **THEN** the response is 401 and no enumeration runs

#### Scenario: Non-GET rejected

- **WHEN** a client sends POST, PUT, or DELETE to `/api/v1/local-paths`
- **THEN** the response is 405 `method_not_allowed`

### Requirement: The picker starts at home and escapes it only by explicit path

When no `path` parameter is supplied, the endpoint SHALL return the user's home directory listing (identifying home in the payload) and SHALL never volunteer a location above the home directory on its own. Any client-supplied absolute path SHALL be enumerated wherever it points — an explicitly entered absolute path is the sole escape above home, which keeps repositories on other drives reachable while the server never suggests the escalation. A relative or empty `path` SHALL be rejected with 400. A nonexistent path SHALL yield 404, a non-directory 400, and a permission failure 403 — each as a structured error envelope, never a crash.

#### Scenario: Omitted path starts at home

- **WHEN** a client requests `GET /api/v1/local-paths` with no `path`
- **THEN** the response lists the user's home directory and identifies it as the starting point

#### Scenario: Explicit absolute path outside home is honored

- **WHEN** a client requests `path=E:\repos` (an absolute path on another drive, outside home)
- **THEN** the response enumerates that directory — reaching it required the client to supply the absolute path explicitly

#### Scenario: Relative path rejected

- **WHEN** a client requests `path=../..` or any non-absolute value
- **THEN** the response is 400 `invalid_path` and nothing is enumerated

#### Scenario: Missing and forbidden paths degrade structurally

- **WHEN** the requested path does not exist, is a file, or cannot be read for permissions
- **THEN** the response is 404, 400, or 403 respectively with an error envelope, and the server does not crash
