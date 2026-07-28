# config-http-api Delta Specification

## REMOVED Requirements

### Requirement: Read-only pipelines inventory endpoint

**Reason**: The pipelines API grows past this capability's scope — space addressing, effective per-stage configuration reporting, and a CLI-backed mutation POST that this requirement's GET-only clause forbids. The whole pipelines surface moves to the new `pipeline-http-api` capability, whose "Pipelines inventory endpoint with effective stage configuration" and "Pipeline mutations run through a whitelisted CLI bridge" requirements carry the contract forward.
**Migration**: Every element of this requirement survives in `pipeline-http-api`: the endpoint path, the in-process registry loading, the token guard, the declared stage fields including the `'vet'`-distinguishable gate value, and method rejection (now scoped to PUT/DELETE, since POST becomes the admitted mutation bridge). Clients reading the old response shape keep working — the new fields are additive.
