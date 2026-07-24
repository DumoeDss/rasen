/**
 * Telemetry payload disclosure (design D4, config-ui-package spec). An isolated,
 * self-contained help affordance rendered beside the `telemetry.enabled` row on
 * the Privacy tab — deliberately NOT a generic per-key help framework, because
 * exactly one key needs this today. It lists, verbatim, the five fields an
 * enabled telemetry setting sends, plus the global-only scope and the
 * environment opt-out precedence. It is informational only: opening or closing
 * it (a native `<details>` disclosure) issues no configuration write.
 *
 * MAINTENANCE: the field list below MUST stay in lockstep with the actual
 * telemetry payload the CLI sends in `src/telemetry/index.ts` (`trackCommand`,
 * the `command`/`version`/`distinctId`/`os`/`node_version` object). The parity
 * test `telemetry-disclosure.test.tsx` pins these payload keys against a fixture
 * mirroring that site and fails on any drift in either direction. The English
 * field `label` prose is also asserted verbatim by that test, so it is kept as a
 * fixed literal here (NOT routed through `t()`) — only the surrounding chrome
 * prose translates.
 */
import { useT } from '../i18n/store.js';

/** One disclosed payload field: the wire key it corresponds to and its human label. */
export interface TelemetryPayloadField {
  /** The exact key in the telemetry payload (`src/telemetry/index.ts` trackCommand). */
  payloadKey: string;
  /** The human-facing description shown in the disclosure. */
  label: string;
}

/**
 * The five fields an enabled telemetry setting sends, verbatim. Order and wording
 * match the config-ui-package spec's disclosure requirement; `payloadKey` mirrors
 * the CLI payload so the parity test can pin the two together.
 */
export const TELEMETRY_PAYLOAD_FIELDS: readonly TelemetryPayloadField[] = [
  { payloadKey: 'command', label: 'the command name' },
  { payloadKey: 'version', label: 'the CLI version' },
  { payloadKey: 'distinctId', label: 'an anonymous randomly generated UUID' },
  { payloadKey: 'os', label: 'the operating system platform' },
  { payloadKey: 'node_version', label: 'the Node.js version' },
];

export function TelemetryDisclosure() {
  const t = useT();
  return (
    <details class="telemetry-disclosure" data-testid="telemetry-disclosure">
      <summary class="telemetry-disclosure__summary">{t('telemetry.summary')}</summary>
      <div class="telemetry-disclosure__body">
        <p>{t('telemetry.body_intro')}</p>
        <ul class="telemetry-disclosure__fields">
          {TELEMETRY_PAYLOAD_FIELDS.map((f) => (
            <li key={f.payloadKey} data-payload-key={f.payloadKey}>
              {f.label}
            </li>
          ))}
        </ul>
        <p class="telemetry-disclosure__note">{t('telemetry.note_global')}</p>
        <p class="telemetry-disclosure__note">
          {t('telemetry.note_env_pre')}<code>RASEN_TELEMETRY=0</code>, <code>DO_NOT_TRACK=1</code>{t('telemetry.note_env_post')}
        </p>
      </div>
    </details>
  );
}
