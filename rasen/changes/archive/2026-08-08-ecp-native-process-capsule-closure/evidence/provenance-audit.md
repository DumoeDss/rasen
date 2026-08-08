# Helper provenance claim audit

Authoritative surfaces inspected before the S5 wording/schema edit:

| Surface | Starting claim | Closure action |
| --- | --- | --- |
| `scripts/build-process-capsule.mjs` | Manifest recorded helper length/SHA plus `compiler` and `sourceSha256`, without naming what the latter proved. | Artifact now explicitly records `provenance: build-inputs`; isolated output roots omit release staging but preserve the production default. |
| `src/core/session-host/process-capsule/resolver.ts` | Compiler and source digest were optional closed-schema fields. | Both are required together with the `build-inputs` label; protocol/platform/arch/capability/length/SHA checks remain exact. |
| `docs/session-host.md` | Said the helper was source-built from pinned source, but did not define byte reproducibility. | Now states that compiler/source digest are build-input provenance and do not promise identical rebuild bytes. |
| `.github/workflows/release.yml` | Upload step was named “with provenance”; it made no byte-reproducibility claim. | No wording expansion; release staging and artifact collection remain unchanged. |
| `package.json` / package files | No helper byte-reproducibility statement. | No new claim added. |
| Prior Change evidence | Explicitly warned that repeated source-identical Windows hashes differed while each adjacent manifest was internally correct. | Preserved as historical evidence, not rewritten. |

The current contract is deliberately narrower than reproducible builds:
manifest-to-adjacent-artifact integrity is exact; compiler/source facts describe
inputs; two-build equality is recorded as local platform evidence only.

The focused two-clean-build gate on Windows x64 produced unequal artifact
digests from identical source/compiler inputs, while each artifact exactly
matched its own manifest:

```text
fbd2495224e8c7faba81bf662b0a8364b0295410df2b43b687c56000865d0fd5
8c68eb707a008081e61a54255077347d5b8d1a3788e48a142bbd56ae0208ff1c
equal=false
```

This is accepted evidence for the selected narrow contract, not a reproducible
build claim.
