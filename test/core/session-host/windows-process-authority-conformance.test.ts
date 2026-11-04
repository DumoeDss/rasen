import { afterEach } from 'vitest';

import {
  cleanupWindowsProcessAuthorityProviderFixtures,
  createWindowsProcessAuthorityProviderFixture,
} from '../../helpers/windows-process-authority-provider-fixture.js';
import {
  processAuthorityProviderConformanceSuite,
} from '../../helpers/process-authority-provider-conformance.js';

afterEach(() => cleanupWindowsProcessAuthorityProviderFixtures());

processAuthorityProviderConformanceSuite(
  'Windows Job Object process-authority provider conformance',
  createWindowsProcessAuthorityProviderFixture
);
