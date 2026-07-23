## 1. English docs

- [x] 1.1 Fix the Claude Code row in the "Command Syntax by AI Tool" table in `docs/commands.md` (~line 676) to `` `/rasen-propose`, `/rasen-apply-change` ``
- [x] 1.2 Fix the Claude Code row in the "Slash command syntax by tool" table in `docs/how-commands-work.md` (~line 78) to `` `/rasen-propose`, `/rasen-apply-change` ``
- [x] 1.3 Rewrite the "colon form" sentence immediately after that table in `docs/how-commands-work.md` (~line 85) to remove the reference to the retired colon form, stating instead that every tool surfaces the skill behind a leading slash and the exact syntax after that varies by tool; keep the cross-link to `supported-tools.md`

## 2. Chinese docs mirrors

- [x] 2.1 Fix the Claude Code row in the mirrored table in `docs/zh/commands.md` (~line 676) to `` `/rasen-propose`、`/rasen-apply-change` ``, leaving every other row untouched
- [x] 2.2 Fix the Claude Code row in the mirrored table in `docs/zh/how-commands-work.md` (~line 78) to `` `/rasen-propose`、`/rasen-apply-change` ``, leaving every other row untouched
- [x] 2.3 Rewrite the "冒号形式...连字符形式" sentence in `docs/zh/how-commands-work.md` (~line 85) to remove the contradictory colon-form reference, keeping the cross-link to 支持的工具/`supported-tools.md`; leave the surrounding `OpenSpec`/`opsx-*` wording in that sentence and file untouched (pre-existing, out-of-scope staleness — see `proposal.md` Impact)

## 3. Verify

- [x] 3.1 Re-read all four edited sections to confirm the Claude Code row now matches the leading-slash format used by every other row, and that no "colon form" reference remains in either language
- [x] 3.2 Confirm no other text in the two Chinese files was touched (diff review) beyond the four targeted edits
