## Why

Project spaces currently have no Management API operation that can establish their non-destructive membership in an existing Store, so the UI cannot onboard a standalone project into the Store-owned Issue workflow. Exposing the existing idempotent `store add-project` behavior closes that gap without creating project-local Issue state or changing where the project plans.

## What Changes

- Extend the authenticated `POST /api/v1/spaces` operation union with an explicit Project-to-Store membership operation addressed by both project and Store identifiers.
- Execute the operation through the existing bounded, shell-free CLI bridge and the existing `store add-project` mutation; never infer `--set-primary` and never invoke `store adopt`.
- Return the freshly re-read target Store catalog entry after success, including idempotent replays, so clients can observe the established membership and navigate to the canonical Store surface.
- Add the mirrored UI API types and client call needed by the subsequent onboarding UI change; this change does not add or alter UI screens.
- Preserve existing CLI failures in the standard Management API error envelope and reject invalid, missing, cross-operation, or unresolved identifiers before mutation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `space-creation`: Expand the existing CLI-backed space lifecycle bridge with explicit, idempotent Project-to-Store membership establishment and fresh catalog observation.
- `management-http-api`: Admit the new membership operation under the existing authenticated `/api/v1/spaces` POST route and its bounded mutation posture.

## Impact

- Management server: `src/core/management-api/create-space.ts`, `router.ts`, `wire-types.ts`, and the bounded CLI whitelist.
- UI API boundary only: `packages/ui/src/api/types.ts` and `packages/ui/src/api/client.ts`.
- Tests: create-space bridge validation/argv/timeout/catalog behavior, management route admission and error envelopes, wire mirrors, and UI client request shape.
- No new dependency, Issue storage model, planning binding, adoption flow, or project Board behavior.
