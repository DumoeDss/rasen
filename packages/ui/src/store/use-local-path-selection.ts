import { useRef, useState } from 'preact/hooks';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type {
  LocalPathSelectionKind,
  LocalPathsResponse,
} from '../api/types.js';

export type LocalPathSelectionStatus =
  | 'empty'
  | 'dirty'
  | 'resolving'
  | 'resolved'
  | 'invalid';

export interface LocalPathSelectionController {
  value: string;
  status: LocalPathSelectionStatus;
  separator: string;
  resolvedKind: 'directory' | 'file' | null;
  listing: LocalPathsResponse | null;
  error: string | null;
  nativeStatus: 'idle' | 'cancelled' | 'unavailable';
  setValue(value: string): void;
  browse(path?: string): Promise<string | null>;
  resolveVisible(): Promise<string | null>;
  resolveForSubmit(): Promise<string | null>;
  selectFile(path: string): Promise<string | null>;
  chooseNative(kind: 'directory' | 'file'): Promise<string | null>;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function useLocalPathSelection(
  kind: LocalPathSelectionKind
): LocalPathSelectionController {
  const [value, setVisibleValue] = useState('');
  const [status, setStatus] = useState<LocalPathSelectionStatus>('empty');
  const [separator, setSeparator] = useState('/');
  const [resolvedKind, setResolvedKind] = useState<'directory' | 'file' | null>(null);
  const [listing, setListing] = useState<LocalPathsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nativeStatus, setNativeStatus] =
    useState<'idle' | 'cancelled' | 'unavailable'>('idle');
  const resolvedPath = useRef<string | null>(null);
  const requestGeneration = useRef(0);

  function commit(
    path: string,
    nextSeparator: string,
    nextKind: 'directory' | 'file'
  ): string {
    resolvedPath.current = path;
    setVisibleValue(path);
    setSeparator(nextSeparator);
    setResolvedKind(nextKind);
    setStatus('resolved');
    setError(null);
    return path;
  }

  function setValue(nextValue: string) {
    requestGeneration.current += 1;
    resolvedPath.current = null;
    setResolvedKind(null);
    setVisibleValue(nextValue);
    setStatus(nextValue.length === 0 ? 'empty' : 'dirty');
    setError(null);
    setNativeStatus('idle');
  }

  async function browse(path?: string): Promise<string | null> {
    const generation = ++requestGeneration.current;
    setStatus('resolving');
    setError(null);
    try {
      const response = await client.listLocalPaths(path);
      if (generation !== requestGeneration.current) return null;
      setListing(response);
      if (kind === 'file') {
        resolvedPath.current = null;
        setVisibleValue(response.path);
        setSeparator(response.separator);
        setResolvedKind(null);
        setStatus('dirty');
        return response.path;
      }
      return commit(response.path, response.separator, 'directory');
    } catch (caught) {
      if (generation !== requestGeneration.current) return null;
      resolvedPath.current = null;
      setResolvedKind(null);
      setStatus(value.length === 0 ? 'empty' : 'invalid');
      setError(messageOf(caught, 'Failed to read that directory.'));
      return null;
    }
  }

  async function resolveCandidate(candidate: string): Promise<string | null> {
    if (candidate.length === 0) {
      resolvedPath.current = null;
      setStatus('invalid');
      setError('Choose or type an absolute server-local path.');
      return null;
    }
    const generation = ++requestGeneration.current;
    setStatus('resolving');
    setError(null);
    try {
      const response = await client.resolveLocalPath(candidate, kind);
      if (generation !== requestGeneration.current) return null;
      return commit(response.path, response.separator, response.kind);
    } catch (caught) {
      if (generation !== requestGeneration.current) return null;
      resolvedPath.current = null;
      setResolvedKind(null);
      setStatus('invalid');
      setError(messageOf(caught, 'Failed to resolve that path.'));
      return null;
    }
  }

  function resolveVisible(): Promise<string | null> {
    return resolveCandidate(value);
  }

  function resolveForSubmit(): Promise<string | null> {
    if (status === 'resolved' && resolvedPath.current === value) {
      return Promise.resolve(value);
    }
    return resolveCandidate(value);
  }

  function selectFile(path: string): Promise<string | null> {
    return resolveCandidate(path);
  }

  async function chooseNative(
    chooserKind: 'directory' | 'file'
  ): Promise<string | null> {
    setError(null);
    setNativeStatus('idle');
    try {
      const response = await client.chooseLocalPath({
        kind: chooserKind,
        ...(listing ? { initialDirectory: listing.path } : {}),
        ...(chooserKind === 'file' ? { filter: 'rasen-package' as const } : {}),
      });
      if (response.status === 'cancelled') {
        setNativeStatus('cancelled');
        return null;
      }
      if (response.status === 'unavailable') {
        setNativeStatus('unavailable');
        return null;
      }
      requestGeneration.current += 1;
      setNativeStatus('idle');
      return commit(response.path, response.separator, response.kind);
    } catch (caught) {
      setNativeStatus('unavailable');
      setError(messageOf(caught, 'Native choice is unavailable; use the browser below.'));
      return null;
    }
  }

  return {
    value,
    status,
    separator,
    resolvedKind,
    listing,
    error,
    nativeStatus,
    setValue,
    browse,
    resolveVisible,
    resolveForSubmit,
    selectFile,
    chooseNative,
  };
}
