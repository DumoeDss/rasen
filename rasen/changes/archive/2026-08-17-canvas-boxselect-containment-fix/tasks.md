## 1. Fix

- [x] 1.1 In `packages/ui/src/canvas/PipelineCanvasPage.tsx`: import `SelectionMode` from `@xyflow/react` and pass `selectionMode={SelectionMode.Partial}` on the `ReactFlow` element in `CanvasFlow`, beside `selectionKeyCode="Shift"` (`:2777`) — the one-line fix per design D1; touch nothing else in the file

## 2. Tests

- [x] 2.1 In `packages/ui/test/canvas/pipeline-canvas-page.test.tsx`: add the prop-pin component test — render the editor in v2 edit mode and assert the ReactFlow mock received `selectionMode` equal to `SelectionMode.Partial` (labeled in a comment as a prop pin; the behavioral pin is the browser probe); run the full UI suite via the CI-canonical `pnpm --dir packages/ui exec vitest run`, CITE the file/test counts against the 67 files / 814 tests baseline, and fix any regressions (do not pipe the gate through `tail`)

## 3. Gates

- [x] 3.1 Real-browser repeat-probe via direct CDP on a throwaway Chrome (`--remote-debugging-port` on a FRESH port — 9333-9338 busy — plus fresh temp `--user-data-dir`, and `--window-size=1600,1000` so the flow column does not collapse): reuse the archived child-3 driver's probe function VERBATIM (same rect construction including the 10px left clip that failed 3/3 — middle pair, singleton, region triple) and assert FULL membership on all three plus the singleton selecting its node; record the transcript and driver in this change's evidence dir
- [x] 3.2 Assert `git diff <pre-fix-ship>..HEAD -- src/core/pipeline-registry/` is empty (IR frozen — use the branch's last archived child's ship commit as the base), and confirm the only source diff is the `PipelineCanvasPage.tsx` prop/import line plus the test file (scope guard per design D4)
