// The scope root for the daemon-lifetime production oracle.
//
// It records that it is live, forks descendants that resist ordinary termination, and then - only
// if it is still alive after the escape window - records that it outlived the teardown. Absence of
// the escape markers is therefore meaningful only because the live markers are required first.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const markers = process.env.RPA_DL_MARKERS;
if (!markers) throw new Error('Missing RPA_DL_MARKERS.');
const escapeSeconds = Number(process.env.RPA_DL_ESCAPE_SECONDS ?? '6');
const at = (name) => path.join(markers, name);

// `detached` puts the child in a new session via setsid(2), so no process-group-directed signal
// reaches it. The inner backgrounded shell in the second case is orphaned the moment its parent
// exits, which is the double-fork shape.
const resist = (live, escaped, doubleFork) => {
  const body = `touch ${JSON.stringify(at(live))}; sleep ${escapeSeconds}; ` +
    `touch ${JSON.stringify(at(escaped))}`;
  const child = spawn('/bin/sh', ['-c', doubleFork ? `( ${body} ) &` : body], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
};

resist('live-setsid', 'escaped-setsid', false);
resist('live-doublefork', 'escaped-doublefork', true);

fs.writeFileSync(at('live-root'), 'live');
setTimeout(() => {
  fs.writeFileSync(at('escaped-root'), 'escaped');
  // Recorded separately from the escape markers: this is the only signal that the workload was
  // allowed to finish normally, which the "normal operation is unaffected" case requires.
  fs.writeFileSync(at('root-completed'), 'completed');
}, escapeSeconds * 1_000);
