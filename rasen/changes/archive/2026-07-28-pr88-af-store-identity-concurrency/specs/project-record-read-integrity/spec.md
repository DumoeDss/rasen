## ADDED Requirements

### Requirement: Authority reads distinguish absent files from unreadable files

A read of a project membership record SHALL treat only ENOENT (file does not exist) as the ordinary "no record" state. A file that exists but cannot be read due to a permission error, I/O fault, or platform-specific condition (Windows delete-pending, network drive blip) SHALL NOT be silently treated as absent. The read SHALL either throw with a diagnostic naming the file and the error, or return a degraded diagnostic that distinguishes "unreadable" from "not present."

#### Scenario: A permission error on the record file is not treated as absence

- **WHEN** a project membership record file exists but the process lacks permission to read it
- **THEN** the read does not return an empty/absent result
- **AND** the error is reported with the file path and the permission error code

#### Scenario: A missing records directory is the ordinary empty state

- **WHEN** the Store's project records directory does not exist
- **THEN** the listing returns an empty record set with no error
- **AND** no diagnostic is produced, because this is the ordinary state of a Store with no project members

#### Scenario: An I/O error reading the records directory is not treated as empty

- **WHEN** the Store's project records directory exists but cannot be enumerated due to an I/O error
- **THEN** the listing does not return an empty record set
- **AND** the error is reported with the directory path and the error code
