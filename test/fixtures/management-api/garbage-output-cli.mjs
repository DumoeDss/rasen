#!/usr/bin/env node
// Exits 0 (success) but with output that is not the expected JSON shape —
// exercises submit.ts's 500 cli_protocol_error path.
process.stdout.write('not json at all');
