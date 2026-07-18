import { describe, expect, test } from '@jest/globals';
import { resolveClaudePermissionPolicy } from './claude-permission-policy';

describe('Claude permission policy', () => {
  test('defaults to the SDK approval mode without dangerous acknowledgement', () => {
    expect(resolveClaudePermissionPolicy(undefined)).toEqual({
      permissionMode: 'default',
      allowDangerouslySkipPermissions: false,
    });
  });

  test('enables bypass only when mode and acknowledgement are both explicit', () => {
    expect(resolveClaudePermissionPolicy('bypassPermissions', true)).toEqual({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    });
    expect(resolveClaudePermissionPolicy('acceptEdits')).toEqual({
      permissionMode: 'acceptEdits',
      allowDangerouslySkipPermissions: false,
    });
  });

  test('rejects bypass without the explicit acknowledgement', () => {
    expect(() => resolveClaudePermissionPolicy('bypassPermissions')).toThrow(
      'requires allowDangerouslySkipPermissions=true',
    );
  });

  test('rejects invalid modes and standalone dangerous acknowledgement', () => {
    expect(() => resolveClaudePermissionPolicy('unknown-mode')).toThrow(
      'Invalid Claude permissionMode',
    );
    expect(() => resolveClaudePermissionPolicy(undefined, true)).toThrow(
      'requires permissionMode "bypassPermissions"',
    );
  });
});
