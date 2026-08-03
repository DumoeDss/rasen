<!-- adapted from mattpocock/skills (MIT, Copyright Matt Pocock) -->

# Codebase design reference

Use this reference only when `rasen-propose` is shaping a new module, a non-trivial interface, or another design-dense change. Record the resulting decisions in the active change's `design.md` Decisions section or in a sidecar under the `changeRoot` returned by `rasen status --change <name> --json`.

Design **deep modules**: a lot of behaviour behind a small interface, placed at a clean seam and testable through that interface. The aim is leverage for callers, locality for maintainers, and testability for everyone.

## Glossary

Use these terms consistently:

- **Module** — anything with an interface and an implementation: a function, class, package, or tier-spanning slice.
- **Interface** — everything a caller must know to use the module correctly, including invariants, ordering, error modes, configuration, and performance characteristics.
- **Implementation** — what is inside a module. Use **adapter** when the role at a seam is the subject.
- **Depth** — leverage at the interface: how much behaviour callers can exercise per unit of interface they must learn.
- **Seam** — a place where behaviour can change without editing the caller; this is where a module's interface lives.
- **Adapter** — a concrete implementation that satisfies an interface at a seam.
- **Leverage** — capability returned to callers per unit of interface learned.
- **Locality** — change, bugs, knowledge, and verification concentrated behind one interface rather than spread across callers.

## Deep versus shallow

A deep module presents a small, simple interface over substantial behaviour. A shallow module exposes nearly as much complexity as it contains. When shaping an interface, ask:

- Can the number of entry points be reduced?
- Can parameters and required ordering be simplified?
- Can more complexity be hidden without hiding important failure modes?

Apply the **deletion test**: if deleting the module makes complexity vanish, it was probably a pass-through; if the complexity reappears across many callers, the module was earning its keep.

Depth is a property of the interface, not a reward for a large implementation. A module may have private internal seams while exposing one coherent external seam. Callers and tests should cross the same public interface. One adapter is usually a hypothetical seam; two justified adapters make the variation real.

## Design for testability

1. Accept dependencies rather than constructing them internally.
2. Return observable results rather than hiding all behaviour in side effects.
3. Keep the public surface small enough that callers and tests can understand it.
4. Test at the interface. If a test must reach past it, reconsider the module shape.

## Completion check

Before returning to the proposal, capture:

- the chosen module and its interface;
- the seam and justified adapters;
- what complexity is hidden and where locality improves;
- the main invariants, error modes, and test surface;
- alternatives rejected and why.

For dependency categories and safe deepening, read [DEEPENING.md](DEEPENING.md). When the first interface is unlikely to be good enough, read [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md) and compare radically different shapes before choosing.
