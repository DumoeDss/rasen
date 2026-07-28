# pipelines-ui Delta Specification

## MODIFIED Requirements

### Requirement: The canvas page fits a single viewport

The pipeline graph route (view and edit modes) SHALL fit within the browser viewport: in a real browser the document SHALL present no page-level scrollbar on this route — the application shell itself is bounded to the viewport, so no amount of panel content can grow the page. The skills palette and the stage properties panel SHALL scroll independently within their own bounds, and the canvas area SHALL fill the remaining space, keeping the canvas, its toolbar, and any feedback surfaces (including validation errors at the canvas bottom) simultaneously visible regardless of how many skills are installed. Other routes keep their normal scrolling behavior. Because DOM-only test environments perform no layout, this contract SHALL be verified against real browser layout (a measured document that does not exceed the viewport height), not solely by asserting markup.

#### Scenario: Long skill list never hides the canvas

- **WHEN** the user opens the canvas editor with more installed skills than fit the viewport height
- **THEN** the skills palette scrolls within its own panel while the canvas, toolbar, and feedback surfaces stay fully visible without scrolling the page

#### Scenario: No document scrollbar in a real browser

- **WHEN** the canvas editor is opened in a real browser with a fully populated skills palette
- **THEN** the document's scrollable height does not exceed the viewport (no page-level scrollbar), and validation feedback at the bottom of the canvas is on screen

#### Scenario: Only the canvas route is viewport-locked

- **WHEN** the user navigates from the canvas back to the Pipelines list or any other page
- **THEN** those pages scroll normally as before
