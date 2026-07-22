import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import * as client from '../api/client.js';
import type { ProjectSpaceEntry, SpaceEntry, StoreSpaceEntry } from '../api/types.js';
import { parseSelector, parseSpacePath, spaceHref, spaceSection } from '../store/use-space.js';

/**
 * Dual-namespace space switcher (management-ui-shell design D3): one
 * `GET /api/v1/spaces` fetch, rendered as two type-tagged groups — Projects
 * and Stores — with the current route's space selected. Selecting a space's
 * only effect is navigation (the red line): it routes to that space's route
 * for the current section, re-scoping the view. There is no "no space" /
 * global-only option; an empty spaces listing shows a hint, not a dead
 * control. Store `members` are ignored here (member chips are child 3).
 */
export function SpaceSwitcher() {
  const { path, route } = useLocation();
  const space = parseSpacePath(path);
  const section = spaceSection(path);

  const [spaces, setSpaces] = useState<SpaceEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .listSpaces()
      .then((res) => {
        if (!cancelled) setSpaces(res.spaces);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (spaces === null && !failed) {
    return <div class="space-switcher space-switcher--loading">Loading spaces…</div>;
  }

  if (failed || (spaces && spaces.length === 0)) {
    return (
      <div class="space-switcher space-switcher--empty" data-testid="space-switcher-empty">
        No spaces — run <code>rasen ui</code> inside a Rasen project.
      </div>
    );
  }

  const projects = spaces!.filter((s): s is ProjectSpaceEntry => s.type === 'project');
  const stores = spaces!.filter((s): s is StoreSpaceEntry => s.type === 'store');

  function onChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    const selected = parseSelector(value);
    if (selected) route(spaceHref(selected, section));
  }

  return (
    <div class="space-switcher">
      <label>
        Space
        <select value={space?.selector ?? ''} onChange={onChange} data-testid="space-switcher-select">
          {!space && (
            <option value="" disabled>
              Select a space…
            </option>
          )}
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={`project:${p.id}`} value={`project:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          {stores.length > 0 && (
            <optgroup label="Stores">
              {stores.map((s) => (
                <option key={`store:${s.id}`} value={`store:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </div>
  );
}
