## ADDED Requirements

### Requirement: A Store whose members have no checkout here is distinguished from a Store with no members

Where a user chooses what to work on in a Store session, the launch surface SHALL
tell apart three situations and state each one plainly: the Store has member
projects that can be worked in; the Store has member projects but none of them
has a checkout on this machine; and the Store has no member projects at all. A
member listed without a checkout on this machine SHALL be shown as a member,
SHALL NOT be selectable, and SHALL carry wording saying that it cannot be worked
in because no checkout of it exists on this machine. The wording for "no member
has a checkout here" SHALL NOT claim that the Store has no members, since that
misstates what the user needs to fix. Every message this requirement introduces
SHALL be available in each language the interface supports.

#### Scenario: A member with no local checkout says why it cannot be chosen

- **WHEN** a Store member has no checkout on this machine
- **THEN** it SHALL still be listed as a member of the Store
- **AND** it SHALL NOT be selectable as a place to work
- **AND** it SHALL state that no checkout of it exists on this machine

#### Scenario: Members without checkouts are not reported as no members

- **WHEN** a Store has member projects and none of them has a checkout on this machine
- **THEN** the surface SHALL state that the Store's members have no checkout on this machine
- **AND** it SHALL NOT state that the Store has no member projects

#### Scenario: A Store with no members is unchanged

- **WHEN** a Store has no member projects at all
- **THEN** the surface SHALL state that the Store has no member projects, as before

#### Scenario: A member that can be worked in is unaffected

- **WHEN** a Store member has a checkout on this machine
- **THEN** it SHALL be selectable as a place to work, exactly as before

#### Scenario: The distinction is available in every supported language

- **WHEN** the interface is displayed in any language it supports
- **THEN** the wording for a member without a local checkout, and the wording for a Store whose members have no checkout here, SHALL both be available in that language
