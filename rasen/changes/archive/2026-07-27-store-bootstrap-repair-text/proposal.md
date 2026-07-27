## Why

E1, E2, and E3 made `rasen bootstrap` able to register, obtain, and prepare everything a project declares. But the commands that fail when a Store is missing still point the user at one repair at a time — register this, then run again, then discover the next gap. The repair that would actually close the whole gap exists now; the failure messages have not caught up to it. This change makes every ordinary command that cannot resolve a declared Store name `rasen bootstrap` as the repair, and gives `rasen doctor` a read-only bootstrap-readiness section that reports the same gap in one place.

## What Changes

- **An unavailable Store points at bootstrap, not at a one-step repair.** When an ordinary command fails because a declared Store is not on this machine, the failure names `rasen bootstrap` as the repair — the one command that registers, obtains, and prepares everything the project declares — instead of the single-step `rasen store register <path>` that closes exactly one gap.
- **Bootstrap is named only where bootstrap can actually repair.** A Store with no recorded remote and no supplied path is not something bootstrap can obtain either, so the failure asks for a path or remote rather than suggesting bootstrap. A checkout that carries a different identity is a mismatch bootstrap cannot fix, so the failure names it as such and writes nothing.
- **The command bootstrap prints is pasteable and unambiguous.** The same selector rule E1 applied to bootstrap's own hints applies to the repair text other commands print: when the Store's display name matches more than one Store on this machine, the printed command names the permanent identity.
- **`rasen doctor` reports bootstrap readiness.** A new read-only section composes the health facts doctor already gathers into a single "is this machine ready, and if not, what does it need?" answer, with copy-pasteable repairs. The section is designed as the seam the following knowledge-bundle change extends.
- **Diagnosis stays read-only.** Doctor reports the readiness and changes nothing; the repairs it lists are the commands the user runs.

Out of scope: anything E1/E2/E3 delivered (the bootstrap command itself, its check/preview/apply modes, registration, retrieval, idempotence, durable declarations); the knowledge-bundle preparation that follows; and any behavior change. This change alters what failing commands **say**, not what they **do**.

## Capabilities

### New Capabilities

None. This change adds one requirement to the `store-bootstrap` capability E1 created and E2/E3 extended.

### Modified Capabilities

- `store-bootstrap`: ADD the requirement that ordinary commands failing on a declared Store name bootstrap as the repair, and that diagnosis reports bootstrap readiness read-only. No existing requirement in this capability changes — its scenarios are preserved verbatim by the children that already shipped them.

## Impact

- **Code**: the shared Store identity resolver (`src/core/store/identity.ts`, `src/core/store/identity-diagnostics.ts`) is where every command's unavailable-Store repair text is built today; this change makes `rasen bootstrap` the primary repair where bootstrap can repair, and leaves the diagnosis-only fallback (`rasen doctor`) for the states bootstrap cannot fix. `src/core/relationship-health.ts` gains a `bootstrapReadiness` section composed from existing inputs. `src/commands/doctor.ts` and `src/commands/shared-gather.ts` gather and render it.
- **Commands**: every command that resolves a declared Store (the breadth of the CLI) surfaces the new repair text through the shared resolver — no per-command edits, because the architecture funnels through one `primaryRepair` / `describeUnavailableStore` pair. `rasen doctor` gains the readiness section.
- **Locales**: `src/locales/{en,zh-cn,ja}.json` for the new doctor section and any new repair strings.
- **Docs**: `docs/cli.md` gains a bootstrap troubleshooting entry per blocked and degraded state.
- **Compatibility**: no behavior change. Commands that previously failed still fail the same way and write nothing; the text they print on failure is what changes. A machine that resolves everything is unaffected.
- **Depends on** E1 (the bootstrap command and its check-mode reporting), E2 (apply-mode registration), and E3 (apply-mode retrieval). Their shipped contracts are the surface this change wires together.
