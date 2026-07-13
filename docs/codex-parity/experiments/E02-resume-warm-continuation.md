# E02 — Resume / warm continuation, across cwd, and after a mid-turn kill

**Codex CLI version:** 0.144.1

## Purpose

Test the Codex counterpart to Claude's SendMessage/Tier-A warm continuation (items 3, 4, 6):
does `codex exec resume` actually retain prior-turn context, does it work from a different
process/cwd, and does it survive a hard kill mid-turn?

## E02a — teach a fact, resume with `--last`, ask it back (new process)

```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  -o /tmp/e02a-last.txt "Remember this secret codeword for later: ZEBRA-19. Just acknowledge..."
# => "I've stored the codeword ZEBRA-19."  thread_id=019f5508-692d-7033-93ee-7421963506af

codex exec resume --last --json $CODEXW_ARGS \
  -o /tmp/e02b-last.txt "What was the secret codeword I told you earlier? Reply with just the codeword."
# => "ZEBRA-19"   (EXIT:0)
```
`--last` correctly picked the just-created thread and the model recalled the fact — confirmed
warm-continuation semantics, run as two fully separate `codex exec` process invocations (not one
long-lived process).

## E02b — resume by explicit thread id, from a DIFFERENT cwd

```
mkdir $SCRATCH/e02-elsewhere && cd $SCRATCH/e02-elsewhere   # not the original repo dir
codex exec resume 019f5508-692d-7033-93ee-7421963506af --json $CODEXW_ARGS --skip-git-repo-check \
  -o /tmp/e02c-last.txt "One more time: what was the secret codeword?"
# => "ZEBRA-19"   (EXIT:0)
```
Resume by explicit UUID works from an arbitrary cwd — the session is looked up by id under
`~/.codex/sessions`, not tied to invoking from the original working directory (though the agent's
own tool calls will operate against whatever cwd is current unless `-C` is passed; the *thread
identity and history* travel independently of cwd).

## E02c — kill mid-turn (`kill -9`), then resume

Started a turn that first states a codeword, then runs `sleep 30` (to guarantee we can kill it
mid-flight), then asks the agent to repeat the codeword:
```
codex exec --json --skip-git-repo-check $CODEXW_ARGS \
  "Remember the secret codeword PANTHER-7. Then run: sleep 30. Then tell me the codeword back." &
sleep 6; kill -9 $!; pkill -9 -f "codex exec.*PANTHER"
```
Captured partial JSONL before the kill:
```
{"type":"thread.started","thread_id":"019f5508-c42a-7e51-9f72-1ffbab60f7ea"}
{"type":"turn.started"}
```
(no `turn.completed` — the process was killed mid-command-execution, as intended).

Resume in a new process:
```
codex exec resume 019f5508-c42a-7e51-9f72-1ffbab60f7ea --json $CODEXW_ARGS --skip-git-repo-check \
  -o /tmp/e02kill2-last.txt "What was the secret codeword? Don't run any commands, just answer..."
```
First attempt hit a transient rate limit (recorded honestly, not a resume-capability failure):
```
{"type":"error","message":"exceeded retry limit, last status: 429 Too Many Requests, ..."}
{"type":"turn.failed", ...}
```
Retried ~20s later:
```
EXIT:0
PANTHER-7
```
**Result: the fact stated before the kill survived** — the user message containing "PANTHER-7"
was already persisted to the rollout JSONL before the process died (each `response_item` is
appended to the JSONL as it's produced, not buffered to end-of-turn), so resume replayed it
correctly even though the *turn* that would have echoed it back never completed. This directly
validates item 4 (in-session revival after infra death): a Codex worker killed mid-turn can be
revived with `codex exec resume <id>` and the prior turns' content is intact; only the
in-flight, uncommitted turn is lost, exactly as `turn.failed`/no `turn.completed` would indicate
to a caller inspecting the JSONL.

## Failure mode observed

`429 Too Many Requests` (`"exceeded retry limit, last status: 429"`) occurred twice during this
session under back-to-back load. Not related to resume mechanics — a rate-limit on the underlying
provider (this env's reverse proxy). A production wrapper should treat `turn.failed` with a 429
message as retryable-after-backoff, distinct from an auth or resume failure.

## Reproduction

Any two sequential `codex exec` calls (`resume --last` or `resume <id>`) with the
`$CODEXW_ARGS` proxy override from E01. For the kill test, background the first call, `sleep`
briefly, then `kill -9`.
