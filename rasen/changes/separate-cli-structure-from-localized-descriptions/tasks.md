## 1. Define the CLI Presentation Model

- [x] 1.1 Add root-inclusive unresolved CLI structure types and resolved presentation types, keeping human descriptions out of unresolved command and option definitions.
- [x] 1.2 Add typed CLI presentation error variants for missing English copy, empty copy, placeholder mismatch, missing runtime facts, duplicate identities, alias collisions, and Commander structure mismatch.
- [x] 1.3 Convert shared option definitions to machine-facing structure only and preserve distinct accepted values and completion values.
- [x] 1.4 Refactor the command registry into one canonical root tree with root-owned options and aliases attached to canonical commands.
- [x] 1.5 Update registry parity tests to cover the root, canonical aliases, options, positionals, accepted values, and hidden-surface policy without asserting unresolved English descriptions.

## 2. Move CLI Copy into Locale Catalogs

- [x] 2.1 Add the complete semantic English `cli` catalog subtree for Commander chrome, root help, canonical commands, options, and dynamic templates.
- [x] 2.2 Add structurally identical Japanese and Simplified Chinese `cli` catalog subtrees with matching placeholders and non-empty localized copy.
- [x] 2.3 Add catalog tests that compare CLI keys and placeholder sets across all supported locales and reject empty presentation leaves.
- [x] 2.4 Add registry-to-catalog coverage tests for every visible root, canonical command, and option, including equality checks where repeated option wording is a product invariant.

## 3. Implement the Resolved Presentation Module

- [x] 3.1 Implement `resolveCliPresentation({ locale, facts? })` with English baseline lookup, selected-locale overlay, immutable tree construction, and semantic-path diagnostics.
- [x] 3.2 Add typed runtime facts and interpolation for available tool IDs, the default schema, and the default workspace directory name without source-language prose matching.
- [x] 3.3 Implement canonical alias projection and validate command, option, and alias identity collisions before returning a presentation.
- [x] 3.4 Add resolver tests for all supported locales, English fallback, empty or missing English copy, placeholder mismatch, missing facts, unresolved placeholders, and unchanged machine values.

## 4. Adapt Shell Completion Generation

- [x] 4.1 Change `CompletionGenerator` and all Bash, Fish, PowerShell, and Zsh generators to accept resolved presentation data only.
- [x] 4.2 Keep shell adapters limited to shell syntax, escaping, static choices, positional routing, and dynamic completion invocation while centralizing alias and presentation policy before rendering.
- [x] 4.3 Update completion generation and installation to resolve one locale and presentation snapshot per operation.
- [x] 4.4 Replace generator and completion-command tests with resolved fixtures that cover localized descriptions, aliases, escaping, static values, and dynamic completion behavior for every supported shell.

## 5. Construct Fresh Localized Commander Programs

- [x] 5.1 Refactor module-level Commander assembly into a factory that builds a fresh unlocalized command tree without package-owned description strings.
- [x] 5.2 Implement a private Commander adapter that preflights root, command, alias, option, and positional parity before applying resolved descriptions and semantic help chrome once.
- [x] 5.3 Preserve runtime startup ordering so legacy machine-data adoption precedes one locale resolution and fresh program construction.
- [x] 5.4 Replace the exported `program` singleton with `createProgram`, update package exports and internal/test call sites, and document the breaking library migration.
- [x] 5.5 Remove registry-description lookups and hardcoded Commander help copy from `src/cli/index.ts` and command registration modules while preserving parser, action, default, conflict, and hidden-command behavior.
- [x] 5.6 Add Commander tests for root and nested help in every locale, independent program instances, canonical aliases, generated help/version copy, preflight mismatch failure, and no partial application.

## 6. Remove the Legacy Localization Path

- [x] 6.1 Remove English-prose description lookup, dynamic English-prefix parsing, and obsolete description-localization exports and tests.
- [x] 6.2 Remove `ROOT_OPTION_DESCRIPTIONS`, old description-bearing shared flags, duplicated alias registry nodes, and the obsolete `commandDescriptions` and `commandDescriptionTemplates` catalog sections.
- [x] 6.3 Update remaining tests that directly assert unresolved English descriptions to assert resolved presentation or observable help/completion output instead.
- [x] 6.4 Audit all visible command-registration paths and completion renderers to confirm package-owned help copy exists only in locale catalogs.

## 7. Validate Behavior and Packaging

- [x] 7.1 Run `pnpm run build` before CLI end-to-end tests so `dist/` uses the new presentation path.
- [x] 7.2 Run focused locale, registry, completion-generator, completion-command, and CLI help tests for English, Japanese, and Simplified Chinese.
- [x] 7.3 Run `pnpm exec tsc --noEmit && pnpm lint` and resolve diagnostics introduced by the refactor.
- [x] 7.4 Run the complete suite with `env -u ZSH pnpm test` and confirm machine-readable CLI contracts remain unchanged.
- [ ] 7.5 Verify path-bearing and default-workspace help values on Windows CI, and confirm shell scripts preserve machine path and identifier tokens across supported platforms.
- [x] 7.6 Run `npm pack --dry-run --json` and confirm the published package contains all three updated locale catalogs and the new public type surface.
