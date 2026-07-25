/**
 * The Store identity diagnostic vocabulary (design D13), defined once with a
 * stable code, message, and repair command, and exported so sibling changes
 * reuse rather than re-coin. Human and JSON surfaces render the SAME code,
 * message, and repair — there is exactly one factory per code, so the two
 * cannot drift.
 */
import { makeStoreDiagnostic, type StoreDiagnostic } from './errors.js';
import { redactRemote } from './remote.js';

export const STORE_IDENTITY_DIAGNOSTIC_CODES = [
  'store_bootstrap_required',
  'store_uid_mismatch',
  'store_alias_ambiguous',
  'store_pointer_legacy',
  'store_pointer_remote_divergence',
  'store_pointer_alias_drift',
  'store_metadata_legacy',
  'store_remote_credentials',
  'store_alias_numeric',
  'store_remote_divergence',
  'store_registry_rekey_blocked',
  'store_alias_repeated',
  'store_alias_renamed',
  // Membership vocabulary (project-keyed-store-membership, design D11).
  'store_project_record_missing',
  'project_membership_locator_missing',
  'project_membership_unverified',
  'shared_metadata_contains_local_path',
  'store_project_record_key_mismatch',
  'store_legacy_reference_unresolved',
  'project_identity_unrecordable',
  'store_membership_legacy_manifest',
  'store_membership_roles_inferred',
] as const;

export type StoreIdentityDiagnosticCode = (typeof STORE_IDENTITY_DIAGNOSTIC_CODES)[number];

/** A Store named by a project declaration, for message rendering. */
export interface StoreIdentityLabel {
  uid?: string;
  id?: string;
  remote?: string;
}

/** `<alias> (<uid>)`, or whichever half is known — never an empty string. */
export function describeStore(label: StoreIdentityLabel): string {
  if (label.id && label.uid) return `${label.id} (${label.uid})`;
  if (label.uid) return label.uid;
  return label.id ?? '<unnamed store>';
}

/** The command that makes a declared-but-missing Store available here. */
export function registerRepair(label: StoreIdentityLabel): string {
  return label.remote
    ? `git clone ${redactRemote(label.remote)} <path> && rasen store register <path>`
    : 'rasen store register <path>';
}

/** The command that rewrites a project declaration to name the identity. */
export function upgradePointerRepair(store: string, uid?: string): string {
  return uid
    ? `rasen store upgrade-identity ${store} --uid ${uid} --apply`
    : `rasen store upgrade-identity ${store} --apply`;
}

/**
 * The ambiguous-alias repair. It carries a `<identity>` PLACEHOLDER, never a
 * concrete uid: a name matching two Stores must not be resolved on the user's
 * behalf, and a paste-ready command carrying one candidate's uid would rebind
 * the project to whichever entry happened to sort first (spec: "SHALL NOT pick
 * one"). The candidates are enumerated in the message the fix accompanies.
 */
export function upgradeAmbiguousPointerRepair(store: string): string {
  return `rasen store upgrade-identity ${store} --uid <identity> --apply`;
}

export function storeBootstrapRequired(label: StoreIdentityLabel): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'store_bootstrap_required',
    `Store ${describeStore(label)} is declared by this project but is not registered on this machine.`,
    { target: 'store.registry', fix: registerRepair(label) }
  );
}

export function storeUidMismatch(input: {
  expected: string;
  found?: string;
  root: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'store_uid_mismatch',
    `The checkout at ${input.root} carries store identity ${input.found ?? '(none)'}, not the expected ${input.expected}. Nothing was written.`,
    {
      target: 'store.metadata',
      fix: 'Register the checkout that carries the expected identity, or update the project declaration to the identity you meant.',
    }
  );
}

export function storeAliasAmbiguous(input: {
  id: string;
  candidates: Array<{ uid?: string; id: string; root: string }>;
}): StoreDiagnostic {
  const rendered = input.candidates
    .map((candidate) => `${candidate.uid ?? '(no identity)'} — ${candidate.id} at ${candidate.root}`)
    .join('; ');

  return makeStoreDiagnostic(
    'error',
    'store_alias_ambiguous',
    `The name '${input.id}' matches ${input.candidates.length} registered stores: ${rendered}. A name is a display alias, not an identity.`,
    {
      target: 'store.pointer',
      // Every candidate is named in the message; the repair keeps the
      // `<identity>` placeholder so pasting it cannot silently bind the
      // project to an arbitrary one of them.
      fix: upgradeAmbiguousPointerRepair(input.id),
    }
  );
}

export function storePointerLegacy(input: { id: string; uid?: string }): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_pointer_legacy',
    `This project declares store '${input.id}' by name only; a name can be renamed and can be shared by two stores.`,
    { target: 'store.pointer', fix: upgradePointerRepair(input.id, input.uid) }
  );
}

export function storePointerRemoteDivergence(input: {
  declared: string;
  canonical: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_pointer_remote_divergence',
    `The declared remote (${redactRemote(input.declared)}) differs from the store's canonical remote (${redactRemote(input.canonical)}).`,
    { target: 'store.pointer' }
  );
}

export function storePointerAliasDrift(input: {
  declared: string;
  actual: string;
  uid?: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_pointer_alias_drift',
    `This project declares store name '${input.declared}', but that store's name is now '${input.actual}'. The permanent identity still matches, so it resolved.`,
    {
      target: 'store.pointer',
      fix: upgradePointerRepair(input.actual, input.uid),
    }
  );
}

export function storeMetadataLegacy(input: { id: string; metadataPath: string }): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_metadata_legacy',
    `Store '${input.id}' has no permanent identity yet (${input.metadataPath} predates them).`,
    {
      target: 'store.metadata',
      fix: `rasen store upgrade-identity ${input.id} --apply`,
    }
  );
}

export function storeRemoteCredentials(input: { remote: string }): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'store_remote_credentials',
    `The remote ${redactRemote(input.remote)} embeds a credential; store metadata never carries credentials.`,
    {
      target: 'store.metadata',
      fix: 'Record a credential-free remote and keep the credential in your Git credential helper.',
    }
  );
}

/**
 * The Store's RECORDED remote (its own metadata) and the checkout's OBSERVED
 * origin disagree. Distinct from `store_pointer_remote_divergence`, which
 * compares a PROJECT DECLARATION's locator against the Store's canonical
 * remote: this one never involves a project declaration.
 *
 * Callers compare the RAW values and pass them in raw — redaction happens here,
 * because two remotes differing only in an embedded credential redact to the
 * same string and comparing after redaction would suppress a real divergence.
 */
export function storeRemoteDivergence(input: {
  recorded: string;
  observed: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_remote_divergence',
    `The store.yaml remote (${redactRemote(input.recorded)}) differs from the checkout's origin (${redactRemote(input.observed)}).`,
    { target: 'store.metadata' }
  );
}

/**
 * The machine registry could not be re-keyed by permanent identity because
 * some Store entry has none yet (design D7). Reported by every command that
 * mutates the registry, so the user learns which entries block the re-key
 * rather than silently keeping an alias-keyed registry forever.
 */
export function storeRegistryRekeyBlocked(input: { blockedBy: string[] }): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_registry_rekey_blocked',
    `The machine store registry still identifies stores by display name: ${input.blockedBy.join(', ')} ${input.blockedBy.length === 1 ? 'has' : 'have'} no permanent identity yet.`,
    {
      target: 'store.registry',
      fix: `rasen store upgrade-identity ${input.blockedBy[0] ?? '<store>'} --apply`,
    }
  );
}

/**
 * A registration that legitimately succeeded under a name another Store
 * already uses. The registry keeps both (they carry different permanent
 * identities), so the user learns HERE that the name has become ambiguous —
 * rather than later, from an unrelated command refusing to resolve it.
 */
export function storeAliasRepeated(input: {
  id: string;
  uid: string;
  matches: number;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_alias_repeated',
    `The name '${input.id}' now matches ${input.matches} registered stores. A name is a display alias, not an identity: declarations should name this store's permanent identity ${input.uid}.`,
    {
      target: 'store.id',
      fix: `Declare it as store: { uid: ${input.uid}, id: ${input.id} }, or rename one store so the display names differ.`,
    }
  );
}

/**
 * The registry entry's display name followed the Store's own metadata, keyed
 * by the unchanged permanent identity (design D11). Re-registering after
 * editing `store.yaml`'s `id` is the ONLY rename path in Phase A, so the
 * command that performs it says so.
 */
export function storeAliasRenamed(input: {
  from: string;
  to: string;
  uid?: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_alias_renamed',
    `The registered display name changed from '${input.from}' to '${input.to}'${
      input.uid ? `; the permanent identity ${input.uid} is unchanged` : ''
    }.`,
    {
      target: 'store.id',
      fix: `Declarations that named '${input.from}' by name no longer resolve; name the permanent identity instead.`,
    }
  );
}

export function storeAliasNumeric(input: { id: string }): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_alias_numeric',
    `Store name '${input.id}' is all digits, which reads like an identity. It is a display name only — the store's permanent identity is the real one.`,
    { target: 'store.id' }
  );
}

// -----------------------------------------------------------------------------
// Membership vocabulary (project-keyed-store-membership, design D11)
// -----------------------------------------------------------------------------

/**
 * Every membership repair names its Store through a `selector` the CALLER
 * computed: the permanent identity when the display name is ambiguous on this
 * machine, the display name otherwise. A hint that fails when pasted is worse
 * than no hint, and only the caller knows the arity — the factory must never
 * guess it from the label.
 */
export interface MembershipStoreLabel extends StoreIdentityLabel {
  /** Unambiguous value to paste into a command that names this Store. */
  selector: string;
}

/**
 * The project's PRIMARY PLANNING Store has no membership record for it. An
 * error, not a warning: planning is already bound to that Store, so the roster
 * and the binding disagree about a relation that is already in force.
 * Distinct from `project_membership_unverified`, which is about a SECONDARY
 * knowledge locator whose Store simply is not present here.
 */
export function storeProjectRecordMissing(input: {
  projectId: string;
  store: MembershipStoreLabel;
  projectPath: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'store_project_record_missing',
    `Store ${describeStore(input.store)} is this project's planning store but records no membership for project ${input.projectId}.`,
    {
      target: 'store.membership',
      fix: `rasen store add-project ${input.projectPath} --to ${input.store.selector}`,
    }
  );
}

/**
 * The Store records the project, but the project declares no locator for the
 * Store. A warning: everything works HERE, and breaks on the next machine —
 * which is exactly when nobody is watching.
 */
export function projectMembershipLocatorMissing(input: {
  projectId: string;
  store: MembershipStoreLabel;
  projectPath: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'project_membership_locator_missing',
    `Store ${describeStore(input.store)} records project ${input.projectId} as a member, but the project declares no membership hint for it; a fresh clone would not discover this store.`,
    {
      target: 'project.storeMemberships',
      fix: `rasen store add-project ${input.projectPath} --to ${input.store.selector}`,
    }
  );
}

/**
 * A declared locator whose Store is not available here, so the Store's own
 * record — the authority — cannot be read. Reported as unverifiable rather
 * than as a missing membership: the answer is unknown, not "no".
 */
export function projectMembershipUnverified(input: {
  store: StoreIdentityLabel;
  repair: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'project_membership_unverified',
    `This project declares a membership hint for store ${describeStore(input.store)}, which is not available on this machine, so its membership record cannot be verified here.`,
    { target: 'project.storeMemberships', fix: input.repair }
  );
}

/**
 * Git-shared data still carries a filesystem path from the machine that wrote
 * it. The path is never acted on — this says so, and names the migration that
 * removes it.
 */
export function sharedMetadataContainsLocalPath(input: {
  filePath: string;
  detail: string;
  storeSelector: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'shared_metadata_contains_local_path',
    `${input.filePath} records a filesystem path from the machine that wrote it (${input.detail}). It is shared through git, is wrong on every other machine, and no command reads it.`,
    {
      target: 'store.metadata',
      fix: `rasen store migrate-membership ${input.storeSelector} --apply`,
    }
  );
}

/**
 * A record file's name and the identity inside it disagree. Never resolved by
 * preferring either: trusting the filename would let a renamed file reassign
 * membership, and trusting the contents would let a copied file claim a second
 * project's membership.
 */
export function storeProjectRecordKeyMismatch(input: {
  filePath: string;
  fileIdentity: string;
  recordedIdentity: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'store_project_record_key_mismatch',
    `${input.filePath} is named for project ${input.fileIdentity} but declares project ${input.recordedIdentity}. Neither is treated as authoritative.`,
    {
      target: 'store.membership',
      fix: `Rename the file to ${input.recordedIdentity}.yaml, or correct the projectId inside it — whichever matches the project you meant.`,
    }
  );
}

/**
 * A legacy `references: project:<alias>` entry that cannot be mapped to a
 * project identity here. Machine-local BY DESIGN (the alias lives in this
 * machine's project namespace), so this is the ordinary fresh-machine answer —
 * reported, never guessed into an identity.
 */
export function storeLegacyReferenceUnresolved(input: {
  alias: string;
  store: MembershipStoreLabel;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_legacy_reference_unresolved',
    `Store ${describeStore(input.store)} references project '${input.alias}' by display name, which is not registered on this machine, so it cannot be mapped to a project identity here.`,
    {
      target: 'store.references',
      fix: `Run rasen store migrate-membership ${input.store.selector} --apply on a machine where '${input.alias}' is registered, or add it here: rasen store add-project <path> --to ${input.store.selector}`,
    }
  );
}

/**
 * The project identity cannot safely name a record file. Never sanitized into
 * one: two distinct identities collapsing onto a single filename would
 * overwrite one project's membership with another's.
 */
export function projectIdentityUnrecordable(input: {
  projectId: string;
  reason: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'error',
    'project_identity_unrecordable',
    `Project identity '${input.projectId}' cannot name a membership record file: ${input.reason}. It is never altered to fit a filename.`,
    {
      target: 'project.projectId',
      fix: "Set a well-formed projectId in the project's rasen/config.yaml (a UUID, as `rasen init` mints, or a kebab-case id), then rerun.",
    }
  );
}

/** The Store still carries the pre-record adoption map; migration is pending. */
export function storeMembershipLegacyManifest(input: {
  manifestPath: string;
  storeSelector: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'warning',
    'store_membership_legacy_manifest',
    `${input.manifestPath} still holds legacy adoption data; membership has not been converted into per-project records yet.`,
    {
      target: 'store.metadata',
      fix: `rasen store migrate-membership ${input.storeSelector} --apply`,
    }
  );
}

/**
 * Roles derived from legacy data rather than declared. An adoption proves
 * PLANNING membership and proves nothing about knowledge, so the inference is
 * always narrow and always labelled — inventing knowledge membership would
 * silently widen what a later change materializes.
 */
export function storeMembershipRolesInferred(input: {
  projectId: string;
  provenance: string;
  storeSelector: string;
}): StoreDiagnostic {
  return makeStoreDiagnostic(
    'info',
    'store_membership_roles_inferred',
    `Membership roles for project ${input.projectId} were inferred from ${input.provenance}, not declared: planning membership only, because legacy data records no knowledge role.`,
    {
      target: 'store.membership',
      fix: `rasen store migrate-membership ${input.storeSelector} --apply`,
    }
  );
}
