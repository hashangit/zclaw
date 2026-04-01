import { ProviderType } from './providers/types.js';

export interface ModelEntry {
  id: string;
  name: string;
}

export const MODEL_CATALOG: Record<ProviderType, ModelEntry[]> = {
  'openai-compatible': [], // No curated list — user provides their own model name
  openai: [
    { id: 'gpt-5.4', name: 'GPT-5.4' },
    { id: 'gpt-5.4-pro', name: 'GPT-5.4 Pro' },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano' },
    { id: 'gpt-5.3-instant', name: 'GPT-5.3 Instant' },
    { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
    { id: 'o3', name: 'o3' },
    { id: 'o3-mini', name: 'o3 Mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6-20260320', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6-20260320', name: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
  ],
  glm: [
    { id: 'haiku', name: 'GLM-4.5 Air' },
    { id: 'sonnet', name: 'GLM-4.7' },
    { id: 'opus', name: 'GLM-5.1' },
  ],
};

export const CUSTOM_MODEL_VALUE = '__custom__';