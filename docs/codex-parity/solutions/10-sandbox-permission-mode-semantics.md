# 10 — Sandbox / permission-mode semantics per role

**Status: live-verified**

## Experiments

E04 (read-only vs workspace-write, live write attempts).

## Solution

`-s read-only|workspace-write|danger-full-access` on `codex exec` maps exactly onto the LEAD
playbook's Step B role-to-sandbox assumption:
- `-s read-only`: filesystem writes are **hard-blocked at the OS sandbox layer**, not just by
  model self-restraint — live-verified: `echo hello > newfile.txt` failed with
  `zsh:1: operation not permitted: newfile.txt` (the shell's own denial, meaning the sandbox
  intercepts the write syscall before it reaches disk), and the target file was never created
  (confirmed via `ls` diff).
- `-s workspace-write`: the identical write succeeds — file lands on disk with correct content,
  `exit_code:0` on both commands.

**Recommendation:** dispatch reviewer/evaluator roles with `-s read-only`, artifact-writing roles
with `-s workspace-write`, exactly matching the existing playbook's Step B intent — no design
change needed, only confirmation.

## Approval policy note

`codex exec` has **no `-a/--ask-for-approval` flag** (confirmed via `--help`; passing it errors
`unexpected argument '-a' found` — E01/E04). Non-interactive `exec` mode's approval behavior is
implicit: command failures (including sandbox denials) are returned directly to the model to
handle/report, there is no blocking human-approval prompt in this mode. (`-a` **does** exist on
the top-level interactive `codex` and on `codex resume`/`codex app-server`'s equivalent
`approvalPolicy` field — E07 showed `"approvalPolicy":"on-request"` as a per-thread field in the
app-server `thread/start` response, so an app-server-driven LEAD does have finer control here than
`codex exec` offers.)

## Network access

The permissions-instructions developer message injected into every thread (E01's rollout) states
`"Network access is restricted"` under the default profile. Not separately live-tested this round
(no experiment attempted an outbound network call under either sandbox mode) — flag as an open
follow-up if rasen ever dispatches a Codex worker role that needs network access (e.g. a
web-fetching research role).

## Resume/identity handle, structured output

Unaffected by sandbox mode — same mechanisms as any dispatch.

## Failure modes

None beyond the expected denial behavior under read-only. Untested: `danger-full-access` (the
third documented sandbox value) — not exercised this round since neither read-only nor
workspace-write left anything to escalate to; assumed to disable the sandbox layer entirely per
its name and `--help` description, matching Claude's most-permissive mode, but not independently
confirmed.
