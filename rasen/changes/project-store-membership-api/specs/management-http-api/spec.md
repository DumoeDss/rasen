## ADDED Requirements

### Requirement: The spaces path admits explicit Project-to-Store membership under the management security posture

The authenticated management route `POST /api/v1/spaces` SHALL admit the `add-project-to-store` operation defined by the `space-creation` capability, including on the canonical path and its single-trailing-slash form. It SHALL use the same bearer-token requirement, JSON body limit, standard error envelope, bounded CLI-only mutation posture, and unsupported-method rejection as the existing space creation operations. The root client API SHALL expose the request and success types, and the UI client SHALL provide one typed call that posts the explicit Project and Store identifiers without requiring UI code to construct a CLI command or filesystem path.

#### Scenario: Authorized membership request reaches the bounded bridge

- **WHEN** a client sends an authorized `POST /api/v1/spaces` with `op: "add-project-to-store"` and explicit live Project and Store identifiers
- **THEN** the request reaches the space mutation bridge instead of being rejected by method admission
- **AND** success returns the freshly observed target Store entry in the documented response shape

#### Scenario: Membership request requires the launch token

- **WHEN** a client sends the membership request without the daemon's bearer token
- **THEN** the server responds 401 with the standard `unauthorized` envelope
- **AND** no subprocess is spawned

#### Scenario: Unsupported methods remain read-only failures

- **WHEN** a client sends PUT or DELETE to `/api/v1/spaces` after membership support is installed
- **THEN** the server responds 405 `method_not_allowed`
- **AND** no Project or Store file is modified

#### Scenario: UI client sends only the typed membership intent

- **WHEN** UI code calls the Project-to-Store membership client with a Project id and Store id
- **THEN** the client sends the authenticated JSON operation to `/api/v1/spaces`
- **AND** the UI code neither supplies a local root nor selects a planning Store
