# Workflows

This guide covers common workflow patterns for rasen and when to use each one. For basic setup, see [Getting Started](getting-started.md). For command reference, see [Commands](commands.md).

## Philosophy: Actions, Not Phases

Traditional workflows force you through phases: planning, then implementation, then done. But real work doesn't fit neatly into boxes.

OPSX takes a different approach:

```text
Traditional (phase-locked):

  PLANNING ────────► IMPLEMENTING ────────► DONE
      │                    │
      │   "Can't go back"  │
      └────────────────────┘

OPSX (fluid actions):

  proposal ──► specs ──► design ──► tasks ──► implement
```

**Key principles:**

- **Actions, not phases** - Commands are things you can do, not stages you're stuck in
- **Dependencies are enablers** - They show what's possible, not what's required next

> **Customization:** OPSX workflows are driven by schemas that define artifact sequences. See [Customization](customization.md) for details on creating custom schemas.

## Two Modes

### Quick Path (`core` profile)

New installs default to the `full` profile (every workflow). `core` is a slimmed-down profile you can switch to for the everyday rhythm:
- `/rasen-explore`
- `/rasen-propose`
- `/rasen-apply-change`
- `/rasen-sync-specs`
- `/rasen-archive-change`

Typical flow:

```text
/rasen-explore ──► /rasen-propose ──► /rasen-apply-change ──► /rasen-sync-specs ──► /rasen-archive-change
  (optional)
```

#### Start by exploring (the habit worth forming)

`/rasen-explore` is part of the default profile, not an advanced add-on. It's the move to make whenever you have a problem but not yet a plan, which, with an AI assistant, is most of the time.

```text
You: /rasen-explore

AI:  What would you like to explore?

You: Our search results feel stale. I'm not sure if it's caching,
     indexing, or the query itself.

AI:  Let me look... [reads the search service and cache layer]
     It's the index: it only rebuilds nightly, so edits don't show
     up until the next day. Two options: rebuild on write (simple,
     more load) or a short-TTL cache invalidation (more moving parts,
     less load). Given your write volume is low, rebuild-on-write is
     the cleaner fix. Want to scope it?

You: Yes.

You: /rasen-propose rebuild-search-index-on-write
```

Explore creates no artifacts and writes no code. It's a free, no-stakes conversation that turns a vague worry into a precise change, so the proposal that follows is sharp. Already know exactly what you want? Skip it and go straight to `/rasen-propose`. Full guide: [Explore First](explore.md).

### Expanded/Full Workflow (custom selection)

The explicit scaffold-and-build commands (`/rasen-new-change`, `/rasen-continue-change`, `/rasen-verify-change`, `/rasen-bulk-archive-change`, `/rasen-onboard`) are already installed by default, since new installs default to the `full` profile. If you'd rather slim down to just the `core` set, switch with:

```bash
rasen config profile core
rasen update
```

## Workflow Patterns (Expanded Mode)

### Quick Feature

When you know what you want to build and just need to execute:

```text
/rasen-propose ──► /rasen-apply-change ──► /rasen-verify-change ──► /rasen-archive-change
```

**Example conversation:**

```text
You: /rasen-propose add-logout-button

AI:  Created rasen/changes/add-logout-button/
     Creating all planning artifacts...
     ✓ proposal.md
     ✓ specs/
     ✓ design.md
     ✓ tasks.md
     Ready for implementation!

You: /rasen-apply-change

AI:  Working through tasks...
     ✓ Added logout button to header
     ✓ Implemented session clearing
     ✓ Added confirmation dialog
     All tasks complete!

You: /rasen-archive-change

AI:  ✓ Merged specs
     ✓ Archived change
```

**Best for:** Small to medium features, bug fixes, straightforward changes.

### Exploratory

When requirements are unclear or you need to investigate first:

```text
/rasen-explore ──► /rasen-new-change ──► /rasen-continue-change ──► ... ──► /rasen-apply-change
```

**Example conversation:**

```text
You: /rasen-explore

AI:  What would you like to explore?

You: I want to improve page load performance but I'm not sure
     where the bottlenecks are.

AI:  Let me help investigate...
     [Analyzes bundle sizes, identifies slow queries, reviews
     component render patterns]

     I found three main bottlenecks:
     1. Large unoptimized images
     2. Synchronous data fetching in ProductList
     3. Re-renders from context changes

     Which would you like to address first?

You: Let's tackle the data fetching issue.

You: /rasen-new-change optimize-product-list-fetching

AI:  Created change. Ready to create: proposal

You: /rasen-continue-change

AI:  Creating proposal based on our exploration...
     [Writes proposal incorporating investigation insights]

     Ready to create: specs, design
     Which would you like next?

You: /rasen-continue-change

AI:  Creating specs...
```

**Best for:** Performance optimization, debugging, architectural decisions, unclear requirements.

### Parallel Changes

Work on multiple changes at once:

```text
Change A: /rasen-propose ──► /rasen-apply-change (in progress)
                               │
                          context switch
                               │
Change B: /rasen-propose ──────► /rasen-apply-change
```

**Example conversation:**

```text
You: I'm working on add-dark-mode but got pulled into a bug fix

You: /rasen-propose fix-login-redirect

AI:  Created rasen/changes/fix-login-redirect/
     ✓ Created planning artifacts

You: /rasen-apply-change

AI:  Working on fix-login-redirect...
     [Implements the fix]
     All tasks complete!

You: /rasen-archive-change

AI:  ✓ Archived fix-login-redirect

You: Let's get back to dark mode

You: /rasen-apply-change add-dark-mode

AI:  Resuming add-dark-mode...
     Picking up at task 2.3: Update Header...
```

**Best for:** Parallel work streams, urgent interrupts, team collaboration.

When you have multiple completed changes, use `/rasen-bulk-archive-change`:

```text
You: /rasen-bulk-archive-change

AI:  Found 3 completed changes:
     - add-dark-mode (all tasks done)
     - fix-login-redirect (all tasks done)
     - update-footer (all tasks done)

     Checking for spec conflicts...
     ⚠ add-dark-mode and update-footer both touch specs/ui/

     Inspecting codebase to resolve...
     Both changes are implemented. Will apply in chronological order.

     Archive all 3 changes?

You: Yes

AI:  ✓ Archived add-dark-mode
     ✓ Archived fix-login-redirect
     ✓ Archived update-footer
     Specs merged in order: add-dark-mode → update-footer
```

Bulk archive detects when multiple changes touch the same specs and resolves conflicts by checking what's actually implemented.

### Completing a Change

The recommended completion flow:

```text
/rasen-apply-change ──► /rasen-verify-change ──► /rasen-archive-change
                    │                 │
              validates          prompts to sync
              implementation     if needed
```

#### Verify: Check Your Work

`/rasen-verify-change` validates implementation against your artifacts across three dimensions:

```text
You: /rasen-verify-change

AI:  Verifying add-auth...

     COMPLETENESS
     ✓ All 12 tasks in tasks.md are checked
     ✓ All requirements in specs have corresponding code
     ⚠ Scenario "Session timeout after inactivity" not tested

     CORRECTNESS
     ✓ Implementation matches spec intent
     ✓ Edge cases from scenarios are handled
     ✓ Error states match spec definitions

     COHERENCE
     ✓ Design decisions reflected in code structure
     ✓ Naming conventions consistent with design.md
     ⚠ Design mentions "event-driven" but implementation uses polling

     SUMMARY
     ─────────────────────────────
     Critical issues: 0
     Warnings: 2
     Ready to archive: Yes (with warnings)

     Recommendations:
     1. Add test for session timeout scenario
     2. Consider refactoring to event-driven as designed, or update design.md
```

**What verify checks:**

| Dimension | What it validates |
|-----------|------------------|
| Completeness | All tasks done, all requirements implemented, scenarios covered |
| Correctness | Implementation matches spec intent, edge cases handled |
| Coherence | Design decisions reflected in code, patterns consistent |

Verify won't block archive, but it surfaces issues you might want to address first.

#### Review Cycle: Loop Until Clean (opt-in)

`/rasen-verify-change` is a single pass. `/rasen-review-cycle` is the **loop** that wraps a reviewer and keeps going until the change is actually clean:

```text
review ──► triage ──► fix ──► re-review(Δ) ──► { pass | loop | escalate }
```

Each review pass delegates to the always-installed `rasen-review` engine — the loop does not reimplement review heuristics. It adds four things on top:

- **Fix-size triage.** Each finding is routed by the size of its fix: **trivial** → orchestrator inline; **non-trivial** → the implementing agent that wrote the code; **design-level** → a separate fix agent (not the original author).
- **Author ≠ verifier.** A finding is resolved only when a reviewer who did NOT author the fix confirms it against the original finding. For a trivial inline fix, an independent gate-run (tests/lint/build) plus a diff-read of the exact change is the equivalent non-author check — and it must be recorded in the cycle report.
- **Re-review only the delta.** On Claude Code with agent-teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) the lead may resume the original reviewer via `SendMessage` to re-review just the delta (only the lead may originate `SendMessage`). Otherwise it falls back to a fresh delta review with the prior findings and the fix diff passed through a shared file — equivalent outcome, just costlier.
- **Bounded termination.** The loop caps at max rounds (default 3). On the cap with unresolved Blocker/Major findings it escalates to a human with the open findings and round history — it never silently reports a clean pass.

Use it AFTER implementation, against the live diff. It is opt-in: enable it via a custom profile (it is not in `core`). The round history and each non-author confirmation are recorded in `review-cycle-report.md` in the change directory.

#### Archive: Finalize the Change

`/rasen-archive-change` completes the change and moves it to the archive:

```text
You: /rasen-archive-change

AI:  Archiving add-auth...

     Artifact status:
     ✓ proposal.md exists
     ✓ specs/ exists
     ✓ design.md exists
     ✓ tasks.md exists (12/12 tasks complete)

     Delta specs: Not yet synced to main
     → Would you like to sync now?

You: Yes

AI:  ✓ Synced specs to rasen/specs/auth/spec.md
     ✓ Moved to rasen/changes/archive/2025-01-24-add-auth/

     Change archived successfully.
```

Archive will prompt if specs aren't synced. It won't block on incomplete tasks, but it will warn you.

## When to Use What

### `/rasen-propose` vs `/rasen-continue-change`

| Situation | Use |
|-----------|-----|
| Clear requirements, ready to build | `/rasen-propose` |
| Exploring, want to review each step | `/rasen-new-change` then `/rasen-continue-change` |
| Want to iterate on proposal before specs | `/rasen-new-change` then `/rasen-continue-change` |
| Time pressure, need to move fast | `/rasen-propose` |
| Complex change, want control | `/rasen-new-change` then `/rasen-continue-change` |

**Rule of thumb:** If you can describe the full scope upfront, use `/rasen-propose`. If you're figuring it out as you go, use `/rasen-new-change` then `/rasen-continue-change`.

### When to Update vs Start Fresh

A common question: when is updating an existing change okay, and when should you start a new one?

**Update the existing change when:**

- Same intent, refined execution
- Scope narrows (MVP first, rest later)
- Learning-driven corrections (codebase isn't what you expected)
- Design tweaks based on implementation discoveries

**Start a new change when:**

- Intent fundamentally changed
- Scope exploded to different work entirely
- Original change can be marked "done" standalone
- Patches would confuse more than clarify

```text
                     ┌─────────────────────────────────────┐
                     │     Is this the same work?          │
                     └──────────────┬──────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
          Same intent?      >50% overlap?      Can original
          Same problem?     Same scope?        be "done" without
                 │                  │          these changes?
                 │                  │                  │
       ┌────────┴────────┐  ┌──────┴──────┐   ┌───────┴───────┐
       │                 │  │             │   │               │
      YES               NO YES           NO  NO              YES
       │                 │  │             │   │               │
       ▼                 ▼  ▼             ▼   ▼               ▼
    UPDATE            NEW  UPDATE       NEW  UPDATE          NEW
```

**Example: "Add dark mode"**

- "Need to also support custom themes" → New change (scope exploded)
- "System preference detection is harder than expected" → Update (same intent)
- "Let's ship toggle first, add preferences later" → Update then archive, then new change

## Best Practices

### Keep Changes Focused

One logical unit of work per change. If you're doing "add feature X and also refactor Y", consider two separate changes.

**Why it matters:**
- Easier to review and understand
- Cleaner archive history
- Can ship independently
- Simpler rollback if needed

### Use `/rasen-explore` for Unclear Requirements

Before committing to a change, explore the problem space:

```text
You: /rasen-explore

AI:  What would you like to explore?

You: How should we handle rate limiting for our API?

AI:  Let me investigate your current setup and options...
     [Researches codebase, considers patterns]

     I see three approaches we could take:
     1. Middleware-based (simple, per-endpoint)
     2. Redis-backed (scalable, shared state)
     3. Token bucket per user (fair, complex)

     Your current stack suggests #1 or #2. What's your scale?
```

Exploration clarifies thinking before you create artifacts.

### Verify Before Archiving

Use `/rasen-verify-change` to check implementation matches artifacts:

```text
You: /rasen-verify-change

AI:  Verifying add-dark-mode...

     ✓ All tasks in tasks.md are checked
     ✓ Requirements in specs have corresponding code
     ✓ Design decisions are reflected in implementation

     Ready to archive!
```

Catches mismatches before you close out the change.

### Name Changes Clearly

Good names make `rasen list` useful:

```text
Good:                          Avoid:
add-dark-mode                  feature-1
fix-login-redirect             update
optimize-product-query         changes
implement-2fa                  wip
```

## Command Quick Reference

For full command details and options, see [Commands](commands.md).

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/rasen-propose` | Create change + planning artifacts | Fast default path (`core` profile) |
| `/rasen-explore` | Think through ideas with the AI | Start here when unsure: unclear requirements, investigation, comparing options |
| `/rasen-new-change` | Start a change scaffold | Expanded mode, explicit artifact control |
| `/rasen-continue-change` | Create next artifact | Expanded mode, step-by-step artifact creation |
| `/rasen-apply-change` | Implement tasks | Ready to write code |
| `/rasen-verify-change` | Validate implementation | Expanded mode, before archiving |
| `/rasen-sync-specs` | Merge delta specs | Expanded mode, optional |
| `/rasen-archive-change` | Complete the change | All work finished |
| `/rasen-bulk-archive-change` | Archive multiple changes | Expanded mode, parallel work |

## Next Steps

- [Writing Good Specs](writing-specs.md) - What a strong requirement and scenario look like, and how to right-size a change
- [Reviewing a Change](reviewing-changes.md) - The two-minute pass on a drafted plan before any code
- [Rasen on a Team](team-workflow.md) - How changes fit branches and pull requests
- [Commands](commands.md) - Full command reference with options
- [Concepts](concepts.md) - Deep dive into specs, artifacts, and schemas
- [Customization](customization.md) - Create custom workflows
