/**
 * ZClaw Core — Error class hierarchy
 *
 * Proper class hierarchy for all ZClaw errors.
 * Each error class carries a `code`, `retryable` flag, and domain-specific
 * metadata (e.g. `provider`, `tool`, `steps`).
 */

// ── Base error ──────────────────────────────────────────────────────────

/**
 * Base class for all ZClaw errors.
 *
 * Carries a machine-readable `code` and a `retryable` flag so callers can
 * decide whether to retry automatically.
 */
export class ZclawError extends Error {
  /** Machine-readable error code, e.g. "PROVIDER_ERROR", "TOOL_FAILED". */
  code: string;
  /** Whether the operation that caused this error can be retried. */
  retryable: boolean;

  constructor(message: string, code: string, retryable = false) {
    super(message);
    this.name = "ZclawError";
    this.code = code;
    this.retryable = retryable;
  }
}

// ── Provider errors ─────────────────────────────────────────────────────

/**
 * Error originating from a provider (LLM API call failure, auth, rate-limit, etc.).
 */
export class ProviderError extends ZclawError {
  /** The provider name that produced the error, if known. */
  provider?: string;

  constructor(message: string, provider?: string) {
    super(message, "PROVIDER_ERROR", true);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

// ── Tool errors ─────────────────────────────────────────────────────────

/**
 * Error from tool execution.
 */
export class ToolError extends ZclawError {
  /** The tool name that produced the error, if known. */
  tool?: string;

  constructor(message: string, tool?: string) {
    super(message, "TOOL_FAILED", true);
    this.name = "ToolError";
    this.tool = tool;
  }
}

// ── Max steps ───────────────────────────────────────────────────────────

/**
 * Thrown when the agent loop exceeds the configured maximum number of steps.
 */
export class MaxStepsError extends ZclawError {
  /** The number of steps that were executed. */
  steps: number;

  constructor(steps: number, maxSteps: number) {
    super(
      `Maximum steps reached (${steps}/${maxSteps})`,
      "MAX_STEPS",
      false,
    );
    this.name = "MaxStepsError";
    this.steps = steps;
  }
}

// ── Aborted ─────────────────────────────────────────────────────────────

/**
 * Thrown when an operation is aborted (e.g. via AbortSignal).
 */
export class AbortedError extends ZclawError {
  constructor(message?: string) {
    super(message ?? "Operation was aborted", "ABORTED", false);
    this.name = "AbortedError";
  }
}
