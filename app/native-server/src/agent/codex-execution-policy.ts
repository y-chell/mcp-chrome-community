import type { CodexEngineConfig } from 'chrome-mcp-shared';

export function getCodexExecutionPolicyArgs(config: CodexEngineConfig): string[] {
  if (config.dangerouslyBypassApprovalsAndSandbox) {
    return ['--dangerously-bypass-approvals-and-sandbox'];
  }

  return ['--sandbox', config.sandboxMode];
}
