# Commands

This is the reference for rasen's slash commands. These commands are invoked in your AI coding assistant's chat interface (e.g., Claude Code, Cursor, Windsurf).

For workflow patterns and when to use each command, see [Workflows](workflows.md). For CLI commands, see [CLI](cli.md).

## Quick Reference

### Quick Path (`core` profile)

| Command | Purpose |
|---------|---------|
| `rasen-propose` | Create a change and generate planning artifacts in one step |
| `rasen-explore` | Think through ideas before committing to a change |
| `rasen-apply-change` | Implement tasks from the change |
| `rasen-sync-specs` | Merge delta specs into main specs |
| `rasen-archive-change` | Archive a completed change |

### Expanded Workflow Commands (custom workflow selection)

| Command | Purpose |
|---------|---------|
| `rasen-new-change` | Start a new change scaffold |
| `rasen-continue-change` | Create the next artifact based on dependencies |
| `rasen-verify-change` | Validate implementation matches artifacts |
| `rasen-bulk-archive-change` | Archive multiple changes at once |
| `rasen-onboard` | Guided tutorial through the complete workflow |
| `rasen-review-cycle` | Iterative review loop — review, triage, fix, re-review the delta, repeat until clean or escalate |
| `rasen-goal` | Goal-driven iteration — repeat modify→judge against a measure or evaluate gate until satisfied or the round cap is hit (perf optimization, rubric-clean code, research brief) |

The default global profile is `full` — all workflow commands are installed out of the box. To slim down to the essentials, run `rasen config profile core` (or pick a custom subset with `rasen config profile`), then run `rasen update` in your project.

---

## Command Reference

### `rasen-propose`

Create a new change and generate planning artifacts in one step. This is the default start command in the `core` profile.

**Syntax:**
```text
rasen-propose [change-name-or-description]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name-or-description` | No | Kebab-case name or plain-language change description |

**What it does:**
- Creates `rasen/changes/<change-name>/`
- Generates artifacts needed before implementation (for `spec-driven`: proposal, specs, design, tasks)
- Stops when the change is ready for `rasen-apply-change`

**Example:**
```text
You: rasen-propose add-dark-mode

AI:  Created rasen/changes/add-dark-mode/
     ✓ proposal.md
     ✓ specs/ui/spec.md
     ✓ design.md
     ✓ tasks.md
     Ready for implementation. Run rasen-apply-change.
```

**Tips:**
- Use this for the fastest end-to-end path
- If you want step-by-step artifact control, enable expanded workflows and use `rasen-new-change` + `rasen-continue-change`

---

### `rasen-explore`

> **Start here when you're unsure.** Explore is a no-stakes thinking partner: it reads your codebase, compares options, and sharpens a fuzzy idea into a concrete plan before any change exists. It ships in the default profile. For the full case and more examples, see the [Explore First](explore.md) guide.

Think through ideas, investigate problems, and clarify requirements before committing to a change.

**Syntax:**
```
rasen-explore [topic]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `topic` | No | What you want to explore or investigate |

**What it does:**
- Opens an exploratory conversation with no structure required
- Investigates the codebase to answer questions
- Compares options and approaches
- Creates visual diagrams to clarify thinking
- Can transition to `rasen-propose` (default) or `rasen-new-change` (expanded workflow) when insights crystallize

**Example:**
```text
You: rasen-explore

AI:  What would you like to explore?

You: How should we handle authentication for the mobile app?

AI:  Let me investigate your current auth setup...
     [Analyzes codebase]

     I see you're using session-based auth for the web app.
     For mobile, we have three main options:

     1. JWT tokens (stateless, works offline)
     2. OAuth2 (if you need third-party login)
     3. Extend current sessions (simpler, but requires connectivity)

     Your API already has CORS configured. Which direction interests you?

You: Let's go with JWT. Can we start a change for that?

AI:  Ready when you are. Run rasen-propose add-jwt-auth to begin.
```

**Tips:**
- Use when requirements are unclear or you need to investigate
- No artifacts are created during exploration
- Good for comparing multiple approaches before deciding
- Can read files and search the codebase

---

### `rasen-new-change`

Start a new change scaffold. Creates the change folder and waits for you to generate artifacts with `rasen-continue-change`.

This command is part of the expanded workflow set (not included in the `core` profile).

**Syntax:**
```
rasen-new-change [change-name] [--schema <schema-name>]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Name for the change folder (prompted if not provided) |
| `--schema` | No | Workflow schema to use (default: from config or `spec-driven`) |

**What it does:**
- Creates `rasen/changes/<change-name>/` directory
- Creates `.openspec.yaml` metadata file in the change folder
- Shows the first artifact template ready for creation
- Prompts for change name and schema if not provided

**What it creates:**
```
rasen/changes/<change-name>/
└── .openspec.yaml    # Change metadata (schema, created date)
```

**Example:**
```
You: rasen-new-change add-dark-mode

AI:  Created rasen/changes/add-dark-mode/
     Schema: spec-driven

     Ready to create: proposal
     Use rasen-continue-change to create it, one artifact at a time.
```

**Tips:**
- Use descriptive names: `add-feature`, `fix-bug`, `refactor-module`
- Avoid generic names like `update`, `changes`, `wip`
- Schema can also be set in project config (`rasen/config.yaml`)

---

### `rasen-continue-change`

Create the next artifact in the dependency chain. Creates one artifact at a time for incremental progress.

**Syntax:**
```
rasen-continue-change [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to continue (inferred from context if not provided) |

**What it does:**
- Queries the artifact dependency graph
- Shows which artifacts are ready vs blocked
- Creates the first ready artifact
- Reads dependency files for context
- Shows what becomes available after creation

**Example:**
```
You: rasen-continue-change

AI:  Change: add-dark-mode

     Artifact status:
     ✓ proposal    (done)
     ◆ specs       (ready)
     ◆ design      (ready)
     ○ tasks       (blocked - needs: specs)

     Creating specs...

     [Reads proposal.md, creates specs based on requirements]

     ✓ Created rasen/changes/add-dark-mode/specs/ui/spec.md

     Now available: tasks
     Run rasen-continue-change to create the next artifact.
```

**Tips:**
- Use when you want to review each artifact before proceeding
- Good for complex changes where you want control
- Multiple artifacts may become ready simultaneously
- You can edit created artifacts before continuing

---

### `rasen-apply-change`

Implement tasks from the change. Works through the task list, writing code and checking off items.

**Syntax:**
```
rasen-apply-change [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to implement (inferred from context if not provided) |

**What it does:**
- Reads `tasks.md` and identifies incomplete tasks
- Works through tasks one by one
- Writes code, creates files, runs tests as needed
- Marks tasks complete with checkboxes `[x]`

**Example:**
```
You: rasen-apply-change

AI:  Implementing add-dark-mode...

     Reading tasks.md:
     - [ ] 1.1 Create ThemeContext
     - [ ] 1.2 Add CSS custom properties
     - [ ] 1.3 Implement localStorage persistence

     Working on 1.1: Create ThemeContext...
     [Creates src/context/ThemeContext.tsx]

     ✓ 1.1 Complete

     Working on 1.2: Add CSS custom properties...
     [Updates src/styles/globals.css]

     ✓ 1.2 Complete
     ...
```

**Tips:**
- Can resume where you left off if interrupted
- Use for parallel changes by specifying the change name
- Completion state is tracked in `tasks.md` checkboxes

---

### `rasen-verify-change`

Validate that implementation matches your change artifacts. Checks completeness, correctness, and coherence.

**Syntax:**
```
rasen-verify-change [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to verify (inferred from context if not provided) |

**What it does:**
- Checks three dimensions of implementation quality
- Searches codebase for implementation evidence
- Reports issues categorized as CRITICAL, WARNING, or SUGGESTION
- Does not block archive, but surfaces issues

**Verification dimensions:**

| Dimension | What it validates |
|-----------|-------------------|
| **Completeness** | All tasks done, all requirements implemented, scenarios covered |
| **Correctness** | Implementation matches spec intent, edge cases handled |
| **Coherence** | Design decisions reflected in code, patterns consistent |

**Example:**
```
You: rasen-verify-change

AI:  Verifying add-dark-mode...

     COMPLETENESS
     ✓ All 8 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "System preference detection" has no test coverage

     CORRECTNESS
     ✓ Implementation matches spec intent
     ✓ Edge cases from scenarios are handled
     ✓ Error states match spec definitions

     COHERENCE
     ✓ Design decisions reflected in code structure
     ✓ Naming conventions consistent with design.md
     ⚠ Design mentions "CSS variables" but implementation uses Tailwind classes

     SUMMARY
     ─────────────────────────────
     Critical issues: 0
     Warnings: 2
     Ready to archive: Yes (with warnings)

     Recommendations:
     1. Add test for system preference detection
     2. Update design.md to reflect Tailwind usage, or refactor to use CSS variables
```

**Tips:**
- Run before archiving to catch mismatches early
- Warnings don't block archive but indicate potential issues
- Good for reviewing AI's work before committing
- Can reveal drift between artifacts and implementation

---

### `rasen-review-cycle`

Drive a change to actually-clean with an iterative loop: `review → triage → fix → re-review(Δ) → {pass | loop | escalate}`. It does not reimplement the reviewer — each pass delegates to the always-installed `rasen-review` engine. This command owns the loop, fix-size triage, the author-vs-verifier invariant, termination, and escalation. Opt-in (not in the `core` profile).

**Syntax:**
```
rasen-review-cycle [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to run the loop on (inferred from context if not provided) |

**What it does:**
- Runs a review pass via `rasen-review`, then triages each finding by fix size
- Routes fixes: trivial → orchestrator inline; non-trivial → the implementing agent; design-level → a separate fix agent
- Re-reviews only the fix delta and marks a finding resolved only when a non-author confirms it against the original finding (author ≠ verifier)
- Caps the loop at max rounds (default 3); on the cap with unresolved Blocker/Major findings it escalates to a human — never silently passes
- Records the round history and each non-author confirmation in `review-cycle-report.md`

**Author ≠ verifier invariant:**
A finding is resolved only when a reviewer who did NOT author the fix confirms it. For a trivial inline fix done by the orchestrator, the equivalent non-author check is an independent gate-run (tests/lint/build) plus a diff-read of the exact change — and that check must be recorded in the cycle report.

**Re-review paths:**
- **Claude Code acceleration (optional):** with agent-teams enabled (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), the lead MAY resume the original reviewer via `SendMessage` to re-review only the delta (only the lead may originate `SendMessage`).
- **Tool-agnostic fallback (mandatory):** otherwise, run a fresh delta review, passing the prior findings and the fix diff through a shared file. Equivalent outcome, just costlier.

**Example:**
```
You: rasen-review-cycle add-dark-mode

AI:  Review Cycle: add-dark-mode (round 1/3)
     Findings: 1 Blocker, 2 Major
       - [Blocker] missing null guard → trivial → orchestrator inline
       - [Major]   race in toggle      → non-trivial → implementing agent
       - [Major]   contract changed     → design-level → separate fix agent
     Fixes applied → re-reviewing delta (fresh non-author review)...
     Round 2/3: 0 Blocker, 0 Major → CLEAN
     Report: review-cycle-report.md
```

**Tips:**
- Use AFTER implementation, against the live diff; for a single verification gate use `rasen-verify-change` instead
- The loop is bounded — if it escalates, the open findings and round history go to a human, not to a silent pass

---

### `rasen-goal`

Goal-driven iteration for tasks whose "done" is a **condition**, not a document — drive a Lighthouse score to 90, make a module rubric-clean, research and write a brief. A sibling entry to `rasen-auto`: the LEAD classifies the task, picks ONE backend pipeline, and repeats **modify → judge** until a gate is satisfied or a round cap is hit. Shares the same orchestration playbook as `rasen-auto` (LEAD + role-isolated workers, tiers, run-state, gates, resume). For the full chapter, see `opsx-workflow-guide.md` §9 (Goal-driven iteration) in the repo's `docs/` directory.

**Syntax:**
```text
rasen-goal [measure|evaluate|research] <task>
rasen-goal --pipeline goal-loop-<variant> <task>
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `measure\|evaluate\|research` | No | Force a backend pipeline; without it the LEAD classifies by keyword (explicit always wins; ambiguous defaults to `evaluate`) |
| `task` | Yes | Natural-language description of the goal to iterate toward |

**What it does:**
- **define-goal** stage — translates the task into `goal-plan.md`: the goal, the concrete gate (`{kind: measure, command, threshold/target}` or `{kind: evaluate, goal, rubric}`), the work product (`code` | `prose`), and `maxRounds`. This stage has a gate — you confirm a measure command before any round runs
- **iterate** loop — each round dispatches a warm-reused implementer, then runs the gate: **measure** runs a deterministic command (`{score, passed}`); **evaluate** dispatches a fresh reviewer worker (`{satisfied, gaps}`). Each round is recorded in `goal-run.json` (the authoritative loop position)
- **tail** — measure/evaluate → `ship` → `archive` (the iterated code is delivered normally); research → `report` (summarized into a final document; no code to ship)
- Bounded by `maxRounds` (default 5) + `loopStallLimit` (default 2); rounds exhausted are marked `maxRounds-exhausted` — never reported as success

**Backend pipeline family:**

| Keywords in the task | Selected pipeline | Gate (examiner) | Work product | Tail |
|---|---|---|---|---|
| `score` `latency` `optimize` `lighthouse` `benchmark` `p99` `memory` `throughput` | **goal-loop-measure** | measure — a deterministic command | code | ship → archive |
| `rubric` `quality` `clean` `standard` `refactor-quality` | **goal-loop-evaluate** | evaluate — a fresh reviewer | code | ship → archive |
| `research` `investigate` `write report` `write brief` `autoresearch` `literature` | **goal-loop-research** | evaluate — a fresh reviewer | prose | report |

**Example:**
```text
You: rasen-goal drive the Lighthouse performance score to 90

AI:  Keyword "lighthouse" + "score" -> goal-loop-measure
     Fetch DAG: define-goal -> iterate (measure gate) -> ship -> archive
     ▸ planner -> goal-plan.md (gate: measure, command: lighthouse --output=json, threshold: 90)
     ⏸ gate: confirm the measure command? -> You: continue
     ▸ implementer (round 1) -> edits the perf-critical path
     ▸ measure gate: score 82 (not passed) -> recorded to goal-run.json
     ▸ implementer (round 2, warm-reused) -> further edits
     ▸ measure gate: score 91 (satisfied) -> ship -> archive
```

**Tips:**
- Use `rasen-goal` when the product is a *condition* met by iteration; use `rasen-auto` when the product is a code-change document
- Kill mid-loop and run `rasen pipeline resume <change>` — the goal-loop resume protocol reads the last `goal-run.json` record and resumes at the right round
- The `define-goal` gate is the safety valve for "measure.command is arbitrary shell" — review the command before continuing

---

### `rasen-sync-specs`

**Optional command.** Merge delta specs from a change into main specs. Archive will prompt to sync if needed, so you typically don't need to run this manually.

**Syntax:**
```
rasen-sync-specs [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to sync (inferred from context if not provided) |

**What it does:**
- Reads delta specs from change folder
- Parses ADDED/MODIFIED/REMOVED/RENAMED sections
- Merges changes into main `rasen/specs/` directory
- Preserves existing content not mentioned in delta
- Does not archive the change (remains active)

**Example:**
```text
You: rasen-sync-specs

AI:  Syncing add-dark-mode delta specs...

     Reading: rasen/changes/add-dark-mode/specs/ui/spec.md
     Target:  rasen/specs/ui/spec.md

     Changes to apply:
     ✓ ADDED: Theme Selection requirement (2 scenarios)
     ✓ ADDED: Accessibility requirement (1 scenario)

     Merging...
     ✓ rasen/specs/ui/spec.md updated

     Change remains active. Run rasen-archive-change when ready to complete.
```

**When to use manually:**

| Scenario | Use sync? |
|----------|-----------|
| Long-running change, want specs in main before archiving | Yes |
| Multiple parallel changes need the updated base specs | Yes |
| Want to preview/review the merge separately | Yes |
| Quick change, going straight to archive | No (archive handles it) |

**Tips:**
- Sync is intelligent, not copy-paste
- Can add scenarios to existing requirements without duplicating
- Change stays active after sync (not archived)
- Most users will never need to call this directly—archive prompts if needed

---

### `rasen-archive-change`

Archive a completed change. Finalizes the change and moves it to the archive folder.

**Syntax:**
```
rasen-archive-change [change-name]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to archive (inferred from context if not provided) |

**What it does:**
- Checks artifact completion status
- Checks task completion (warns if incomplete)
- Offers to sync delta specs if not already synced
- Moves change folder to `rasen/changes/archive/YYYY-MM-DD-<name>/`
- Preserves all artifacts for audit trail

**Example:**
```text
You: rasen-archive-change

AI:  Archiving add-dark-mode...

     Artifact status:
     ✓ proposal.md exists
     ✓ specs/ exists
     ✓ design.md exists
     ✓ tasks.md exists (8/8 tasks complete)

     Delta specs: Not yet synced
     → Sync now? (recommended)

You: Yes

AI:  ✓ Synced specs to rasen/specs/ui/spec.md
     ✓ Moved to rasen/changes/archive/2025-01-24-add-dark-mode/

     Change archived successfully.
```

**Tips:**
- Archive won't block on incomplete tasks, but will warn
- Delta specs can be synced during archive or beforehand
- Archived changes are preserved for history
- Use `rasen-verify-change` first to catch issues

---

### `rasen-bulk-archive-change`

Archive multiple completed changes at once. Handles spec conflicts between changes.

**Syntax:**
```
rasen-bulk-archive-change [change-names...]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `change-names` | No | Specific changes to archive (prompts to select if not provided) |

**What it does:**
- Lists all completed changes
- Validates each change before archiving
- Detects spec conflicts across changes
- Resolves conflicts by checking what's actually implemented
- Archives in chronological order

**Example:**
```
You: rasen-bulk-archive-change

AI:  Found 3 completed changes:
     - add-dark-mode (8/8 tasks complete)
     - fix-login-bug (3/3 tasks complete)
     - update-footer (2/2 tasks complete)

     Checking for spec conflicts...
     ⚠ add-dark-mode and update-footer both touch specs/ui/

     Inspecting codebase to resolve...
     Both changes are implemented. Will merge in chronological order:
     1. add-dark-mode (created Jan 20)
     2. update-footer (created Jan 22)

     Archive all 3 changes?

You: Yes

AI:  ✓ Archived add-dark-mode
     ✓ Archived fix-login-bug
     ✓ Archived update-footer
     Specs merged: add-dark-mode → update-footer
```

**Tips:**
- Good for parallel work streams
- Conflict resolution is agentic (checks codebase)
- Changes are archived in order of creation
- Prompts before overwriting spec content

---

### `rasen-onboard`

Guided onboarding through the complete rasen workflow. An interactive tutorial using your actual codebase.

**Syntax:**
```
rasen-onboard
```

**What it does:**
- Walks through a complete workflow cycle with narration
- Scans your codebase for real improvement opportunities
- Creates an actual change with real artifacts
- Implements actual work (small, safe changes)
- Archives the completed change
- Explains each step as it happens

**Phases:**
1. Welcome and codebase analysis
2. Finding an improvement opportunity
3. Creating a change (`rasen-new-change`)
4. Writing the proposal
5. Creating specs
6. Writing the design
7. Creating tasks
8. Implementing tasks (`rasen-apply-change`)
9. Verifying implementation
10. Archiving the change
11. Summary and next steps

**Example:**
```
You: rasen-onboard

AI:  Welcome to rasen!

     I'll walk you through the complete workflow using your actual codebase.
     We'll find something small to improve, create a proper change for it,
     implement it, and archive it.

     Let me scan your codebase for opportunities...

     [Analyzes codebase]

     I found a few things we could work on:
     1. Add input validation to the contact form
     2. Improve error messages in the auth flow
     3. Add loading states to async buttons

     Which interests you? (or suggest something else)
```

**Tips:**
- Best for new users learning the workflow
- Uses real code, not toy examples
- Creates a real change you can keep or discard
- Takes 15-30 minutes to complete

---

## Command Syntax by AI Tool

Rasen installs a **skill** for every workflow — `.claude/skills/rasen-*/SKILL.md` and equivalents per tool — and no separate slash-command file is generated. Each AI tool that natively discovers project skills (Claude Code and 15+ others) surfaces that skill using its own invocation syntax:

| Tool | Syntax Example |
|------|----------------|
| Claude Code | `/rasen-propose`, `/rasen-apply-change` |
| Cursor | `/rasen-propose`, `/rasen-apply` |
| Windsurf | `/rasen-propose`, `/rasen-apply` |
| Copilot (IDE) | `/rasen-propose`, `/rasen-apply` |
| Kimi CLI | Skill-based invocations such as `/rasen-propose`, `/rasen-apply-change` |
| Trae | Skill-based invocations such as `/rasen-propose`, `/rasen-apply-change` |

The intent is the same across tools, but how a skill is surfaced can differ by integration — consult your tool's own docs if the syntax above doesn't match what you see.

---

## Troubleshooting

### "Change not found"

The command couldn't identify which change to work on.

**Solutions:**
- Specify the change name explicitly: `rasen-apply-change add-dark-mode`
- Check that the change folder exists: `rasen list`
- Verify you're in the right project directory

### "No artifacts ready"

All artifacts are either complete or blocked by missing dependencies.

**Solutions:**
- Run `rasen status --change <name>` to see what's blocking
- Check if required artifacts exist
- Create missing dependency artifacts first

### "Schema not found"

The specified schema doesn't exist.

**Solutions:**
- List available schemas: `rasen schemas`
- Check spelling of schema name
- Create the schema if it's custom: `rasen schema init <name>`

### Commands not recognized

The AI tool doesn't recognize rasen commands.

**Solutions:**
- Ensure rasen is initialized: `rasen init`
- Regenerate skills: `rasen update`
- Check that `.claude/skills/` directory exists (for Claude Code)
- Restart your AI tool to pick up new skills

### Artifacts not generating properly

The AI creates incomplete or incorrect artifacts.

**Solutions:**
- Add project context in `rasen/config.yaml`
- Add per-artifact rules for specific guidance
- Provide more detail in your change description
- Use `rasen-continue-change` to create and review one artifact at a time instead of all at once

---

## Next Steps

- [Workflows](workflows.md) - Common patterns and when to use each command
- [CLI](cli.md) - Terminal commands for management and validation
- [Customization](customization.md) - Create custom schemas and workflows
