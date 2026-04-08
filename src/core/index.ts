/**
 * ZClaw Core Module
 *
 * Central orchestrators and utilities for the ZClaw unified architecture.
 */

export { invokeSkill, type SkillInvocationResult } from './skill-invoker.js';
export {
  runAgentLoop,
  type AgentLoopOptions,
  type AgentLoopResult,
  type AgentLoopError,
  type ProviderFactory,
} from './agent-loop.js';
export { createHookExecutor, type HookExecutor } from './hooks.js';
export { createSessionStore, createMemoryStore } from './session-store.js';

// Export error classes (canonical definitions live in ./errors.ts)
export {
  ZclawError,
  ProviderError,
  ToolError,
  MaxStepsError,
  AbortedError,
} from './errors.js';

// Export all types from types.ts
export type {
  // Provider
  ProviderType,
  MultiProviderConfig,
  // Messages
  Message,
  ToolCall,
  // Steps
  StepResult,
  // Usage
  Usage,
  CumulativeUsage,
  // Tools
  UserToolDefinition,
  ToolContext,
  ToolResult,
  // Hooks
  Hooks,
  // generateText
  GenerateTextOptions,
  GenerateTextResult,
  // streamText
  StreamTextOptions,
  StreamTextResult,
  // createAgent
  AgentCreateOptions,
  SdkAgent,
  AgentResponse,
  // Session
  SessionStore,
  SessionData,
  // Skills
  SkillMetadata,
} from './types.js';

// ZclawError is also re-exported as a value from types.ts, but the canonical
// class export comes from ./errors.js above. The `export type` block omits
// ZclawError intentionally to avoid a duplicate value export.

// Export provider resolver functions
export {
  provider,
  configureProviders,
  getProviderConfig,
  getDefaultProviderType,
  getDefaultProvider,
  getProvider,
  resolveProviderConfigFromApp,
  resolveFromEnv,
  resolveFromConfigFile,
  migrateLegacyConfig,
  addProvider,
  updateProviderConfig,
  removeProvider,
  resolveGLMModel,
} from './provider-resolver.js';

export type {
  ResolvedProviderConfig,
  AppConfig,
} from './provider-resolver.js';

// Export message conversion helpers
export {
  generateId,
  now,
  estimateTokens,
  toZclawError,
  messageToProviderMessage,
  providerToolCallToToolCall,
  providerResponseToMessages,
} from './message-convert.js';

// Export tool executor
export {
  CORE_TOOLS,
  COMM_TOOLS,
  ADVANCED_TOOLS,
  ALL_TOOLS,
  tool,
  resolveTools,
  getToolGroup,
  registerTool,
  executeTool,
} from './tool-executor.js';
