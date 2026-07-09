# Technical Design

## Architecture Decisions

### Simplicity First
- No version tracking - always update when commanded
- Full replacement for OpenSpec-managed files only (e.g., `openspec/README.md`)
- Marker-based updates for user-owned files (e.g., `CLAUDE.md`)
- Templates bundled with package - no network required
- Minimal error handling - only check prerequisites

### Template Strategy
- Use existing template utilities
  - `readmeTemplate` from `src/core/templates/readme-template.ts` for `openspec/README.md`
  - `TemplateManager.getClaudeTemplate()` for `CLAUDE.md`
- Directory name is fixed to `openspec` (from `OPENSPEC_DIR_NAME`)

### File Operations
- Use async utilities for consistency
  - `FileSystemUtils.writeFile` for `openspec/README.md`
  - `FileSystemUtils.updateFileWithMarkers` for `CLAUDE.md`
- No atomic operations needed - users have git
- Check directory existence before proceeding

## Implementation

### Update Command (`src/core/update.ts`)
```typescript
export class UpdateCommand {
  async execute(projectPath: string): Promise<void> {
    const openspecDirName = OPENSPEC_DIR_NAME;
    const openspecPath = path.join(projectPath, openspecDirName);

    // 1. Check openspec directory exists
    if (!await FileSystemUtils.directoryExists(openspecPath)) {
      throw new Error(`No OpenSpec directory found. Run 'openspec init' first.`);
    }

    // 2. Update README.md (full replacement)
    const readmePath = path.join(openspecPath, 'README.md');
    await FileSystemUtils.writeFile(readmePath, readmeTemplate);

    // 3. Update CLAUDE.md (marker-based)
    const claudePath = path.join(projectPath, 'CLAUDE.md');
    const claudeContent = TemplateManager.getClaudeTemplate();
    await FileSystemUtils.updateFileWithMarkers(
      claudePath,
      claudeContent,
      OPENSPEC_MARKERS.start,
      OPENSPEC_MARKERS.end
    );

    // 4. Success message (ASCII-safe, checkmark optional by terminal)
    console.log('Updated OpenSpec instructions');
  }
}
```

## Why This Approach

### Benefits
- **Dead simple**: ~40 lines of code total
- **Fast**: No version checks, minimal parsing
- **Predictable**: Same result every time; idempotent
- **Maintainable**: Reuses existing utilities

### Trade-offs Accepted
- No version tracking (unnecessary complexity)
- Full overwrite only for OpenSpec-managed files
- Marker-managed updates for user-owned files

## Error Handling

Only handle critical errors:
- Missing `openspec` directory → throw error handled by CLI to present a friendly message
- File write failures → let errors bubble up to CLI

## Testing Strategy

Manual smoke tests are sufficient initially:
1. Run `openspec init` in a test project
2. Modify both files (including custom content around markers in `CLAUDE.md`)
3. Run `openspec update`
4. Verify `openspec/README.md` fully replaced; `CLAUDE.md` OpenSpec block updated without altering user content outside markers
5. Run the command twice to verify idempotency and no duplicate markers
6. Test with missing `openspec` directory (expect failure)