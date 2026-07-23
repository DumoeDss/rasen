import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = 'E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/OpenSpec-code/.claude/skills';
const dirs = readdirSync(root).filter(d => d.startsWith('rasen-'));

// section = text from a "## " header to the next "## " header
const sections = new Map(); // hash -> {header, bytes, files:[]}
const fileSizes = [];
for (const d of dirs) {
  let text;
  try { text = readFileSync(join(root, d, 'SKILL.md'), 'utf8'); } catch { continue; }
  fileSizes.push([d, text.length]);
  const parts = text.split(/^(?=## )/m);
  for (const p of parts) {
    const norm = p.replace(/\r\n/g, '\n').trim();
    if (norm.length < 200) continue;
    const h = createHash('md5').update(norm).digest('hex');
    const header = (norm.match(/^## (.+)/) || [,'(preamble/frontmatter)'])[1];
    if (!sections.has(h)) sections.set(h, { header, bytes: norm.length, files: [] });
    sections.get(h).files.push(d);
  }
}

const dups = [...sections.values()].filter(s => s.files.length >= 2)
  .map(s => ({ ...s, wasted: s.bytes * (s.files.length - 1) }))
  .sort((a, b) => b.wasted - a.wasted);

let totalWasted = 0;
console.log('=== EXACT-DUPLICATE sections across skills (bytes wasted = size × (copies-1)) ===');
for (const s of dups) {
  totalWasted += s.wasted;
  console.log(`${(s.wasted/1024).toFixed(1)}KB wasted | ${s.files.length}x | ${(s.bytes/1024).toFixed(1)}KB each | "${s.header}"`);
}
console.log(`\nTOTAL exact-duplicate waste: ${(totalWasted/1024).toFixed(1)}KB`);
const total = fileSizes.reduce((a, [,n]) => a + n, 0);
console.log(`TOTAL all skills: ${(total/1024).toFixed(1)}KB -> dup share ${(100*totalWasted/total).toFixed(1)}%`);

// near-dup check: same header name, different hash
const byHeader = new Map();
for (const s of sections.values()) {
  if (!byHeader.has(s.header)) byHeader.set(s.header, []);
  byHeader.get(s.header).push(s);
}
console.log('\n=== SAME-HEADER variants (near-duplicates, content drifted) ===');
for (const [h, list] of byHeader) {
  const copies = list.reduce((a, s) => a + s.files.length, 0);
  if (list.length >= 2 && copies >= 3) {
    const bytes = list.reduce((a, s) => a + s.bytes * s.files.length, 0);
    console.log(`"${h}": ${copies} copies in ${list.length} variants, ${(bytes/1024).toFixed(1)}KB total`);
  }
}
