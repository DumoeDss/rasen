# Planning context — project Issue onboarding

## User intent

The user observed that Rasen 0.2.0 exposes Store-owned Issues only under Store
spaces, while a standalone project has no UI path to create a Store, add the
current project to it, and enter the Issue Board. They requested an end-to-end
implementation through `rasen-auto auto-decompose`, developed in an isolated
worktree and branch, delivered as one PR, merged only after CI is green.

## Product decision

- Keep the canonical Issue record, Execution Plan, acceptance, and write
  authority Store-owned.
- Make Issue onboarding discoverable from a project space.
- Do not create a second project-local Issue truth.
- Treat "join a Store to use Issues" as the normal non-destructive flow.
- Keep `store adopt` (moving planning content into a Store) separate and out of
  this onboarding; it is a materially riskier migration.
- A project with no membership may create a Store or select an existing Store,
  add itself through the existing idempotent `store add-project` semantics,
  refresh the space catalog, and navigate to the canonical Store Issue Board.
- Multiple Store memberships must remain explicit; never guess from list order.

## Existing code facts

- `CreateSpaceDialog` and `POST /api/v1/spaces` currently support only
  `create-project`, `create-store`, and `register-store`.
- The CLI already provides the non-destructive, idempotent
  `store add-project <project-path> --to <store-id>` operation.
- `store add-project` does not change the project's planning Store unless the
  caller explicitly opts in; this onboarding must not silently bind or adopt.
- `/p/:projectId/board` is the project Change surface; the canonical Issue home
  remains `/s/:storeId/issues`.
- The project worktree was created from `origin/dev/0.2.0` at `bd4d2055` on
  branch `feat/project-issue-onboarding`; the original worktree is dirty and
  must remain untouched.

## Decomposition

1. `project-store-membership-api` adds the bounded Management API bridge and
   wire/client contract for adding an existing project to an existing Store.
2. `project-issue-onboarding-ui` consumes that contract to add the Project
   Issues entry and onboarding flow. It depends on the API child and therefore
   runs strictly after that child is implementation-complete and review-clean.

The two children deliver through one parent PR. Child ship stages are local
only; no partial portfolio may be pushed.

## Verification expectations

- Backend tests prove validation, bounded argv/shell-false execution,
  idempotent result handling, exact project/Store selection, failure passthrough,
  and fresh catalog re-read.
- UI tests prove zero-membership, one-membership, and multiple-membership
  behavior; Store creation/selection; exact current-project membership; error
  and retry states; and navigation to the canonical Store Issue route.
- Existing project Board, Store Issue Board, space creation, and route matrices
  remain covered.
- Root build/typecheck and focused backend/UI suites pass before delivery.
