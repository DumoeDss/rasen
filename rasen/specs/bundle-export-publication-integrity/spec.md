# bundle-export-publication-integrity Specification

## Purpose
When publishing a knowledge bundle, the destination is verified to be the exact file authorized and within the Store subtree both immediately before and after the link. A temp-path swap (wrong bytes) or an authorized-parent symlink/junction swap (publish outside the Store) fails closed rather than succeeding with misplaced content.
## Requirements
### Requirement: Published bundle bytes and destination are verified against the authorized file descriptor

A knowledge bundle export SHALL verify that the temporary file's identity still matches the open file descriptor immediately before the publication link operation, after all authorization checks have completed. After the link operation, the destination file's content SHALL be verified against the content that was written to the descriptor. If the platform cannot prove file identity (for example, when file inode is zero on Windows NTFS), the content comparison SHALL be the authoritative check, and a platform that cannot satisfy either identity or content verification SHALL fail rather than return success.

#### Scenario: A temp-path swap between authorization and link is detected

- **WHEN** the temporary file path is replaced between the Store authorization check and the link operation
- **THEN** the pre-link identity re-verification detects the swap
- **AND** the export fails rather than publishing the wrong bytes

#### Scenario: A destination content mismatch after link is detected

- **WHEN** the link operation succeeds but the destination file's content does not match what was written to the file descriptor
- **THEN** the post-link content verification detects the mismatch
- **AND** the export fails rather than reporting success

#### Scenario: A platform with zero inodes verifies via content comparison

- **WHEN** the export runs on a filesystem where file inodes are always zero (Windows NTFS)
- **THEN** the identity check is supplemented by a content comparison of the destination against the written bytes
- **AND** a mismatch is detected and reported as a failure

