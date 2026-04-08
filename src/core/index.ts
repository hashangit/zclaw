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
  // Errors
  ZclawError,
} from './types.js';

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
} from './message-convert.js';
