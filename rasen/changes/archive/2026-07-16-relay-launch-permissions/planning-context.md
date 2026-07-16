# Planning Context — relay-launch-permissions

## User intent (verbatim)

> 当前主LEAD handoff时会出现权限问题，启动claude的命令修改为claude --dangerously-skip-permissions 这样可以有全部权限。codex也要查询相关的命令保证handoff LEAD能够正常工作！

Translation of intent: when the main LEAD session relays itself (Step H.7 session relay / rasen-handoff "Session relay" section), the successor `claude` session it spawns starts WITHOUT the predecessor's permission grants, so the autopilot chain breaks on permission prompts with no human watching. Fix: the relay launch commands must start the successor with `claude --dangerously-skip-permissions`. Additionally: research and document the Codex CLI equivalent (the flags that bypass approval prompts/sandbox) so a Codex-side handoff/relay LEAD would also work unattended.

## LEAD codebase findings (verified in this worktree, base = origin/main 3db46b9)

- The session-relay launch commands live in `src/core/templates/workflows/handoff.ts` lines ~52-54 — three platform variants, all spawning bare `claude`:
  - Windows: `claude "$(Get-Content -Raw '<relay-prompt.txt>')"` via PowerShell `-EncodedCommand` + `Start-Process`
  - macOS: `relay.command` script with `cd '<root>' && claude "$(cat '<relay-prompt.txt>')"` then `open relay.command`
  - Linux: `gnome-terminal -- bash -lc 'cd <root> && claude "$(cat <abs path>)"'`
- `src/core/templates/workflows/_orchestration.ts` (shared orchestration playbook, Step H.7) mentions session relay mechanics and names `codex resume [SESSION_ID] [PROMPT]` / `codex fork --last` as future-LEAD-on-Codex primitives ("named here only, not designed") — this is where Codex permission-flag guidance likely belongs, plus the handoff.ts relay section.
- Skills are GENERATED from these templates: the change must follow build → update so `skills/` (and any adapter outputs) regenerate; do not hand-edit generated SKILL.md files. (Established project process: 模板改动流程=build→update.)
- Repo has a Codex integration library at `src/core/codex` (buildCodexExecInvocation etc.) — check whether relay/resume invocation builders exist there and whether a bypass flag needs to be threaded.

## Codex CLI facts to verify during research (planner: verify against the installed codex CLI --help, not memory)

- Candidate full-permissions flag: `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`) — bypasses ALL approval prompts + sandbox.
- Alternative softer mode: `--full-auto` / `-a on-failure` / `-s workspace-write` combos.
- Need: which of these are valid on `codex` (interactive), `codex exec`, and `codex resume` — the relay path for a Codex LEAD would be interactive `codex resume`, and per prior project research `codex exec resume` rejects `-s`; verify whether the bypass flag is accepted on resume.

## Constraints / decisions already made

- Scope: docs/template change (relay launch commands + codex guidance) + regeneration of skills. No version bump (user owns versions).
- Decompose: skipped — single coherent slice.
- Gate policy: off (flag) — ship gate will auto-approve; delivery stays local-first unless ship resolves otherwise (worktree branch `worktree-handoff-relay-permissions`).
- The `--dangerously-skip-permissions` flag is intentional and user-mandated; do not water it down to `--permission-mode acceptEdits` — the requirement is FULL permissions for an unattended successor LEAD.

## Durable findings (verified live during planning, 2026-07-16)

- **codex-cli 0.144.1** (installed). The full-permissions flag is `--dangerously-bypass-approvals-and-sandbox` ("Skip all confirmation prompts and execute commands without sandboxing"). Verified present in `--help` for ALL FOUR relevant surfaces: `codex` (interactive), `codex exec`, `codex resume`, and `codex fork`. `grep -c` confirmed the flag on both `codex resume --help` and `codex fork --help` (1 each).
- **No `--yolo` / `--full-auto` alias** exists in this Codex version — that memory candidate is stale/absent. `--dangerously-bypass-approvals-and-sandbox` is the single canonical flag. (Softer alternatives that DO exist: `-a/--ask-for-approval <untrusted|on-request|never>` and `-s/--sandbox <read-only|workspace-write|danger-full-access>`.)
- **Interactive `codex resume` != `codex exec resume`.** The interactive `codex resume` (the visible-window relay path) accepts `-s`/sandbox AND the bypass flag; the prior-research finding that "`codex exec resume` rejects `-s`" is about the exec subcommand, a different code path. The relay path for a Codex LEAD is the interactive one, so the bypass flag is valid there.
- **Generated SKILL.md locations** for the regeneration check: `.claude/skills/rasen-handoff/SKILL.md` (carries the launch commands) plus the orchestration-sharing skills `.claude/skills/rasen-auto|rasen-review-cycle|rasen-goal/SKILL.md` (all embed `_orchestration.ts`, so the Step H.7 Codex note propagates to all of them). Build entry: `pnpm build` (= `node build.js`); worktree `dist/` was NOT built at plan time (bin/rasen.js needs `dist/cli/index.js` — build first before any `rasen update`).
- **Spec target:** modified `session-relay` only (one delta). `orchestration-handoff` defers relay mechanics to `session-relay`, so it is untouched.
