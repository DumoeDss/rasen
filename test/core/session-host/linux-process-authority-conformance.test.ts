import { afterEach } from 'vitest';

import {
  cleanupLinuxProcessAuthorityProviderFixtures,
  createLinuxProcessAuthorityProviderFixture,
} from '../../helpers/linux-process-authority-provider-fixture.js';
import {
  processAuthorityProviderConformanceSuite,
} from '../../helpers/process-authority-provider-conformance.js';

afterEach(() => cleanupLinuxProcessAuthorityProviderFixtures());

processAuthorityProviderConformanceSuite(
  'Linux user PID-namespace process-authority provider conformance',
  createLinuxProcessAuthorityProviderFixture
);
