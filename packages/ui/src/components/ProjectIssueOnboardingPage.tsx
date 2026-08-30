import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import * as client from '../api/client.js';
import { ApiError } from '../api/client.js';
import type { CreateSpaceResponse, StoreSpaceEntry } from '../api/types.js';
import { useT } from '../i18n/store.js';
import {
  publishSpace,
  refreshSpaceCatalog,
  useSpaceCatalog,
} from '../store/space-catalog.js';
import { parseSpacePath, spaceHref, type Space } from '../store/use-space.js';
import { CreateSpaceDialog } from './CreateSpaceDialog.js';
import { PageHeader } from './ui/PageHeader.js';

function storeSpace(store: StoreSpaceEntry): Space {
  return { type: 'store', id: store.id, selector: `store:${store.id}` };
}

/**
 * Project identity equality mirrors the Store membership authority: trim and
 * lowercase only Project ids. Route tokens and Store ids remain opaque and are
 * passed to navigation and mutations exactly as received.
 */
function sameProjectIdentity(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/**
 * Transitional Project-owned route. It resolves Store membership only; Issue
 * Board and Detail components are deliberately absent from this module.
 */
export function ProjectIssueOnboardingPage() {
  const { path } = useLocation();
  const project = parseSpacePath(path);
  if (project?.type !== 'project') return null;
  return <ProjectIssueOnboardingProject key={project.selector} project={project} />;
}

function ProjectIssueOnboardingProject({ project }: { project: Space }) {
  const t = useT();
  const { route } = useLocation();
  const {
    spaces,
    loading: catalogLoading,
    error: observedCatalogError,
  } = useSpaceCatalog();
  const [catalogSettled, setCatalogSettled] = useState(false);
  const [completedCatalogAttempt, setCompletedCatalogAttempt] = useState<number | null>(null);
  const [catalogFailure, setCatalogFailure] = useState<{ message: string; fix?: string } | null>(null);
  const [selectedStore, setSelectedStore] = useState<StoreSpaceEntry | null>(null);
  const [createdStore, setCreatedStore] = useState<StoreSpaceEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const catalogAttemptRef = useRef(0);
  const membershipAttemptRef = useRef(0);
  const membershipInFlightRef = useRef(false);

  function beginCatalogRefresh(): void {
    const attempt = ++catalogAttemptRef.current;
    setCatalogSettled(false);
    setCatalogFailure(null);
    setCompletedCatalogAttempt(null);
    void refreshSpaceCatalog().then(() => {
      if (!mountedRef.current || attempt !== catalogAttemptRef.current) return;
      setCompletedCatalogAttempt(attempt);
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    beginCatalogRefresh();
    return () => {
      mountedRef.current = false;
      catalogAttemptRef.current += 1;
      membershipAttemptRef.current += 1;
      membershipInFlightRef.current = false;
    };
  }, []);

  // Latch only the result of this page's owned entry/retry refresh. A later
  // best-effort refresh (for example after Store creation) must not erase an
  // already-established onboarding decision or hide a recoverable join retry.
  useEffect(() => {
    if (
      completedCatalogAttempt === null ||
      completedCatalogAttempt !== catalogAttemptRef.current ||
      catalogLoading
    ) {
      return;
    }
    setCatalogFailure(observedCatalogError);
    setCatalogSettled(true);
    setCompletedCatalogAttempt(null);
  }, [catalogLoading, completedCatalogAttempt, observedCatalogError]);

  // Membership and Store candidates are always derived directly from the
  // current shared projection. No index, Map, preferred Store, or cache exists.
  const stores = (spaces ?? []).filter(
    (space): space is StoreSpaceEntry => space.type === 'store'
  );
  const memberships = stores.filter((store) =>
    store.members.some((member) => sameProjectIdentity(member.projectId, project.id))
  );
  const catalogReady = catalogSettled && !catalogFailure;
  const soleMembershipId = catalogReady && memberships.length === 1
    ? memberships[0]!.id
    : null;

  useEffect(() => {
    if (!soleMembershipId || !mountedRef.current) return;
    route(spaceHref({ type: 'store', id: soleMembershipId, selector: `store:${soleMembershipId}` }, 'issues'), true);
  }, [soleMembershipId]);

  async function joinStore(store: StoreSpaceEntry, followsCreation = false): Promise<void> {
    if (membershipInFlightRef.current) return;
    membershipInFlightRef.current = true;
    const attempt = ++membershipAttemptRef.current;
    setSelectedStore(store);
    setJoining(true);
    setJoinError(null);
    try {
      const result = await client.addProjectToStore(project.id, store.id);
      if (!mountedRef.current || attempt !== membershipAttemptRef.current) return;
      publishSpace(result.space);
      void refreshSpaceCatalog();
      route(spaceHref(storeSpace(result.space), 'issues'), true);
    } catch (caught) {
      if (!mountedRef.current || attempt !== membershipAttemptRef.current) return;
      membershipInFlightRef.current = false;
      setJoining(false);
      setJoinError(errorMessage(caught, 'issues.onboarding.join_error'));
      if (followsCreation) setCreatedStore(store);
    }
  }

  function handleCreated(result: CreateSpaceResponse): void {
    if (!mountedRef.current) return;
    if (result.space.type !== 'store') {
      setCreating(false);
      setJoinError('issues.onboarding.create_result_error');
      return;
    }
    setCreating(false);
    setCreatedStore(result.space);
    setSelectedStore(result.space);
    void joinStore(result.space, true);
  }

  const selectedName = selectedStore?.name ?? t('issues.onboarding.store_unselected');

  return (
    <div class="project-issues-onboarding" data-testid="project-issues-onboarding">
      <PageHeader title={t('issues.onboarding.title')} />
      <p class="project-issues-onboarding__intro">
        {t('issues.onboarding.intro', { project: project.id })}
      </p>

      <ol
        class="project-issues-onboarding__topology"
        aria-label={t('issues.onboarding.topology_aria')}
        data-testid="issues-topology"
      >
        <li class="project-issues-onboarding__topology-node">
          <span class="project-issues-onboarding__topology-kind">
            {t('issues.onboarding.project_label')}
          </span>
          <strong>{project.id}</strong>
        </li>
        <li class="project-issues-onboarding__topology-segment">
          <span class="project-issues-onboarding__relationship">
            {t('issues.onboarding.membership_relationship')}
            <span aria-hidden="true"> →</span>
          </span>
          <div class="project-issues-onboarding__topology-node">
            <span class="project-issues-onboarding__topology-kind">
              {t('issues.onboarding.store_label')}
            </span>
            <strong>{selectedName}</strong>
          </div>
        </li>
        <li class="project-issues-onboarding__topology-segment">
          <span class="project-issues-onboarding__relationship">
            {t('issues.onboarding.canonical_relationship')}
            <span aria-hidden="true"> →</span>
          </span>
          <div class="project-issues-onboarding__topology-node">
            <span class="project-issues-onboarding__topology-kind">
              {t('issues.onboarding.destination_label')}
            </span>
            <strong>{t('nav.issues')}</strong>
          </div>
        </li>
      </ol>

      {!catalogSettled && (
        <p class="project-issues-onboarding__status" data-testid="onboarding-catalog-loading">
          {t('issues.onboarding.resolving')}
        </p>
      )}

      {catalogSettled && catalogFailure && (
        <section class="project-issues-onboarding__error" role="alert" data-testid="onboarding-catalog-error">
          <p>
            {t('issues.onboarding.catalog_error')}: {t(catalogFailure.message)}
            {catalogFailure.fix ? ` — ${catalogFailure.fix}` : ''}
          </p>
          <button type="button" onClick={beginCatalogRefresh}>
            {t('status.retry')}
          </button>
          {stores.length > 0 && (
            <ul class="project-issues-onboarding__inspection-list" aria-label={t('issues.onboarding.retained_stores')}>
              {stores.map((store) => (
                <li key={store.root}>
                  <strong>{store.name}</strong>
                  <span>{store.id}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {catalogReady && memberships.length === 1 && (
        <p class="project-issues-onboarding__status" data-testid="onboarding-single-membership">
          {t('issues.onboarding.entering_store', { store: memberships[0]!.name })}
        </p>
      )}

      {catalogReady && memberships.length > 1 && (
        <section class="project-issues-onboarding__choice" aria-labelledby="member-store-heading">
          <h3 id="member-store-heading">{t('issues.onboarding.multiple_title')}</h3>
          <p>{t('issues.onboarding.multiple_description')}</p>
          <ul class="project-issues-onboarding__store-list">
            {memberships.map((store) => (
              <li key={store.root}>
                <button
                  type="button"
                  class="project-issues-onboarding__store-action"
                  onClick={() => route(spaceHref(storeSpace(store), 'issues'), true)}
                  aria-label={t('issues.onboarding.open_store_aria', { store: store.name })}
                >
                  <span>
                    <strong>{store.name}</strong>
                    <small>{store.id}</small>
                  </span>
                  <span>{t('issues.onboarding.open_issues')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {catalogReady && memberships.length === 0 && (
        <section class="project-issues-onboarding__choice" aria-labelledby="join-store-heading">
          <h3 id="join-store-heading">{t('issues.onboarding.zero_title')}</h3>
          <p>{t('issues.onboarding.zero_description')}</p>

          {createdStore && joinError && (
            <p class="project-issues-onboarding__partial" role="status" data-testid="onboarding-partial-success">
              {t('issues.onboarding.partial_success', { store: createdStore.name })}
            </p>
          )}

          {stores.length > 0 ? (
            <fieldset class="project-issues-onboarding__store-fieldset" disabled={joining}>
              <legend>{t('issues.onboarding.choose_store')}</legend>
              <div class="project-issues-onboarding__store-list">
                {stores.map((store) => (
                  <label class="project-issues-onboarding__store-option" key={store.root}>
                    <input
                      type="radio"
                      name="onboarding-store"
                      value={store.root}
                      checked={selectedStore?.root === store.root}
                      onChange={() => {
                        setSelectedStore(store);
                        setJoinError(null);
                      }}
                    />
                    <span>
                      <strong>{store.name}</strong>
                      <small>{store.id}</small>
                      <small>{store.root}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p class="project-issues-onboarding__status">{t('issues.onboarding.no_stores')}</p>
          )}

          {joinError && (
            <p class="project-issues-onboarding__join-error" role="alert" data-testid="onboarding-join-error">
              {t(joinError)}
            </p>
          )}

          <div class="project-issues-onboarding__actions">
            {selectedStore && (
              <button
                type="button"
                class="btn--primary"
                disabled={joining}
                onClick={() => void joinStore(selectedStore, createdStore?.root === selectedStore.root)}
              >
                {joining ? t('issues.onboarding.joining') : joinError ? t('issues.onboarding.retry_join') : t('issues.onboarding.join_store')}
              </button>
            )}
            <button type="button" disabled={joining} onClick={() => setCreating(true)}>
              {t('issues.onboarding.create_store')}
            </button>
          </div>
        </section>
      )}

      {creating && (
        <CreateSpaceDialog
          fixedOperation="create-store"
          onCancel={() => setCreating(false)}
          onSuccess={handleCreated}
        />
      )}
    </div>
  );
}
