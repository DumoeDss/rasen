# Independent workflow and pipeline review

Use this reference only after the staged package passes static validation. The review is read-only unless the user separately authorizes fixes. Give it to a reviewer who did not author the package when role isolation is available; otherwise declare and perform a clearly separated second pass.

Read [checklist.md](checklist.md) before reviewing. Never execute scripts from the staged package.

## Preconditions

1. Review a staging directory, never the final user-wide registry.
2. Run `rasen workflow validate <path> --json` or `rasen pipeline validate <path> --json` first. Static errors block semantic review.
3. Read the complete manifest, `SKILL.md` or `pipeline.yaml`, and every declared sidecar.
4. Keep the reviewer distinct from the author whenever the runtime supports it.

## Semantic review

Verify purpose, trigger, scope, inputs, outputs, completion, and escalation; dependency declarations and prose agreement; overlap with built-ins; portable skill identity; destructive, network, secret, and external writes plus their confirmations; shell interpolation, path traversal, credential handling; deterministic failure behaviour; bounded loops; and a clear terminal condition.

For pipelines also verify:

- the stage DAG is acyclic and the build order matches intent;
- stage ids are unique and not misleadingly near-duplicate;
- decompose recursion is bounded to one level and child pipelines are decompose-free;
- every effective runtime/model is resolvable or its portability cost is documented;
- every standard stage's skill exists and is enabled for the intended installer.

## Findings contract

Return each real finding as:

```text
[severity] location
Evidence: concrete text or behavior
Required fix: specific correction and acceptance condition
```

Use `critical`, `high`, `medium`, or `low`; do not report stylistic preferences as defects. End with `APPROVE`, `CHANGES REQUIRED`, or `BLOCK` and the reason. A successful review is a mitigation, not a signature, attestation, or safety guarantee, and it never imports the package.
