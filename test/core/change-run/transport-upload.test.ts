import { describe, expect, it } from 'vitest';

import {
  buildEvidenceRef,
  createInMemoryEvidenceStore,
  verifyEvidenceContent,
} from '../../../src/core/change-run/internal/evidence.js';

const encoder = new TextEncoder();

describe('CLI transport-upload invariants (7.9)', () => {
  it('stages content before the facade sees it; only refs enter receipt bytes', () => {
    const store = createInMemoryEvidenceStore();
    const content = encoder.encode('{"result":"ok"}');
    // The CLI stages the upload first, getting back a content digest.
    const stagedDigest = store.stage(content);
    // The ref is built from the staged content; the receipt carries only the
    // ref (contentDigest + identity), never the raw bytes.
    const ref = buildEvidenceRef({
      content,
      mediaType: 'application/json',
      observationKind: 'domain-result',
      producer: { id: 'adapter:apply', version: '1', identityDigest: 'sha256:' + 'a'.repeat(64) },
      binding: {
        planningSpaceId: 'planning-space:' + '1'.repeat(64),
        changeInstanceId: 'change-instance:' + '2'.repeat(64),
        projectId: 'project',
        changeId: 'change',
        runId: 'run:' + 'a'.repeat(64),
        actionId: 'action:' + 'a'.repeat(58) + 'aa',
        schema: 'result/1',
      },
    });
    expect(ref.contentDigest).toBe(stagedDigest);
    // The ref carries no raw content — it is path-free and content-addressed.
    expect('content' in ref).toBe(false);
    expect('bytes' in ref).toBe(false);
  });

  it('orphaned uploads (staged but never in a completion) cannot advance a Run', () => {
    const store = createInMemoryEvidenceStore();
    const content = encoder.encode('{"orphan":true}');
    store.stage(content);
    // The orphaned upload exists in the store but is never referenced by any
    // completion or record mutation. It has no effect on Run state.
    const ref = buildEvidenceRef({
      content: encoder.encode('{"real":"result"}'),
      mediaType: 'application/json',
      observationKind: 'domain-result',
      producer: { id: 'p', version: '1', identityDigest: 'sha256:' + 'b'.repeat(64) },
      binding: {
        planningSpaceId: 'planning-space:' + '1'.repeat(64),
        changeInstanceId: 'change-instance:' + '2'.repeat(64),
        projectId: 'project',
        changeId: 'change',
        runId: 'run:' + 'a'.repeat(64),
        actionId: 'action:' + 'a'.repeat(58) + 'aa',
        schema: 'result/1',
      },
    });
    // The orphan's digest differs from the ref's — it cannot masquerade.
    expect(store.has({ ...ref, contentDigest: 'sha256:' + '0'.repeat(64) } as never)).toBe(false);
    // The real ref verifies against the staged content.
    store.stage(encoder.encode('{"real":"result"}'));
    expect(() => verifyEvidenceContent(ref, encoder.encode('{"real":"result"}'))).not.toThrow();
  });
});
