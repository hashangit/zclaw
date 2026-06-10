/**
 * ZClaw Gateway — barrel
 *
 * Re-exports the public surface of the gateway module.
 */

export { MCPGateway } from './gateway.js';
export { createGatewayTools } from './tool-factory.js';
export { importOpenApiSpec } from './openapi-importer.js';
export { GatewaySettingsAdapter } from './settings-adapter.js';
export { scoreRelevance } from './semantic-scorer.js';
export type {
  AuthType,
  McpTransportType,
  RestTarget,
  McpTarget,
  Target,
  AuditRecord,
  GatewayHooks,
  GatewayConfig,
} from './types.js';
