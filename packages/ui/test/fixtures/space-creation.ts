import type {
  AddProjectToStoreResponse,
  CreateSpaceRequest,
  CreateSpaceResponse,
} from '../../src/api/types.js';

export const addProjectToStoreRequestFixture = {
  op: 'add-project-to-store',
  projectId: 'project-123',
  storeId: 'team-store',
} satisfies CreateSpaceRequest;

export const addProjectToStoreResponseFixture = {
  operation: 'store-add-project',
  space: {
    type: 'store',
    id: 'team-store',
    name: 'Team Store',
    root: 'C:\\work\\team-store',
    members: [
      {
        projectId: 'project-123',
        name: 'Project 123',
        root: 'C:\\work\\project-123',
      },
    ],
  },
} satisfies AddProjectToStoreResponse;

// The precise membership response must remain a member of the compatibility
// union consumed by older create-space callers.
export const createSpaceMembershipResponseFixture: CreateSpaceResponse =
  addProjectToStoreResponseFixture;
