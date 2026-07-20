/** Full-screen notice for missing token / 401 (design.md D4): no retry loop, no token prompt. */
export function RelaunchNotice() {
  return (
    <main class="relaunch-notice">
      <h1>Session expired</h1>
      <p>
        This tab's session is no longer valid — most likely the management server was restarted.
      </p>
      <p>
        Re-launch the platform by running <code>rasen ui</code> again.
      </p>
    </main>
  );
}
