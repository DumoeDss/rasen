#!/usr/bin/env node
// Ignores SIGTERM to simulate a hung CLI subprocess that survives the
// server's first-line termination attempt — only SIGKILL (uncatchable) can
// end it. Used by submit.ts's timeout-escalation regression test (review
// M1): proves the server actually escalates to SIGKILL and only releases
// its concurrency slot once the child is confirmed gone, not at 504-response
// time.
process.on('SIGTERM', () => {
  // Deliberately do nothing — pretend to keep working.
});
setInterval(() => {}, 1000);
