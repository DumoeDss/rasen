// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsultationObservabilityPanel } from '../../src/components/ConsultationObservabilityPanel.js';
import type { ConsultationViewSection } from '../../src/api/types.js';

const QUESTION_DIGEST = `sha256:question-body-${'b'.repeat(50)}`;
const ADVICE_DIGEST = `sha256:advice-body-${'d'.repeat(50)}`;
const EVIDENCE_DIGEST = `sha256:evidence-body-${'e'.repeat(50)}`;

function makeSection(
  overrides: Partial<ConsultationViewSection> = {}
): ConsultationViewSection {
  return {
    kind: 'consultation',
    version: 1,
    entries: [
      {
        consultationId: 'consultation:' + 'a'.repeat(64),
        ordinal: 1,
        state: 'advice-committed',
        source: {
          actionId: 'action:' + 'c'.repeat(64),
          invocationId: 'invocation:' + 'c'.repeat(64),
          attemptId: 'attempt:' + 'c'.repeat(64),
          occurrence: 0,
          stableSessionId: '11111111-2222-3333-4444-555555555555',
          model: 'claude-opus-4',
          runtime: 'claude',
          questionDigest: QUESTION_DIGEST,
          evidenceDigests: [EVIDENCE_DIGEST],
        },
        teacher: {
          model: 'claude-opus-4',
          runtime: 'claude',
          adviceDecision: 'plan',
          adviceDigest: ADVICE_DIGEST,
          evidenceDigests: [EVIDENCE_DIGEST],
        },
        counters: {
          consultations: { used: 1, max: 3 },
          teacherAttempts: { used: 2, max: 2 },
        },
        limits: {
          maxQuestionBytes: 65536,
          maxAdviceBytes: 131072,
          maxAttemptedApproaches: 32,
          maxConstraints: 32,
          maxEvidencePointers: 64,
          maxAdviceSteps: 64,
          maxCautions: 32,
          maxEvidenceNotes: 64,
        },
      },
    ],
    ...overrides,
  };
}

describe('ConsultationObservabilityPanel', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    document.body.removeChild(container);
  });

  it('renders entries with correct state badges and counters', () => {
    const section = makeSection();
    render(<ConsultationObservabilityPanel section={section} />, container);
    const panel = container.querySelector('[data-testid="consultation-observability-panel"]');
    expect(panel).not.toBeNull();
    const entry = container.querySelector('[data-testid="consultation-observability-entry"]');
    expect(entry).not.toBeNull();
    expect(entry!.getAttribute('data-state')).toBe('advice-committed');
    expect(entry!.getAttribute('data-ordinal')).toBe('1');

    const stateBadge = container.querySelector('[data-testid="consultation-state-badge"]');
    expect(stateBadge!.textContent).toContain('advice-committed');

    const adviceDecision = container.querySelector('[data-testid="consultation-advice-decision"]');
    expect(adviceDecision).not.toBeNull();
    expect(adviceDecision!.textContent).toContain('plan');

    const consultationCounter = container.querySelector(
      '[data-testid="consultation-counter-consultations"]'
    );
    expect(consultationCounter!.textContent).toContain('1');
    expect(consultationCounter!.textContent).toContain('3');

    const attemptCounter = container.querySelector(
      '[data-testid="consultation-counter-attempts"]'
    );
    expect(attemptCounter!.textContent).toContain('2');
  });

  it('renders failure reason when present', () => {
    const section = makeSection({
      entries: [
        {
          ...makeSection().entries[0]!,
          state: 'unavailable',
          failure: { code: 'teacher-unavailable', detail: 'No Teacher skill registered' },
        },
      ],
    });
    render(<ConsultationObservabilityPanel section={section} />, container);
    const failure = container.querySelector('[data-testid="consultation-failure"]');
    expect(failure).not.toBeNull();
    expect(failure!.textContent).toContain('teacher-unavailable');
    expect(failure!.textContent).toContain('No Teacher skill registered');
  });

  it('renders continuation state when present', () => {
    const section = makeSection({
      entries: [
        {
          ...makeSection().entries[0]!,
          state: 'continuation-granted',
          continuation: {
            requestId: 'aaaaaaaa-2222-3333-4444-555555555555',
            inputDigest: QUESTION_DIGEST,
            state: 'granted',
          },
        },
      ],
    });
    render(<ConsultationObservabilityPanel section={section} />, container);
    const cont = container.querySelector('[data-testid="consultation-continuation-state"]');
    expect(cont).not.toBeNull();
    expect(cont!.textContent).toContain('granted');
  });

  it('does not render advice bodies, question content, or evidence content', () => {
    const section = makeSection();
    render(<ConsultationObservabilityPanel section={section} />, container);
    const text = container.textContent ?? '';
    // The fixture carries distinctive digest/body VALUES. The panel must NOT
    // render any of them — only state badges, counters, identities, and
    // failure reasons are permitted. Asserting the actual VALUE strings
    // (not the property key-names) ensures a mutation that renders
    // {entry.source.questionDigest} etc. would be caught.
    expect(text).not.toContain(QUESTION_DIGEST);
    expect(text).not.toContain(ADVICE_DIGEST);
    expect(text).not.toContain(EVIDENCE_DIGEST);
  });

  it('does not offer continuation, retry, cancel, or any interactive execution control', () => {
    const section = makeSection();
    render(<ConsultationObservabilityPanel section={section} />, container);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(0);
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(0);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(0);
  });

  it('renders multiple entries', () => {
    const base = makeSection().entries[0]!;
    const section = makeSection({
      entries: [
        base,
        { ...base, ordinal: 2, consultationId: 'consultation:' + 'b'.repeat(64) },
      ],
    });
    render(<ConsultationObservabilityPanel section={section} />, container);
    const entries = container.querySelectorAll('[data-testid="consultation-observability-entry"]');
    expect(entries).toHaveLength(2);
  });

  it('renders consultation id short form (first 12 chars)', () => {
    const section = makeSection();
    render(<ConsultationObservabilityPanel section={section} />, container);
    const idElement = container.querySelector('.ops-run__consultation-id');
    expect(idElement).not.toBeNull();
    expect(idElement!.textContent).toBe('consultation');
  });
});
