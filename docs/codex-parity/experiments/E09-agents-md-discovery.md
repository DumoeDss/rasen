# E09 — AGENTS.md discovery: root vs nested cwd

**Codex CLI version:** 0.144.1

## Purpose

Item 11: verify AGENTS.md discovery rules (repo root? nested dirs? merged?) as the CLAUDE.md
analog for injecting rasen's per-change context.

## Setup

Throwaway git repo `$SCRATCH/e11` with two AGENTS.md files carrying distinct, easily-greppable
instructions:
```
AGENTS.md:          "ROOT_AGENTS_RULE: always end replies with token ROOT_TAG"
nested/AGENTS.md:   "NESTED_AGENTS_RULE: always end replies with token NESTED_TAG"
```

## Commands (run from two different cwds)

```
cd $SCRATCH/e11         && codex exec --json --skip-git-repo-check $CODEXW_ARGS "Say hello in one short sentence." < /dev/null
cd $SCRATCH/e11/nested   && codex exec --json --skip-git-repo-check $CODEXW_ARGS "Say hello in one short sentence." < /dev/null
```

## Result

```
=== cwd = repo root ===
Hello! ROOT_TAG

=== cwd = nested/ ===
Hello! ROOT_TAG NESTED_TAG
```

- Invoked from the repo root: only the root `AGENTS.md` rule applied.
- Invoked from `nested/`: **both** the root's and the nested dir's `AGENTS.md` rules applied,
  and in root-first order (`ROOT_TAG` appears before `NESTED_TAG` in the reply, consistent with
  root-to-cwd instruction ordering).

## Verdict for item 11

AGENTS.md discovery walks from cwd up to (at least) the repo root and **merges** every AGENTS.md
found along that path — not "closest one wins," but a concatenation, closest-to-root first. This
means rasen worker dispatches should place a repo-root `AGENTS.md` for global rasen conventions
and *may* rely on a nested `AGENTS.md` for change-scoped instructions if the worker's cwd is set
to (or below) the change directory — though in practice, rasen's per-change context
(`rasen/changes/<name>/`) is more reliably passed **by prompt reference** (a file path in the
dispatch prompt telling the worker to read it), matching the goal-plan's suggested approach,
since AGENTS.md discovery is cwd-relative and rasen workers' cwd is normally the repo root, not
the change directory. Global `~/.codex/AGENTS.md` was not tested this round (not exercised by
either throwaway repo) — flagged as an open follow-up.

## Reproduction

Create nested AGENTS.md files with distinguishable tokens as above; invoke `codex exec` from each
directory level and check which tokens appear in the reply.
