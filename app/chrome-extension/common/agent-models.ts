/**
 * Agent CLI Model Definitions.
 *
 * Static model definitions for each CLI type.
 * Based on the pattern from Claudable (other/cweb).
 */

import type { AgentEngineInfo, AgentModelInfo, CodexReasoningEffort } from 'chrome-mcp-shared';

// ============================================================
// Types
// ============================================================

export type ModelDefinition = AgentModelInfo;

export type AgentCliType = 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';

// ============================================================
// Claude Models
// ============================================================

export const CLAUDE_MODELS: ModelDefinition[] = [
  {
    id: 'fable',
    name: 'Claude Fable 5',
    description: 'Latest Fable model through the Claude Code alias',
    supportsImages: true,
  },
  {
    id: 'opus',
    name: 'Claude Opus (latest)',
    description: 'Latest Opus model available to Claude Code',
    supportsImages: true,
  },
  {
    id: 'sonnet',
    name: 'Claude Sonnet (latest)',
    description: 'Latest Sonnet model available to Claude Code',
    supportsImages: true,
  },
  {
    id: 'haiku',
    name: 'Claude Haiku (latest)',
    description: 'Latest Haiku model available to Claude Code',
    supportsImages: true,
  },
];

export const CLAUDE_DEFAULT_MODEL = '';

// ============================================================
// Codex Models
// ============================================================

const CODEX_STANDARD_EFFORTS: readonly CodexReasoningEffort[] = ['low', 'medium', 'high', 'xhigh'];
const CODEX_MAX_EFFORTS: readonly CodexReasoningEffort[] = [...CODEX_STANDARD_EFFORTS, 'max'];
const CODEX_ULTRA_EFFORTS: readonly CodexReasoningEffort[] = [...CODEX_MAX_EFFORTS, 'ultra'];

export const CODEX_MODELS: ModelDefinition[] = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'Frontier agentic coding model',
    supportedReasoningEfforts: CODEX_ULTRA_EFFORTS,
    defaultReasoningEffort: 'low',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'General-purpose frontier coding model',
    supportedReasoningEfforts: CODEX_ULTRA_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'Efficient frontier coding model',
    supportedReasoningEfforts: CODEX_MAX_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Previous-generation Codex model',
    supportedReasoningEfforts: CODEX_STANDARD_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Compatible Codex model',
    supportedReasoningEfforts: CODEX_STANDARD_EFFORTS,
    defaultReasoningEffort: 'medium',
  },
];

export const CODEX_DEFAULT_MODEL = '';

// Codex model alias normalization
const CODEX_ALIAS_MAP: Record<string, string> = {
  gpt5: 'gpt-5.6-sol',
  gpt_5: 'gpt-5.6-sol',
  'gpt-5': 'gpt-5.6-sol',
};

/**
 * Normalize a Codex model ID, handling aliases and falling back to default.
 */
export function normalizeCodexModelId(model?: string | null): string {
  if (!model || typeof model !== 'string') {
    return CODEX_DEFAULT_MODEL;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return CODEX_DEFAULT_MODEL;
  }

  const lower = trimmed.toLowerCase();
  if (CODEX_ALIAS_MAP[lower]) {
    return CODEX_ALIAS_MAP[lower];
  }

  return trimmed;
}

/**
 * Get supported reasoning efforts for a Codex model.
 * Returns standard efforts (low/medium/high) for unknown models.
 */
export function getCodexReasoningEfforts(
  modelId?: string | null,
  models: readonly ModelDefinition[] = CODEX_MODELS,
): readonly CodexReasoningEffort[] {
  const normalized = normalizeCodexModelId(modelId);
  const model = models.find((m) => m.id === normalized);
  return model?.supportedReasoningEfforts ?? CODEX_STANDARD_EFFORTS;
}

/**
 * Check if a model supports xhigh reasoning effort.
 */
export function supportsXhighEffort(modelId?: string | null): boolean {
  const efforts = getCodexReasoningEfforts(modelId);
  return efforts.includes('xhigh');
}

// ============================================================
// Cursor Models
// ============================================================

export const CURSOR_MODELS: ModelDefinition[] = [
  {
    id: 'auto',
    name: 'Auto',
    description: 'Cursor auto-selects the best model',
  },
  {
    id: 'sonnet',
    name: 'Claude Sonnet (latest)',
    description: 'Anthropic Claude via Cursor',
    supportsImages: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    description: 'OpenAI model via Cursor',
  },
];

export const CURSOR_DEFAULT_MODEL = 'auto';

// ============================================================
// Qwen Models
// ============================================================

export const QWEN_MODELS: ModelDefinition[] = [
  {
    id: 'qwen3-coder-plus',
    name: 'Qwen3 Coder Plus',
    description: 'Balanced 32k context model for coding',
  },
  {
    id: 'qwen3-coder-pro',
    name: 'Qwen3 Coder Pro',
    description: 'Larger 128k context with stronger reasoning',
  },
  {
    id: 'qwen3-coder',
    name: 'Qwen3 Coder',
    description: 'Fast iteration model',
  },
];

export const QWEN_DEFAULT_MODEL = 'qwen3-coder-plus';

// ============================================================
// GLM Models
// ============================================================

export const GLM_MODELS: ModelDefinition[] = [
  {
    id: 'glm-4.6',
    name: 'GLM 4.6',
    description: 'Zhipu GLM 4.6 agent runtime',
  },
];

export const GLM_DEFAULT_MODEL = 'glm-4.6';

// ============================================================
// Aggregated Definitions
// ============================================================

export const CLI_MODEL_DEFINITIONS: Record<AgentCliType, ModelDefinition[]> = {
  claude: CLAUDE_MODELS,
  codex: CODEX_MODELS,
  cursor: CURSOR_MODELS,
  qwen: QWEN_MODELS,
  glm: GLM_MODELS,
};

export const CLI_DEFAULT_MODELS: Record<AgentCliType, string> = {
  claude: CLAUDE_DEFAULT_MODEL,
  codex: CODEX_DEFAULT_MODEL,
  cursor: CURSOR_DEFAULT_MODEL,
  qwen: QWEN_DEFAULT_MODEL,
  glm: GLM_DEFAULT_MODEL,
};

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get model definitions for a specific CLI type.
 */
function getRuntimeEngine(
  cli: string,
  engines?: readonly AgentEngineInfo[],
): AgentEngineInfo | undefined {
  return engines?.find((engine) => engine.name.toLowerCase() === cli.toLowerCase());
}

export function getModelsForCli(
  cli: string | null | undefined,
  engines?: readonly AgentEngineInfo[],
): ModelDefinition[] {
  if (!cli) return [];
  const key = cli.toLowerCase() as AgentCliType;
  const runtimeModels = getRuntimeEngine(key, engines)?.models;
  if (runtimeModels && runtimeModels.length > 0) return runtimeModels;
  return CLI_MODEL_DEFINITIONS[key] || [];
}

/**
 * Get the default model for a CLI type.
 */
export function getDefaultModelForCli(
  cli: string | null | undefined,
  engines?: readonly AgentEngineInfo[],
): string {
  if (!cli) return '';
  const key = cli.toLowerCase() as AgentCliType;
  const runtimeDefault = getRuntimeEngine(key, engines)?.defaultModel;
  if (runtimeDefault !== undefined) return runtimeDefault;
  return CLI_DEFAULT_MODELS[key] || '';
}

/**
 * Get display name for a model ID.
 */
export function getModelDisplayName(
  cli: string | null | undefined,
  modelId: string | null | undefined,
  engines?: readonly AgentEngineInfo[],
): string {
  if (!cli || !modelId) return modelId || '';
  const models = getModelsForCli(cli, engines);
  const model = models.find((m) => m.id === modelId);
  return model?.name || modelId;
}
