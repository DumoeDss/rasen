# 11 — Project context injection (CLAUDE.md analog)

**Status: live-verified** (root + nested discovery; global `~/.codex/AGENTS.md` untested)

## Experiments

E09 (AGENTS.md discovery from root vs nested cwd), E12 (round 2 — live proof a worker actually
reads a prompt-referenced file rather than hallucinating).

## Solution

AGENTS.md discovery walks from the invocation `cwd` **up toward the repo root**, merging every
AGENTS.md found along that path (root-first ordering), not a closest-wins single-file resolution.
Live-verified: a repo-root `AGENTS.md` rule applied when invoked from the root; when invoked from
a nested subdirectory, **both** the root's and the nested dir's rules applied, root-instruction
first in the reply ordering. This directly parallels Claude's own CLAUDE.md discovery/merge
behavior (root + nested, closer-scoped instructions layered on top).

## Recommendation for rasen's per-change context

Since rasen workers are normally dispatched with `cwd` = repo root (not the change directory),
relying on a nested `rasen/changes/<name>/AGENTS.md` to auto-inject would require setting the
worker's `cwd` to (or below) the change directory — not rasen's current dispatch pattern, and
would complicate the worker's ability to touch files across the repo. **Recommended approach
(matches the goal-plan's own suggestion): pass per-change context by prompt reference** — include
the change directory's path in the dispatch prompt and instruct the worker to read
`rasen/changes/<name>/proposal.md`/`design.md`/`tasks.md` directly, rather than relying on
AGENTS.md auto-discovery. A repo-root `AGENTS.md` remains a good home for **global** rasen
conventions (e.g. "this repo uses the rasen artifact workflow; see `rasen/changes/` for
active work") that should apply to every Codex worker regardless of dispatch.

**This "prompt reference" recommendation is now itself live-verified, not just plausible design**
(round 2, E12): dispatched a worker with a prompt that named a file path
(`rasen/changes/fake-change/proposal.md`) containing an unguessable token (`FLAMINGO-42`) and
asked it to report the token. The worker ran a real `rg -n "CONTEXT_TOKEN"
rasen/changes/fake-change/proposal.md` command (visible in the JSONL as a `command_execution`
item) and correctly reported `FLAMINGO-42` — a value that appeared nowhere in the prompt text
itself, ruling out hallucination. Prompt-referenced file reading is a proven mechanism, not an
assumption.

## Untested this round

Global `~/.codex/AGENTS.md` (outside any git repo, applying to all Codex sessions machine-wide) —
neither throwaway test repo exercised this path. Also untested: file-size behavior / truncation
if AGENTS.md is very large (out of scope this round; rasen's AGENTS.md, if adopted, would be
short).

## Resume/identity handle, structured output

Not applicable — AGENTS.md injection happens automatically at thread-start time regardless of
dispatch mechanism (`exec` or `app-server`), same as any other developer-role scaffolding.

## Failure modes

None observed. AGENTS.md content becomes part of the fixed developer-role context at the start of
every fresh thread (same class of message as the permissions/skills/multi-agent scaffolding
observed in E01/E11) — it does **not** appear to be re-read on `resume` of an existing thread
(not independently verified this round, but consistent with how all other startup scaffolding
behaves: injected once at thread creation, not per-turn).
