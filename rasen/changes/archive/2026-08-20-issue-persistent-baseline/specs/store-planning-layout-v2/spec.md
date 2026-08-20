## MODIFIED Requirements

### Requirement: Layout version is declared explicitly and independently

Store metadata SHALL represent layout v2 with its own layout declaration, separate from the metadata
schema version, so the two version meanings never collide. Store metadata without that declaration
SHALL remain a legacy-layout Store. Reading or writing Store metadata SHALL NOT infer the declaration
from directories found on disk, and SHALL NOT add it to a record that did not carry it. `rasen store
setup` SHALL author the declaration at creation when the operator explicitly requests layout 2,
writing a store whose metadata carries the declaration and whose created scaffold is the layout-2
shape with no flat planning tree to retire; without the explicit request, setup SHALL create exactly
what it creates today, and no other command SHALL add the declaration to a legacy record.

#### Scenario: Existing permanent-identity metadata stays legacy-layout

- **WHEN** Store metadata carries a permanent Store identity but no layout declaration
- **THEN** it parses as a Store whose layout version is not declared
- **AND** writing it back does not introduce a layout declaration

#### Scenario: Layout v2 is declared explicitly

- **WHEN** Store metadata carries both its metadata schema version and an explicit layout version 2
- **THEN** the Store is recognized as declaring layout v2
- **AND** the two version fields retain their separate meanings

#### Scenario: Directories on disk never upgrade a Store

- **WHEN** a legacy-layout Store checkout already contains project-partitioned directories
- **THEN** its metadata still parses as legacy layout
- **AND** no implicit upgrade is performed

#### Scenario: Setup authors layout 2 when explicitly asked

- **WHEN** `rasen store setup` runs with the operator's explicit layout-2 request
- **THEN** the created store's metadata carries the layout version 2 declaration beside its schema version
- **AND** the store creates no flat planning tree that a later layout-2 use would have to retire

#### Scenario: Setup without the request stays legacy

- **WHEN** `rasen store setup` runs with no layout request
- **THEN** the created store's metadata carries no layout declaration
- **AND** the created scaffold is exactly what setup creates without the capability
