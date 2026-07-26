# Planning context — knowledge-bundle-export (Phase F, child F1)

Seeded by the LEAD before propose. Read this first, then research only what is
needed to verify the landed code surface. The design and scope are locked; do
not re-derive them.

## User intent

Create and complete change `knowledge-bundle-export`, the first child of Phase
F, from commit `968482cf` in the isolated worktree
`E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code-wt-knowledge-bundle-export`.
The shared main worktree is dirty and belongs to another session; do not edit
or stage anything there.

## Authoritative sources

Read these in full and preserve the original wording wherever it belongs to F1:

1. `C:\Users\Sayo\.rasen\projects\autonomy-ladder-1e42477e\changes\store-context-unification\work\ef-decomposition-plan.md`
2. The complete Phase F source change in the shared tree:
   - `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\portable-project-knowledge\proposal.md`
   - `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\portable-project-knowledge\design.md`
   - `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\portable-project-knowledge\tasks.md`
   - `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\portable-project-knowledge\specs\portable-project-knowledge\spec.md`
3. Repository conventions and known traps:
   `E:\AI\ChatAI\Agents\VibeCodingProjects\workflow\Reference\OpenSpec-code\rasen\changes\store-bootstrap-diagnose\planning-context.md`

## Locked F1 scope

- Phase F task group 2 in full: bundle schema, explicit permitted-field list,
  all-platform machine-path assertion, and a validating non-writing reader.
- Phase F task group 3 in full: export.
- Only the portions of groups 9–12 that serve groups 2 and 3: the export
  subcommand and flags, export acceptance coverage, relevant docs/locales, and
  validation/archive rehearsal.
- Keep “readers before writers” as the task order inside this change.
- Carry only the requirement whose complete contract is satisfied by F1,
  verbatim:
  - `A bundle carries an explicitly listed set of portable fields and nothing that belongs to a machine`
- Defer `A project's knowledge travels between machines only when the user
  exports a bundle` whole to a later child: despite its title, its first
  normative sentence promises both export and import, so F1 would satisfy it
  only partly.
- Preserve the Phase F delta Purpose verbatim so it can be restored after
  archiving the new capability.

## Collapsing invariant

At a user-specified destination, F1 creates exactly one new file and refuses if
that destination is already occupied. This must hold for every path and every
failure mode. Everything read by export remains byte-identical.

## Explicit exclusions

- No task group 4 (Store transport).
- No task groups 5–7 (import).
- No task group 8 (Phase E preparation integration).
- No Phase E work.
- No `--to-store` option and no import command.
- Prefer leaving a whole requirement to a later child over adding a
  requirement F1 only half satisfies.

## Dependency and archive facts

- F's eight requirement titles are pairwise disjoint; F1 needs only ADDED
  blocks and may archive first safely.
- `validate` cannot see cross-change collisions. Rehearse archive with zero
  blast radius by copying `rasen/config.yaml`, `rasen/specs/`, and this change
  directory into a temporary root and running archive from that root.
- Archiving the first child of a new capability replaces the Purpose with
  `TBD - created by archiving change ...`. After the real archive, restore the
  Purpose from the archived delta. The final check
  `grep -rl "TBD - created by archiving" rasen/specs/` must return no matches.

## Repository conventions and hazards

- Cross-platform paths use `path.join()` / `path.resolve()`; tests construct
  expected paths the same way.
- New messages go through `src/commands/knowledge-messages.ts`; no inline
  English strings.
- Register the export subcommand and every flag in
  `src/core/completions/command-registry.ts`.
- Add all locale keys to `src/locales/{en,ja,zh-cn}.json`.
- Do not run concurrent Vitest batches.
- Never use `git add -A`; ship owns staging.
- Do not change the package version.

## Durable findings

Append only durable constraints, conventions, or gotchas discovered by stage
workers. Do not append status chatter.

### propose (planner)

- The landed integration seam is concrete: `resolveProjectKnowledgeHome()` owns
  canonical project-catalog resolution, and `readCanonicalRecord()` owns strict
  managed-record reads. F1 should compose those exports rather than reproduce
  catalog discovery or manifest/body validation.
- A fresh Git worktree does not carry the ignored `dist/` tree, so
  `node bin/rasen.js ...` cannot run there until the package is built. The
  installed `rasen` executable resolves the worktree root correctly and is the
  planning/validation path for an unbuilt isolated worktree.
- Requirement titles are not a safe slicing boundary. The deferred
  export-focused title opens with a normative promise covering both export and
  import, so the full requirement must land with a later child that satisfies
  both even though all of its export scenarios are implementable in F1.

### apply (implementer)

- The exporter can stay on the landed identity boundary by composing
  `resolveProjectSelector()`, `resolveProjectKnowledgeHome()`, and
  `readStoreCatalog()`. A corrupt Rasen-authored record must block the export;
  silently omitting it would turn an integrity failure into data loss.
- Node's cross-platform `rename()` cannot provide the locked no-clobber
  invariant: on POSIX it may replace a destination created by a racing process.
  Publication therefore uses an exclusive randomized `0700` private staging
  directory outside the user-specified destination directory on the same
  filesystem. The staging fd remains open; `fstat(fd)` / `stat(path)` inode
  identity is required immediately before hard-link publication and again
  before cleanup. A mismatch is never linked or unlinked. Atomic publication
  is the commit point and the destination path is never touched afterward.
  Cleanup failure or post-publication ownership mismatch is a successful
  export with an explicit `staging_cleanup_deferred` warning.
- Node has neither a portable fd-based atomic hard-link nor atomic
  verify-and-unlink. The supported concurrency model covers ordinary
  exporters and destination creators, which do not enter another invocation's
  randomized owner-private staging directory. Deliberate mutation of that
  private directory by a process running as the same OS principal between
  proof and link/unlink is an out-of-model local adversary, not a concurrency
  guarantee this feature can honestly make with Node's available primitives.
- `knowledge bundle export` is intentionally the sole project-selector-only
  completion entry. Pinning that exception as an exact one-item allowlist keeps
  the broader command-registry guard that project selectors normally pair with
  Store selection.
