# ZClaw CLI API UX Review

## Executive Summary

The zclaw CLI has evolved significantly from a single-provider tool to a sophisticated multi-provider system. While the core functionality works, there are several API UX issues that could confuse users and create maintenance burdens. The review identified **3 CRITICAL**, **8 MAJOR**, and **6 MINOR** issues across configuration structure, provider management, and interaction flows.

**Overall Assessment**: The API is functional but suffers from architectural debt due to backwards compatibility concerns and overlapping configuration paradigms.

---

## CRITICAL ISSUES (Blocks User Workflow)

### C1: Config Structure Confusion - Dual API Paradigms

**Location**: `AppConfig` interface (lines 33-66)

**Problem**: The config structure maintains two parallel paradigms:
- Legacy: Top-level `apiKey`, `model`, `baseUrl` 
- Modern: Provider-specific `models.{provider-type}`

This creates confusion about which fields to use and how they interact.

**Current Code**:
```typescript
interface AppConfig {
  provider?: ProviderType;
  apiKey?: string;        // Legacy - conflicts with models.*
  baseUrl?: string;       // Legacy - conflicts with models.*
  model?: string;         // Legacy - conflicts with models.*
  models?: {
    'openai-compatible'?: { apiKey: string; baseUrl: string; model: string; };
    openai?: { apiKey: string; model: string; };
    anthropic?: { apiKey: string; model: string; };
    glm?: { apiKey: string; model: string; };
  };
  // ... other fields
}
```

**Impact**: 
- Users don't know whether to set `apiKey` or `models.openai.apiKey`
- Documentation must explain both paradigms
- Migration path from legacy to modern is unclear
- Runtime logic (lines 803-812) has to handle legacy format

**Recommendation**: 
1. Document legacy fields as deprecated
2. Add migration logic to auto-convert legacy configs to modern format
3. Add warning when legacy fields are detected
4. Plan removal timeline (e.g., 2 versions)

---

### C2: Silent Fallback Behavior Hides Configuration Errors

**Location**: `resolveProviderConfig()` function (lines 442-453)

**Problem**: When provider resolution fails, the function silently returns `null`, and the application prompts for setup rather than explaining what went wrong.

**Current Code**:
```typescript
function resolveProviderConfig(config: AppConfig, providerType: ProviderType): ProviderConfig | null {
  const modelConfig = config.models?.[providerType];
  if (!modelConfig) return null;  // Silent failure - no error message

  const apiKey = ('apiKey' in modelConfig) ? modelConfig.apiKey : config.apiKey;
  if (!apiKey) return null;  // Silent failure - no error message
  // ...
}
```

**Impact**:
- Users don't know WHY their config is invalid
- Could be typos in provider names, missing API keys, or structure issues
- Forces users to re-run setup wizard instead of fixing specific issues

**Recommendation**:
```typescript
function resolveProviderConfig(config: AppConfig, providerType: ProviderType): ProviderConfig | {error: string} {
  const modelConfig = config.models?.[providerType];
  if (!modelConfig) {
    return {error: `Provider "${providerType}" not found in config. Available providers: ${Object.keys(config.models || {}).join(', ')}`};
  }
  // Similar checks for apiKey, model, etc.
}
```

---

### C3: Inconsistent Provider State After Removal

**Location**: `removeProviderConfig()` flow (lines 662-694)

**Problem**: When removing the active provider, the code attempts to switch to another provider, but the state management is complex and error-prone. The `config.provider` field can become stale or reference removed providers.

**Current Code**:
```typescript
if (selected === activeProvider) {
  // Fall back to first remaining configured provider
  const remaining = Object.keys(config.models || {}).filter(
    k => (config.models as any)[k]?.apiKey
  ) as ProviderType[];
  if (remaining.length > 0) {
    activeProvider = remaining[0];  // Only updates local variable
    // ... later updates config.provider
  }
}
// Additional cleanup logic needed
if (config.provider && !config.models?.[config.provider as ProviderType]?.apiKey) {
  const remaining = Object.keys(config.models || {}).filter(
    k => (config.models as any)[k]?.apiKey
  ) as ProviderType[];
  config.provider = remaining.length > 0 ? remaining[0] : undefined;
}
```

**Impact**:
- Complex state management with multiple places that update `config.provider`
- Potential for `config.provider` to reference removed providers
- Hard to reason about which provider is "active"

**Recommendation**:
1. Create a single `setActiveProvider(config, providerType)` function
2. Always call this function instead of directly setting `config.provider`
3. Make it validate that the provider exists and has required fields
4. Return clear error if trying to set invalid provider

---

## MAJOR ISSUES (Causes Confusion)

### M1: Config File Name Mismatch

**Location**: Lines 30-31

**Problem**: Config file is named `setting.json` but should be `settings.json` (plural). This is inconsistent with standard conventions and could confuse users looking for the config file.

**Current Code**:
```typescript
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, 'setting.json');
const LOCAL_CONFIG_FILE = path.join(process.cwd(), '.zclaw', 'setting.json');
```

**Recommendation**: 
1. Support both `setting.json` and `settings.json` for backwards compatibility
2. Write to `settings.json` going forward
3. Add migration logic to rename existing files

---

### M2: Ambiguous "Active Provider" Concept

**Location**: Multiple places reference "active" provider

**Problem**: The concept of an "active" provider is implicit and not clearly communicated to users. There's no visual indicator of which provider is currently active except in the `/models` command.

**Current Behavior**:
- Only shown in `/models` menu as `provider (active)`
- Not displayed in the prompt or status line
- No command to quickly check current provider/model

**Recommendation**:
1. Add a `/status` command to show current provider, model, and config location
2. Consider adding provider info to the command prompt: `(openai: gpt-4o) You >`
3. Make the active provider more visible in `/models` output

---

### M3: Image Config Inheritance is Unclear

**Location**: Lines 263-291

**Problem**: Image configuration can optionally inherit from main provider config, but this relationship is not clearly documented or communicated to users.

**Current Code**:
```typescript
const imageAnswers = await inquirer.prompt([
  {
    type: 'password',
    name: 'imageApiKey',
    message: currentConfig.imageApiKey
      ? `Enter Image Service API Key (Leave empty to keep ${maskSecret(currentConfig.imageApiKey)}, or leave empty to use main API key):`
      : 'Enter Image Service API Key (Leave empty to use main API key):',
    // ...
  },
]);
```

**Impact**:
- Users may not understand which API key will be used for image generation
- Unclear what "main API key" means when multiple providers are configured
- No indication of which provider's key is the "main" one

**Recommendation**:
1. Make image provider explicit: `Which provider should be used for image generation?`
2. Show which provider/model will be used: `Using OpenAI (gpt-4o) for image generation`
3. Store image config as provider reference + overrides rather than duplicate fields

---

### M4: Duplicate Provider Configuration Logic

**Location**: Multiple functions (lines 164-189, 481-508, 534-561)

**Problem**: Provider-specific configuration logic is duplicated across `runSetup()`, `addProviderInline()`, and `editProviderConfig()`. This creates maintenance burden and inconsistency risk.

**Current Code**: Each function has similar switch statements:
```typescript
if (providerType === 'openai-compatible') {
  const answers = await inquirer.prompt([...]);
  config.models['openai-compatible'] = { apiKey: answers.apiKey, baseUrl: answers.baseUrl, model: answers.model };
} else if (providerType === 'openai') {
  const answers = await inquirer.prompt([...]);
  config.models.openai = { apiKey: answers.apiKey, model: answers.model };
} // ... repeated for each provider type
```

**Impact**:
- Adding new providers requires changes in 3+ places
- Risk of inconsistencies between setup and edit flows
- Validation logic may differ between flows

**Recommendation**:
1. Create a `PROVIDER_CONFIG_SCHEMA` constant that defines prompts for each provider
2. Create a generic `configureProvider(providerType, existingConfig?)` function
3. All flows call this single function

---

### M5: Models Command Complexity

**Location**: `handleModelsCommand()` (lines 589-763)

**Problem**: The `/models` command tries to do too much: switch providers, switch models, edit configs, remove providers. The nested menu structure is deep and confusing.

**Current Flow**:
1. Select provider
2. Select action (switch/edit/remove/back)
3. If switch → select model → confirm
4. If edit → prompts for all fields
5. If remove → confirmation → handle active provider change

**Impact**:
- Users may not discover all available actions
- Deep menu nesting (3+ levels) is hard to navigate
- No way to quickly switch models without going through provider selection

**Recommendation**:
1. Split into separate commands: `/models`, `/providers`, `/config`
2. `/models` - quick model switching for current provider
3. `/providers` - provider management (add/remove/switch)
4. `/config` - full configuration editing
5. Add tab-completion for provider and model names

---

### M6: Environment Variable Handling Inconsistency

**Location**: Lines 789-799, 803-812

**Problem**: Environment variables are handled inconsistently:
- Some env vars are explicitly checked and mapped (`SMTP_HOST`, `TAVILY_API_KEY`)
- Provider-related env vars are only used in legacy compat mode
- No way to configure providers entirely via environment

**Current Code**:
```typescript
// Only for legacy compat
if (!fullConfig.models && (fullConfig.apiKey || process.env.OPENAI_API_KEY)) {
  fullConfig.models = {
    'openai-compatible': {
      apiKey: process.env.OPENAI_API_KEY || fullConfig.apiKey || '',
      baseUrl: process.env.OPENAI_BASE_URL || fullConfig.baseUrl || 'https://api.openai.com/v1',
      model: options.model || process.env.OPENAI_MODEL || fullConfig.model || 'gpt-4o'
    }
  };
}
```

**Impact**:
- Can't configure modern multi-provider setup via env vars
- No `ZCLAW_ANTHROPIC_API_KEY` or similar
- Container/deployment users may prefer env-only config

**Recommendation**:
1. Support env vars for each provider: `ZCLAW_OPENAI_API_KEY`, `ZCLAW_ANTHROPIC_API_KEY`, etc.
2. Document env var → config field mapping
3. Consider `ZCLAW_CONFIG_SOURCE=env|file|prefer-env` option

---

### M7: Weak Error Messages for Invalid Config

**Location**: Throughout config loading and validation

**Problem**: Error messages don't provide actionable guidance when config is invalid.

**Examples**:
- `"No provider configuration found."` - Which providers are valid? What's missing?
- `"Provider configuration is required to proceed."` - How do I fix this?
- Generic parse errors from `JSON.parse()`

**Recommendation**:
1. Add structured validation with specific error messages
2. Show available providers when provider is not found
3. Provide fix suggestions: "Run `zclaw setup` to configure"
4. Validate config on load and show all errors at once

---

### M8: Command Discovery Issues

**Location**: Lines 110-124, chat loop (lines 894-1010)

**Problem**: Commands are not well documented or discoverable. Users must read source code to know about `/models`, `/skills`, `exit`, `quit`.

**Current State**:
- Only `/models` and `/skills` are hinted in startup message (line 870)
- No `/help` command
- No command listing available
- Slash commands are not discoverable

**Recommendation**:
1. Add `/help` command that lists all available commands
2. Show command hints on startup
3. Consider standard CLI patterns: `zclaw --help`, `zclaw models --help`
4. Document slash commands in README

---

## MINOR ISSUES (Polish)

### m1: Inconsistent Prompt Wording

**Location**: Various inquirer prompts

**Problem**: Prompt wording is inconsistent across providers and flows.
- "API Key" vs "OpenAI API Key" vs "OpenAI-Compatible API Key"
- Sometimes shows "(Leave empty to keep...)" sometimes doesn't

**Recommendation**: Standardize prompt templates

---

### m2: Model Catalog Hardcoded

**Location**: `src/models-catalog.ts`

**Problem**: Model lists are hardcoded and will become outdated quickly. No way to fetch available models from APIs.

**Recommendation**: 
1. Document how to update model catalog
2. Consider fetching models from provider APIs (if available)
3. Add contribution guide for keeping catalog current

---

### m3: No Config Validation Command

**Problem**: No way to validate config without actually running the agent

**Recommendation**: Add `zclaw config validate` command

---

### m4: Unclear Backwards Compatibility Support

**Problem**: Not clear when legacy config format will be removed or how to migrate

**Recommendation**: 
1. Document migration path
2. Add deprecation warnings
3. Provide migration tool/script

---

### m5: Config File Location Confusion

**Location**: Lines 516-528

**Problem**: `saveConfig()` automatically chooses between global and local config based on what exists, which could be surprising.

**Current Code**:
```typescript
function saveConfig(config: AppConfig) {
  const targetFile = fs.existsSync(path.join(process.cwd(), '.zclaw', 'setting.json'))
    ? LOCAL_CONFIG_FILE
    : GLOBAL_CONFIG_FILE;
  // ...
}
```

**Recommendation**: 
1. Add `--global` and `--local` flags to control save location
2. Show which file is being saved
3. Add command to check current config location: `zclaw config location`

---

### m6: Missing Config Diff/Backup

**Problem**: No way to see what changed in config or backup previous config

**Recommendation**:
1. Show diff before saving in setup wizard
2. Auto-backup config before changes
3. Add `zclaw config backup` and `zclaw config restore` commands

---

## POSITIVE ASPECTS

1. **Good backwards compatibility**: Legacy configs still work via migration logic
2. **Clear setup wizard**: The `setup` command is well-structured and guides users through configuration
3. **Provider abstraction**: Clean separation between provider types via factory pattern
4. **Graceful degradation**: When config is missing, offers to run setup instead of crashing
5. **Security**: Uses file permissions (0o600) for config files and masks API keys in prompts

---

## RECOMMENDED IMPROVEMENT ROADMAP

### Phase 1: Critical Fixes (Immediate)
1. Add structured error messages to `resolveProviderConfig()`
2. Fix provider state management after removal
3. Document dual config paradigm and add migration warnings

### Phase 2: Major Improvements (Next Release)
1. Refactor to single `configureProvider()` function
2. Split `/models` into `/models`, `/providers`, `/config`
3. Add environment variable support for multi-provider config
4. Rename `setting.json` to `settings.json` with migration

### Phase 3: Polish (Future)
1. Add `/help` and `/status` commands
2. Implement config validation and diff commands
3. Add config backup/restore functionality
4. Improve prompt consistency and wording

---

## TESTING RECOMMENDATIONS

The API UX issues suggest need for:

1. **Config migration testing**: Test upgrade path from legacy to modern config format
2. **Multi-provider workflows**: Test adding/removing/switching providers in various combinations
3. **Error scenario testing**: Test all invalid config states and error messages
4. **Environment variable testing**: Test configuration via env vars only
5. **New user testing**: Observe new users setting up multi-provider configuration

---

## CONCLUSION

The zclaw CLI has a solid foundation but is hampered by backwards compatibility concerns and rapid evolution from single-provider to multi-provider architecture. The CRITICAL issues around config structure clarity and error handling should be addressed immediately to improve user experience. The MAJOR issues require some refactoring but will significantly reduce confusion and maintenance burden.

The proposed improvements would transform zclaw from a functional but confusing tool into a polished, professional CLI with clear configuration semantics and excellent user experience.
