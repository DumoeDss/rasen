# config-ui-package Delta Specification

> Stacked delta: the first REMOVED requirement below is the ADDED text of the pending `ui-config-redesign-config-page` (W2) change's delta to this spec — W2 must archive before this change. The second REMOVED requirement is current main-spec text W2 deliberately left standing.

## REMOVED Requirements

### Requirement: The configuration page is organized into scope-filtered tabs

**Reason**: The interim Workflow tab this requirement carries was explicitly a staging area "until the pipeline surface takes them over" — this change is that pipeline surface. The Workflow and Autopilot groups (and the Pipelines group's family entries) leave the Config page for the Pipelines page. Replaced by "The configuration page is organized into four scope-filtered tabs".
**Migration**: The four final tabs, the empty-tab rule, the human labels, and the trailing bucket carry over verbatim; the Workflow-tab clause and its per-role control mandates move to the pipelines-ui capability's Defaults-table requirement.

### Requirement: The Autopilot group shows a read-only gates inventory

**Reason**: Superseded by the Pipelines page — the gates inventory's read-only listing (including its always-pausing vet marking) is replaced by the pipelines-ui capability's per-stage effective-gate display, which is editable rather than display-only.
**Migration**: The inventory's information survives richer on the Pipelines page: per-stage effective gates with sources from the pipelines endpoint; the `'vet'` distinguishability contract lives in `pipeline-http-api`. No Config-page element replaces the panel.

## ADDED Requirements

### Requirement: The configuration page is organized into four scope-filtered tabs

The configuration page SHALL present its keys in exactly four tabs mapped from the registry's group metadata: General (Profile, Appearance, and Behavior groups), Project (Project and Archive groups), Privacy (Telemetry group), and Advanced (the Advanced group). The Workflow, Autopilot, and Pipelines groups SHALL NOT render on the configuration page — their keys and family entries belong to the Pipelines page. A tab none of whose keys are visible in the active scope mode SHALL not be shown; a key whose group maps to no tab and is not claimed by another surface SHALL still be reachable in a trailing bucket rather than hidden. Each entry SHALL title on a human-readable label with its dot-path key as secondary text.

#### Scenario: Four tabs, pipeline-surface groups absent

- **WHEN** the configuration page loads
- **THEN** it offers at most General, Project, Privacy, and Advanced tabs, and no key of the Workflow, Autopilot, or Pipelines groups renders anywhere on the page

#### Scenario: Empty tab is absent

- **WHEN** the active mode leaves a tab with no visible keys
- **THEN** that tab is not offered until the mode changes

#### Scenario: Unclaimed unmapped group stays reachable

- **WHEN** an entry's group matches no tab mapping and no other surface claims it
- **THEN** the entry still renders in a trailing bucket rather than disappearing
