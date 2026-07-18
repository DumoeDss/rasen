/**
 * Shared project-switcher state (design.md D6): the header's switcher and the
 * config page both read/react to "which project is selected" — a tiny
 * pub-sub store avoids threading it through props for what's still a
 * single-page shell.
 */
import * as client from '../api/client.js';
import type { ProjectRef } from '../api/types.js';

export interface ProjectStoreState {
  loaded: boolean;
  launchProject: ProjectRef | null;
  selected: ProjectRef | null;
  projects: ProjectRef[];
}

let state: ProjectStoreState = {
  loaded: false,
  launchProject: null,
  selected: null,
  projects: [],
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getProjectState(): ProjectStoreState {
  return state;
}

export function subscribeProjectState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads the launch project (health) and the registered projects list; selects the launch project by default. */
export async function initProjectStore(): Promise<void> {
  const [health, projectsResponse] = await Promise.all([client.health(), client.listProjects()]);
  state = {
    loaded: true,
    launchProject: health.project,
    selected: health.project,
    projects: projectsResponse.projects,
  };
  notify();
}

export function selectProject(project: ProjectRef | null): void {
  state = { ...state, selected: project };
  notify();
}

/** Test-only reset. */
export function resetProjectStoreForTest(): void {
  state = { loaded: false, launchProject: null, selected: null, projects: [] };
  listeners.clear();
}
