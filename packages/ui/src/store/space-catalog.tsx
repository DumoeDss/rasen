import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { SpaceEntry } from '../api/types.js';

export interface SpaceCatalogState {
  spaces: SpaceEntry[] | null;
  loading: boolean;
  error: { message: string; fix?: string } | null;
}

let state: SpaceCatalogState = {
  spaces: null,
  loading: false,
  error: null,
};
let requestGeneration = 0;
let mutationEpoch = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: SpaceCatalogState): void {
  state = next;
  for (const listener of listeners) listener();
}

function rowKey(space: SpaceEntry): string {
  return `${space.type}\u0000${space.root}`;
}

export function publishSpace(space: SpaceEntry): void {
  mutationEpoch += 1;
  const spaces = state.spaces ? [...state.spaces] : [];
  const key = rowKey(space);
  const index = spaces.findIndex((candidate) => rowKey(candidate) === key);
  if (index === -1) spaces.push(space);
  else spaces[index] = space;
  emit({ spaces, loading: state.loading, error: null });
}

export async function refreshSpaceCatalog(): Promise<void> {
  const generation = ++requestGeneration;
  const epochAtStart = mutationEpoch;
  emit({ ...state, loading: true, error: null });
  const request = client
    .listSpaces()
    .then((response) => {
      if (generation !== requestGeneration || epochAtStart !== mutationEpoch) return;
      emit({ spaces: response.spaces, loading: false, error: null });
    })
    .catch((caught) => {
      if (generation !== requestGeneration) return;
      const error =
        caught instanceof ApiError
          ? { message: caught.message, ...(caught.fix ? { fix: caught.fix } : {}) }
          : { message: 'status.error.spaces_load' };
      // Keep any published/listed entries on failure.
      emit({ spaces: state.spaces, loading: false, error });
    })
    .finally(() => {
      if (inFlight === request) inFlight = null;
    });
  inFlight = request;
  await request;
}

export function ensureSpaceCatalog(): Promise<void> {
  if (state.spaces !== null) return Promise.resolve();
  if (inFlight) return inFlight;
  return refreshSpaceCatalog();
}

export function useSpaceCatalog(): SpaceCatalogState & {
  refresh: () => Promise<void>;
  publish: (space: SpaceEntry) => void;
} {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render((value) => value + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return {
    ...state,
    refresh: refreshSpaceCatalog,
    publish: publishSpace,
  };
}

/** App-level owner for the shared catalog. Direct component tests can still use the same store hook. */
export function SpaceCatalogProvider({
  children,
}: {
  children: ComponentChildren;
}) {
  useEffect(() => {
    void ensureSpaceCatalog();
  }, []);
  return <>{children}</>;
}

/** Test seam for deterministic catalog generations and cross-test isolation. */
export function resetSpaceCatalogForTests(): void {
  requestGeneration += 1;
  mutationEpoch = 0;
  inFlight = null;
  emit({ spaces: null, loading: false, error: null });
}
