#!/usr/bin/env python3
"""
Seeds the ENRICHED rehearsal store (design D2 stage 2, tasks.md 2.2).

The content is AUTHORED, not real. What is real about stage 2 is the CLI, the
machine registry, the Windows host, and the store lineage (this tree is a
robocopy of the user's actual legacy flat store). Every item below exists to
hit one pre-enumerated check from design D3.

  change-alpha-recorded   E1 recorded identity             -> resolved
  change-no-evidence      no evidence in any class         -> unknown-owner
  change-non-member       E1 naming a non-member project   -> non-member-owner
  change-conflict         E2 (adoption list) vs E3 (machine association)
                                                           -> evidence-conflict
  <zh-change>             E1, but a non-kebab UTF-8 name   -> unrecordable-identity
  change-dirty            E1, tracked file modified        -> dirty-source

  2026-01-01-archive-recorded  archive.json schemaVersion 2 -> E1 resolved
  2026-01-02-archive-bare      no archive.json              -> unknown-owner
  2026-02-01-alpha-shared      archive.json P1, delta on shared-capability
  2026-02-02-beta-shared       archive.json P2, delta on shared-capability

  specs/alpha-only-capability  one provenance contributor   -> resolved
  specs/shared-capability      two contributors             -> shared-spec
  specs/<zh-spec>              direct E2 (adoption.specs)   -> resolved, UTF-8 name kept

Usage: python seed-enriched.py <store-root>
"""
import io
import json
import os
import sys

P1 = "11111111-1111-4111-8111-111111111111"   # project-alpha, member, has adoption lists
P2 = "22222222-2222-4222-8222-222222222222"   # project-beta, member, no adoption record
P3 = "33333333-3333-4333-8333-333333333333"   # NOT a member of this Store

ZH_CHANGE = '变更-中文名称'
ZH_SPEC = '中文能力'

root = sys.argv[1]


def write(rel, text):
    path = os.path.join(root, rel.replace("/", os.sep))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(text)


def change(name, project_id=None, extra_specs=()):
    write("rasen/changes/%s/proposal.md" % name,
          "## Why\n\nSeeded rehearsal content for %s.\n\n## What Changes\n\n- nothing real\n" % name)
    write("rasen/changes/%s/tasks.md" % name, "## 1. Work\n\n- [x] 1.1 seeded\n")
    if project_id is not None:
        write("rasen/changes/%s/.openspec.yaml" % name,
              "schema: spec-driven\ncreated: 2026-01-10\nidentity:\n  projectId: %s\n" % project_id)
    for capability in extra_specs:
        write("rasen/changes/%s/specs/%s/spec.md" % (name, capability),
              "# %s Delta\n\n## ADDED Requirements\n\n### Requirement: Seeded\nSeeded.\n\n#### Scenario: Seeded\n- **WHEN** seeded\n- **THEN** seeded\n" % capability)


def archive_entry(name, project_id=None, extra_specs=()):
    write("rasen/changes/archive/%s/proposal.md" % name,
          "## Why\n\nArchived rehearsal content for %s.\n" % name)
    if project_id is not None:
        write("rasen/changes/archive/%s/archive.json" % name,
              json.dumps({"schemaVersion": 2, "projectId": project_id,
                          "archivedAt": "2026-02-01T00:00:00.000Z"}, indent=2) + "\n")
    for capability in extra_specs:
        write("rasen/changes/archive/%s/specs/%s/spec.md" % (name, capability),
              "# %s Delta\n\n## MODIFIED Requirements\n\n### Requirement: Seeded\nSeeded.\n\n#### Scenario: Seeded\n- **WHEN** seeded\n- **THEN** seeded\n" % capability)


def capability(name):
    write("rasen/specs/%s/spec.md" % name,
          "# %s Specification\n\n## Purpose\n\nSeeded rehearsal capability.\n\n## Requirements\n\n### Requirement: Seeded\nSeeded.\n\n#### Scenario: Seeded\n- **WHEN** seeded\n- **THEN** seeded\n" % name)


# --- membership records (E2 source, and the member roster) -------------------
write(".rasen-store/projects/%s.yaml" % P1,
      "version: 1\n"
      "projectId: %s\n"
      "id: project-alpha\n"
      "roles:\n  planning: true\n  knowledge: true\n"
      "adoption:\n"
      "  specs:\n    - %s\n"
      "  changes:\n    - change-conflict\n"
      "  adoptedAt: '2026-01-15T00:00:00.000Z'\n" % (P1, ZH_SPEC))
write(".rasen-store/projects/%s.yaml" % P2,
      "version: 1\n"
      "projectId: %s\n"
      "id: project-beta\n"
      "roles:\n  planning: true\n  knowledge: true\n" % P2)

# --- active changes ----------------------------------------------------------
change("change-alpha-recorded", P1)
change("change-no-evidence", None)
change("change-non-member", P3)
change("change-conflict", None)
change(ZH_CHANGE, P1)
change("change-dirty", P1)

# --- archive entries ---------------------------------------------------------
archive_entry("2026-01-01-archive-recorded", P1, extra_specs=("alpha-only-capability",))
archive_entry("2026-01-02-archive-bare", None)
archive_entry("2026-02-01-alpha-shared", P1, extra_specs=("shared-capability",))
archive_entry("2026-02-02-beta-shared", P2, extra_specs=("shared-capability",))

# --- canonical specs ---------------------------------------------------------
capability("alpha-only-capability")
capability("shared-capability")
capability(ZH_SPEC)

# --- a Store-level design doc (retained by decision, not omission) -----------
write("rasen/design-docs/store-overview.md", "# Store overview\n\nSeeded.\n")

print("seeded", root)
