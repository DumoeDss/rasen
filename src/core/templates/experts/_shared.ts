/**
 * Shared instruction blocks for expert skill templates.
 *
 * These constants are the single source of truth for prose blocks interpolated
 * into the expert template strings in `experts/*.ts` (via `${BLOCK}`). Freshness
 * is pinned by the parity golden-master in
 * `test/core/templates/skill-templates-parity.test.ts`.
 *
 * The browser-driving blocks (`CHROME_USE_SETUP`, `CHROME_USE_SNAPSHOT`,
 * `CHROME_USE_ENDPOINTS`, and the methodology blocks) instruct the reader to drive
 * the vendored chrome-use CDP proxy over its curl endpoints at `localhost:3456`;
 * endpoint names/params mirror `skills/experts/chrome-use/references/cdp-api.md`.
 */

const PREAMBLE_BASE = `## Preamble (run first)

\`\`\`bash
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
\`\`\`

**Config (embedded at install time):**
- **Proactive:** \`__OPENSPEC_PROACTIVE__\` — if \`false\`, do not proactively suggest expert skills. Only invoke them when the user explicitly asks.`;

const REPO_MODE_CONFIG = `- **Repo mode:** \`__OPENSPEC_REPO_MODE__\` — controls issue ownership behavior (see Repo Ownership Mode below).`;

const SEVERITY_VOCABULARY = `## Canonical severity vocabulary

Findings from the generic expert skills (review, cso, qa, qa-only, benchmark, design-review) feed one canonical severity scale — the same scale the review→fix loop and the verify stage consume to decide clean vs. escalate. Classify against these four levels:

- **Blocker** — must not ship: wrong behavior on a common path, data loss or corruption, an exploitable security hole, a failing test or gate, or a required spec behavior missing.
- **Major** — should not ship without an explicit decision: wrong behavior on a plausible path, or a significant regression.
- **Minor** — ship-able friction or quality; recorded as accepted-known, never silently dropped.
- **Trivial** — cosmetic or a nit.

Each expert speaks a native scale; map it onto the canonical scale below. **Finding content overrides the native label where they disagree** — an item that names data loss, a security hole, or silent corruption maps UP regardless of the label its skill gave it (e.g. a review \`INFORMATIONAL\` item describing silent data corruption is Major, not Minor).

| Expert (native scale) | Blocker | Major | Minor | Trivial |
|---|---|---|---|---|
| review \`CRITICAL\` / \`INFORMATIONAL\` | \`CRITICAL\` naming data-loss / security / corruption / crash on a common path | other \`CRITICAL\` (correctness); \`INFORMATIONAL\` naming data-loss / security / silent corruption | \`INFORMATIONAL\` (default) | pure nit / style |
| cso \`CRITICAL\` / \`HIGH\` / \`MEDIUM\` (+ conf N/10) | \`CRITICAL\` | \`HIGH\` | \`MEDIUM\` | — (cso drops < MEDIUM by design) |
| qa / qa-only \`critical\` / \`high\` / \`medium\` / \`low\` / \`cosmetic\` | \`critical\` | \`high\` | \`medium\` / \`low\` | \`cosmetic\` |
| benchmark \`REGRESSION\` / \`WARNING\` / \`OK\` (+ Grade A–F) | \`REGRESSION\` crossing a hard budget (a FAIL row) | \`REGRESSION\` (timing / size) | \`WARNING\` | \`OK\`; grade-only deltas |
| design-review impact \`high\` / \`medium\` / \`polish\` (+ Grade A–F) | high-impact broken / unusable UI (rare) | high impact | medium | polish |
| codex \`[P1]\` / \`[P2]\` (display-only, not gate-consumed) | \`[P1]\` | \`[P2]\` | — | — |

In dispatched mode (see below) each expert self-maps and tags every finding it emits with a canonical severity in its report file, so the LEAD and the loop never have to infer a mapping.`;

const DISPATCH_CONTRACT = `## Dispatched vs standalone mode

The generic expert skills (review, cso, qa, qa-only, benchmark, design-review) run in one of two modes. Detect the mode from your own invocation — no flag is required:

- **Dispatched (report-only) mode** — your invocation instructs you to do a single unit of work, to not spawn subagents, and states that a LEAD owns orchestration (the signature every orchestrated dispatch carries). You are a role-isolated leaf reviewer worker.
- **Standalone mode** — a human invoked you directly (none of the above). Keep your full behavior as described in this skill.

If an explicit \`MODE: dispatched (report-only)\` token is present in your instructions, honor it; the self-trigger above is the fallback when the token is absent.

**In dispatched mode you MUST:**
- Apply **no** AUTO-FIX and make **no** code edits. Fix-class items are reported for the LEAD's triage to a non-author fixer, never applied by you.
- Issue **no** \`AskUserQuestion\`. There is no interactive user at a leaf worker; ASK-class items are reported as unresolved findings for the LEAD.
- Make **no** \`git commit\`. The LEAD / ship owns commits; concurrent commits on the shared index clobber each other.
- Spawn **no** subagents of your own. Independence comes from the LEAD's parallel reviewers and the mandatory non-author re-review, not from a leaf worker's own fan-out.
- Return classified findings and **write only the canonical \`<skill>-report.md\`** (review → \`review-report.md\`, cso → \`cso-report.md\`, qa and qa-only → \`qa-report.md\`, benchmark → \`benchmark-report.md\`, design-review → \`design-review-report.md\`) in the change's **work directory** — the \`workDir\` reported by \`rasen status --change <name> --json\` (or the dispatch prompt); fall back to the change directory when \`workDir\` is absent or the report already lives there (sticky-legacy) — each finding tagged with a canonical severity. Do NOT also write to the standalone \`.rasen/*-reports/\` or \`~/.rasen/projects/\` paths.

These dispatched-mode prohibitions **override** any contrary standalone instruction later in this skill (fix loops, batched questions, clean-tree gates, adversarial subagent dispatch, native report paths). Standalone mode retains all of that behavior.

**Denied-edit honesty.** If an Edit or Write you attempt is **denied** by an active edit boundary — a \`/freeze\` or \`/guard\` whose target is outside the allowed directory — the fix did NOT land. Report it as an un-applied finding, \`[BLOCKED: freeze/guard] file:line — proposed fix\`, never as \`[AUTO-FIXED]\`, and never silently drop it. The boundary hook wins over any Fix-First rule; do not claim a fix succeeded when it was refused. (Dispatched mode does no AUTO-FIX at all; this clause primarily governs the standalone fix loops.)`;

const ASK_USER_QUESTION_FORMAT = `## AskUserQuestion Format

**ALWAYS follow this structure for every AskUserQuestion call:**
1. **Re-ground (per the Dialogue Override):** State the project, the current branch (use the \`_BRANCH\` value printed by the preamble — NOT any branch from conversation history or gitStatus), and the current plan/task (1-2 sentences). This step follows the Dialogue Override's re-ground rule — restate at the START of a session or after a genuine long gap, NOT on every consecutive AskUserQuestion call in continuous back-and-forth. The "for every AskUserQuestion call" framing above does NOT require repeating the full project/branch/plan opener between consecutive replies (steps 2–4 apply every call; this re-ground is gap-gated).
2. **Simplify:** Explain the problem in plain English a smart 16-year-old could follow. No raw function names, no internal jargon, no implementation details. Use concrete examples and analogies. Say what it DOES, not what it's called.
3. **Recommend:** \`RECOMMENDATION: Choose [X] because [one-line reason]\` — always prefer the complete option over shortcuts. Include \`Completeness: X/10\` for each option **only when the decision weighs a shortcut against a complete implementation**; discussion-type or exploratory forks do NOT carry a Completeness score. Calibration (when it applies): 10 = complete implementation (all edge cases, full coverage), 7 = covers happy path but skips some edges, 3 = shortcut that defers significant work. If both options are 8+, pick the higher; if one is ≤5, flag it.
4. **Options:** Lettered options: \`A) ... B) ... C) ...\` — when an option involves effort, show both scales: \`(human: ~X / CC: ~Y)\`

Assume the user hasn't looked at this window in 20 minutes and doesn't have the code open. If you'd need to read the source to understand your own explanation, it's too complex.

Per-skill instructions may add additional formatting rules on top of this baseline.`;

const DIALOGUE_OVERRIDE = `## Dialogue Override

AskUserQuestion is a **decision tool, not a conversation tool.** Before every AskUserQuestion call, read the user's previous message. If it contains a question, a request to explain or discuss, or free-text that is not a clean selection of one of your options → **pause the question flow.** Answer in body prose — no lettered options, no \`RECOMMENDATION\`, no \`Completeness\` score — and keep discussing until the user explicitly signals to proceed. Then resume the phase exactly where you paused; never skip ahead.

- **Never answer and advance in the same turn.** Answer the question this turn; ask your next question only once the user signals they are ready.
- **A request for more dialogue is the opposite of a skip signal.** "Answer me first," "let's discuss," and repeated follow-up questions mean the user wants *more* conversation — they NEVER trigger a fast-forward, an escape hatch, or a jump to the next phase.
- **Re-ground only after a genuine long gap.** In continuous back-and-forth, do not repeat the template opener (project / branch / plan restatement) on every turn — it belongs at the start of a session or after the user has been away, not between consecutive replies.`;

const REPO_OWNERSHIP = `## Repo Ownership Mode — See Something, Say Something

\`Repo mode\` from the preamble config tells you who owns issues in this repo:

- **\`solo\`** — One person does 80%+ of the work. They own everything. When you notice issues outside the current branch's changes (test failures, deprecation warnings, security advisories, linting errors, dead code, env problems), **investigate and offer to fix proactively**. The solo dev is the only person who will fix it. Default to action.
- **\`collaborative\`** — Multiple active contributors. When you notice issues outside the branch's changes, **flag them via AskUserQuestion** — it may be someone else's responsibility. Default to asking, not fixing.
- **\`unknown\`** — Treat as collaborative (safer default — ask before fixing).

**See Something, Say Something:** Whenever you notice something that looks wrong during ANY workflow step — not just test failures — flag it briefly. One sentence: what you noticed and its impact. In solo mode, follow up with "Want me to fix it?" In collaborative mode, just flag it and move on.

Never let a noticed issue silently pass. The whole point is proactive communication.

**Scope (dispatched leaf workers override this section):** every absolute above — \`solo\`'s "**investigate and offer to fix proactively**" / "**Default to action**", the "**ANY workflow step**" reach of See-Something-Say-Something, and "**Never let a noticed issue silently pass**" — is scoped to **interactive / standalone** sessions, where you can actually reach the user to offer a fix. When you are a **dispatched leaf worker** (a one-unit-of-work dispatch under the LEAD; see the dispatched-mode contract), this whole section is OVERRIDDEN: an out-of-scope issue you notice goes into your \`DONE\` **durable-findings** for the LEAD to triage — you do NOT investigate it, fix it, or ask the user about it (you cannot reach the user, and investigating breaks your one-unit-of-work isolation). Recording it in durable-findings IS "not letting it silently pass" — it is the dispatched-mode form of the same discipline. This is consistent with the dispatched-mode one-unit-of-work contract; it does NOT reopen the report-only dispatched contract.`;

const COMPLETION_STATUS = `## Completion Status Protocol

When completing a skill workflow, report status using one of:
- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.

### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result."

Bad work is worse than no work. You will not be penalized for escalating.
- If you have attempted a task 3 times without success, STOP and escalate.
- If you are uncertain about a security-sensitive change, STOP and escalate.
- If the scope of work exceeds what you can verify, STOP and escalate.

Escalation format:
\`\`\`
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
\`\`\``;

const PLAN_STATUS_FOOTER = `## Plan Status Footer

When you are in plan mode and about to call ExitPlanMode:

1. Check if the plan file already has a \`## RASEN REVIEW REPORT\` section.
2. If it DOES — skip (a review skill already wrote a richer report).
3. If it does NOT — write a \`## RASEN REVIEW REPORT\` section to the end of the plan file with this placeholder table:

\\\`\\\`\\\`markdown
## RASEN REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Verify | \\\`/rasen-verify-change\\\` | Implementation matches the change artifacts | 0 | — | — |
| Verify (enhanced) | \\\`/rasen-verify-enhanced\\\` | Adds code-review, security, and browser passes | 0 | — | — |
| Review cycle | \\\`/rasen-review-cycle\\\` | Iterate review → triage → fix until clean | 0 | — | — |
| Codex Review | \\\`/codex review\\\` | Independent 2nd opinion | 0 | — | — |

**VERDICT:** NO REVIEWS YET — run \\\`/rasen-review-cycle\\\` for the full review loop, or the individual reviews above.
\\\`\\\`\\\`

**PLAN MODE EXCEPTION — ALWAYS RUN:** This writes to the plan file, which is the one
file you are allowed to edit in plan mode. The plan file review report is part of the
plan's living status.`;

/**
 * Full orchestration preamble — for the generic review-family experts
 * (review, cso, qa, qa-only, benchmark, design-review, codex) whose findings
 * feed the canonical severity scale and the dispatched-mode contract.
 */
export const PREAMBLE = [
  `${PREAMBLE_BASE}\n${REPO_MODE_CONFIG}`,
  SEVERITY_VOCABULARY,
  DISPATCH_CONTRACT,
  ASK_USER_QUESTION_FORMAT,
  DIALOGUE_OVERRIDE,
  REPO_OWNERSHIP,
  COMPLETION_STATUS,
  PLAN_STATUS_FOOTER,
].join('\n\n');

/**
 * Dialogue preamble — for interactive experts that run AskUserQuestion-driven
 * sessions (office-hours, design-consultation, investigate) but emit no
 * severity-scaled findings and are never dispatched as leaf reviewers.
 */
export const PREAMBLE_DIALOGUE = [
  `${PREAMBLE_BASE}\n${REPO_MODE_CONFIG}`,
  ASK_USER_QUESTION_FORMAT,
  DIALOGUE_OVERRIDE,
  REPO_OWNERSHIP,
  COMPLETION_STATUS,
].join('\n\n');

/**
 * Lite preamble — for tool-type experts (chrome-use, prototype, tdd,
 * codebase-design, navigator). Branch echo plus the proactive config flag;
 * none of the review-orchestration protocol applies to them.
 */
export const PREAMBLE_LITE = PREAMBLE_BASE;

export const CHROME_USE_SETUP = `## SETUP (run this BEFORE any chrome-use command)

chrome-use drives your everyday Chrome over the Chrome DevTools Protocol via a
sticky local proxy on \`localhost:3456\`. Verify prerequisites and start the proxy:

\`\`\`bash
node "\${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
\`\`\`

This checks Node 22+, detects Chrome's debug port, and starts the proxy if it is
not already running. Expect \`node: ok\`, \`chrome: ok (port NNNN)\`, \`proxy: ready\`.

- **Chrome not connected?** Open \`chrome://inspect/#remote-debugging\` and tick
  **Allow remote debugging** (Chrome must already be running).
- **First connection** triggers a one-time Chrome **"Allow"** popup — if
  \`check-deps.mjs\` hangs on \`proxy: connecting...\`, click Allow.
- **Sticky proxy — never stop it.** Restarting forces re-authorizing CDP; reuse the
  running instance across every command.

Then open a background tab and reuse its \`targetId\` on all subsequent calls:

\`\`\`bash
TAB=$(curl --noproxy '*' -s "localhost:3456/new?url=about:blank" | jq -r .targetId)
\`\`\`

Tabs are isolated per \`targetId\` (the shared proxy serves multiple sub-agents).
Close yours when done: \`curl --noproxy '*' "localhost:3456/close?target=$TAB"\`.

**Every curl below passes \`--noproxy '*'\`** — on a machine with a configured
\`HTTP(S)_PROXY\`, \`curl localhost:3456\` is otherwise hijacked by the proxy and
returns 502. Keep the flag on every call; it bypasses the proxy for that one localhost
request regardless of environment.`;

export const CHROME_USE_SNAPSHOT = `\`/snapshot\` is your primary tool for understanding and interacting with pages. It
returns a serialized interactive DOM tree — each element with a stable \`@ref\`, an
ARIA \`role\`, its \`name\`/text, and its \`tag\`.

\`\`\`bash
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB"            # mode=i (default): interactive elements
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=C"     # + non-ARIA clickables (@c refs)
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=D"     # diff vs this tab's previous snapshot
\`\`\`

**Modes:**
- \`mode=i\` — interactive elements only (links, buttons, inputs, and anything with \`role\`/\`onclick\`/\`tabindex\`); assigned \`@e\` refs.
- \`mode=C\` — also includes non-ARIA clickables (divs with \`cursor:pointer\`, \`onclick\`, or \`tabindex\`); assigned \`@c\` refs. Use it for tricky UIs the accessibility tree misses.
- \`mode=D\` — reports what changed (added/removed) since the last snapshot of this \`targetId\`. Snapshot before an action, then \`mode=D\` after, to see exactly what changed.

**Interacting with what you found:** the snapshot is an inventory — act on elements by
CSS selector via \`/click\`, \`/clickAt\`, or \`/eval\`:
\`\`\`bash
curl --noproxy '*' -sX POST "localhost:3456/click?target=$TAB" -d 'button[type=submit]'
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB"  -d 'document.querySelector("#email").value="user@test.com"'
\`\`\`

The diff baseline is per-tab and in-memory (reset if the proxy restarts). Re-snapshot
after navigation — the DOM is rebuilt.`;

export const CHROME_USE_ENDPOINTS = `All endpoints are HTTP calls against the sticky proxy at \`localhost:3456\`; pass your
tab as \`target=$TAB\`. See \`references/cdp-api.md\` (beside this skill) for the full
list and every parameter.

### Navigation
| Endpoint | Description |
|----------|-------------|
| \`GET /new?url=<url>\` | Open a background tab (auto-waits load); returns \`{targetId}\` |
| \`GET /navigate?target=$TAB&url=<url>\` | Navigate current tab (auto-waits); add \`&hard_reload=true\` for a no-cache reload |
| \`GET /back?target=$TAB\` | History back |
| \`GET /info?target=$TAB\` | \`{title, url, ready}\` (current URL / readiness) |
| \`GET /close?target=$TAB\` | Close the tab |

### Reading
| Endpoint | Description |
|----------|-------------|
| \`GET /text?target=$TAB&selector=<sel>\` | \`{text, value}\` — innerText + input value |
| \`GET /attribute?target=$TAB&selector=<sel>&name=<attr>\` | One attribute value |
| \`POST /eval?target=$TAB\` (body = JS) | Run JS (supports await); returns \`{value}\`. Use for link/form extraction, e.g. map \`document.links\` |
| \`GET /resources?target=$TAB[&type=&contains=]\` | PerformanceResourceTiming entries |
| \`GET /iframes?target=$TAB\` | Cross-origin iframe targets (attach independently) |

### Interaction
| Endpoint | Description |
|----------|-------------|
| \`POST /click?target=$TAB\` (body = CSS sel) | JS-layer \`el.click()\` |
| \`POST /clickAt?target=$TAB[&visible=true&nth=N&text=...]\` (body = CSS sel) | Real mouse click, filterable by visibility/index/text |
| \`POST /eval?target=$TAB\` (body = JS) | Fill / select / type via \`document.querySelector(...).value=...\` (no dedicated /fill endpoint) |
| \`POST /setFiles?target=$TAB\` (JSON \`{selector,files[]}\`) | Set a file input's paths (bypasses the OS dialog) |
| \`GET /scroll?target=$TAB&y=N&direction=down\\|up\\|top\\|bottom\` | Scroll (waits ~800ms for lazy load) |
| \`GET /wait?target=$TAB&selector=<sel>[&visible=true&timeout=10000]\` | Wait for an element; \`POST\` body = JS to wait for a truthy expression |

### Inspection
| Endpoint | Description |
|----------|-------------|
| \`GET /console/enable?target=$TAB\` → \`GET /console?target=$TAB[&level=error&contains=&since=&limit=]\` | Console messages / exceptions / logs |
| \`GET /cookies?target=$TAB\` · \`POST /cookies?target=$TAB\` (JSON) | Read / write cookies |
| \`GET /localStorage?target=$TAB[&key=]\` · \`POST /localStorage?target=$TAB\` (JSON) | Read / write localStorage |
| \`GET /perf?target=$TAB\` | LCP / FCP / CLS + resource timing + nav timing |
| \`GET /network/enable?target=$TAB[&body=true]\`, \`/network/events\`, \`/network/wait\`, \`/network/body\` | Browser-layer network capture |

### Visual
| Endpoint | Description |
|----------|-------------|
| \`GET /screenshot?target=$TAB&file=<path>[&full=true&format=png\\|jpeg&retries=N]\` | Save a screenshot (\`full=true\` = beyond viewport) |
| \`GET /viewport?target=$TAB&width=W&height=H[&scale=S&mobile=true]\` | Device viewport emulation — does NOT resize the real window |
| \`GET /responsive?target=$TAB[&screenshot=true&dir=<dir>]\` | Emulate mobile/tablet/desktop breakpoints; optional per-breakpoint screenshots |

### Snapshot
| Endpoint | Description |
|----------|-------------|
| \`GET /snapshot?target=$TAB[&mode=i\\|C\\|D]\` | Interactive DOM tree with @refs: \`i\` interactive, \`C\` +clickables, \`D\` diff vs previous |`;

export const BASE_BRANCH_DETECT = `## Step 0: Detect base branch

Determine which branch this PR targets. Use the result as "the base branch" in all subsequent steps.

1. Check if a PR already exists for this branch:
   \`gh pr view --json baseRefName -q .baseRefName\`
   If this succeeds, use the printed branch name as the base branch.

2. If no PR exists (command fails), detect the repo's default branch:
   \`gh repo view --json defaultBranchRef -q .defaultBranchRef.name\`

3. If both commands fail, fall back to \`main\`.

Print the detected base branch name. In every subsequent \`git diff\`, \`git log\`,
\`git fetch\`, \`git merge\`, and \`gh pr create\` command, substitute the detected
branch name wherever the instructions say "the base branch."

---`;

export const PLAN_FILE_REVIEW_REPORT = `## Plan File Review Report

After displaying the Review Readiness Dashboard in conversation output, also update the
**plan file** itself so review status is visible to anyone reading the plan.

### Detect the plan file

1. Check if there is an active plan file in this conversation (the host provides plan file
   paths in system messages — look for plan file references in the conversation context).
2. If not found, skip this section silently — not every review runs in plan mode.

### Generate the report

Read the review log output you already have from the Review Readiness Dashboard step above.
Parse each JSONL entry. Each skill logs different fields:

- **codex-review**: \\\`status\\\`, \\\`gate\\\`, \\\`findings\\\`, \\\`findings_fixed\\\`
  → Findings: "{findings} findings, {findings_fixed}/{findings} fixed"

All fields needed for the Findings column are now present in the JSONL entries.
For the review you just completed, you may use richer details from your own Completion
Summary. For prior reviews, use the JSONL fields directly — they contain all required data.

Produce this markdown table:

\\\`\\\`\\\`markdown
## RASEN REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Verify | \\\`/rasen-verify-change\\\` | Implementation matches the change artifacts | {runs} | {status} | {findings} |
| Verify (enhanced) | \\\`/rasen-verify-enhanced\\\` | Adds code-review, security, and browser passes | {runs} | {status} | {findings} |
| Review cycle | \\\`/rasen-review-cycle\\\` | Iterate review → triage → fix until clean | {runs} | {status} | {findings} |
| Codex Review | \\\`/codex review\\\` | Independent 2nd opinion | {runs} | {status} | {findings} |
\\\`\\\`\\\`

Below the table, add these lines (omit any that are empty/not applicable):

- **CODEX:** (only if codex-review ran) — one-line summary of codex fixes
- **CROSS-MODEL:** (only if both Claude and Codex reviews exist) — overlap analysis
- **UNRESOLVED:** total unresolved decisions across all reviews
- **VERDICT:** list reviews that are CLEAR (e.g., "VERIFY + REVIEW-CYCLE CLEARED — ready to implement").
  If the review cycle is not CLEAR and not skipped globally, append "review required".

### Write to the plan file

**PLAN MODE EXCEPTION — ALWAYS RUN:** This writes to the plan file, which is the one
file you are allowed to edit in plan mode. The plan file review report is part of the
plan's living status.

- Search the plan file for a \\\`## RASEN REVIEW REPORT\\\` section **anywhere** in the file
  (not just at the end — content may have been added after it).
- If found, **replace it** entirely using the Edit tool. Match from \\\`## RASEN REVIEW REPORT\\\`
  through either the next \\\`## \\\` heading or end of file, whichever comes first. This ensures
  content added after the report section is preserved, not eaten. If the Edit fails
  (e.g., concurrent edit changed the content), re-read the plan file and retry once.
- If no such section exists, **append it** to the end of the plan file.
- Always place it as the very last section in the plan file. If it was found mid-file,
  move it: delete the old location and append at the end.`;

export const QA_METHODOLOGY = `## Modes

### Diff-aware (automatic when on a feature branch with no URL)

This is the **primary mode** for developers verifying their work. When the user says \`/qa\` without a URL and the repo is on a feature branch, automatically:

1. **Analyze the branch diff** to understand what changed:
   \`\`\`bash
   git diff main...HEAD --name-only
   git log main..HEAD --oneline
   \`\`\`

2. **Identify affected pages/routes** from the changed files:
   - Controller/route files → which URL paths they serve
   - View/template/component files → which pages render them
   - Model/service files → which pages use those models (check controllers that reference them)
   - CSS/style files → which pages include those stylesheets
   - API endpoints → test them directly with \`curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "await fetch('/api/...').then(r => r.status)"\`
   - Static pages (markdown, HTML) → navigate to them directly

   **If no obvious pages/routes are identified from the diff:** Do not skip browser testing. The user invoked /qa because they want browser-based verification. Fall back to Quick mode — navigate to the homepage, follow the top 5 navigation targets, check console for errors, and test any interactive elements found. Backend, config, and infrastructure changes affect app behavior — always verify the app still works.

3. **Detect the running app** — check common local dev ports:
   \`\`\`bash
   for PORT in 3000 4000 8080; do
     TAB=$(curl --noproxy '*' -s "localhost:3456/new?url=http://localhost:$PORT" | jq -r .targetId)
     [ "$(curl --noproxy '*' -s "localhost:3456/info?target=$TAB" | jq -r .ready)" = "complete" ] \\
       && { echo "Found app on :$PORT (tab $TAB)"; break; }
   done
   \`\`\`
   If no local app is found, check for a staging/preview URL in the PR or environment. If nothing works, ask the user for the URL.

4. **Test each affected page/route:**
   - Navigate to the page
   - Take a screenshot
   - Check console for errors
   - If the change was interactive (forms, buttons, flows), test the interaction end-to-end
   - Use \`/snapshot?mode=D\` before and after actions to verify the change had the expected effect

5. **Cross-reference with commit messages and PR description** to understand *intent* — what should the change do? Verify it actually does that.

6. **Check TODOS.md** (if it exists) for known bugs or issues related to the changed files. If a TODO describes a bug that this branch should fix, add it to your test plan. If you find a new bug during QA that isn't in TODOS.md, note it in the report.

7. **Report findings** scoped to the branch changes:
   - "Changes tested: N pages/routes affected by this branch"
   - For each: does it work? Screenshot evidence.
   - Any regressions on adjacent pages?

**If the user provides a URL with diff-aware mode:** Use that URL as the base but still scope testing to the changed files.

### Full (default when URL is provided)
Systematic exploration. Visit every reachable page. Document 5-10 well-evidenced issues. Produce health score. Takes 5-15 minutes depending on app size.

### Quick (\`--quick\`)
30-second smoke test. Visit homepage + top 5 navigation targets. Check: page loads? Console errors? Broken links? Produce health score. No detailed issue documentation.

### Regression (\`--regression <baseline>\`)
Run full mode, then load \`baseline.json\` from a previous run. Diff: which issues are fixed? Which are new? What's the score delta? Append regression section to report.

---

## Workflow

### Phase 1: Initialize

1. Run SETUP — \`check-deps.mjs\` and open a tab \`$TAB\` via \`/new\` (see Setup above)
2. Create output directories
3. Copy report template from \`templates/qa-report-template.md\` (beside this SKILL.md) to output dir
4. Start timer for duration tracking

### Phase 2: Authenticate (if needed)

**If the user specified auth credentials:**

\`\`\`bash
curl --noproxy '*' "localhost:3456/navigate?target=$TAB&url=<login-url>"
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=i"                # find the login form
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d 'document.querySelector("#email").value="user@example.com"'
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d 'document.querySelector("#password").value="[REDACTED]"'   # NEVER include real passwords in report
curl --noproxy '*' -sX POST "localhost:3456/click?target=$TAB" -d '#submit'    # submit
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=D"                # verify login succeeded
\`\`\`

**If the user provided a cookie file:**

\`\`\`bash
curl --noproxy '*' -sX POST "localhost:3456/cookies?target=$TAB" -d @cookies.json
curl --noproxy '*' "localhost:3456/navigate?target=$TAB&url=<target-url>"
\`\`\`

**If 2FA/OTP is required:** Ask the user for the code and wait.

**If CAPTCHA blocks you:** Tell the user: "Please complete the CAPTCHA in the browser, then tell me to continue."

### Phase 3: Orient

Get a map of the application:

\`\`\`bash
curl --noproxy '*' "localhost:3456/navigate?target=$TAB&url=<target-url>"
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=i"                                          # interactive inventory
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/initial.png&full=true"
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d '[...document.links].map(a => a.textContent.trim()+" -> "+a.href)'   # map navigation
curl --noproxy '*' "localhost:3456/console/enable?target=$TAB"; curl --noproxy '*' "localhost:3456/console?target=$TAB&level=error"                 # errors on landing?
\`\`\`

**Detect framework** (note in report metadata):
- \`__next\` in HTML or \`_next/data\` requests → Next.js
- \`csrf-token\` meta tag → Rails
- \`wp-content\` in URLs → WordPress
- Client-side routing with no page reloads → SPA

**For SPAs:** the \`document.links\` extraction may return few results because navigation is client-side. Use \`/snapshot?mode=i\` to find nav elements (buttons, menu items) instead.

### Phase 4: Explore

Visit pages systematically. At each page:

\`\`\`bash
curl --noproxy '*' "localhost:3456/navigate?target=$TAB&url=<page-url>"
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=i"
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/page-name.png&full=true"
curl --noproxy '*' "localhost:3456/console?target=$TAB&level=error"
\`\`\`

Then follow the **per-page exploration checklist** (see \`references/issue-taxonomy.md\` beside this SKILL.md):

1. **Visual scan** — Look at the annotated screenshot for layout issues
2. **Interactive elements** — Click buttons, links, controls. Do they work?
3. **Forms** — Fill and submit. Test empty, invalid, edge cases
4. **Navigation** — Check all paths in and out
5. **States** — Empty state, loading, error, overflow
6. **Console** — Any new JS errors after interactions?
7. **Responsiveness** — Check mobile viewport if relevant:
   \`\`\`bash
   curl --noproxy '*' "localhost:3456/viewport?target=$TAB&width=375&height=812&mobile=true"
   curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/page-mobile.png"
   curl --noproxy '*' "localhost:3456/viewport?target=$TAB&width=1280&height=720"
   \`\`\`

**Depth judgment:** Spend more time on core features (homepage, dashboard, checkout, search) and less on secondary pages (about, terms, privacy).

**Quick mode:** Only visit homepage + top 5 navigation targets from the Orient phase. Skip the per-page checklist — just check: loads? Console errors? Broken links visible?

### Phase 5: Document

Document each issue **immediately when found** — don't batch them.

**Two evidence tiers:**

**Interactive bugs** (broken flows, dead buttons, form failures):
1. Take a screenshot before the action
2. Perform the action
3. Take a screenshot showing the result
4. Use \`/snapshot?mode=D\` to show what changed
5. Write repro steps referencing screenshots

\`\`\`bash
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/issue-001-step-1.png"
curl --noproxy '*' -sX POST "localhost:3456/click?target=$TAB" -d '#submit'
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/issue-001-result.png"
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=D"
\`\`\`

**Static bugs** (typos, layout issues, missing images):
1. Take a single annotated screenshot showing the problem
2. Describe what's wrong

\`\`\`bash
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/issue-002.png&full=true"
\`\`\`

**Write each issue to the report immediately** using the template format from \`templates/qa-report-template.md\` (beside this SKILL.md).

### Phase 6: Wrap Up

1. **Compute health score** using the rubric below
2. **Write "Top 3 Things to Fix"** — the 3 highest-severity issues
3. **Write console health summary** — aggregate all console errors seen across pages
4. **Update severity counts** in the summary table
5. **Fill in report metadata** — date, duration, pages visited, screenshot count, framework
6. **Save baseline** — write \`baseline.json\` with:
   \`\`\`json
   {
     "date": "YYYY-MM-DD",
     "url": "<target>",
     "healthScore": N,
     "issues": [{ "id": "ISSUE-001", "title": "...", "severity": "...", "category": "..." }],
     "categoryScores": { "console": N, "links": N, ... }
   }
   \`\`\`

**Regression mode:** After writing the report, load the baseline file. Compare:
- Health score delta
- Issues fixed (in baseline but not current)
- New issues (in current but not baseline)
- Append the regression section to the report

---

## Health Score Rubric

Compute each category score (0-100), then take the weighted average.

### Console (weight: 15%)
- 0 errors → 100
- 1-3 errors → 70
- 4-10 errors → 40
- 10+ errors → 10

### Links (weight: 10%)
- 0 broken → 100
- Each broken link → -15 (minimum 0)

### Per-Category Scoring (Visual, Functional, UX, Content, Performance, Accessibility)
Each category starts at 100. Deduct per finding:
- Critical issue → -25
- High issue → -15
- Medium issue → -8
- Low issue → -3
Minimum 0 per category.

### Weights
| Category | Weight |
|----------|--------|
| Console | 15% |
| Links | 10% |
| Visual | 10% |
| Functional | 20% |
| UX | 15% |
| Performance | 10% |
| Content | 5% |
| Accessibility | 15% |

### Final Score
\`score = Σ (category_score × weight)\`

---

## Framework-Specific Guidance

### Next.js
- Check console for hydration errors (\`Hydration failed\`, \`Text content did not match\`)
- Monitor \`_next/data\` requests in network — 404s indicate broken data fetching
- Test client-side navigation (click links, don't just \`goto\`) — catches routing issues
- Check for CLS (Cumulative Layout Shift) on pages with dynamic content

### Rails
- Check for N+1 query warnings in console (if development mode)
- Verify CSRF token presence in forms
- Test Turbo/Stimulus integration — do page transitions work smoothly?
- Check for flash messages appearing and dismissing correctly

### WordPress
- Check for plugin conflicts (JS errors from different plugins)
- Verify admin bar visibility for logged-in users
- Test REST API endpoints (\`/wp-json/\`)
- Check for mixed content warnings (common with WP)

### General SPA (React, Vue, Angular)
- Use \`/snapshot?mode=i\` for navigation — the \`document.links\` extraction misses client-side routes
- Check for stale state (navigate away and back — does data refresh?)
- Test browser back/forward — does the app handle history correctly?
- Check for memory leaks (monitor console after extended use)

---

## Important Rules

1. **Repro is everything.** Every issue needs at least one screenshot. No exceptions.
2. **Verify before documenting.** Retry the issue once to confirm it's reproducible, not a fluke.
3. **Never include credentials.** Write \`[REDACTED]\` for passwords in repro steps.
4. **Write incrementally.** Append each issue to the report as you find it. Don't batch.
5. **Never read source code to FORM findings — exploration/testing phase only.** During exploration you test as a user, not a developer: findings come from observed behavior, not from reading the implementation. This rule (and its reinforcer #7) governs the audit phase; reading source IS required and allowed for exactly two activities: (a) **diff-aware triage** — mapping changed controller / model / view files to the routes/pages they serve (Diff-aware mode); and (b) the **standalone fix loop** (qa Phase 8, when a human runs /qa directly), which reads source to make the minimal fix. This carve-out names the STANDALONE fix loop only — it does NOT reopen the dispatched-mode report-only contract (a dispatched reviewer still makes no edits).
6. **Check console after every interaction.** JS errors that don't surface visually are still bugs.
7. **Test like a user (exploration phase).** Use realistic data. Walk through complete workflows end-to-end. Like #5, this governs how you FIND issues; it does not forbid the source reading #5 enumerates (diff-aware triage, standalone fix loop).
8. **Depth over breadth.** 5-10 well-documented issues with evidence > 20 vague descriptions.
9. **Never delete output files.** Screenshots and reports accumulate — that's intentional.
10. **Use \`/snapshot?mode=C\` for tricky UIs.** Finds clickable divs (@c refs) that the accessibility tree misses.
11. **Show screenshots to the user.** After every \`/screenshot\` or \`/responsive\` call that writes a file, use the Read tool on the output file(s) so the user can see them inline. For \`/responsive\` (up to 3 files), Read all of them. This is critical — without it, screenshots are invisible to the user.
12. **Never refuse to use the browser.** When the user invokes /qa or /qa-only, they are requesting browser-based testing. Never suggest evals, unit tests, or other alternatives as a substitute. Even if the diff appears to have no UI changes, backend changes affect app behavior — always open the browser and test.`;

export const DESIGN_METHODOLOGY = `## Modes

### Full (default)
Systematic review of all pages reachable from homepage. Visit 5-8 pages. Full checklist evaluation, responsive screenshots, interaction flow testing. Produces complete design audit report with letter grades.

### Quick (\`--quick\`)
Homepage + 2 key pages only. First Impression + Design System Extraction + abbreviated checklist. Fastest path to a design score.

### Deep (\`--deep\`)
Comprehensive review: 10-15 pages, every interaction flow, exhaustive checklist. For pre-launch audits or major redesigns.

### Diff-aware (automatic when on a feature branch with no URL)
When on a feature branch, scope to pages affected by the branch changes:
1. Analyze the branch diff: \`git diff main...HEAD --name-only\`
2. Map changed files to affected pages/routes
3. Detect running app on common local ports (3000, 4000, 8080)
4. Audit only affected pages, compare design quality before/after

### Regression (\`--regression\` or previous \`design-baseline.json\` found)
Run full audit, then load previous \`design-baseline.json\`. Compare: per-category grade deltas, new findings, resolved findings. Output regression table in report.

---

## Phase 1: First Impression

The most uniquely designer-like output. Form a gut reaction before analyzing anything.

1. Navigate to the target URL
2. Take a full-page desktop screenshot: \`curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/first-impression.png&full=true"\`
3. Write the **First Impression** using this structured critique format:
   - "The site communicates **[what]**." (what it says at a glance — competence? playfulness? confusion?)
   - "I notice **[observation]**." (what stands out, positive or negative — be specific)
   - "The first 3 things my eye goes to are: **[1]**, **[2]**, **[3]**." (hierarchy check — are these intentional?)
   - "If I had to describe this in one word: **[word]**." (gut verdict)

This is the section users read first. Be opinionated. A designer doesn't hedge — they react.

---

## Phase 2: Design System Extraction

Extract the actual design system the site uses (not what a DESIGN.md says, but what's rendered):

\`\`\`bash
# Fonts in use (capped at 500 elements to avoid timeout)
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "JSON.stringify([...new Set([...document.querySelectorAll('*')].slice(0,500).map(e => getComputedStyle(e).fontFamily))])"

# Color palette in use
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "JSON.stringify([...new Set([...document.querySelectorAll('*')].slice(0,500).flatMap(e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]).filter(c => c !== 'rgba(0, 0, 0, 0)'))])"

# Heading hierarchy
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "JSON.stringify([...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({tag:h.tagName, text:h.textContent.trim().slice(0,50), size:getComputedStyle(h).fontSize, weight:getComputedStyle(h).fontWeight})))"

# Touch target audit (find undersized interactive elements)
curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "JSON.stringify([...document.querySelectorAll('a,button,input,[role=button]')].filter(e => {const r=e.getBoundingClientRect(); return r.width>0 && (r.width<44||r.height<44)}).map(e => ({tag:e.tagName, text:(e.textContent||'').trim().slice(0,30), w:Math.round(e.getBoundingClientRect().width), h:Math.round(e.getBoundingClientRect().height)})).slice(0,20))"

# Performance baseline — LCP/FCP/CLS + resource timing.
# The audit tab opens in the background and never renders, so paint/LCP come back
# null; pass &activate=true to briefly foreground it and sample real paint metrics
# (this steals focus for ~1.5s). Without it, treat null paint as "not rendered",
# not a page problem — check the returned "visibility"/"note" fields.
curl --noproxy '*' "localhost:3456/perf?target=$TAB&activate=true"
\`\`\`

Structure findings as an **Inferred Design System**:
- **Fonts:** list with usage counts. Flag if >3 distinct font families.
- **Colors:** palette extracted. Flag if >12 unique non-gray colors. Note warm/cool/mixed.
- **Heading Scale:** h1-h6 sizes. Flag skipped levels, non-systematic size jumps.
- **Spacing Patterns:** sample padding/margin values. Flag non-scale values.

After extraction, offer: *"Want me to save this as your DESIGN.md? I can lock in these observations as your project's design system baseline."*

---

## Phase 3: Page-by-Page Visual Audit

For each page in scope:

\`\`\`bash
curl --noproxy '*' "localhost:3456/navigate?target=$TAB&url=<url>"
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=i"
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=$REPORT_DIR/screenshots/{page}-annotated.png&full=true"
curl --noproxy '*' "localhost:3456/responsive?target=$TAB&screenshot=true&dir=$REPORT_DIR/screenshots"
curl --noproxy '*' "localhost:3456/console/enable?target=$TAB"; curl --noproxy '*' "localhost:3456/console?target=$TAB&level=error"
curl --noproxy '*' "localhost:3456/perf?target=$TAB&activate=true"   # &activate=true: background audit tab won't render paint/LCP otherwise (steals focus ~1.5s)
\`\`\`

### Auth Detection

After the first navigation, check if the URL changed to a login-like path:
\`\`\`bash
curl --noproxy '*' "localhost:3456/info?target=$TAB"
\`\`\`
If URL contains \`/login\`, \`/signin\`, \`/auth\`, or \`/sso\`: the site requires authentication. AskUserQuestion: "This site requires authentication. Provide a logged-in browser session (or import cookies for the domain) before continuing the audit."

### Design Audit Checklist (10 categories, ~80 items)

Apply these at each page. Each finding gets an impact rating (high/medium/polish) and category.

**1. Visual Hierarchy & Composition** (8 items)
- Clear focal point? One primary CTA per view?
- Eye flows naturally top-left to bottom-right?
- Visual noise — competing elements fighting for attention?
- Information density appropriate for content type?
- Z-index clarity — nothing unexpectedly overlapping?
- Above-the-fold content communicates purpose in 3 seconds?
- Squint test: hierarchy still visible when blurred?
- White space is intentional, not leftover?

**2. Typography** (15 items)
- Font count <=3 (flag if more)
- Scale follows ratio (1.25 major third or 1.333 perfect fourth)
- Line-height: 1.5x body, 1.15-1.25x headings
- Measure: 45-75 chars per line (66 ideal)
- Heading hierarchy: no skipped levels (h1→h3 without h2)
- Weight contrast: >=2 weights used for hierarchy
- No blacklisted fonts (Papyrus, Comic Sans, Lobster, Impact, Jokerman)
- If primary font is Inter/Roboto/Open Sans/Poppins → flag as potentially generic
- \`text-wrap: balance\` or \`text-pretty\` on headings (check via \`curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d 'getComputedStyle(document.querySelector("<heading>")).textWrap'\`)
- Curly quotes used, not straight quotes
- Ellipsis character (\`…\`) not three dots (\`...\`)
- \`font-variant-numeric: tabular-nums\` on number columns
- Body text >= 16px
- Caption/label >= 12px
- No letterspacing on lowercase text

**3. Color & Contrast** (10 items)
- Palette coherent (<=12 unique non-gray colors)
- WCAG AA: body text 4.5:1, large text (18px+) 3:1, UI components 3:1
- Semantic colors consistent (success=green, error=red, warning=yellow/amber)
- No color-only encoding (always add labels, icons, or patterns)
- Dark mode: surfaces use elevation, not just lightness inversion
- Dark mode: text off-white (~#E0E0E0), not pure white
- Primary accent desaturated 10-20% in dark mode
- \`color-scheme: dark\` on html element (if dark mode present)
- No red/green only combinations (8% of men have red-green deficiency)
- Neutral palette is warm or cool consistently — not mixed

**4. Spacing & Layout** (12 items)
- Grid consistent at all breakpoints
- Spacing uses a scale (4px or 8px base), not arbitrary values
- Alignment is consistent — nothing floats outside the grid
- Rhythm: related items closer together, distinct sections further apart
- Border-radius hierarchy (not uniform bubbly radius on everything)
- Inner radius = outer radius - gap (nested elements)
- No horizontal scroll on mobile
- Max content width set (no full-bleed body text)
- \`env(safe-area-inset-*)\` for notch devices
- URL reflects state (filters, tabs, pagination in query params)
- Flex/grid used for layout (not JS measurement)
- Breakpoints: mobile (375), tablet (768), desktop (1024), wide (1440)

**5. Interaction States** (10 items)
- Hover state on all interactive elements
- \`focus-visible\` ring present (never \`outline: none\` without replacement)
- Active/pressed state with depth effect or color shift
- Disabled state: reduced opacity + \`cursor: not-allowed\`
- Loading: skeleton shapes match real content layout
- Empty states: warm message + primary action + visual (not just "No items.")
- Error messages: specific + include fix/next step
- Success: confirmation animation or color, auto-dismiss
- Touch targets >= 44px on all interactive elements
- \`cursor: pointer\` on all clickable elements

**6. Responsive Design** (8 items)
- Mobile layout makes *design* sense (not just stacked desktop columns)
- Touch targets sufficient on mobile (>= 44px)
- No horizontal scroll on any viewport
- Images handle responsive (srcset, sizes, or CSS containment)
- Text readable without zooming on mobile (>= 16px body)
- Navigation collapses appropriately (hamburger, bottom nav, etc.)
- Forms usable on mobile (correct input types, no autoFocus on mobile)
- No \`user-scalable=no\` or \`maximum-scale=1\` in viewport meta

**7. Motion & Animation** (6 items)
- Easing: ease-out for entering, ease-in for exiting, ease-in-out for moving
- Duration: 50-700ms range (nothing slower unless page transition)
- Purpose: every animation communicates something (state change, attention, spatial relationship)
- \`prefers-reduced-motion\` respected (check: \`curl --noproxy '*' -sX POST "localhost:3456/eval?target=$TAB" -d "matchMedia('(prefers-reduced-motion: reduce)').matches"\`)
- No \`transition: all\` — properties listed explicitly
- Only \`transform\` and \`opacity\` animated (not layout properties like width, height, top, left)

**8. Content & Microcopy** (8 items)
- Empty states designed with warmth (message + action + illustration/icon)
- Error messages specific: what happened + why + what to do next
- Button labels specific ("Save API Key" not "Continue" or "Submit")
- No placeholder/lorem ipsum text visible in production
- Truncation handled (\`text-overflow: ellipsis\`, \`line-clamp\`, or \`break-words\`)
- Active voice ("Install the CLI" not "The CLI will be installed")
- Loading states end with \`…\` ("Saving…" not "Saving...")
- Destructive actions have confirmation modal or undo window

**9. AI Slop Detection** (10 anti-patterns — the blacklist)

The test: would a human designer at a respected studio ever ship this?

- Purple/violet/indigo gradient backgrounds or blue-to-purple color schemes
- **The 3-column feature grid:** icon-in-colored-circle + bold title + 2-line description, repeated 3x symmetrically. THE most recognizable AI layout.
- Icons in colored circles as section decoration (SaaS starter template look)
- Centered everything (\`text-align: center\` on all headings, descriptions, cards)
- Uniform bubbly border-radius on every element (same large radius on everything)
- Decorative blobs, floating circles, wavy SVG dividers (if a section feels empty, it needs better content, not decoration)
- Emoji as design elements (rockets in headings, emoji as bullet points)
- Colored left-border on cards (\`border-left: 3px solid <accent>\`)
- Generic hero copy ("Welcome to [X]", "Unlock the power of...", "Your all-in-one solution for...")
- Cookie-cutter section rhythm (hero → 3 features → testimonials → pricing → CTA, every section same height)

**10. Performance as Design** (6 items)
- LCP < 2.0s (web apps), < 1.5s (informational sites)
- CLS < 0.1 (no visible layout shifts during load)
- Skeleton quality: shapes match real content, shimmer animation
- Images: \`loading="lazy"\`, width/height dimensions set, WebP/AVIF format
- Fonts: \`font-display: swap\`, preconnect to CDN origins
- No visible font swap flash (FOUT) — critical fonts preloaded

---

## Phase 4: Interaction Flow Review

Walk 2-3 key user flows and evaluate the *feel*, not just the function:

\`\`\`bash
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=i"
curl --noproxy '*' -sX POST "localhost:3456/click?target=$TAB" -d '<selector>'   # perform action
curl --noproxy '*' "localhost:3456/snapshot?target=$TAB&mode=D"                  # diff to see what changed
\`\`\`

Evaluate:
- **Response feel:** Does clicking feel responsive? Any delays or missing loading states?
- **Transition quality:** Are transitions intentional or generic/absent?
- **Feedback clarity:** Did the action clearly succeed or fail? Is the feedback immediate?
- **Form polish:** Focus states visible? Validation timing correct? Errors near the source?

---

## Phase 5: Cross-Page Consistency

Compare screenshots and observations across pages for:
- Navigation bar consistent across all pages?
- Footer consistent?
- Component reuse vs one-off designs (same button styled differently on different pages?)
- Tone consistency (one page playful while another is corporate?)
- Spacing rhythm carries across pages?

---

## Phase 6: Compile Report

### Output Locations

**Local:** \`.rasen/design-reports/design-audit-{domain}-{YYYY-MM-DD}.md\`

**Project-scoped:**
\`\`\`bash
SLUG=$(basename "$(git remote get-url origin 2>/dev/null)" .git 2>/dev/null || basename "$(pwd)") && mkdir -p ~/.rasen/projects/$SLUG
\`\`\`
Write to: \`~/.rasen/projects/{slug}/{user}-{branch}-design-audit-{datetime}.md\`

**Baseline:** Write \`design-baseline.json\` for regression mode:
\`\`\`json
{
  "date": "YYYY-MM-DD",
  "url": "<target>",
  "designScore": "B",
  "aiSlopScore": "C",
  "categoryGrades": { "hierarchy": "A", "typography": "B", ... },
  "findings": [{ "id": "FINDING-001", "title": "...", "impact": "high", "category": "typography" }]
}
\`\`\`

### Scoring System

**Dual headline scores:**
- **Design Score: {A-F}** — weighted average of all 10 categories
- **AI Slop Score: {A-F}** — standalone grade with pithy verdict

**Per-category grades:**
- **A:** Intentional, polished, delightful. Shows design thinking.
- **B:** Solid fundamentals, minor inconsistencies. Looks professional.
- **C:** Functional but generic. No major problems, no design point of view.
- **D:** Noticeable problems. Feels unfinished or careless.
- **F:** Actively hurting user experience. Needs significant rework.

**Grade computation:** Each category starts at A. Each High-impact finding drops one letter grade. Each Medium-impact finding drops half a letter grade. Polish findings are noted but do not affect grade. Minimum is F.

**Category weights for Design Score:**
| Category | Weight |
|----------|--------|
| Visual Hierarchy | 15% |
| Typography | 15% |
| Spacing & Layout | 15% |
| Color & Contrast | 10% |
| Interaction States | 10% |
| Responsive | 10% |
| Content Quality | 10% |
| AI Slop | 5% |
| Motion | 5% |
| Performance Feel | 5% |

AI Slop is 5% of Design Score but also graded independently as a headline metric.

### Regression Output

When previous \`design-baseline.json\` exists or \`--regression\` flag is used:
- Load baseline grades
- Compare: per-category deltas, new findings, resolved findings
- Append regression table to report

---

## Design Critique Format

Use structured feedback, not opinions:
- "I notice..." — observation (e.g., "I notice the primary CTA competes with the secondary action")
- "I wonder..." — question (e.g., "I wonder if users will understand what 'Process' means here")
- "What if..." — suggestion (e.g., "What if we moved search to a more prominent position?")
- "I think... because..." — reasoned opinion (e.g., "I think the spacing between sections is too uniform because it doesn't create hierarchy")

Tie everything to user goals and product objectives. Always suggest specific improvements alongside problems.

---

## Important Rules

1. **Think like a designer, not a QA engineer.** You care whether things feel right, look intentional, and respect the user. You do NOT just care whether things "work."
2. **Screenshots are evidence.** Every finding needs at least one screenshot. Use \`/screenshot\` (add \`&full=true\` for the whole page) and pair it with a \`/snapshot\` to identify the elements involved.
3. **Be specific and actionable.** "Change X to Y because Z" — not "the spacing feels off."
4. **Never read source code to FORM findings — audit phase only.** Evaluate the rendered site, not the implementation: do not form design findings by reading code instead of looking at the rendered page. Exceptions where reading source IS allowed: (a) offer to write DESIGN.md from extracted observations; (b) reading changed files to map them to affected pages in **diff-aware mode**; and (c) the **standalone fix loop** (design-review Phase 8, when a human runs /design-review directly), which reads source to make the minimal fix. Carve-out (c) names the STANDALONE fix loop only — it does NOT reopen the dispatched-mode report-only contract.
5. **AI Slop detection is your superpower.** Most developers can't evaluate whether their site looks AI-generated. You can. Be direct about it.
6. **Quick wins matter.** Always include a "Quick Wins" section — the 3-5 highest-impact fixes that take <30 minutes each.
7. **Use \`/snapshot?mode=C\` for tricky UIs.** Finds clickable divs (@c refs) that the accessibility tree misses.
8. **Responsive is design, not just "not broken."** A stacked desktop layout on mobile is not responsive design — it's lazy. Evaluate whether the mobile layout makes *design* sense.
9. **Document incrementally.** Write each finding to the report as you find it. Don't batch.
10. **Depth over breadth.** 5-10 well-documented findings with screenshots and specific suggestions > 20 vague observations.
11. **Show screenshots to the user.** After every \`/screenshot\` or \`/responsive\` call that writes a file, use the Read tool on the output file(s) so the user can see them inline. For \`/responsive\` (up to 3 files), Read all of them. This is critical — without it, screenshots are invisible to the user.`;

export const DESIGN_REVIEW_LITE = `## Design Review (conditional, diff-scoped)

Check if the diff touches frontend files by inspecting changed file extensions:

\`\`\`bash
SCOPE_FRONTEND=$(git diff <base>...HEAD --name-only 2>/dev/null | grep -qE '\\.(tsx|jsx|css|scss|html|vue|svelte)$' && echo "true" || echo "false")
\`\`\`

**If \`SCOPE_FRONTEND=false\`:** Skip design review silently. No output.

**If \`SCOPE_FRONTEND=true\`:**

1. **Check for DESIGN.md.** If \`DESIGN.md\` or \`design-system.md\` exists in the repo root, read it. All design findings are calibrated against it — patterns blessed in DESIGN.md are not flagged. If not found, use universal design principles.

2. **Read \`design-checklist.md\` from this skill's own directory (beside this SKILL.md).** If the file cannot be read, skip design review with a note: "Design checklist not found — skipping design review."

3. **Read each changed frontend file** (full file, not just diff hunks). Frontend files are identified by the patterns listed in the checklist.

4. **Apply the design checklist** against the changed files. For each item:
   - **[HIGH] mechanical CSS fix** (\`outline: none\`, \`!important\`, \`font-size < 16px\`): classify as AUTO-FIX
   - **[HIGH/MEDIUM] design judgment needed**: classify as ASK
   - **[LOW] intent-based detection**: present as "Possible — verify visually or run /design-review"

5. **Include findings** in the review output under a "Design Review" header, following the output format in the checklist. Design findings merge with code review findings into the same Fix-First flow.`;

export const TEST_BOOTSTRAP = `## Test Framework Bootstrap

**Detect existing test framework and project runtime:**

\`\`\`bash
# Detect project runtime
[ -f Gemfile ] && echo "RUNTIME:ruby"
[ -f package.json ] && echo "RUNTIME:node"
[ -f requirements.txt ] || [ -f pyproject.toml ] && echo "RUNTIME:python"
[ -f go.mod ] && echo "RUNTIME:go"
[ -f Cargo.toml ] && echo "RUNTIME:rust"
[ -f composer.json ] && echo "RUNTIME:php"
[ -f mix.exs ] && echo "RUNTIME:elixir"
# Detect sub-frameworks
[ -f Gemfile ] && grep -q "rails" Gemfile 2>/dev/null && echo "FRAMEWORK:rails"
[ -f package.json ] && grep -q '"next"' package.json 2>/dev/null && echo "FRAMEWORK:nextjs"
# Check for existing test infrastructure
ls jest.config.* vitest.config.* playwright.config.* .rspec pytest.ini pyproject.toml phpunit.xml 2>/dev/null
ls -d test/ tests/ spec/ __tests__/ cypress/ e2e/ 2>/dev/null
# Check opt-out marker
[ -f .rasen/no-test-bootstrap ] && echo "BOOTSTRAP_DECLINED"
\`\`\`

**If test framework detected** (config files or test directories found):
Print "Test framework detected: {name} ({N} existing tests). Skipping bootstrap."
Read 2-3 existing test files to learn conventions (naming, imports, assertion style, setup patterns).
Store conventions as prose context for use in Phase 8e.5 or Step 3.4. **Skip the rest of bootstrap.**

**If BOOTSTRAP_DECLINED** appears: Print "Test bootstrap previously declined — skipping." **Skip the rest of bootstrap.**

**If NO runtime detected** (no config files found): Use AskUserQuestion:
"I couldn't detect your project's language. What runtime are you using?"
Options: A) Node.js/TypeScript B) Ruby/Rails C) Python D) Go E) Rust F) PHP G) Elixir H) This project doesn't need tests.
If user picks H → write \`.rasen/no-test-bootstrap\` and continue without tests.

**If runtime detected but no test framework — bootstrap:**

### B2. Research best practices

Use WebSearch to find current best practices for the detected runtime:
- \`"[runtime] best test framework 2025 2026"\`
- \`"[framework A] vs [framework B] comparison"\`

If WebSearch is unavailable, use this built-in knowledge table:

| Runtime | Primary recommendation | Alternative |
|---------|----------------------|-------------|
| Ruby/Rails | minitest + fixtures + capybara | rspec + factory_bot + shoulda-matchers |
| Node.js | vitest + @testing-library | jest + @testing-library |
| Next.js | vitest + @testing-library/react + playwright | jest + cypress |
| Python | pytest + pytest-cov | unittest |
| Go | stdlib testing + testify | stdlib only |
| Rust | cargo test (built-in) + mockall | — |
| PHP | phpunit + mockery | pest |
| Elixir | ExUnit (built-in) + ex_machina | — |

### B3. Framework selection

Use AskUserQuestion:
"I detected this is a [Runtime/Framework] project with no test framework. I researched current best practices. Here are the options:
A) [Primary] — [rationale]. Includes: [packages]. Supports: unit, integration, smoke, e2e
B) [Alternative] — [rationale]. Includes: [packages]
C) Skip — don't set up testing right now
RECOMMENDATION: Choose A because [reason based on project context]"

If user picks C → write \`.rasen/no-test-bootstrap\`. Tell user: "If you change your mind later, delete \`.rasen/no-test-bootstrap\` and re-run." Continue without tests.

If multiple runtimes detected (monorepo) → ask which runtime to set up first, with option to do both sequentially.

### B4. Install and configure

1. Install the chosen packages (npm/bun/gem/pip/etc.)
2. Create minimal config file
3. Create directory structure (test/, spec/, etc.)
4. Create one example test matching the project's code to verify setup works

If package installation fails → debug once. If still failing → revert with \`git checkout -- package.json package-lock.json\` (or equivalent for the runtime). Warn user and continue without tests.

### B4.5. First real tests

Generate 3-5 real tests for existing code:

1. **Find recently changed files:** \`git log --since=30.days --name-only --format="" | sort | uniq -c | sort -rn | head -10\`
2. **Prioritize by risk:** Error handlers > business logic with conditionals > API endpoints > pure functions
3. **For each file:** Write one test that tests real behavior with meaningful assertions. Never \`expect(x).toBeDefined()\` — test what the code DOES.
4. Run each test. Passes → keep. Fails → fix once. Still fails → delete silently.
5. Generate at least 1 test, cap at 5.

Never import secrets, API keys, or credentials in test files. Use environment variables or test fixtures.

### B5. Verify

\`\`\`bash
# Run the full test suite to confirm everything works
{detected test command}
\`\`\`

If tests fail → debug once. If still failing → revert all bootstrap changes and warn user.

### B5.5. CI/CD pipeline

\`\`\`bash
# Check CI provider
ls -d .github/ 2>/dev/null && echo "CI:github"
ls .gitlab-ci.yml .circleci/ bitrise.yml 2>/dev/null
\`\`\`

If \`.github/\` exists (or no CI detected — default to GitHub Actions):
Create \`.github/workflows/test.yml\` with:
- \`runs-on: ubuntu-latest\`
- Appropriate setup action for the runtime (setup-node, setup-ruby, setup-python, etc.)
- The same test command verified in B5
- Trigger: push + pull_request

If non-GitHub CI detected → skip CI generation with note: "Detected {provider} — CI pipeline generation supports GitHub Actions only. Add test step to your existing pipeline manually."

### B6. Create TESTING.md

First check: If TESTING.md already exists → read it and update/append rather than overwriting. Never destroy existing content.

Write TESTING.md with:
- Philosophy: "100% test coverage is the key to great vibe coding. Tests let you move fast, trust your instincts, and ship with confidence — without them, vibe coding is just yolo coding. With tests, it's a superpower."
- Framework name and version
- How to run tests (the verified command from B5)
- Test layers: Unit tests (what, where, when), Integration tests, Smoke tests, E2E tests
- Conventions: file naming, assertion style, setup/teardown patterns

### B7. Update CLAUDE.md

First check: If CLAUDE.md already has a \`## Testing\` section → skip. Don't duplicate.

Append a \`## Testing\` section:
- Run command and test directory
- Reference to TESTING.md
- Test expectations:
  - 100% test coverage is the goal — tests make vibe coding safe
  - When writing new functions, write a corresponding test
  - When fixing a bug, write a regression test
  - When adding error handling, write a test that triggers the error
  - When adding a conditional (if/else, switch), write tests for BOTH paths
  - Never commit code that makes existing tests fail

### B8. Commit

\`\`\`bash
git status --porcelain
\`\`\`

Only commit if there are changes. Stage all bootstrap files (config, test directory, TESTING.md, CLAUDE.md, .github/workflows/test.yml if created):
\`git commit -m "chore: bootstrap test framework ({framework name})"\`

---`;

export const TEST_COVERAGE_AUDIT_REVIEW = `100% coverage is the goal. Evaluate every codepath changed in the diff and identify test gaps. Gaps become INFORMATIONAL findings that follow the Fix-First flow.

### Test Framework Detection

Before analyzing coverage, detect the project's test framework:

1. **Read CLAUDE.md** — look for a \`## Testing\` section with test command and framework name. If found, use that as the authoritative source.
2. **If CLAUDE.md has no testing section, auto-detect:**

\`\`\`bash
# Detect project runtime
[ -f Gemfile ] && echo "RUNTIME:ruby"
[ -f package.json ] && echo "RUNTIME:node"
[ -f requirements.txt ] || [ -f pyproject.toml ] && echo "RUNTIME:python"
[ -f go.mod ] && echo "RUNTIME:go"
[ -f Cargo.toml ] && echo "RUNTIME:rust"
# Check for existing test infrastructure
ls jest.config.* vitest.config.* playwright.config.* cypress.config.* .rspec pytest.ini phpunit.xml 2>/dev/null
ls -d test/ tests/ spec/ __tests__/ cypress/ e2e/ 2>/dev/null
\`\`\`

3. **If no framework detected:** still produce the coverage diagram, but skip test generation.

**Step 1. Trace every codepath changed** using \`git diff origin/<base>...HEAD\`:

Read every changed file. For each one, trace how data flows through the code — don't just list functions, actually follow the execution:

1. **Read the diff.** For each changed file, read the full file (not just the diff hunk) to understand context.
2. **Trace data flow.** Starting from each entry point (route handler, exported function, event listener, component render), follow the data through every branch:
   - Where does input come from? (request params, props, database, API call)
   - What transforms it? (validation, mapping, computation)
   - Where does it go? (database write, API response, rendered output, side effect)
   - What can go wrong at each step? (null/undefined, invalid input, network failure, empty collection)
3. **Diagram the execution.** For each changed file, draw an ASCII diagram showing:
   - Every function/method that was added or modified
   - Every conditional branch (if/else, switch, ternary, guard clause, early return)
   - Every error path (try/catch, rescue, error boundary, fallback)
   - Every call to another function (trace into it — does IT have untested branches?)
   - Every edge: what happens with null input? Empty array? Invalid type?

This is the critical step — you're building a map of every line of code that can execute differently based on input. Every branch in this diagram needs a test.

**Step 2. Map user flows, interactions, and error states:**

Code coverage isn't enough — you need to cover how real users interact with the changed code. For each changed feature, think through:

- **User flows:** What sequence of actions does a user take that touches this code? Map the full journey (e.g., "user clicks 'Pay' → form validates → API call → success/failure screen"). Each step in the journey needs a test.
- **Interaction edge cases:** What happens when the user does something unexpected?
  - Double-click/rapid resubmit
  - Navigate away mid-operation (back button, close tab, click another link)
  - Submit with stale data (page sat open for 30 minutes, session expired)
  - Slow connection (API takes 10 seconds — what does the user see?)
  - Concurrent actions (two tabs, same form)
- **Error states the user can see:** For every error the code handles, what does the user actually experience?
  - Is there a clear error message or a silent failure?
  - Can the user recover (retry, go back, fix input) or are they stuck?
  - What happens with no network? With a 500 from the API? With invalid data from the server?
- **Empty/zero/boundary states:** What does the UI show with zero results? With 10,000 results? With a single character input? With maximum-length input?

Add these to your diagram alongside the code branches. A user flow with no test is just as much a gap as an untested if/else.

**Step 3. Check each branch against existing tests:**

Go through your diagram branch by branch — both code paths AND user flows. For each one, search for a test that exercises it:
- Function \`processPayment()\` → look for \`billing.test.ts\`, \`billing.spec.ts\`, \`test/billing_test.rb\`
- An if/else → look for tests covering BOTH the true AND false path
- An error handler → look for a test that triggers that specific error condition
- A call to \`helperFn()\` that has its own branches → those branches need tests too
- A user flow → look for an integration or E2E test that walks through the journey
- An interaction edge case → look for a test that simulates the unexpected action

Quality scoring rubric:
- ★★★  Tests behavior with edge cases AND error paths
- ★★   Tests correct behavior, happy path only
- ★    Smoke test / existence check / trivial assertion (e.g., "it renders", "it doesn't throw")

### E2E Test Decision Matrix

When checking each branch, also determine whether a unit test or E2E/integration test is the right tool:

**RECOMMEND E2E (mark as [→E2E] in the diagram):**
- Common user flow spanning 3+ components/services (e.g., signup → verify email → first login)
- Integration point where mocking hides real failures (e.g., API → queue → worker → DB)
- Auth/payment/data-destruction flows — too important to trust unit tests alone

**RECOMMEND EVAL (mark as [→EVAL] in the diagram):**
- Critical LLM call that needs a quality eval (e.g., prompt change → test output still meets quality bar)
- Changes to prompt templates, system instructions, or tool definitions

**STICK WITH UNIT TESTS:**
- Pure function with clear inputs/outputs
- Internal helper with no side effects
- Edge case of a single function (null input, empty array)
- Obscure/rare flow that isn't customer-facing

### REGRESSION RULE (mandatory)

**IRON RULE (standalone mode):** When the coverage audit identifies a REGRESSION — code that previously worked but the diff broke — a regression test is written immediately. No AskUserQuestion. No skipping. Regressions are the highest-priority test because they prove something broke.

**Dispatched mode overrides this IRON RULE:** writing a regression test is a code edit, which dispatched mode forbids. When dispatched, record the detected regression and its missing regression test as a finding in the report (Major, or Blocker if it names data-loss / security / silent corruption) for the LEAD to route to a non-author fixer — do NOT write or commit the test yourself.

A regression is when:
- The diff modifies existing behavior (not new code)
- The existing test suite (if any) doesn't cover the changed path
- The change introduces a new failure mode for existing callers

When uncertain whether a change is a regression, err on the side of writing the test.

Format: commit as \`test: regression test for {what broke}\`

**Step 4. Output ASCII coverage diagram:**

Include BOTH code paths and user flows in the same diagram. Mark E2E-worthy and eval-worthy paths:

\`\`\`
CODE PATH COVERAGE
===========================
[+] src/services/billing.ts
    │
    ├── processPayment()
    │   ├── [★★★ TESTED] Happy path + card declined + timeout — billing.test.ts:42
    │   ├── [GAP]         Network timeout — NO TEST
    │   └── [GAP]         Invalid currency — NO TEST
    │
    └── refundPayment()
        ├── [★★  TESTED] Full refund — billing.test.ts:89
        └── [★   TESTED] Partial refund (checks non-throw only) — billing.test.ts:101

USER FLOW COVERAGE
===========================
[+] Payment checkout flow
    │
    ├── [★★★ TESTED] Complete purchase — checkout.e2e.ts:15
    ├── [GAP] [→E2E] Double-click submit — needs E2E, not just unit
    ├── [GAP]         Navigate away during payment — unit test sufficient
    └── [★   TESTED]  Form validation errors (checks render only) — checkout.test.ts:40

[+] Error states
    │
    ├── [★★  TESTED] Card declined message — billing.test.ts:58
    ├── [GAP]         Network timeout UX (what does user see?) — NO TEST
    └── [GAP]         Empty cart submission — NO TEST

[+] LLM integration
    │
    └── [GAP] [→EVAL] Prompt template change — needs eval test

─────────────────────────────────
COVERAGE: 5/13 paths tested (38%)
  Code paths: 3/5 (60%)
  User flows: 2/8 (25%)
QUALITY:  ★★★: 2  ★★: 2  ★: 1
GAPS: 8 paths need tests (2 need E2E, 1 needs eval)
─────────────────────────────────
\`\`\`

**Fast path:** All paths covered → "Step 4.75: All new code paths have test coverage ✓" Continue.

**Step 5. Generate tests for gaps (Fix-First):**

**Dispatched mode:** do NOT generate, run, or commit tests. Report every coverage gap as a finding tagged with a canonical severity (a plain coverage gap is Minor; a gap over an untested data-loss / security / silent-corruption path is Major) for the LEAD to route to a non-author fixer. The generate-and-commit flow below is standalone only.

If test framework is detected and gaps were identified:
- Classify each gap as AUTO-FIX or ASK per the Fix-First Heuristic:
  - **AUTO-FIX:** Simple unit tests for pure functions, edge cases of existing tested functions
  - **ASK:** E2E tests, tests requiring new test infrastructure, tests for ambiguous behavior
- For AUTO-FIX gaps: generate the test, run it, commit as \`test: coverage for {feature}\`
- For ASK gaps: include in the Fix-First batch question with the other review findings
- For paths marked [→E2E]: always ASK (E2E tests are higher-effort and need user confirmation)
- For paths marked [→EVAL]: always ASK (eval tests need user confirmation on quality criteria)

If no test framework detected → include gaps as INFORMATIONAL findings only, no generation.

**Diff is test-only changes:** Skip Step 4.75 entirely: "No new application code paths to audit."`;

export const ADVERSARIAL_STEP = `## Step 5.7: Adversarial review (auto-scaled)

Adversarial review thoroughness scales automatically based on diff size. No configuration needed.

**Dispatched mode:** skip the Claude adversarial **subagent dispatch** entirely (the medium-tier fallback and the large-tier pass 2) — a leaf worker must not spawn subagents. That fresh-context independence is already provided by the LEAD's parallel reviewers and the mandatory non-author re-review. The Codex \`codex exec\` / \`codex review\` passes are external processes (not subagents) and MAY still run; when they do, report their findings tagged with a canonical severity for the LEAD — do not fix and do not \`AskUserQuestion\` on a GATE: FAIL (report the \`[P1]\` items as Blocker findings instead).

**Detect diff size and tool availability:**

\`\`\`bash
DIFF_INS=$(git diff origin/<base> --stat | tail -1 | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo "0")
DIFF_DEL=$(git diff origin/<base> --stat | tail -1 | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo "0")
DIFF_TOTAL=$((DIFF_INS + DIFF_DEL))
which codex 2>/dev/null && echo "CODEX_AVAILABLE" || echo "CODEX_NOT_AVAILABLE"
echo "DIFF_SIZE: $DIFF_TOTAL"
\`\`\`

**User override:** If the user explicitly requested a specific tier (e.g., "run all passes", "paranoid review", "full adversarial", "do all 4 passes", "thorough review"), honor that request regardless of diff size. Jump to the matching tier section.

**Auto-select tier based on diff size:**
- **Small (< 50 lines changed):** Skip adversarial review entirely. Print: "Small diff ($DIFF_TOTAL lines) — adversarial review skipped." Continue to the next step.
- **Medium (50–199 lines changed):** Run Codex adversarial challenge (or Claude adversarial subagent if Codex unavailable). Jump to the "Medium tier" section.
- **Large (200+ lines changed):** Run all remaining passes — Codex structured review + Claude adversarial subagent + Codex adversarial. Jump to the "Large tier" section.

---

### Medium tier (50–199 lines)

Claude's structured review already ran. Now add a **cross-model adversarial challenge**.

**If Codex is available:** run the Codex adversarial challenge. **If Codex is NOT available:** fall back to the Claude adversarial subagent instead.

**Codex adversarial:**

\`\`\`bash
TMPERR_ADV=$(mktemp /tmp/codex-adv-XXXXXXXX)
codex exec "Review the changes on this branch against the base branch. Run git diff origin/<base> to see the diff. Your job is to find ways this code will fail in production. Think like an attacker and a chaos engineer. Find edge cases, race conditions, security holes, resource leaks, failure modes, and silent data corruption paths. Be adversarial. Be thorough. No compliments — just the problems." -s read-only -c 'model_reasoning_effort="xhigh"' --enable web_search_cached 2>"$TMPERR_ADV"
\`\`\`

Set the Bash tool's \`timeout\` parameter to \`300000\` (5 minutes). Do NOT use the \`timeout\` shell command — it doesn't exist on macOS. After the command completes, read stderr:
\`\`\`bash
cat "$TMPERR_ADV"
\`\`\`

Present the full output verbatim. This is informational — it never blocks shipping.

**Error handling:** All errors are non-blocking — adversarial review is a quality enhancement, not a prerequisite.
- **Auth failure:** If stderr contains "auth", "login", "unauthorized", or "API key": "Codex authentication failed. Run \\\`codex login\\\` to authenticate."
- **Timeout:** "Codex timed out after 5 minutes."
- **Empty response:** "Codex returned no response. Stderr: <paste relevant error>."

On any Codex error, fall back to the Claude adversarial subagent automatically.

**Claude adversarial subagent** (fallback when Codex unavailable or errored):

Dispatch via the Agent tool. The subagent has fresh context — no checklist bias from the structured review. This genuine independence catches things the primary reviewer is blind to.

Subagent prompt:
"Read the diff for this branch with \`git diff origin/<base>\`. Think like an attacker and a chaos engineer. Your job is to find ways this code will fail in production. Look for: edge cases, race conditions, security holes, resource leaks, failure modes, silent data corruption, logic errors that produce wrong results silently, error handling that swallows failures, and trust boundary violations. Be adversarial. Be thorough. No compliments — just the problems. For each finding, classify as FIXABLE (you know how to fix it) or INVESTIGATE (needs human judgment)."

Present findings under an \`ADVERSARIAL REVIEW (Claude subagent):\` header. **FIXABLE findings** flow into the same Fix-First pipeline as the structured review. **INVESTIGATE findings** are presented as informational.

If the subagent fails or times out: "Claude adversarial subagent unavailable. Continuing without adversarial review."

**Cleanup:** Run \`rm -f "$TMPERR_ADV"\` after processing (if Codex was used).

---

### Large tier (200+ lines)

Claude's structured review already ran. Now run **all three remaining passes** for maximum coverage:

**1. Codex structured review (if available):**
\`\`\`bash
TMPERR=$(mktemp /tmp/codex-review-XXXXXXXX)
codex review --base <base> -c 'model_reasoning_effort="xhigh"' --enable web_search_cached 2>"$TMPERR"
\`\`\`

Set the Bash tool's \`timeout\` parameter to \`300000\` (5 minutes). Do NOT use the \`timeout\` shell command — it doesn't exist on macOS. Present output under \`CODEX SAYS (code review):\` header.
Check for \`[P1]\` markers: found → \`GATE: FAIL\`, not found → \`GATE: PASS\`.

If GATE is FAIL, use AskUserQuestion:
\`\`\`
Codex found N critical issues in the diff.

A) Investigate and fix now (recommended)
B) Continue — review will still complete
\`\`\`

If A: address the findings. Re-run \`codex review\` to verify.

Read stderr for errors (same error handling as medium tier).

After stderr: \`rm -f "$TMPERR"\`

**2. Claude adversarial subagent:** Dispatch a subagent with the adversarial prompt (same prompt as medium tier). This always runs regardless of Codex availability.

**3. Codex adversarial challenge (if available):** Run \`codex exec\` with the adversarial prompt (same as medium tier).

If Codex is not available for steps 1 and 3, note to the user: "Codex CLI not found — large-diff review ran Claude structured + Claude adversarial (2 of 4 passes). Install Codex for full 4-pass coverage: \`npm install -g @openai/codex\`"

---

### Cross-model synthesis (medium and large tiers)

After all passes complete, synthesize findings across all sources:

\`\`\`
ADVERSARIAL REVIEW SYNTHESIS (auto: TIER, N lines):
════════════════════════════════════════════════════════════
  High confidence (found by multiple sources): [findings agreed on by >1 pass]
  Unique to Claude structured review: [from earlier step]
  Unique to Claude adversarial: [from subagent, if ran]
  Unique to Codex: [from codex adversarial or code review, if ran]
  Models used: Claude structured ✓  Claude adversarial ✓/✗  Codex ✓/✗
════════════════════════════════════════════════════════════
\`\`\`

High-confidence findings (agreed on by multiple sources) should be prioritized for fixes.

---`;

export const DESIGN_SKETCH = `## Visual Sketch (UI ideas only)

If the chosen approach involves user-facing UI (screens, pages, forms, dashboards,
or interactive elements), generate a rough wireframe to help the user visualize it.
If the idea is backend-only, infrastructure, or has no UI component — skip this
section silently.

**Step 1: Gather design context**

1. Check if \`DESIGN.md\` exists in the repo root. If it does, read it for design
   system constraints (colors, typography, spacing, component patterns). Use these
   constraints in the wireframe.
2. Apply core design principles:
   - **Information hierarchy** — what does the user see first, second, third?
   - **Interaction states** — loading, empty, error, success, partial
   - **Edge case paranoia** — what if the name is 47 chars? Zero results? Network fails?
   - **Subtraction default** — "as little design as possible" (Rams). Every element earns its pixels.
   - **Design for trust** — every interface element builds or erodes user trust.

**Step 2: Generate wireframe HTML**

Generate a single-page HTML file with these constraints:
- **Intentionally rough aesthetic** — use system fonts, thin gray borders, no color,
  hand-drawn-style elements. This is a sketch, not a polished mockup.
- Self-contained — no external dependencies, no CDN links, inline CSS only
- Show the core interaction flow (1-3 screens/states max)
- Include realistic placeholder content (not "Lorem ipsum" — use content that
  matches the actual use case)
- Add HTML comments explaining design decisions

Write to a temp file:
\`\`\`bash
SKETCH_FILE="/tmp/rasen-sketch-$(date +%s).html"
\`\`\`

**Step 3: Render and capture**

\`\`\`bash
TAB=$(curl --noproxy '*' -s "localhost:3456/new?url=file://$SKETCH_FILE" | jq -r .targetId)
curl --noproxy '*' "localhost:3456/screenshot?target=$TAB&file=/tmp/rasen-sketch.png&full=true"
\`\`\`

If the chrome-use proxy is not available (\`check-deps.mjs\` failed), skip the render
step. Tell the user: "Visual sketch requires chrome-use — a running Chrome with remote
debugging. Run \`check-deps.mjs\` to enable it."

**Step 4: Present and iterate**

Show the screenshot to the user. Ask: "Does this feel right? Want to iterate on the layout?"

If they want changes, regenerate the HTML with their feedback and re-render.
If they approve or say "good enough," proceed.

**Step 5: Include in design doc**

Reference the wireframe screenshot in the design doc's "Recommended Approach" section.
The screenshot file at \`/tmp/rasen-sketch.png\` can be referenced by downstream skills
(\`/design-review\`) to see what was originally envisioned.`;

export const SPEC_REVIEW_LOOP = `## Spec Review Loop

Before presenting the document to the user for approval, run adversarial review. This is
a **quality bonus, not a gate** — the document is a DRAFT; downstream \`/rasen-propose\` →
implement → \`/rasen-review-cycle\` will scrutinize it again (review-cycle is the real
adversarial code review). Do not over-polish a draft, and never iterate to convergence.

**Step 1: One fresh adversarial review**

Dispatch ONE independent reviewer via the Agent tool, and give it a **name** (e.g.
\`spec-reviewer\`) so you can continue it later. Fresh context is the whole point of this
first pass — the reviewer cannot see the brainstorming conversation, only the document on
disk — and that independence only holds on the FIRST pass.

Prompt: "Read this document and review it on 5 dimensions. For each dimension, note PASS
or list specific issues with a concrete suggested fix. End with a quality score (1-10).
Return PASS, or a numbered list of issues."

**Dimensions:**
1. **Completeness** — Are all requirements addressed? Missing edge cases?
2. **Consistency** — Do parts of the document agree with each other? Contradictions?
3. **Clarity** — Could an engineer implement this without asking questions? Ambiguous language?
4. **Scope** — Does the document creep beyond the original problem? YAGNI violations?
5. **Feasibility** — Can this actually be built with the stated approach? Hidden complexity?

**Step 2: Triage findings — defect vs. direction fork (CRITICAL)**

Sort every finding into one of two buckets. This is the step that goes wrong most often:

- **Defect** — there is ONE correct resolution (a missing validation, a self-contradiction,
  a name collision, stale wording, an unguarded check). → **Fix it silently** with the Edit
  tool. No user involvement needed.
- **Direction fork** — there are MULTIPLE valid resolutions and the choice depends on
  product vision, scope, or priorities (e.g. "this use case is incompatible with the reused
  skill" → could cut the use case, replace the skill, or reframe the design). → **STOP. Do
  not resolve it yourself.** Surface it to the user: name the fork, list the options, give
  your recommendation. Resolving a direction fork autonomously — especially by quietly
  narrowing scope — burns review rounds and produces a design the user never asked for.

**When unsure which bucket a finding is in, treat it as a direction fork and ask.**

**Step 3: Verify fixes with a WARM-continued reviewer (not a fresh dispatch)**

After applying defect fixes (and any user-decided fork resolutions), **continue the SAME
reviewer agent** via SendMessage (e.g. to \`spec-reviewer\`): "I addressed findings #N —
here's how. The doc is at <path>. Verify those are resolved and check ONLY the changed
sections; don't re-derive context you already have."

Warm continuation reuses the reviewer's prior context — it remembers what it flagged, so it
does a fast incremental delta-check instead of re-reading the whole document from scratch.
**Do NOT spawn a fresh reviewer for verification**: that throws away the context you already
paid for and re-reads everything (slow, expensive — the single biggest cause of wasted time
in this loop).

**Step 4: Fresh re-review ONLY after a major redesign**

Re-dispatch a FRESH reviewer (independence matters again) only when a direction fork or user
feedback drove a **substantial redesign that introduces new design surface area** — new
stages, new modes, a replaced mechanism. Cosmetic fixes and defect patches do NOT warrant a
fresh pass. At most one fresh-after-redesign pass per redesign.

**Step 5: Stop — don't converge**

The cap for a DRAFT is tight: **1 fresh review + 1 warm verification**, plus at most **1
fresh pass after a major redesign**. Do NOT iterate toward a perfect score.

- If the reviewer returns the SAME unresolved issue on two consecutive passes (the fix didn't
  land, or it's a genuine disagreement), STOP. Persist it as an "## Open Questions" or
  "## Reviewer Concerns" section in the document for \`/rasen-propose\` to resolve. A draft is
  allowed to carry open questions — that is not a failure.
- If the subagent fails, times out, or is unavailable — skip the loop: tell the user "Spec
  review unavailable — presenting unreviewed doc." The document is already on disk; the
  review is a bonus, not a gate.

**Step 6: Report and persist metrics**

1. Summary, by default: "Fresh review + N warm verification pass(es). M defect findings
   fixed; K direction fork(s) surfaced to you. Quality score: X/10." Show the full reviewer
   output only if asked.
2. Residual unresolved issues → "## Reviewer Concerns" section in the document (downstream
   skills read it).
3. Append metrics:
\`\`\`bash
mkdir -p ~/.rasen/analytics
echo '{"skill":"office-hours","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","iterations":ITERATIONS,"issues_found":FOUND,"issues_fixed":FIXED,"remaining":REMAINING,"quality_score":SCORE}' >> ~/.rasen/analytics/spec-review.jsonl 2>/dev/null || true
\`\`\`
ITERATIONS = total review passes (fresh + warm). Replace ITERATIONS, FOUND, FIXED,
REMAINING, SCORE with actual values from the review.`;

