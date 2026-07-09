## REMOVED Requirements

### Requirement: Browse Directory Inclusion
**Reason**: The `browse` vendored headless-Chromium tool is removed from the fork; the `browse/` directory no longer ships.
**Migration**: Browser automation is provided by the chrome-use expert skill, which drives the user's own Chrome over CDP via the vendored proxy in `skills/experts/chrome-use/`. No `browse/` directory is required.

### Requirement: Browse Binary Availability
**Reason**: The bun-compiled `browse/dist/browse` binary is removed; the fork no longer builds or distributes a native browser binary.
**Migration**: chrome-use requires no compiled binary — it uses the user's existing Chrome plus a Node CDP proxy launched by `check-deps.mjs`. There is no `browse/dist/browse` to resolve.

### Requirement: Playwright as Optional Dependency
**Reason**: Playwright was only used by the removed `browse` tool; it is dropped from `package.json` `optionalDependencies`.
**Migration**: chrome-use does not depend on Playwright. Installations no longer attempt to install it, and browser functionality is available through the user's Chrome via CDP.

### Requirement: Skill Browser Path Resolution
**Reason**: Skills no longer reference a `browse/dist/browse` binary path; the browse-binary resolution contract is obsolete.
**Migration**: The chrome-use skill resolves its proxy scripts relative to the installed skill directory (`${CLAUDE_SKILL_DIR}/scripts/`) and talks to the proxy over `localhost:3456`; no package-root binary path is resolved.
