# E04 — Sandbox mode enforcement: `read-only` vs `workspace-write`

**Codex CLI version:** 0.144.1

## Purpose

Item 10: live-verify that `-s read-only|workspace-write|danger-full-access` actually blocks/allows
writes as the LEAD playbook assumes (reviewer roles = read-only, artifact-writing roles =
workspace-write).

## Commands (run concurrently, two separate throwaway git repos)

```
# read-only
codex exec --json --skip-git-repo-check $CODEXW_ARGS -s read-only \
  -o /tmp/e04ro-last.txt \
  "Run: echo hello > newfile.txt   then run: cat newfile.txt   Report the exact stdout/stderr..."

# workspace-write
codex exec --json --skip-git-repo-check $CODEXW_ARGS -s workspace-write \
  -o /tmp/e04ww-last.txt \
  "Run: echo hello > newfile.txt   then run: cat newfile.txt   Report the exact stdout/stderr..."
```

Note: `-a/--ask-for-approval` is **not** a valid flag on `codex exec` (see E01) — dropped it;
`exec` mode's approval behavior is implicit non-interactive regardless.

## Result — read-only: write is blocked, file never created

Final message:
```
Command 1: `echo hello > newfile.txt`
- stdout: empty
- stderr: `zsh:1: operation not permitted: newfile.txt`
- exit code: 1

Command 2: `cat newfile.txt`
- stdout: empty
- stderr: `cat: newfile.txt: No such file or directory`
- exit code: 1
```
JSONL command_execution item confirms: `"exit_code":1,"status":"failed"`,
`"aggregated_output":"cat: newfile.txt: No such file or directory\n"`. `ls` of the working dir
after the run shows only the pre-existing `f` — `newfile.txt` was never created. The OS-level
sandbox (not just a prompt instruction) intercepted the shell redirect itself
("operation not permitted" is the shell's own error for a denied write, i.e. enforced below the
model).

## Result — workspace-write: write succeeds

```
`echo hello > newfile.txt`
- stdout: empty
- stderr: empty
`cat newfile.txt`
- stdout: `hello\n`
- stderr: empty
```
JSONL: both `command_execution` items `"exit_code":0,"status":"completed"`. `ls` of the working
dir after the run shows `newfile.txt` actually present on disk with contents `hello`.

## Verdict

`-s read-only|workspace-write` behaves exactly as the LEAD playbook's Step B mapping assumes:
read-only hard-blocks filesystem writes at the OS sandbox layer (not just via model
self-restraint), workspace-write allows them. This is a strong, direct mapping — reviewer-role
dispatches should pass `-s read-only`, artifact-writing roles `-s workspace-write`. Network access
default: the E01 rollout's permissions-instructions developer message states
`"Network access is restricted"` under the default profile; not separately live-tested here
(out of scope for this round — flag as an open follow-up if network-dependent worker roles are
ever dispatched via Codex).

## Reproduction

Run either command above from a fresh throwaway git repo; diff `ls` before/after.
