import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { SkillTemplate } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getInvestigateSkillTemplate(): SkillTemplate {
  const skillPath = resolve(__dirname, '..', '..', '..', '..', 'skills', 'gstack', 'investigate', 'SKILL.md');
  let instructions: string;
  try {
    const content = readFileSync(skillPath, 'utf-8');
    // Strip YAML frontmatter if present
    const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
    instructions = fmEnd > 0 ? content.slice(fmEnd + 3).trim() : content;
  } catch {
    instructions = 'Skill file not found: investigate/SKILL.md';
  }
  return {
    name: 'gstack:investigate',
    description: '|',
    instructions,
    metadata: { author: 'openspec', version: '1.0' },
  };
}
