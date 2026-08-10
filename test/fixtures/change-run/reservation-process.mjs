const reservations = await import(process.env.RASEN_RESERVATION_MODULE);
const stores = await import(process.env.RASEN_RUN_STORE_MODULE);

const storeRoot = process.env.RASEN_RESERVATION_STORE_ROOT;
const workspaceInstanceId = process.env.RASEN_RESERVATION_WORKSPACE;
if (!storeRoot || !workspaceInstanceId) {
  throw new Error('reservation process fixture requires store and workspace inputs');
}

const store = stores.createFilesystemRunStore(storeRoot);
const registry = reservations.createFilesystemWorkspaceReservationRegistry({
  storeRoot,
  loadRecords: () => store.list().map((summary) => store.load(summary.runId)),
});
const snapshot = registry.snapshot(workspaceInstanceId);
const secondRun = `run:${'f'.repeat(64)}`;
const readerConflict = registry.reserve({
  workspaceInstanceId,
  runId: secondRun,
  actionId: `action:${'e'.repeat(64)}`,
  attemptId: `attempt:${'d'.repeat(64)}`,
  access: 'read',
  recordDigest: `sha256:${'c'.repeat(64)}`,
  recordVersion: 0,
  state: 'pending',
});
const writerConflict = registry.reserve({
  workspaceInstanceId,
  runId: secondRun,
  actionId: `action:${'b'.repeat(64)}`,
  attemptId: `attempt:${'a'.repeat(64)}`,
  access: 'write',
  recordDigest: `sha256:${'9'.repeat(64)}`,
  recordVersion: 0,
  state: 'pending',
});

process.stdout.write(JSON.stringify({
  count: snapshot.length,
  sponsored: snapshot.filter((entry) => entry.consultationSponsor !== undefined).length,
  readerConflict: readerConflict?.code,
  writerConflict: writerConflict?.code,
}));
