# Settings Wizard Redesign

**Date**: 2026-04-16
**Status**: Approved
**Scope**: CLI `/settings` command — wizard UX overhaul

## Problem

The current `/settings` interactive mode shows a plain inquirer list ("What would you like to change?") with a raw table editor. This doesn't match the wizard-based design from the settings feature spec. The gap is purely in the presentation layer — the backend (SettingsManager, schema, validation, persistence) works correctly.

## Design Decisions

1. **3-level drill-down TUI** — categories -> settings list -> bordered mini-form — gives a UI-like experience within the terminal
2. **Bordered ASCII box header** — shows current provider/model/permissions before the category menu
3. **5 categories** — reorganize schema to separate notifications from tools, rename agent to permissions, move persistence out of settings entirely
4. **Bordered mini-form for edits** — structured form with current value, source, and type when editing a setting
5. **Single editing path** — the wizard IS the editor. No separate `/settings edit` or `/settings wizard` subcommands. The interactive flow starts and stays in the wizard.
6. **Simplified utils** — one function per concern, no overlapping pairs

## Category Reorganization

The schema's `SettingsCategory` type and `SETTINGS_CATEGORIES` array are updated:

| Category | Key | Settings | Change |
|----------|-----|----------|--------|
| Providers & Models | `providers` | `provider`, `providers.*` (10) | No change |
| Permissions & Safety | `permissions` | `agent.permissionLevel`, `agent.autoConfirm` (2) | Renamed from `agent` |
| Tools & Integrations | `tools` | `image.*` (7), `smtp.*` (5), `search.*` (1) = 13 | Remove notifications |
| Notifications | `notifications` | `notifications.*` feishu/dingtalk/wecom (6) | Extracted from `tools` |
| Skills | `skills` | (reserved) | No change |

**Removed categories:**
- `persistence` — moves to its own `/sessions` command (chat history, session storage backend). Not a settings concern.
- `server` — dropped (was reserved with zero settings).

5 categories total, covering all 31 settings. The "37" in CLAUDE.md is incorrect — actual count is **31** in SETTINGS_MAP, **34** in AppConfig (3 legacy properties `apiKey`/`baseUrl`/`model` intentionally excluded from SETTINGS_MAP).

## Wizard Flow

### Level 1: Category Menu

```
┌──────────────────────────────────────────────────┐
│  Current Settings                                 │
│                                                   │
│  Provider: anthropic       Model: claude-sonnet   │
│  Permissions: moderate     Auto-confirm: off      │
│                                                   │
│  ? What would you like to change?                 │
│    ❯ Providers & Models           [4/10]          │
│      Permissions & Safety         [configured]    │
│      Tools & Integrations         [partial]       │
│      Notifications                [not set]       │
│      ──────────────────────                       │
│      View full config (JSON)                      │
│      Reset to defaults                            │
│      Done                                         │
└──────────────────────────────────────────────────┘
```

- `renderWizardHeader()` draws the bordered box with current state
- **Header resolution**: reads `provider` setting to determine active provider, then resolves the model by reading `providers.<activeProvider>.model`. Falls back to "not configured" if provider or model unset.
- Two-column layout inside the box: provider+model left, permissions+auto-confirm right
- Fixed width (50 chars) for clean alignment
- Category status labels: `[N configured / M total]` for providers, `[configured]` / `[partially configured]` / `[not set]` for others
- Utility options: View full config (JSON), Reset to defaults, Done

### Level 2: Settings List

```
  Tools & Integrations

    Image API Key:     sk-...abc       (project config)
    Image Base URL:    (not set)       (default)
    Image Model:       dall-e-3        (default)
    SMTP Host:         smtp.gmail.com  (global config)
    ...

  ? Select a setting to edit:
    ❯ Image Generation API Key
      Image Generation Base URL
      Image Generation Model
      ...
      ← Back to categories
```

- `renderSettingsList()` formats 3-column aligned output: label, value, origin in parens
- Secret values masked via existing `maskValue()`
- `[restart]` tag shown for restart-required settings
- Inquirer `list` type for selection
- `← Back to categories` as last option

### Level 3: Bordered Mini-Form

```
┌─────────────────────────────────────────┐
│  SMTP Host                              │
│                                         │
│  Current:  smtp.gmail.com               │
│  Source:   global config                │
│  Type:     string                       │
└─────────────────────────────────────────┘

? New value:  smtp.gmail.com
```

- `renderSettingForm()` draws the bordered box with metadata
- Prompt type varies by schema:
  - `type: string` + `secret: false` -> inquirer `input`
  - `type: string` + `secret: true` -> inquirer `password` with `mask: '*'`
  - `type: number` -> inquirer `input` (validated as numeric)
  - `type: boolean` -> inquirer `confirm`
  - `type: enum` -> inquirer `list` with allowed values from `enumValues`
- After successful edit, prints confirmation and returns to Level 2

## Navigation

- Arrow keys at each level for selection
- `← Back` option returns up one level
- Ctrl+C at any level returns to REPL (no partial state persisted)
- After editing a setting, returns to Level 2 (settings list)

## Error Handling

- **Validation failure in mini-form**: Shows error inline, re-prompts with the same form
- **Secret field edit**: Box shows `Current: sk-...abc` (masked). Uses password prompt.
- **Env-var overridden setting**: Box shows `Source: env: OPENAI_API_KEY`. Edit prompt warns about env var precedence.
- **Restart-required setting**: After save, prints yellow warning about restart. Box shows `[restart]` tag.
- **Empty category**: Shows "(none configured)" and only offers "Back".
- **Non-interactive mode**: Falls back to `handleList()` unchanged.

## Command Structure (simplified)

The wizard replaces both `handleInteractive` and `handleEdit`. Single editing path:

```
/settings                          →  Wizard (Level 1 category menu)
/settings list                     →  Non-interactive table
/settings get <dot.key>            →  Show single value + origin
/settings set <dot.key> <value>    →  Set a value directly
/settings reset <dot.key>          →  Remove a value (revert to default)
/settings export                   →  Print full merged config as JSON
/settings help                     →  Show help
```

**Removed subcommands:**
- `/settings edit` — absorbed into the wizard. No separate path.
- `/settings wizard` — was a redirect to setup wizard. The setup wizard is now accessible from the category menu or via `/setup`.

## File Changes

### `src/core/settings-schema.ts`
- Update `SettingsCategory` type: `agent` → `permissions`, add `notifications`, remove `persistence` and `server`
- Update `SETTINGS_CATEGORIES`: 5 categories (providers, permissions, tools, notifications, skills)
- Move 6 notification entries from `tools` to `notifications` in `SETTINGS_MAP`
- No changes to `SETTINGS_SCHEMA`, `ENV_VAR_MAP`, or helper functions

### `src/adapters/cli/commands/settings-utils.ts`

Replace overlapping function pairs with single functions:

| Remove | Replace with |
|--------|-------------|
| `getCategoryStatus()` | `renderCategoryStatus(categoryKey, manager)` — renders status label with count |
| `formatSettingTable()` | `renderSettingsList(keys, manager)` — renders aligned settings table for Level 2 |

Keep unchanged:
- `formatSettingValue()` — still used by `handleGet`, `handleSet`, `handleExport`
- `maskValue()` — still used by `formatSettingValue` and `renderSettingForm`
- `getOriginLabel()` — still used by `renderSettingsList` and `renderSettingForm`
- `SettingRow` type — still used by `handleList`

Add new:
- `renderWizardHeader(manager)` → string — bordered box with current provider/model/permissions
- `renderSettingForm(dotKey, manager)` → string — bordered box with setting metadata

### `src/adapters/cli/commands/settings.ts`
- Remove `handleInteractive()`, `editCategory()`, `handleEdit()`, `handleWizard()` — all replaced by the wizard
- Add `handleWizard(manager)` — Level 1 category menu with box header, loops until "Done"
- Add `handleCategoryDrilldown(manager, category)` — Level 2 settings list with back navigation
- Add `handleSettingEdit(manager, dotKey)` — Level 3 bordered mini-form with validation loop
- Update router: `/settings` (no args, interactive) → `handleWizard`
- Update help text to reflect removed subcommands
- Keep: `handleList`, `handleGet`, `handleSet`, `handleReset`, `handleExport`, `handleHelp`

### `src/adapters/cli/commands/registry.ts` (or wherever commands are registered)
- Consider adding `/setup` as a direct alias to the setup wizard, since `/settings wizard` is removed

## Out of Scope

- Subcommand handlers (`get`, `set`, `reset`, `list`, `export`, `help`) — unchanged
- SDK/Server adapters — not affected
- SettingsManager core — not affected
- New settings or new validation rules — no schema entries added
- Skills category content — still reserved for future use
- Persistence/session management — moves to its own command, separate effort
- Setup wizard functionality — preserved, just accessed differently
