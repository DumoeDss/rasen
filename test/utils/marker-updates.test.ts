import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { FileSystemUtils, removeMarkerBlock, findAllMarkerBlocks } from '../../src/utils/file-system.js';

describe('FileSystemUtils.updateFileWithMarkers', () => {
  let testDir: string;
  const START_MARKER = '<!-- OPENSPEC:START -->';
  const END_MARKER = '<!-- OPENSPEC:END -->';

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `rasen-marker-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('new file creation', () => {
    it('should create new file with markers and content', async () => {
      const filePath = path.join(testDir, 'new-file.md');
      const content = 'Rasen content';
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        content,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(`${START_MARKER}\n${content}\n${END_MARKER}`);
    });
  });

  describe('existing file without markers', () => {
    it('should prepend markers and content to existing file', async () => {
      const filePath = path.join(testDir, 'existing.md');
      const existingContent = '# Existing Content\nUser content here';
      await fs.writeFile(filePath, existingContent);
      
      const newContent = 'Rasen content';
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        newContent,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(
        `${START_MARKER}\n${newContent}\n${END_MARKER}\n\n${existingContent}`
      );
    });
  });

  describe('existing file with markers', () => {
    it('should replace content between markers', async () => {
      const filePath = path.join(testDir, 'with-markers.md');
      const beforeContent = '# Before\nSome content before';
      const oldManagedContent = 'Old Rasen content';
      const afterContent = '# After\nSome content after';
      
      const existingFile = `${beforeContent}\n${START_MARKER}\n${oldManagedContent}\n${END_MARKER}\n${afterContent}`;
      await fs.writeFile(filePath, existingFile);
      
      const newContent = 'New Rasen content';
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        newContent,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(
        `${beforeContent}\n${START_MARKER}\n${newContent}\n${END_MARKER}\n${afterContent}`
      );
    });

    it('should preserve content before and after markers', async () => {
      const filePath = path.join(testDir, 'preserve.md');
      const userContentBefore = '# User Content Before\nImportant user notes';
      const userContentAfter = '## User Content After\nMore user notes';
      
      const existingFile = `${userContentBefore}\n${START_MARKER}\nOld content\n${END_MARKER}\n${userContentAfter}`;
      await fs.writeFile(filePath, existingFile);
      
      const newContent = 'Updated content';
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        newContent,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toContain(userContentBefore);
      expect(result).toContain(userContentAfter);
      expect(result).toContain(newContent);
      expect(result).not.toContain('Old content');
    });

    it('should handle markers at the beginning of file', async () => {
      const filePath = path.join(testDir, 'markers-at-start.md');
      const afterContent = 'User content after markers';
      
      const existingFile = `${START_MARKER}\nOld content\n${END_MARKER}\n${afterContent}`;
      await fs.writeFile(filePath, existingFile);
      
      const newContent = 'New content';
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        newContent,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(`${START_MARKER}\n${newContent}\n${END_MARKER}\n${afterContent}`);
    });

    it('should handle markers at the end of file', async () => {
      const filePath = path.join(testDir, 'markers-at-end.md');
      const beforeContent = 'User content before markers';
      
      const existingFile = `${beforeContent}\n${START_MARKER}\nOld content\n${END_MARKER}`;
      await fs.writeFile(filePath, existingFile);
      
      const newContent = 'New content';
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        newContent,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(`${beforeContent}\n${START_MARKER}\n${newContent}\n${END_MARKER}`);
    });
  });

  describe('invalid marker states', () => {
    it('should throw error if only start marker exists', async () => {
      const filePath = path.join(testDir, 'invalid-start.md');
      const existingFile = `Some content\n${START_MARKER}\nManaged content\nNo end marker`;
      await fs.writeFile(filePath, existingFile);
      
      await expect(
        FileSystemUtils.updateFileWithMarkers(
          filePath,
          'New content',
          START_MARKER,
          END_MARKER
        )
      ).rejects.toThrow(/Invalid marker state/);
    });

    it('should throw error if only end marker exists', async () => {
      const filePath = path.join(testDir, 'invalid-end.md');
      const existingFile = `Some content\nNo start marker\nManaged content\n${END_MARKER}`;
      await fs.writeFile(filePath, existingFile);
      
      await expect(
        FileSystemUtils.updateFileWithMarkers(
          filePath,
          'New content',
          START_MARKER,
          END_MARKER
        )
      ).rejects.toThrow(/Invalid marker state/);
    });
  });

  describe('idempotency', () => {
    it('should produce same result when called multiple times with same content', async () => {
      const filePath = path.join(testDir, 'idempotent.md');
      const content = 'Consistent content';
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        content,
        START_MARKER,
        END_MARKER
      );
      
      const firstResult = await fs.readFile(filePath, 'utf-8');
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        content,
        START_MARKER,
        END_MARKER
      );
      
      const secondResult = await fs.readFile(filePath, 'utf-8');
      expect(secondResult).toBe(firstResult);
    });
  });

  describe('edge cases', () => {
    it('should handle empty content', async () => {
      const filePath = path.join(testDir, 'empty-content.md');
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        '',
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toBe(`${START_MARKER}\n\n${END_MARKER}`);
    });

    it('should handle content with special characters', async () => {
      const filePath = path.join(testDir, 'special-chars.md');
      const content = '# Special chars: ${}[]()<>|\\`*_~';
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        content,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toContain(content);
    });

    it('should handle multi-line content', async () => {
      const filePath = path.join(testDir, 'multi-line.md');
      const content = `Line 1
Line 2
Line 3

Line 5 with gap`;
      
      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        content,
        START_MARKER,
        END_MARKER
      );
      
      const result = await fs.readFile(filePath, 'utf-8');
      expect(result).toContain(content);
    });

    it('should ignore inline mentions of markers when updating content', async () => {
      const filePath = path.join(testDir, 'inline-mentions.md');
      const existingFile = `Intro referencing markers like ${START_MARKER} and ${END_MARKER} inside text.

${START_MARKER}
Original content
${END_MARKER}
`;

      await fs.writeFile(filePath, existingFile);

      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        'Updated content',
        START_MARKER,
        END_MARKER
      );

      const firstResult = await fs.readFile(filePath, 'utf-8');
      expect(firstResult).toContain('Intro referencing markers like');
      expect(firstResult).toContain('Updated content');
      expect(firstResult.match(new RegExp(START_MARKER, 'g'))?.length).toBe(2);
      expect(firstResult.match(new RegExp(END_MARKER, 'g'))?.length).toBe(2);

      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        'Updated content',
        START_MARKER,
        END_MARKER
      );

      const secondResult = await fs.readFile(filePath, 'utf-8');
      expect(secondResult).toBe(firstResult);
    });
  });

  describe('multi-family dedupe (both current and legacy blocks present)', () => {
    const LEGACY_START = '<!-- OPENSPEC-LEGACY:START -->';
    const LEGACY_END = '<!-- OPENSPEC-LEGACY:END -->';

    it('should refresh the first block found in place and remove every other recognized block', async () => {
      const filePath = path.join(testDir, 'both-families.md');
      const existingFile = [
        '# Before',
        LEGACY_START,
        'Old legacy content',
        LEGACY_END,
        '',
        '# Middle',
        START_MARKER,
        'Old current content',
        END_MARKER,
        '# After',
      ].join('\n');

      await fs.writeFile(filePath, existingFile);

      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        'Fresh content',
        START_MARKER,
        END_MARKER,
        { start: LEGACY_START, end: LEGACY_END }
      );

      const result = await fs.readFile(filePath, 'utf-8');

      expect(result).toContain('# Before');
      expect(result).toContain('# Middle');
      expect(result).toContain('# After');
      expect(result).toContain('Fresh content');
      expect(result).not.toContain('Old legacy content');
      expect(result).not.toContain('Old current content');
      expect(result).not.toContain(LEGACY_START);
      expect(result).not.toContain(LEGACY_END);

      // Exactly one managed block — no duplicate and no orphan
      expect(result.match(new RegExp(START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length).toBe(1);
      expect(result.match(new RegExp(END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length).toBe(1);

      // The dedupe target is the first block found by position (legacy, here) — it is
      // refreshed in place, so the fresh block lands before "# Middle", not after it.
      expect(result.indexOf(START_MARKER)).toBeLessThan(result.indexOf('# Middle'));
    });
  });

  describe('coincidental marker-prefix collisions (strictness regression guard)', () => {
    // Regression guard for a verifier-caught issue: updateFileWithMarkers() must keep
    // requiring the marker literal ALONE on its own line (no trailing text) — the same
    // strictness bash/zsh had before findAllMarkerBlocks existed. A user's own comment
    // that merely *starts* with the marker literal (e.g. a section-header convention
    // unrelated to this tool) must never be mistaken for a managed block and must never
    // have its content deleted.
    const RASEN_START = '# RASEN:START';
    const RASEN_END = '# RASEN:END';

    it('should not match — and must not delete — a user comment that merely starts with the start marker literal plus trailing text', async () => {
      const filePath = path.join(testDir, 'coincidental-prefix.md');
      const userContent = [
        '# RASEN:START of my custom aliases (not related to the completion tool)',
        'alias ll="ls -la"',
        'alias gs="git status"',
        '# RASEN:END of my custom aliases',
      ].join('\n');

      await fs.writeFile(filePath, userContent);

      await FileSystemUtils.updateFileWithMarkers(
        filePath,
        'Fresh content',
        RASEN_START,
        RASEN_END
      );

      const result = await fs.readFile(filePath, 'utf-8');

      // The user's coincidental comment and its content must survive completely intact —
      // it must not be treated as a managed block and spliced out.
      expect(result).toContain('# RASEN:START of my custom aliases (not related to the completion tool)');
      expect(result).toContain('alias ll="ls -la"');
      expect(result).toContain('alias gs="git status"');
      expect(result).toContain('# RASEN:END of my custom aliases');

      // A genuine new bare-marker block should have been appended instead (no matching
      // block found, so updateFileWithMarkers falls back to prepend-new-block behavior).
      expect(result).toContain('Fresh content');
      const bareStartLines = result.split('\n').filter((line) => line.trim() === RASEN_START);
      expect(bareStartLines).toHaveLength(1);
    });
  });
});

describe('removeMarkerBlock', () => {
  const START_MARKER = '<!-- OPENSPEC:START -->';
  const END_MARKER = '<!-- OPENSPEC:END -->';

  describe('basic removal', () => {
    it('should remove marker block and preserve content before', () => {
      const content = `User content before
${START_MARKER}
Rasen content
${END_MARKER}`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toBe('User content before\n');
      expect(result).not.toContain(START_MARKER);
      expect(result).not.toContain(END_MARKER);
    });

    it('should remove marker block and preserve content after', () => {
      const content = `${START_MARKER}
Rasen content
${END_MARKER}
User content after`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toBe('User content after\n');
    });

    it('should remove marker block and preserve content before and after', () => {
      const content = `User content before
${START_MARKER}
Rasen content
${END_MARKER}
User content after`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain('User content before');
      expect(result).toContain('User content after');
      expect(result).not.toContain(START_MARKER);
    });

    it('should return empty string when only markers remain', () => {
      const content = `${START_MARKER}
Rasen content
${END_MARKER}`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toBe('');
    });
  });

  describe('invalid states', () => {
    it('should return original content when markers are missing', () => {
      const content = 'Plain content without markers';
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toBe('Plain content without markers');
    });

    it('should return original content when only start marker exists', () => {
      const content = `${START_MARKER}
Content without end marker`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain(START_MARKER);
    });

    it('should return original content when only end marker exists', () => {
      const content = `Content without start marker
${END_MARKER}`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain(END_MARKER);
    });

    it('should return original content when markers are in wrong order', () => {
      const content = `${END_MARKER}
Content
${START_MARKER}`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain(END_MARKER);
      expect(result).toContain(START_MARKER);
    });
  });

  describe('whitespace handling', () => {
    it('should clean up double blank lines', () => {
      const content = `Line 1


${START_MARKER}
Rasen content
${END_MARKER}


Line 2`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).not.toMatch(/\n{3,}/);
    });

    it('should handle markers with whitespace on same line', () => {
      const content = `User content
  ${START_MARKER}
Rasen content
  ${END_MARKER}
More content`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain('User content');
      expect(result).toContain('More content');
      expect(result).not.toContain(START_MARKER);
    });
  });

  describe('inline marker mentions', () => {
    it('should ignore inline mentions and only remove actual marker block', () => {
      const content = `Intro referencing markers like ${START_MARKER} and ${END_MARKER} inside text.

${START_MARKER}
Original content
${END_MARKER}
`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      // Inline mentions should be preserved
      expect(result).toContain('Intro referencing markers like');
      expect(result).toContain(`${START_MARKER} and ${END_MARKER} inside text`);
      // Original content between markers should be removed
      expect(result).not.toContain('Original content');
    });

    it('should handle multiple inline mentions before actual block', () => {
      const content = `The ${START_MARKER} marker starts a block.
The ${END_MARKER} marker ends it.
Here is the actual block:
${START_MARKER}
Managed content
${END_MARKER}
After block content`;
      const result = removeMarkerBlock(content, START_MARKER, END_MARKER);
      expect(result).toContain(`The ${START_MARKER} marker starts a block`);
      expect(result).toContain(`The ${END_MARKER} marker ends it`);
      expect(result).toContain('After block content');
      expect(result).not.toContain('Managed content');
    });
  });

  describe('shell markers', () => {
    const SHELL_START = '# OPENSPEC:START';
    const SHELL_END = '# OPENSPEC:END';

    it('should work with shell-style markers', () => {
      const content = `# User config
export PATH="/usr/local/bin:$PATH"

${SHELL_START}
# Rasen managed
alias openspec="npx openspec"
${SHELL_END}

# More user config
export EDITOR="vim"`;
      const result = removeMarkerBlock(content, SHELL_START, SHELL_END);
      expect(result).toContain('export PATH');
      expect(result).toContain('export EDITOR');
      expect(result).not.toContain('alias openspec');
      expect(result).not.toContain(SHELL_START);
    });
  });
});

describe('findAllMarkerBlocks', () => {
  const CURRENT = { start: '# RASEN:START', end: '# RASEN:END' };
  const LEGACY = { start: '# OPENSPEC:START', end: '# OPENSPEC:END' };

  it('should return an empty array when no recognized family is present', () => {
    const content = 'Plain content\nwith no markers at all';
    expect(findAllMarkerBlocks(content, [CURRENT, LEGACY])).toEqual([]);
  });

  it('should find a single block when only one family is present', () => {
    const content = `Before\n${CURRENT.start}\nManaged\n${CURRENT.end}\nAfter`;
    const matches = findAllMarkerBlocks(content, [CURRENT, LEGACY]);

    expect(matches).toHaveLength(1);
    expect(matches[0].startMarker).toBe(CURRENT.start);
    expect(matches[0].endMarker).toBe(CURRENT.end);
  });

  it('should find blocks from both families and sort by position, regardless of array or file order', () => {
    // The legacy block appears first in the file; the family array lists current first —
    // the result must still be ordered by position in the file, not family order.
    const content = [
      '# Before',
      LEGACY.start,
      'Legacy block',
      LEGACY.end,
      '# Middle',
      CURRENT.start,
      'Current block',
      CURRENT.end,
      '# After',
    ].join('\n');

    const matches = findAllMarkerBlocks(content, [CURRENT, LEGACY]);

    expect(matches).toHaveLength(2);
    expect(matches[0].startMarker).toBe(LEGACY.start);
    expect(matches[1].startMarker).toBe(CURRENT.start);
    expect(matches[0].startIndex).toBeLessThan(matches[1].startIndex);
  });

  it('should skip a malformed family (start marker with no matching end) without throwing', () => {
    const content = [
      '# Before',
      LEGACY.start, // dangling — no matching OPENSPEC:END anywhere in the content
      'Dangling legacy content',
      CURRENT.start,
      'Current block',
      CURRENT.end,
    ].join('\n');

    let matches: ReturnType<typeof findAllMarkerBlocks> | undefined;
    expect(() => {
      matches = findAllMarkerBlocks(content, [CURRENT, LEGACY]);
    }).not.toThrow();

    expect(matches).toHaveLength(1);
    expect(matches![0].startMarker).toBe(CURRENT.start);
  });

  describe('strict option (default true)', () => {
    it('should reject a marker with trailing text on the same line by default (strict)', () => {
      const content = [
        `${CURRENT.start} of my custom aliases (not related to the completion tool)`,
        'alias ll="ls -la"',
        `${CURRENT.end} of my custom aliases`,
      ].join('\n');

      expect(findAllMarkerBlocks(content, [CURRENT, LEGACY])).toEqual([]);
      expect(findAllMarkerBlocks(content, [CURRENT, LEGACY], { strict: true })).toEqual([]);
    });

    it('should match a marker with trailing text on the same line when strict: false', () => {
      const content = [
        `${CURRENT.start} - Rasen completion (managed block, do not edit manually)`,
        'some managed content',
        CURRENT.end,
      ].join('\n');

      const matches = findAllMarkerBlocks(content, [CURRENT, LEGACY], { strict: false });

      expect(matches).toHaveLength(1);
      expect(matches[0].startMarker).toBe(CURRENT.start);
      expect(matches[0].endMarker).toBe(CURRENT.end);
    });

    it('should still reject a marker with non-whitespace text BEFORE it on the line even when strict: false', () => {
      const content = `echo "${CURRENT.start}"\nsome content\n${CURRENT.end}`;

      expect(findAllMarkerBlocks(content, [CURRENT, LEGACY], { strict: false })).toEqual([]);
    });
  });
});
