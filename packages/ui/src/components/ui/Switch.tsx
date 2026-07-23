/**
 * A binary on/off switch (ui-component-system spec: "a switch control for
 * binary on/off state that is operable by keyboard, exposes its on/off state to
 * assistive technology, and shows a visibly distinct disabled state").
 *
 * A native `<button role="switch">` so Space/Enter toggle it for free and
 * `aria-checked` announces the state; the track/thumb are drawn from tokens
 * (`.ui-switch` in style.css), so both color schemes and the CRT variant
 * inherit correct colors. A disabled switch is inert (no toggle) and visibly
 * dimmed. `title` carries the disabled reason (e.g. a closure-required unit).
 */
export function Switch({
  checked,
  disabled = false,
  onToggle,
  label,
  title,
  testid,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  /** Accessible name (aria-label) — the switch has no visible text of its own. */
  label: string;
  /** Optional tooltip, used to surface a disabled reason. */
  title?: string;
  testid?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      data-testid={testid}
      class={`ui-switch${checked ? ' ui-switch--on' : ''}`}
      onClick={() => {
        if (!disabled) onToggle(!checked);
      }}
    >
      <span class="ui-switch__thumb" aria-hidden="true" />
    </button>
  );
}
