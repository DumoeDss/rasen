# Handover to `fix-store-retention-scope-resolution` (sibling A)

`rasen store upgrade-identity` **previews one permanent identity and applies a
different one**. Found by the layout-migration rehearsal; not fixed here because
the minting lives in `src/core/store/identity.ts`, which is sibling A's seam.

## Why it matters

The preview exists so an operator can see what a mutation will do before doing
it, and a permanent Store identity is the one value in that preview that
everything else keys off: the machine registry re-keys by it, membership records
bind to it, and the layout-migration coordination root is addressed by it
(`<globalDataDir>/store-layout-migration/<storeUid>/<refSlug>/`). An operator who
records the previewed uuid — into a runbook, a ticket, a commit message, another
machine's registry — records a value that never existed anywhere.

## Reproduction (verbatim, real CLI, redirected machine home)

A store with committed metadata `version: 1, id: rasen-store` and no uid — the
shape a teammate gets when cloning a v1 store, and the shape the real
`rasen-store`'s committed metadata is today.

```
$ rasen store upgrade-identity rasen-store
Store identity plan (preview, nothing written): rasen-store
Permanent identity: 40ff165f-37dc-4bf6-86f3-0e6ef12bd62a
  - <store>/.rasen-store/store.yaml: Record permanent identity 40ff165f-37dc-4bf6-86f3-0e6ef12bd62a in the store's own metadata.
  - the machine store registry: Re-key the machine store registry by permanent identity.

$ rasen store upgrade-identity rasen-store --apply
Store identity applied: rasen-store
Permanent identity: 7ec12a39-294f-4fcd-be0f-c68e05b19829
  - <store>/.rasen-store/store.yaml: Record permanent identity 7ec12a39-294f-4fcd-be0f-c68e05b19829 in the store's own metadata.
  - the machine store registry: Re-key the machine store registry by permanent identity.
```

Previewed `40ff165f-37dc-4bf6-86f3-0e6ef12bd62a`; applied
`7ec12a39-294f-4fcd-be0f-c68e05b19829`. The preview appears to mint a fresh
candidate rather than deriving (or reserving) the identity `--apply` will use.

## Evidence

- `rasen/changes/rehearse-legacy-store-layout-migration/evidence/rehearsal/03-clone/02-upgrade-identity-preview.txt`
- `rasen/changes/rehearse-legacy-store-layout-migration/evidence/rehearsal/03-clone/03-upgrade-identity-apply.txt`

Both captured with a CLI built from `git archive HEAD` at commit `9f9f68cf`
(dev/0.2.0), so the behavior is the committed tree's, not any in-flight work.
The harness that reproduces it is `evidence/rehearsal/harness.sh`; the store is a
disposable `git clone` of a real legacy flat store, registered under a redirected
`RASEN_HOME`.

## What this change did NOT do

Nothing in `src/core/store/identity.ts` was read for behavior or edited. The
rehearsal only ran the command and recorded both outputs.
