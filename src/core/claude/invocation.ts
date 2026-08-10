import { inlineCommandTemplate, type TemplateInliner } from '../codex/template-inline.js';
import {
  workerContractJsonSchema,
  type WorkerContract,
} from '../worker-contracts.js';

export type ClaudeSandboxMode = 'read-only' | 'workspace-write';
export type ClaudeReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeTemplateOptions {
  source: string;
  args: string;
  inliner?: TemplateInliner;
}

export interface BuildClaudePrintInvocationOptions {
  prompt: string;
  contract: WorkerContract;
  sandbox: ClaudeSandboxMode;
  model?: string;
  effort?: ClaudeReasoningEffort;
  resumeSessionId?: string;
  template?: ClaudeTemplateOptions;
  skillContent?: string;
  handoffContract?: string;
}

export interface ClaudePrintInvocation {
  command: 'claude';
  args: string[];
  stdin: string;
  prompt: string;
  contract: WorkerContract;
}

export const CLAUDE_FLAT_HIERARCHY_GUARD =
  'CLAUDE_FLAT_HIERARCHY_GUARD: You are a leaf worker. Do not create, delegate to, message, resume, or wait on subagents or agent teams. Perform the assigned work yourself and return only through the required structured contract.';

export const CLAUDE_LEAF_DENIED_TOOLS = [
  'Agent',
  'Task',
  'TeamCreate',
  'TeamDelete',
  'SendMessage',
] as const;

const CONTRACT_INSTRUCTIONS: Record<WorkerContract, string> = {
  leaf:
    'Return a JSON object matching the leaf contract: status is DONE or HANDOFF; summary and handoffReason are optional strings.',
  'consultable-leaf':
    'Return a JSON object matching the consultable leaf contract: status is DONE, HANDOFF, or CONSULT. CONSULT requires problemSummary, question, attemptedApproaches, constraints, and evidencePointers and must not include runtime authority fields.',
  evaluate:
    'Return a JSON object matching the evaluate contract: satisfied is boolean and gaps is an array of strings; summary is optional.',
};
const CLAUDE_EFFORTS = new Set<ClaudeReasoningEffort>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

function validateOptionalText(value: string | undefined, name: string): void {
  if (value !== undefined && value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string when provided.`);
  }
}

export function buildClaudePrintInvocation(
  options: BuildClaudePrintInvocationOptions
): ClaudePrintInvocation {
  if (!options.prompt.trim()) throw new Error('Claude prompt must not be empty.');
  validateOptionalText(options.model, 'Claude model');
  validateOptionalText(options.resumeSessionId, 'Claude resume session ID');
  if (options.effort && !CLAUDE_EFFORTS.has(options.effort)) {
    throw new Error(
      `Unsupported Claude effort "${String(options.effort)}"; expected low, medium, high, xhigh, or max.`
    );
  }

  const templateBody = options.template
    ? (options.template.inliner ?? { inline: inlineCommandTemplate }).inline(
        options.template.source,
        options.template.args
      )
    : undefined;
  const prompt = [
    templateBody,
    options.skillContent,
    options.prompt,
    options.handoffContract,
    CONTRACT_INSTRUCTIONS[options.contract],
    CLAUDE_FLAT_HIERARCHY_GUARD,
  ]
    .filter((part): part is string => Boolean(part?.length))
    .join('\n\n');

  const args = [
    '-p',
    '--input-format',
    'text',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(workerContractJsonSchema(options.contract)),
    '--permission-mode',
    options.sandbox === 'read-only' ? 'plan' : 'acceptEdits',
    '--disallowedTools',
    CLAUDE_LEAF_DENIED_TOOLS.join(','),
  ];
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--effort', options.effort);
  if (options.resumeSessionId) args.push('--resume', options.resumeSessionId);

  return {
    command: 'claude',
    args,
    stdin: prompt,
    prompt,
    contract: options.contract,
  };
}
