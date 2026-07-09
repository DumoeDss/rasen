# project-registry Specification (delta)

## ADDED Requirements

### Requirement: Doctor reports machine-root relocation state

`rasen doctor`'s machine-home section SHALL surface the relocation lifecycle without acting on it: after a successful adoption, when an old-scheme machine-data directory still exists on disk, it SHALL note the path and that the contents were copied to the new root and are safe to delete after verifying; when adoption is pending or previously failed (the resolved default root lacks content, an old-scheme directory exists, and no environment override is set), it SHALL warn loudly with the manual remedy. Doctor SHALL remain read-only — startup owns the adoption re-attempts.

#### Scenario: Lingering old directory noted after adoption

- **WHEN** `rasen doctor` runs after a successful relocation and the old-scheme directory still exists
- **THEN** the machine-home section SHALL name the old path and state it is safe to delete after verification
- **AND** doctor SHALL NOT delete or modify it

#### Scenario: Failed relocation warned loudly

- **WHEN** `rasen doctor` runs while the default root lacks machine data, an old-scheme directory exists, and no env override is set
- **THEN** the machine-home section SHALL warn that relocation has not completed and show the manual remedy

#### Scenario: Clean state shows no relocation output

- **WHEN** no old-scheme directory exists
- **THEN** the machine-home section SHALL contain no relocation-related lines
