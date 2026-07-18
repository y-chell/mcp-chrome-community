const CLAUDE_PERMISSION_MODES = new Set([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
]);

export interface ClaudePermissionPolicy {
  permissionMode: string;
  allowDangerouslySkipPermissions: boolean;
}

export class ClaudePermissionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudePermissionPolicyError';
  }
}

export function resolveClaudePermissionPolicy(
  permissionMode: unknown,
  allowDangerouslySkipPermissions: unknown = false,
): ClaudePermissionPolicy {
  const normalized = typeof permissionMode === 'string' ? permissionMode.trim() : '';
  if (!normalized) {
    if (allowDangerouslySkipPermissions === true) {
      throw new ClaudePermissionPolicyError(
        'allowDangerouslySkipPermissions requires permissionMode "bypassPermissions"',
      );
    }
    return { permissionMode: 'default', allowDangerouslySkipPermissions: false };
  }
  if (!CLAUDE_PERMISSION_MODES.has(normalized)) {
    throw new ClaudePermissionPolicyError(`Invalid Claude permissionMode: ${normalized}`);
  }
  if (normalized === 'bypassPermissions' && allowDangerouslySkipPermissions !== true) {
    throw new ClaudePermissionPolicyError(
      'permissionMode "bypassPermissions" requires allowDangerouslySkipPermissions=true',
    );
  }

  return {
    permissionMode: normalized,
    allowDangerouslySkipPermissions:
      normalized === 'bypassPermissions' && allowDangerouslySkipPermissions === true,
  };
}
