## REMOVED Requirements

### Requirement: codebase-design allowed-tools scoped to advisory actions

**Reason**: The requirement constrained `allowed-tools` in `skills/gstack/codebase-design/SKILL.md.tmpl`, which is deleted. The `allowed-tools` field was only ever present on the `.tmpl` source and its (uninstalled) generated build product — the TS install pipeline (`getSkillTemplates()` → `generateSkillContent()`) strips all source frontmatter and does not emit `allowed-tools`, so the constraint never reached the installed skill. With the `.tmpl` removed there is no artifact left to scope, and the behavior-preserving migration does not add `allowed-tools` emission.
**Migration**: The `codebase-design` expert remains advisory by its body (reads and reasons about interfaces; no file writes or shell commands). Re-introducing enforced per-skill `allowed-tools` for installed experts is a separate feature (extend `SkillTemplate`/`generateSkillContent` to emit `allowedTools`) and should be proposed as its own change if desired.
