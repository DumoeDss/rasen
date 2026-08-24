import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  deriveChangeInstanceId,
  derivePlanningScopeId,
  mintChangeInstanceSeed,
} from '../../../../dist/core/store/planning-identity.js';

const storeRoot =
  'E:/AI/ChatAI/Agents/VibeCodingProjects/workflow/Reference/rasen-issue-store';
const storeUid = 'f76edc31-229a-42bc-a5c7-848021eeb2da';
const projectId = 'e2ee72ed-04a1-4395-86aa-7e77d2b83ec7';
const targetLineId = 'line-0.2';
const entries = [
  '2026-08-24-issue-read-surface',
  '2026-08-24-issue-operations-and-unlinked',
  '2026-08-24-issue-board-cutover',
];

const planningScopeId = derivePlanningScopeId({
  storeUid,
  projectId,
  targetLineId,
});

const precedent = deriveChangeInstanceId({
  planningScopeId,
  instanceSeed: 'eb0e56c174b68d7dce27251ed678969d',
});
if (
  precedent !==
  'ci_96db06e16c62383fc2c4218874cb00e6e2a93a9b3c5415206bb8c568d267ab42'
) {
  throw new Error(`identity self-check failed: ${precedent}`);
}

const destinationParent = join(
  storeRoot,
  'rasen',
  'projects',
  projectId,
  'changes',
  'archive',
  targetLineId,
);
mkdirSync(destinationParent, { recursive: true });

const prepared = entries.map((entry) => {
  const source = join('rasen', 'changes', 'archive', entry);
  const destination = join(destinationParent, entry);
  const temporary = join(destinationParent, `.${entry}.phase7-seed-tmp`);
  if (!existsSync(source)) {
    throw new Error(`missing source archive: ${source}`);
  }
  if (existsSync(destination)) {
    throw new Error(`M-1 guard: destination already exists: ${destination}`);
  }
  if (existsSync(temporary)) {
    throw new Error(`stale seed staging directory exists: ${temporary}`);
  }
  return { entry, source, destination, temporary };
});

const result = {};
for (const item of prepared) {
  cpSync(item.source, item.temporary, { recursive: true });
  const openspecPath = join(item.temporary, '.openspec.yaml');
  const original = readFileSync(openspecPath, 'utf8');
  if (/^identity:/m.test(original)) {
    throw new Error(`source already carries Store identity: ${item.entry}`);
  }
  const lines = original.split('\n');
  const createdIndex = lines.findIndex((line) => line.startsWith('created:'));
  if (createdIndex < 0) {
    throw new Error(`missing created field: ${openspecPath}`);
  }
  const instanceSeed = mintChangeInstanceSeed();
  const instanceId = deriveChangeInstanceId({ planningScopeId, instanceSeed });
  lines.splice(
    createdIndex + 1,
    0,
    'identity:',
    '  version: 2',
    `  instanceSeed: "${instanceSeed}"`,
    `  instanceId: "${instanceId}"`,
    `  storeUid: "${storeUid}"`,
    `  projectId: "${projectId}"`,
    `  targetLineId: "${targetLineId}"`,
  );
  writeFileSync(openspecPath, lines.join('\n'), 'utf8');
  result[item.entry] = { instanceId, instanceSeed };
}

for (const item of prepared) {
  renameSync(item.temporary, item.destination);
}

process.stdout.write(
  `${JSON.stringify(
    {
      storeRoot,
      storeUid,
      projectId,
      targetLineId,
      precedentSelfCheck: precedent,
      entries: result,
    },
    null,
    2,
  )}\n`,
);
