import { useEffect, useState } from 'preact/hooks';
import { getProjectState, subscribeProjectState, type ProjectStoreState } from './project-store.js';

/** Subscribes a component to the shared project store. */
export function useProjectState(): ProjectStoreState {
  const [state, setState] = useState(getProjectState());
  useEffect(() => subscribeProjectState(() => setState(getProjectState())), []);
  return state;
}
