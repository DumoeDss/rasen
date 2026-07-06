<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Skill Authoring Guide

The writing standard for authoring and editing skills in this repo — the gstack
expert skills (`skills/gstack/<name>/SKILL.md.tmpl`) and the OpenSpec workflow
skills. It is a repository document, not an installable skill: it has no
template, no registration, and no effect on skill counts.

A skill exists to wrangle determinism out of a stochastic system.
**Predictability** — the agent taking the same _process_ every run, not
producing the same output — is the root virtue; every lever below serves it.

## Invocation

A skill is reached one of two ways, and the choice trades two different costs:

- A **model-invoked** skill keeps a `description`, so the agent can fire it
  autonomously _and_ other skills can reach it (you can still type its name
  too). It contributes to **context load** — the description sits in the
  window every turn. Mechanics: omit `disable-model-invocation`, and write a
  model-facing description with rich trigger phrasing ("Use when the user
  wants…, mentions…").
- A **user-invoked** skill strips the description from the agent's reach: only a
  human typing its name can invoke it, and no other skill can. Zero context
  load, but it spends **cognitive load** — the human is the index that must
  remember it exists. Mechanics: set `disable-model-invocation: true`; the
  `description` becomes a human-facing one-line summary with trigger lists
  stripped.

Pick model-invocation only when the agent must reach the skill on its own, or
another skill must. If it only ever fires by hand, make it user-invoked and pay
no context load. When user-invoked skills multiply past what you can remember,
cure that piled-up cognitive load with a **router skill**: one user-invoked
skill that names the others and when to reach for each.

## Writing the description

A model-invoked `description` does two jobs — state what the skill is, and list
the **branches** that should trigger it. Every word increases context load, so
the description earns even harder pruning than the body:

- **Front-load the skill's leading word** — the description is where it does its
  invocation work.
- **One trigger per branch.** Synonyms that rename a single branch are
  **duplication** — "build features using TDD … asks for test-first
  development" is one branch written twice. Collapse them; keep only genuinely
  distinct branches.
- **Cut identity that's already in the body.** Keep the description to triggers,
  plus any "when another skill needs…" reach clause.

## Information hierarchy

A skill is built from two content types — **steps** and **reference** — that
mix freely. The core decision is which to use and where each sits on the
**information hierarchy**, a ladder ranked by how immediately the agent needs
the material:

1. **In-skill step** — an ordered action in `SKILL.md`, the primary tier. Each
   step ends on a **completion criterion**, the condition that tells the agent
   the work is done. Make it _checkable_ (can the agent tell done from
   not-done?) and, where it matters, _exhaustive_ ("every modified model
   accounted for", not "produce a change list") — a vague criterion invites
   **premature completion**.
2. **In-skill reference** — a definition, rule, or fact in `SKILL.md`, consulted
   on demand. Often a legitimately flat peer-set (every rule of a review on one
   rung) — a fine arrangement, not a smell.
3. **External reference** — reference pushed out of `SKILL.md` into a separate
   file (a sidecar such as `GLOSSARY.md` or `DEEPENING.md`), reached by a
   **context pointer** and loaded only when the pointer fires.

Push too little down and the top bloats; push too much and you hide material the
agent actually needs. That tension is the whole decision. **Progressive
disclosure** — moving reference out of `SKILL.md` into a linked file — is how
the top stays legible. Branching is the cleanest disclosure test: inline what
every branch needs, and push behind a pointer what only some branches reach. A
context pointer's _wording_, not its target, decides when and how reliably the
agent reaches the material.

Where the ladder decides _how far down_ a piece sits, **co-location** decides
_what sits beside it_ once there: keep a concept's definition, rules, and
caveats under one heading rather than scattered, so reading one part brings its
neighbours with it.

## When to split

**Granularity** is how finely you divide skills, and each cut spends one of the
two loads, so split only when the cut earns it:

- **By invocation** — split off a model-invoked skill when you have a distinct
  **leading word** that should trigger it on its own, or another skill must
  reach it. You pay context load for the new always-loaded description, so that
  independent reach has to be worth it.
- **By sequence** — split a run of steps when the steps still ahead (a step's
  **post-completion steps**) tempt the agent to rush the one in front of it.
  Keeping them out of view encourages more **legwork** on the current task.

## Leading words

A **leading word** is a compact concept already living in the model's
pretraining that the agent thinks with while running the skill (e.g. _lesson_,
_fog of war_, _tracer bullets_, _seam_, _deep module_, _ubiquitous language_).
Repeated as a token throughout the text (though a strong leading word might only
be needed once), it accumulates a distributed definition and anchors a whole
region of behaviour in the fewest tokens, by recruiting priors the model already
holds.

It serves predictability twice. In the body it anchors _execution_: the agent
reaches for the same behaviour every time the word appears. In the description
it anchors _invocation_: when the same word lives in your prompts, docs, and
code, the agent links that shared language to the skill and fires it more
reliably.

Coining your own works if you define it clearly, but a made-up word recruits no
priors — you pay in definition tokens what a pretrained word gives free. Reach
for an existing word first. Hunt for opportunities to refactor a skill onto
leading words: a triad spelled out at three sites, or a description spending a
sentence to gesture at one idea, is a passage begging to collapse into a single
token.

- "fast, deterministic, low-overhead" → _tight_ (a _tight_ loop).
- "a loop you believe in" → _red_ (the loop goes _red_ on the bug, or it
  doesn't).

## Pruning

Keep each meaning in a **single source of truth**: one authoritative place, so
changing the behaviour is a one-place edit.

Check every line for **relevance**: does it still bear on what the skill does?

Then hunt **no-ops** sentence by sentence, not just line by line: run the no-op
test on each sentence in isolation, and when one fails, delete the whole
sentence rather than trim words from it. Be aggressive — most prose that fails
should go, not be rewritten.

## Failure-mode clinic

Use these to diagnose issues with a skill.

- **Premature completion** — ending a step before it's genuinely done, attention
  slipping to _being done_. Defence, in order: sharpen the completion criterion
  first (cheap, local); only if it is irreducibly fuzzy _and_ you observe the
  rush, hide the post-completion steps by splitting the sequence.
- **Duplication** — the same meaning in more than one place. Costs maintenance
  and tokens, and inflates a meaning's prominence on the ladder past its real
  rank. The accidental inverse of a leading word, which raises attention on
  purpose by repeating a token, never the meaning.
- **Sediment** — stale layers that settle because adding feels safe and removing
  feels risky. The default fate of any skill without a pruning discipline.
- **Sprawl** — a skill simply too long, even when every line is live and unique.
  The cure is the ladder: disclose reference behind pointers, and split by
  branch or sequence so each path carries only what it needs.
- **No-op** — a line the model already obeys by default, so you pay load to say
  nothing. The test: does it change behaviour versus the default? A weak leading
  word (_be thorough_ when the agent is already thorough-ish) is a no-op; the
  fix is a stronger word (_relentless_), not a different technique. This is
  model-relative — settle a no-op disagreement by running the skill, not by
  debate.
