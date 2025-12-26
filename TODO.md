# Modularization TODO

## Phase 2 - High-value extractions

- [ ] **Extract agentLoop** (`services/agentLoop.js`) - ~680 lines
  - `getLLMResponse()` function (lines 2077-2757)
  - The agentic loop with tool execution
  - Biggest complexity reduction opportunity

- [ ] **Extract mentionHandler** (`services/mentionHandler.js`) - ~626 lines
  - `handleMentionAsync()` function
  - @mention processing logic
  - Second-biggest function in codebase

## Phase 3 - Organization

- [ ] **Extract command handlers** (`commands/handlers.js`) - ~500 lines
  - `handleCommit`, `handleSearch`, `handleSetModel`, `handleStatus`
  - `handlePoll`, `handleLogs`, `handleDeepResearch`
  - Cleaner separation of Discord interaction logic

- [ ] **Extract validation service** (`services/validation.js`) - ~180 lines
  - `validateHTMLContent`, `validateJSContent`
  - `calculateQualityScore`, `buildValidationFeedback`
  - Reusable across content generation features

- [ ] **Extract metadata service** (`services/metadata.js`) - ~200 lines
  - `updateIndexWithPage`, `syncIndexWithSrcFiles`
  - `getIconForDescription`, `formatProjectTitle`, `condenseDescription`
  - Project metadata management

- [ ] **Extract command definitions** (`commands/definitions.js`) - ~115 lines
  - `const commands = [...]` array
  - Slash command builders

- [ ] **Extract GUI logger** (`utils/guiLogger.js`) - ~100 lines
  - `logToGUI`, `logToolCall`, `logFileChange`
  - `startAgentLoop`, `updateAgentLoop`, `endAgentLoop`

## Completed

- [x] **Phase 1: Remove duplicate filesystem functions** - 444 lines removed
  - Deleted local `listFiles`, `fileExists`, `readFile`, `writeFile`, `searchFiles`
  - Updated tool handlers to use `services/filesystem.js` imports
  - Added `onFileChange` callbacks for GUI logging
