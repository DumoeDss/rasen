import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getAutoplanSkillTemplate(): SkillTemplate {
  const skillPath = resolve(__dirname, '..', '..', '..', '..', 'skills', 'gstack', 'autoplan', 'SKILL.md');
  let instructions: string;
  try {
    const content = readFileSync(skillPath, 'utf-8');
    // Strip YAML frontmatter if present
    const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
    instructions = fmEnd > 0 ? content.slice(fmEnd + 3).trim() : content;
  } catch {
    instructions = 'Skill file not found: autoplan/SKILL.md';
  }
  return {
    name: 'gstack:autoplan',
    description: '|',
    instructions: `${instructions}

${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
