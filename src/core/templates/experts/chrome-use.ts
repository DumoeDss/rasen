import type { SkillTemplate } from '../types.js';
import { STORE_SELECTION_GUIDANCE } from '../workflows/store-selection.js';
import { PREAMBLE_LITE } from './_shared.js';

// Self-contained by design: this template inlines its own SETUP and endpoint
// reference and does NOT import browse's `_shared.ts` browse constants
// (`BROWSE_SETUP`/`SNAPSHOT_FLAGS`/`COMMAND_REFERENCE`). That keeps the browse
// seam clean — the sibling expert-templates change can rewrite those constants
// and the browse-removal change can delete browse without touching chrome-use.
const BODY = `
${PREAMBLE_LITE}

# chrome-use: Browser QA via CDP

Drives the user's **everyday Chrome** over the Chrome DevTools Protocol (CDP)
through a sticky local HTTP proxy on port 3456. No headless binary, no
Playwright — it inherits the real browser's login state and fingerprint. Use it
for QA on pages that need auth, dynamic/SPA rendering, or resist bots, and for
browser-layer network capture, DOM snapshots, performance metrics, and
responsive audits.

## SETUP (run first, every session)

\`\`\`bash
node "\${CLAUDE_SKILL_DIR}/scripts/check-deps.mjs"
\`\`\`

\`check-deps.mjs\` verifies Node, detects Chrome's debugging port, and starts the
CDP proxy if it is not already running. Expect output like \`node: ok\`,
\`chrome: ok (port NNNN)\`, \`proxy: ready\`.

**Prerequisites:**
- **Chrome** running with remote debugging enabled. If \`check-deps.mjs\` reports
  \`chrome: not connected\`, tell the user to open \`chrome://inspect/#remote-debugging\`
  and tick **Allow remote debugging** (Chrome must be running first).
- **Node 22+** (the proxy uses the native \`WebSocket\`). Older Node prints a warning.

**First-connection permission popup:** the **first** CDP connection triggers a
Chrome **"Allow"** authorization popup. If \`check-deps.mjs\` hangs on
\`proxy: connecting...\`, it is waiting on that popup — tell the user to click
**Allow**, then it finishes with \`proxy: ready\`. This only happens once per
Chrome session.

**Sticky proxy — never stop it.** The proxy binds port 3456 and stays resident;
a restart forces re-authorizing CDP (another Allow popup). Do **not** \`pkill\` it
between commands. \`check-deps.mjs\` reuses a healthy running instance. Logs go to
\`os.tmpdir()/cdp-proxy.log\`.

**Tab lifecycle (per-\`targetId\`, shared proxy).** The proxy is shared across
sub-agents; isolate your work by tab:
- \`GET /new?url=URL\` opens a **background** tab and returns \`{targetId}\`. Use this
  \`targetId\` on every subsequent call as \`?target=<id>\`.
- \`GET /close?target=<id>\` closes it when done. Managed tabs also auto-close after
  ~15 min idle.
- Emulation overrides (\`/viewport\`, \`/responsive\`) persist on the tab; reset via
  \`/viewport\` or just close the disposable tab.

## Core patterns (curl against http://localhost:3456)

\`\`\`bash
BASE=http://localhost:3456
# --noproxy '*' on every call: a configured HTTP(S)_PROXY otherwise hijacks
# localhost and returns 502.

# open a disposable tab, capture its id
TAB=$(curl --noproxy '*' -s "$BASE/new?url=https://yourapp.com" | jq -r .targetId)

# verify a page loads
curl --noproxy '*' -s "$BASE/info?target=$TAB"                       # title / url / readyState
curl --noproxy '*' -s "$BASE/text?target=$TAB&selector=.main-content"
curl --noproxy '*' -s "$BASE/console/enable?target=$TAB"; curl --noproxy '*' -s "$BASE/console?target=$TAB&level=error"

# interact
curl --noproxy '*' -s -X POST "$BASE/click?target=$TAB" -d '#submit'     # JS-layer click (CSS selector in body)
curl --noproxy '*' -s "$BASE/screenshot?target=$TAB&file=/tmp/shot.png"

# reverse-engineer a request (browser-layer capture)
curl --noproxy '*' -s "$BASE/network/enable?target=$TAB&body=true"
curl --noproxy '*' -s "$BASE/network/wait?target=$TAB&url_pattern=/api/.*/submit&method=POST&timeout=60000&include_body=true"

# close when done
curl --noproxy '*' -s "$BASE/close?target=$TAB"
\`\`\`

## Browser-QA endpoints

\`\`\`bash
# structured interactive DOM snapshot (parity with browse snapshot -i/-C/-D)
curl --noproxy '*' -s "$BASE/snapshot?target=$TAB"            # interactive elements w/ @ref, role, name
curl --noproxy '*' -s "$BASE/snapshot?target=$TAB&mode=C"     # + non-ARIA clickables (@c refs)
curl --noproxy '*' -s "$BASE/snapshot?target=$TAB&mode=D"     # diff vs previous snapshot: added/removed

# performance metrics (FCP/LCP/CLS + long tasks + nav/resource timing)
curl --noproxy '*' -s "$BASE/perf?target=$TAB"

# device viewport emulation — does NOT resize the real window
curl --noproxy '*' -s "$BASE/viewport?target=$TAB&width=375&height=812&scale=2&mobile=true"

# responsive audit across mobile/tablet/desktop breakpoints (optional per-bp screenshot)
curl --noproxy '*' -s "$BASE/responsive?target=$TAB&screenshot=true&dir=/tmp"
\`\`\`

Take \`/snapshot\` in pairs (baseline, then \`mode=D\` after an action) to see exactly
what changed. \`/perf\` returns whatever metrics the page has produced — a background
tab that never rendered reports \`null\` paint/\`lcp\` plus a \`visibility\`/\`note\`; pass
\`&activate=true\` to briefly foreground it and sample real paint (\`lcp\` reads from a
buffered observer, so any once-rendered tab already has it).

## Full endpoint reference

The complete API — navigation, input, network capture, waiting, console,
storage, DOM shortcuts, resources/iframes, and the QA endpoints above — is in
\`references/cdp-api.md\` beside this skill. Core primitives: \`/health\` \`/targets\`
\`/new\` \`/close\` \`/navigate\` \`/back\` \`/info\` \`/eval\` \`/click\` \`/clickAt\`
\`/setFiles\` \`/scroll\` \`/screenshot\` \`/network/*\` \`/wait\` \`/console/*\`
\`/cookies\` \`/localStorage\` \`/text\` \`/attribute\` \`/resources\` \`/iframes\`.

## Show screenshots to the user

After \`/screenshot\` or \`/responsive\` writes a PNG, use the Read tool on the
output file so the user can actually see it — otherwise the screenshot is invisible.
`;

export function getChromeUseSkillTemplate(): SkillTemplate {
  return {
    name: 'rasen:chrome-use',
    description: 'Browser QA via CDP — drive the real Chrome browser through a local proxy for DOM snapshots, clicks, network capture, screenshots, and responsive audits',
    instructions: `${BODY.trim()}\n\n${STORE_SELECTION_GUIDANCE}`,
    metadata: { author: 'rasen', version: '1.0' },
  };
}
