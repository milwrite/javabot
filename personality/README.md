# Modular Prompt System

This directory contains the modular prompt system for Bot Sportello, designed to reduce token usage and improve maintainability by loading only the prompt context needed for each pipeline stage.

## Overview

The monolithic `systemPrompt.js` (372 lines) has been decomposed into focused modules that are assembled on-demand based on pipeline stage requirements.

### Token Savings

| Stage | Monolithic | Modular | Reduction |
|-------|------------|---------|-----------|
| **Full Agent** (tool execution) | 372 lines | 200 lines | **46% savings** |
| **Chat** (conversation) | 372 lines | 105 lines | **72% savings** |
| **Edit Mode** (file editing) | 398 lines | 114 lines | **71% savings** |
| **Router** (intent classification) | Custom 40 lines | 40 lines | Standardized |

## Directory Structure

```
personality/
├── core/               # Foundation modules (identity, capabilities, repository)
│   ├── identity.js          # Doc Sportello personality & voice
│   ├── capabilities.js      # High-level capability overview
│   └── repository.js        # URLs, file paths, inventory
├── tools/              # Tool definitions and usage guidelines
│   ├── toolCatalog.js       # Canonical tool definitions (single source of truth)
│   ├── fileOperations.js    # File tool usage guidelines
│   ├── gitOperations.js     # Git/commit guidelines
│   └── searchGuidelines.js  # Web search patterns
├── content/            # Content creation guidelines
│   ├── designSystem.js      # Noir theme, colors, typography
│   ├── cssClasses.js        # CSS class reference
│   ├── mobilePatterns.js    # Interaction patterns
│   ├── pageStructure.js     # Required elements, hierarchy
│   └── components.js        # Reusable components
├── specialized/        # Stage-specific prompts
│   ├── routing.js           # Routing-specific context
│   ├── editing.js           # Edit mode workflow
│   └── agentRoles.js        # Content pipeline roles (architect/builder/tester/scribe)
├── assemblers/         # Module combination functions
│   └── index.js             # Assembler functions for each stage
└── test/               # Validation scripts
    └── validateModules.js   # Module validation tests
```

## Assembler Functions

### `assembleFullAgent()`
**Usage**: Tool execution stage (agentic loop)
**Includes**: core.* + tools.* + repository
**Token estimate**: ~200 lines

### `assembleChat()`
**Usage**: Conversation fast path
**Includes**: identity + capabilities + repository URLs
**Token estimate**: ~105 lines

### `assembleEditMode()`
**Usage**: Edit workflow stage
**Includes**: repository + fileOperations + editing workflow
**Token estimate**: ~114 lines

### `assembleRouter()`
**Usage**: Fast routing/intent classification
**Includes**: routing context with tool awareness
**Token estimate**: ~40 lines

### Content Pipeline Assemblers
- `assembleArchitect()` - Planning stage (~39 lines)
- `assembleBuilder()` - Generation stage (~98 lines)
- `assembleTester()` - Validation stage (~46 lines)
- `assembleScribe()` - Metadata generation (~11 lines)

## Feature Flag

Control modular prompts via environment variable:

```bash
# Enable modular prompts (default)
USE_MODULAR_PROMPTS=true

# Disable (use legacy systemPrompt.js)
USE_MODULAR_PROMPTS=false
```

## Adding New Modules

1. **Create module file** in appropriate directory (core/, tools/, content/, specialized/)
2. **Export string** with prompt content
3. **Update assembler** in `assemblers/index.js` to include new module
4. **Run validation**: `node personality/test/validateModules.js`

### Example

```javascript
// personality/content/newFeature.js
module.exports = `NEW FEATURE GUIDELINES:
- Feature-specific instructions
- Usage patterns
- Examples`;

// personality/assemblers/index.js
const newFeature = require('../content/newFeature');

function assembleFullAgent() {
    return [
        identity,
        repository,
        capabilities,
        newFeature,  // Add here
        fileOperations,
        gitOperations
    ].join('\n\n');
}
```

## Validation

Test all modules and assemblers:

```bash
# Validate all modules
node personality/test/validateModules.js

# Validate specific category
node personality/test/validateModules.js core
node personality/test/validateModules.js tools
node personality/test/validateModules.js content
node personality/test/validateModules.js specialized
node personality/test/validateModules.js assemblers
```

## Module Guidelines

1. **Keep modules focused** - Each module should address one concern
2. **Avoid duplication** - If multiple stages need the same info, extract to core/
3. **String exports only** - Modules export plain strings (not objects or functions)
4. **No circular dependencies** - Modules should not require each other
5. **Update tests** - Add validation for new modules in `test/validateModules.js`

## Benefits

- **Token efficiency**: 30-70% reduction per stage
- **Response speed**: Faster processing with smaller prompts
- **Maintainability**: Update design system in one place
- **Clarity**: Explicit dependencies per pipeline stage
- **Testability**: Individual modules can be validated separately
- **Flexibility**: Easy to A/B test variants

## Migration Notes

- Legacy `systemPrompt.js` preserved for rollback (`USE_MODULAR_PROMPTS=false`)
- Tool definitions centralized in `tools/toolCatalog.js` (single source of truth)
- Agent roles migrated from `services/llmClient.js` to `specialized/agentRoles.js`
- Edit suffix migrated from `services/editService.js` to `specialized/editing.js`
