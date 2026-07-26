## Why

A Store's knowledge is shared the moment someone clones the Store — it lives in Git. A project's own learned knowledge is not: it lives on the machine that learned it, and a second machine that clones the same project starts empty.

The explicit export route now produces a portable bundle, but a user still needs a deliberate way to carry that file through a Store without making the Store an owner or changing any state the Store owns.

## What Changes

- **A Store may carry the file without owning the knowledge.** `rasen knowledge bundle export --to <path> --to-store <store>` additionally places the same bundle into a Store repository as a file, at a location reserved for transported bundles.
- **Transport changes no Store-owned state.** The Store's catalog, its project records, and its metadata remain unchanged; transport does not make the project a Store member.
- **Rasen performs no Git publication.** Nothing is staged, committed, or pushed, and the command prints the file the user needs to commit.
- **Unavailable Stores fail closed.** The placement reports the exact reason and a copy-pasteable repair and writes nothing to that Store.
- **Each placement is durable and cross-platform.** The derived location includes the bundle identity, never replaces an earlier transported bundle, and resolves consistently across platform path forms.

Out of scope: bundle import and conflict handling, ownership rules on the import side, machine-preparation integration, and every Phase E behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `portable-project-knowledge`: add the Store-as-transport contract as one new requirement; no existing requirement is modified.

## Impact

- **Commands:** the existing `rasen knowledge bundle export` command gains optional `--to-store <store>` while `--to <path>` remains required.
- **Store repositories:** a successful placement adds exactly one untracked bundle file at a derived transport location; Store-owned files and Git index/history remain unchanged.
- **Code:** the landed F1 exporter and command surface, the tri-state Store resolver, transport-specific messages, and completion metadata.
- **Tests and documentation:** transport invariants, unavailable-Store behavior, repeated placement, Windows path identity, CLI docs, migration guidance, release notes, and all three CLI locales.
- **Compatibility:** additive. Exports without `--to-store` retain their existing behavior.
