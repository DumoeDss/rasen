/**
 * Pre-flight guard for the rehearsal harness (tasks.md 1.4).
 *
 * Reads `rasen store list --json` on stdin and exits non-zero unless EVERY
 * registered entry resolves to a path inside the disposable temp root. The
 * disposable copies carry the SAME uid as the user's real store, so a stage
 * that ran against the real machine registry would target the real store.
 * argv[2] = the temp root that every registered path must live under.
 */
const BACKSLASH = String.fromCharCode(92);
const norm = (value) => String(value).split(BACKSLASH).join('/').toLowerCase();

const wantRaw = process.argv[2];
const want = norm(wantRaw);
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    console.log('PREFLIGHT-FAIL: unparseable store list output');
    process.exit(2);
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed.stores ?? []);
  if (rows.length === 0) {
    console.log('PREFLIGHT-FAIL: redirected registry is empty (nothing registered)');
    process.exit(2);
  }
  const bad = [];
  for (const row of rows) {
    if (!norm(row.root ?? row.path ?? '').startsWith(want)) {
      bad.push((row.id ?? '?') + ' -> ' + (row.root ?? '(no root)'));
    }
  }
  if (bad.length > 0) {
    console.log('PREFLIGHT-FAIL: entries resolve OUTSIDE the temp root:');
    for (const line of bad) console.log('  ' + line);
    console.log('STOP. Do not unregister anything. Redirection failed.');
    process.exit(2);
  }
  console.log('PREFLIGHT-OK: ' + rows.length + ' registered entr(ies), all inside ' + wantRaw);
  for (const row of rows) {
    console.log('  ' + row.id + (row.uid ? ' [uid ' + row.uid + ']' : ' [no uid recorded]') + ' -> ' + row.root);
  }
  process.exit(0);
});
