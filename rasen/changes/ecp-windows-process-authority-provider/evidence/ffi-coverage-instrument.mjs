// Task 9.6: prove every hand-declared foreign item is exercised by a real call.
//
// ONE COMMAND, from the repository root:
//
//   node rasen/changes/ecp-windows-process-authority-provider/evidence/ffi-coverage-instrument.mjs
//   RWPA_FFI_TRACE=<dir> cargo test --manifest-path native/windows-process-authority/Cargo.toml --locked -- --test-threads 1
//   node rasen/changes/ecp-windows-process-authority-provider/evidence/ffi-coverage-instrument.mjs --restore
//
// The first command rewrites native/windows-process-authority/src/sys.rs so every declared
// foreign item is reached through a forwarding wrapper that appends its name to
// $RWPA_FFI_TRACE/<pid>.txt on FIRST call and then forwards to the real import. The union of
// those files across every traced process is the coverage answer. `--restore` puts the
// pristine bytes back; verify with `node scripts/build-windows-process-authority.mjs --plan`.
//
// THIS IS TEMPORARY MEASUREMENT SCAFFOLDING AND MUST NEVER BE FROZEN OR SHIPPED. It moves the
// three extern blocks verbatim into a private `mod imports` and adds a recorder that takes a
// mutex inside calls as ordinary as CloseHandle. It changes no signature, link name, constant
// or call site, so it is behaviour-preserving, but the crate source digest moves and every
// receipt taken against it is bound to the instrumented tree, not to the freeze.
//
// Write-on-first-call rather than dump-at-exit is deliberate: the guardian is force-killed in
// several rows, so anything buffered until exit would be lost for exactly the process whose
// coverage matters most. See evidence/section-9-oracle-discrimination.md, finding S9-F2, for
// the two recorder defects that both produced the same plausible WRONG answer before this
// version was trusted.
//
// If the pristine backup is missing (a new session, a cleared temp directory), restore with:
//   git checkout -- native/windows-process-authority/src/sys.rs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SYS = path.join(REPO, 'native/windows-process-authority/src/sys.rs');
const BACKUP = path.join(os.tmpdir(), 'rasen-wpa-sys-pristine.rs');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

if (process.argv[2] === '--restore') {
  const original = fs.readFileSync(BACKUP);
  fs.writeFileSync(SYS, original);
  const now = fs.readFileSync(SYS);
  console.log('restored bytes:', now.length, sha(now));
  console.log('matches backup:', sha(now) === sha(original));
  process.exit(0);
}

const originalText = fs.readFileSync(SYS, 'utf8');
const originalBytes = fs.readFileSync(SYS);
if (!fs.existsSync(BACKUP)) fs.writeFileSync(BACKUP, originalBytes);
console.log('original bytes:', originalBytes.length, sha(originalBytes));

// Locate the three extern blocks as whole text spans.
const blockRe = /#\[link\(name = "([a-z0-9]+)"\)\]\r?\nextern "system" \{([\s\S]*?)\r?\n\}\r?\n/g;
const blocks = [];
let m;
while ((m = blockRe.exec(originalText))) {
  blocks.push({ library: m[1], body: m[2], start: m.index, end: m.index + m[0].length, whole: m[0] });
}
if (blocks.length !== 3) throw new Error(`expected 3 extern blocks, found ${blocks.length}`);

function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '<' || ch === '[') depth += 1;
    if (ch === ')' || ch === '>' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((p) => p.trim()).filter(Boolean);
}

const items = [];
for (const block of blocks) {
  const fnRe = /pub fn (\w+)\s*\(([\s\S]*?)\)\s*(->\s*([^;]+?))?\s*;/g;
  let f;
  while ((f = fnRe.exec(block.body))) {
    const params = splitTopLevel(f[2]).map((p) => {
      const colon = p.indexOf(':');
      return { name: p.slice(0, colon).trim(), type: p.slice(colon + 1).trim() };
    });
    items.push({ library: block.library, name: f[1], params, ret: (f[4] || '').trim() });
  }
}
console.log('declared items parsed:', items.length);

const names = items.map((i) => i.name);
if (new Set(names).size !== names.length) throw new Error('duplicate declared item name');

// Build the replacement text: an `imports` module holding the untouched declarations, a trace
// recorder, and one forwarding wrapper per item at the original public path.
const importBlocks = blocks
  .map((b) => b.whole.replace(/^/gm, '    ').replace(/\s+$/, ''))
  .join('\n\n');

const wrappers = items
  .map((item, index) => {
    const signature = item.params.map((p) => `${p.name}: ${p.type}`).join(', ');
    const call = item.params.map((p) => p.name).join(', ');
    const ret = item.ret ? ` -> ${item.ret}` : '';
    return `#[inline]
#[allow(non_snake_case)]
#[allow(clippy::too_many_arguments)]
pub unsafe fn ${item.name}(${signature})${ret} {
    ffi_trace::record(${index});
    imports::${item.name}(${call})
}`;
  })
  .join('\n\n');

const replacement = `// ===== TEMPORARY TASK 9.6 INSTRUMENTATION -- NOT PART OF THE FROZEN SOURCE =====
// Every hand-declared foreign item is reached through a forwarding wrapper that records its
// first real call. Restored byte-exact after the measurement; the crate source digest is
// re-measured to prove the freeze is intact.
#[allow(non_snake_case)]
mod imports {
    use super::*;

${importBlocks}
}

pub mod ffi_trace {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    pub const NAMES: [&str; ${items.length}] = [
${items.map((i) => `        "${i.library}::${i.name}",`).join('\n')}
    ];

    const NOT_HIT: AtomicBool = AtomicBool::new(false);
    static HIT: [AtomicBool; ${items.length}] = [NOT_HIT; ${items.length}];
    static SINK: Mutex<Option<std::fs::File>> = Mutex::new(None);

    /// Append on first call only. The guardian is force-killed in several rows, so anything
    /// buffered until exit would be lost for exactly the process that matters most.
    ///
    /// Two recorder defects had to be removed before this measurement meant anything, and both
    /// were found by the measurement disagreeing with the code rather than by inspection.
    ///
    /// 1. Opening the file per record dropped records silently: several guardian threads open
    ///    the same path concurrently, Windows refuses the second open with a sharing violation,
    ///    and the HIT bit was already set -- so the item was lost forever and read as "never
    ///    called".
    /// 2. Opening the file per record was **blind inside the impersonation window**. Between
    ///    'ImpersonateNamedPipeClient' and 'RevertToSelf' the thread carries an
    ///    identification-level token, which permits identity queries and no file access at all,
    ///    so every open in that window fails. Exactly the three items called there read as
    ///    unexercised.
    ///
    /// The sink is therefore opened **once**, on the first record, and reused: the access check
    /// happens at open time, so writes through an already-open handle survive impersonation.
    pub fn record(index: usize) {
        if HIT[index].load(Ordering::SeqCst) {
            return;
        }
        let directory = match std::env::var("RWPA_FFI_TRACE") {
            Ok(value) => value,
            Err(_) => return,
        };
        let mut sink = match SINK.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if HIT[index].load(Ordering::SeqCst) {
            return;
        }
        if sink.is_none() {
            let path = std::path::Path::new(&directory).join(format!("{}.txt", std::process::id()));
            let mut attempt = 0;
            while attempt < 200 && sink.is_none() {
                match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
                    Ok(file) => *sink = Some(file),
                    Err(_) => {
                        attempt += 1;
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                }
            }
        }
        use std::io::Write;
        if let Some(file) = sink.as_mut() {
            if writeln!(file, "{}", NAMES[index]).is_ok() && file.flush().is_ok() {
                HIT[index].store(true, Ordering::SeqCst);
            }
        }
    }
}

${wrappers}
`;

const before = originalText.slice(0, blocks[0].start);
const after = originalText.slice(blocks[2].end);
const instrumented = `${before}${replacement}${after}`;
fs.writeFileSync(SYS, instrumented, 'utf8');
const written = fs.readFileSync(SYS);
console.log('instrumented bytes:', written.length, sha(written));
console.log('items instrumented:', items.length);
