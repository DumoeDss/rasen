import { useEffect } from 'preact/hooks';
import { useProjectState } from '../store/use-project-state.js';
import { initProjectStore, selectProject } from '../store/project-store.js';

/**
 * Header project switcher (design.md D6): lists registered projects, defaults
 * to the server's launch project, and re-selection re-fetches the config view
 * for that project (ConfigPage reacts to the shared store's `selected`).
 */
export function ProjectSwitcher() {
  const state = useProjectState();

  useEffect(() => {
    if (!state.loaded) initProjectStore();
  }, [state.loaded]);

  if (!state.loaded) {
    return <div class="project-switcher project-switcher--loading">Loading projects…</div>;
  }

  const onChange = (event: Event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '') {
      selectProject(null);
      return;
    }
    const project = state.projects.find((p) => p.projectId === value) ?? null;
    selectProject(project);
  };

  return (
    <div class="project-switcher">
      <label>
        Project
        <select value={state.selected?.projectId ?? ''} onChange={onChange}>
          <option value="">No project (global only)</option>
          {state.projects.map((project) => (
            <option key={project.projectId} value={project.projectId}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
