## MODIFIED Requirements

### Requirement: Dashboard Filtering and Time Range

The admin panel SHALL let a maintainer choose a time range covering at least
7 days, 30 days, 90 days, and all history through a segmented control of
mutually-exclusive buttons, with the active range visually highlighted; filter
the displayed aggregates by command, version, and os dimensions through rows of
clickable pills populated from the current breakdown data, where an "All"
default pill is selected until the maintainer clicks a value, and clicking the
selected value again returns to "All"; and toggle whether smoke-test traffic is
included through a switch control that defaults to hide test traffic. A selected
dimension value SHALL persist across a data refresh, including when that value is
absent from the refreshed breakdown. A pill label longer than 40 characters SHALL
be truncated for display while its full value remains available on hover. The
control affordances SHALL be operable by keyboard and expose their selected state
to assistive technology. The panel SHALL remain a single self-contained document
requiring no build step and no external assets, and SHALL indicate the data source
(recent live data vs. historical aggregates) backing the current view.

#### Scenario: Time range selection changes the window

- **WHEN** a maintainer activates a different time-range button (for example all history)
- **THEN** the panel marks that button as the active range and reloads its aggregates for that window, reflecting the new numbers

#### Scenario: Dimension filter narrows the view

- **WHEN** a maintainer clicks a command, version, or os pill
- **THEN** the pill becomes the selected value and the panel shows aggregates restricted to that dimension value

#### Scenario: Deselecting a dimension returns to All

- **WHEN** a maintainer clicks the currently selected command, version, or os pill again
- **THEN** the selection returns to the "All" default and the panel shows aggregates unrestricted on that dimension

#### Scenario: Selected value persists across refresh even when absent

- **WHEN** a dimension value is selected and the data is refreshed such that the value is no longer present in the returned breakdown
- **THEN** the panel keeps that value selected and continues to offer it as a pill

#### Scenario: Long pill label is truncated with full value on hover

- **WHEN** a dimension value longer than 40 characters is shown as a pill
- **THEN** the pill displays a truncated label and reveals the full value on hover

#### Scenario: Hide-test-traffic defaults on

- **WHEN** the panel first loads
- **THEN** the toggle switch is on and smoke-test traffic (version `0.0.0`) is excluded by default, and the maintainer can switch it off to include that traffic

#### Scenario: Controls are keyboard and assistive-technology accessible

- **WHEN** a maintainer navigates the time-range and dimension controls by keyboard
- **THEN** each control is focusable, activatable from the keyboard, and reports its selected (pressed) state to assistive technology

#### Scenario: Empty data does not break the layout

- **WHEN** a selected window or filter returns no data
- **THEN** the panel shows its no-data state without horizontal overflow or broken layout at any viewport width

#### Scenario: Panel still ships as a single no-build file

- **WHEN** the panel is deployed
- **THEN** it is delivered as one self-contained document with no bundler, compile step, or external asset introduced to the Worker
