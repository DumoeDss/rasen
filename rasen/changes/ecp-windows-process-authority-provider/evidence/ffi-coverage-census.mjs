// Task 9.6, static half: enumerate every hand-declared foreign item and its call sites,
// separated into product code (src/**) and test code (tests/**).
//
// ONE COMMAND, from the repository root:
//
//   node rasen/changes/ecp-windows-process-authority-provider/evidence/ffi-coverage-census.mjs
//
// This proves REACHABILITY, never execution. A call site in tests/** only means the item is
// exercised by the SUITE, not by the product; an item with no call site anywhere is a dead
// declaration. Task 9.6 asks for execution, which only the dynamic half
// (ffi-coverage-instrument.mjs) can answer. Read this as the denominator, not the answer.
//
// Writes ffi-declared.json next to itself for the instrument run to diff against.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const crate = path.resolve(HERE, '../../../..', 'native/windows-process-authority');
const sysText = fs.readFileSync(path.join(crate, 'src/sys.rs'), 'utf8');

// Parse the three extern blocks.
const declared = [];
const blockRe = /#\[link\(name = "([a-z0-9]+)"\)\]\s*\r?\nextern "system" \{([\s\S]*?)\r?\n\}/g;
let m;
while ((m = blockRe.exec(sysText))) {
  const library = m[1];
  const body = m[2];
  const fnRe = /pub fn (\w+)\s*\(([\s\S]*?)\)\s*(->\s*([^;]+?))?\s*;/g;
  let f;
  while ((f = fnRe.exec(body))) {
    declared.push({ library, name: f[1], params: f[2], ret: (f[4] || '').trim() });
  }
}

function filesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

const srcFiles = filesUnder(path.join(crate, 'src'));
const testFiles = filesUnder(path.join(crate, 'tests'));

// A "call site" is `Name(` not preceded by `fn ` / `pub fn ` and not the declaration itself.
function callSites(files, name) {
  const hits = [];
  const re = new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'g');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*pub fn /.test(line)) continue; // the declaration in sys.rs
      re.lastIndex = 0;
      if (re.test(line)) hits.push(`${path.relative(crate, file).replace(/\\/g, '/')}:${i + 1}`);
    }
  }
  return hits;
}

const rows = declared.map((item) => {
  const inProduct = callSites(srcFiles, item.name).filter((h) => !h.includes('sys.rs'));
  const inSys = callSites([path.join(crate, 'src/sys.rs')], item.name);
  const inTests = callSites(testFiles, item.name);
  return { ...item, product: inProduct, sys: inSys, tests: inTests };
});

console.log(`declared foreign items: ${rows.length}`);
console.log('');
console.log('| # | library | item | product call sites | test-only call sites |');
console.log('| --- | --- | --- | --- | --- |');
rows.forEach((r, i) => {
  const productAll = [...r.sys, ...r.product];
  console.log(
    `| ${i} | ${r.library} | ${r.name} | ${productAll.length ? productAll.slice(0, 3).join(', ') + (productAll.length > 3 ? ` (+${productAll.length - 3})` : '') : '**NONE**'} | ${r.tests.length ? r.tests.slice(0, 2).join(', ') + (r.tests.length > 2 ? ` (+${r.tests.length - 2})` : '') : '-'} |`
  );
});

const noProduct = rows.filter((r) => r.sys.length + r.product.length === 0);
console.log('');
console.log(`items with NO call site in src/**: ${noProduct.length}`);
for (const r of noProduct) {
  console.log(`  ${r.library}::${r.name}  tests: ${r.tests.length ? r.tests.join(', ') : 'none anywhere'}`);
}

fs.writeFileSync(path.join(HERE, 'ffi-declared.json'), JSON.stringify(rows, null, 1));
