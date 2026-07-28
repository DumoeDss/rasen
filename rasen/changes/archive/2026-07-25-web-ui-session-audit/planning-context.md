# Planning Context

## User intent

> 为web ui增加一个功能：选择session进行audit分析并显示结果，我们当前是有一个单独的viewer\audit.html，现在想想既然做了web ui，那就可以直接在web中也集成这个功能。可以快捷选择session，也可以从文件导入，生成的config结果本来就会保存到~/.rasen/analytics，所以直接就可以作为列表展示（切换）

## Known constraints

- Integrate the existing audit experience into the current Web UI instead of maintaining only `viewer/audit.html`.
- Users need two input paths: quickly select a discovered session, or import a session file.
- Audit outputs already persist under `~/.rasen/analytics`; expose those saved results as a list and allow switching between them.
- Reuse the existing audit implementation, result format, and visual language where practical rather than inventing a parallel contract.
- Preserve cross-platform path behavior (Windows, macOS, Linux) and use Node path utilities.
- The working tree already contains unrelated user changes. Do not overwrite, clean, or fold them into this change.

## Autopilot decisions

- Pipeline: `small-feature`.
- Selection policy: `manual` (default).
- Gate policy: `off` from global config; effective stage gates are auto-approved and recorded.
- Execution tier: Tier B-style isolated workers under the Codex host.
- Change id: `web-ui-session-audit`.

## Planner research targets

- Locate the current Web UI architecture, routes/tabs, API/server endpoints, and tests.
- Inspect `viewer/audit.html`, the `rasen-audit` workflow/CLI implementation, session discovery/import code, and analytics persistence schema.
- Define the smallest cohesive user flow for browsing saved analyses, selecting a session, importing a file, running audit, and showing errors/progress/results.
- Identify any security and file-access boundaries required for localhost Web UI APIs.

## Durable findings and decisions

- Audit is machine-wide rather than planning-space-owned: the Preact shell already supports global `/workflows` and `/profiles` routes, while native Claude/Codex/Zed stores and the resolved Rasen `analytics` directory are user-wide. The Web UI entry is therefore a global `/audit` route.
- `src/core/token-audit/audit.ts` is already the authoritative cross-runtime engine and writes `rasen-token-audit/2` reports to `path.join(getGlobalDataDir(), 'analytics')`; the Web UI should call this core and index validated report files rather than create a second schema or database.
- `viewer/audit.html` already contains the complete backward-compatible Claude/Codex/Zed renderer. A same-origin `postMessage` embed mode can reuse it exactly while preserving standalone file-drop/`?src=`/`--open` behavior.
- Browser import must grant file bytes, not an arbitrary server path. Native session selection should send only `{runtime, sessionId}` and be re-resolved inside established runtime stores; uploaded `.jsonl`/`.db`/`.sqlite` sources use generated temporary files, while valid audit-report `.json` files are copied into analytics.
- Saved-result lookup must accept one direct regular basename beneath analytics, reject traversal/symlinks, and resolve every path with Node path utilities so Windows, macOS, Linux, and machine-home overrides share one contract.
- Follow-up layout decision (user: “当前的页面利用率有点低，本身audit的页面内容就是要看比较多的，现在两侧还留白那么多，把左侧栏设置成可展开收起的，然后整个页面横向占比再放宽一些，让横向因需要滚动”): interpret the final phrase as reducing/eliminating horizontal scrolling. Use a substantially wider Audit page with compact side gutters; make Saved results an accessible collapsible rail that is expanded initially on normal desktops, collapsed initially on narrow screens, and gives all reclaimed width to the report pane while preserving selection and a clear keyboard-operable reopen control.
