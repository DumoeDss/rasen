## 1. Regression Coverage

- [x] 1.1 Add a focused `InitCommand` regression that creates a valid store-pointer repository with cross-platform path utilities, installs Codex through an explicit non-empty `--tools` selection, and proves the pointer survives while local planning directories remain absent.
- [x] 1.2 Extend the declared-store CLI coverage to prove explicit pointer-root tool installation succeeds and that plain init, `--tools none`, malformed pointers, and descendant targets still refuse without unsafe writes.

## 2. Pointer Tool-Only Initialization

- [x] 2.1 Update the pointer guard to recognize a valid non-empty explicit tool selection only when the requested target canonically identifies the exact pointer repository root, while preserving malformed-pointer and descendant refusal precedence.
- [x] 2.2 Route pointer tool-only mode through the existing tool validation and generation lifecycle while skipping local planning-directory creation and pointer-config creation or profile-lock mutation.

## 3. Verification

- [x] 3.1 Build the CLI and run the focused core init and declared-store command tests, confirming the new success path and every retained safety refusal.
- [x] 3.2 Run the path-sensitive focused tests on Windows CI or a local Windows environment, verify native separators and canonical root identity, then run the related init test files and project type checks.
