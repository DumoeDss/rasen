<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Test-driven development reference

Read this reference only when test-first implementation is selected for the active `rasen-apply-change` task. TDD is a vertical red → green loop; this reference keeps the resulting tests worth retaining.

When exploring the codebase, read `CONTEXT.md` if present and respect relevant ADRs so test names and interface vocabulary match the project.

## Agree the seams first

A **seam** is the public interface where behaviour can be observed without reaching into implementation details. Before writing a test, state the seams under test and agree them with the user or the change artifacts. Do not spread tests across unconfirmed internal boundaries.

Read [tests.md](tests.md) for examples and [mocking.md](mocking.md) for system-boundary mocking guidance.

## Three anti-patterns

- **Implementation-coupled** — mocks internal collaborators, tests private methods, or verifies through a side channel. It breaks during refactoring even when behaviour is unchanged.
- **Tautological** — computes the expected value in the same way as the implementation, so the assertion passes by construction. Use an independent literal, worked example, or spec.
- **Horizontal-slicing** — writes all imagined tests before implementation. Use tracer-bullet vertical slices instead: one behaviour test, one minimal implementation, then let that cycle inform the next.

## Rules of the loop

1. **Red before green.** Observe the new test fail for the intended reason.
2. **One vertical slice at a time.** One seam, one behaviour, one minimal implementation.
3. **Do not anticipate later tests.** Add only what makes the current slice pass.
4. **Keep tests behavioural.** Tests use public interfaces and survive internal refactors.
5. **Refactor only with a green suite.** Preserve behaviour while improving the implementation, then run the focused test again.

## Completion check

For each retained test, confirm its initial red evidence, the public seam it exercises, the independent expected result, and that it would fail for a meaningful regression rather than an internal rearrangement.
