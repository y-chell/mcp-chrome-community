import { describe, expect, test } from '@jest/globals';
import { DEFAULT_CODEX_CONFIG } from 'chrome-mcp-shared';
import { getCodexExecutionPolicyArgs } from './codex-execution-policy';

describe('Codex execution policy', () => {
  test('uses workspace sandboxing by default', () => {
    expect(DEFAULT_CODEX_CONFIG.sandboxMode).toBe('workspace-write');
    expect(DEFAULT_CODEX_CONFIG.dangerouslyBypassApprovalsAndSandbox).toBe(false);
    expect(getCodexExecutionPolicyArgs(DEFAULT_CODEX_CONFIG)).toEqual([
      '--sandbox',
      'workspace-write',
    ]);
  });

  test('only bypasses approvals and sandboxing after explicit opt-in', () => {
    expect(
      getCodexExecutionPolicyArgs({
        ...DEFAULT_CODEX_CONFIG,
        sandboxMode: 'danger-full-access',
        dangerouslyBypassApprovalsAndSandbox: true,
      }),
    ).toEqual(['--dangerously-bypass-approvals-and-sandbox']);
  });
});
