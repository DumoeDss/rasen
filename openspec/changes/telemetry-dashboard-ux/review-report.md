# Review Report — telemetry-dashboard-ux

Reviewer: reviewer-dashux (independent verifier; author ≠ verifier)
Date: 2026-07-09

## Summary verdict

**APPROVE.** The implementation faithfully realizes the locked design. The entire
intended diff is confined to `telemetry-backend/admin/index.html`
(`git status --porcelain -- telemetry-backend/` shows only that file; +119/−44).
JS correctness — the highest-risk area since this is hand-written DOM code with no
test coverage — is sound: `currentParams()` preserves the backend contract verbatim,
`renderPills` is a line-for-line faithful port of `populateFilter` (including the
re-inject-dropped-selection path, 40-char truncation, and full-value `title`),
selection comparisons use raw (unescaped) values, all three innerHTML sinks are
`escapeHtml`-guarded (no XSS path), and event listeners are container-delegated so
they do not accumulate across pill re-renders. `npm test` 29/29 green;
`validate --strict` green; inline script passes `node --check`.

No Blocker or Major findings.

## Findings table

| Severity | Location | Description |
|----------|----------|-------------|
| Minor | tasks.md 3.1–3.7, 4.1 | User hands-on acceptance (live-panel, human eyes) and the ship commit remain unchecked. Expected — these are post-review gates, not implementation gaps. All 16 impl+verify tasks (1.1–1.11, 2.1–2.5) are done. |
| Trivial | index.html:350 | `!container.contains(btn)` is redundant — `e.target.closest('button.pill')` on a listener bound to `container` can only return a descendant. Harmless. |
| Trivial (informational) | index.html:118–121, 290–297 | Segmented range + pills use the `aria-pressed` toggle-button pattern rather than a `radiogroup`/`aria-checked` radio pattern. This is exactly what the locked design and tasks specify, and it satisfies the spec scenario ("reports its selected (pressed) state"). Noted only for completeness; not an issue. |

## Focus-area audit (the 7)

1. **currentParams() contract** — PASS. `git show HEAD:` diff confirms the old body set
   `range` always, `hideTest` always ('true'/'false'), and `command`/`version`/`os` only
   when truthy. The new body reads `$('range').dataset.range || '7d'`, `$('hideTest').checked`,
   and each container's `dataset.value`, emitting the identical query string. Backend
   contract (`range`/`command`/`version`/`os`/`hideTest`) unchanged. (index.html:195–204)

2. **renderPills preserve-selection + truncation + escaping** — PASS. Byte-for-byte logical
   equivalent of `populateFilter`: reads `current` from `dataset.value`, unions breakdown
   values (filtering null/empty exactly as the original did), `unshift`es a selected value
   that dropped out of the list, `Set`-dedupes and `sort()`s, emits an "All" pill
   (`data-value=""`) plus one pill per value. Truncation expression is the exact
   `v.length > 40 ? v.slice(0,40)+'…' : v` (73c3642 not regressed) and `title` carries the
   full escaped value. `escapeHtml` is applied to `data-value`, `title`, and text; selection
   comparison `v === current` uses raw values on both sides (dataset decodes entities on
   read, so no double-escaping). **XSS trace**: a crafted command name (quotes / angle
   brackets / `onmouseover=`) flows API JSON → `r[key]` → `escapeHtml` at every sink; `"`
   and `'` are entity-encoded so it cannot break out of the `data-value`/`title` attributes,
   and `<`/`>` are encoded in text — no injection path. (index.html:283–304)

3. **Event wiring** — PASS. Range click delegated on the static `#range` group (never
   re-rendered); each pill row's click listener is bound once to the container at init
   (`['fCommand','fVersion','fOs'].forEach(wirePills)`, line 363) and delegates via
   `closest('button.pill')`, so re-rendering pills inside the container does NOT accumulate
   listeners. `#hideTest` keeps its `change→load`; `#refresh` keeps `click→load`; the old
   select-based `change` array is gone (no `<select>`/`populateFilter` residue — grep clean).
   (index.html:332–367)

4. **State-refresh loop soundness** — PASS. Pill click sets `container.dataset.value = next`,
   optimistically syncs `active`/`aria-pressed`, then `load()` re-fetches and re-renders;
   `renderPills` reads the just-set `data-value` as `current`, so active class and
   `aria-pressed` are rebuilt consistently with `data-value`. `load()` does not dispatch
   click events, so there is no re-entrant loop. Deselect logic
   `(val !== '' && val === current) ? '' : val` correctly toggles a selected value to All,
   selects a new value, and treats the All pill as All. (index.html:345–361, 283–300)

5. **CSS / layout / a11y** — PASS. `.pills` is `flex-wrap: wrap`; `.pill` is
   `max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (secondary
   clamp behind JS truncation) — no horizontal overflow. `focus-visible` outlines exist for
   segment buttons, pills, and the switch input. The toggle keeps a real
   `<input type=checkbox id=hideTest checked>` that is `opacity:0` but full-size and
   positioned over the switch, so it stays keyboard-focusable and in tab order (not
   `display:none`). 720px breakpoint (`.grid-2 → 1fr`) intact; controls wrap via flex.
   (index.html:38–66, 101, 136–142)

6. **Syntax** — PASS. Inline `<script>` extracted to scratchpad and `node --check` clean.

7. **Delta spec coherence** — PASS. Delta `MODIFIED` header
   `### Requirement: Dashboard Filtering and Time Range` matches the main
   `openspec/specs/telemetry-admin-console/spec.md` header verbatim (archive-matching safe).
   `node bin/rasen.js validate telemetry-dashboard-ux --strict` → "is valid".

## Test re-run result

`npm test` (npm, inside `telemetry-backend/`): **29 passed / 29** (test/worker.test.ts,
824ms). Matches the expected no-test-delta for a pure front-end change.

## Artifact coherence

Proposal, design, delta spec, and tasks are mutually consistent and match the code. The
DOM-as-state decision (`data-range` on the segment group, `data-value` on pill containers,
`currentParams` reading attributes), the `renderPills`-replaces-`populateFilter` port, the
checkbox-under-CSS toggle, and the event-wiring reduction (only `hideTest` on `change`;
range/pills click-delegated) are all present exactly as specified in the Planner addendum.
No scope creep outside `admin/index.html`.
