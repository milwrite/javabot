# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bot Sportello is a Discord bot with a laid-back Doc Sportello personality that manages a web development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered content generation through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage web pages and JavaScript libraries through Discord commands while maintaining a chill, slightly spacey but helpful personality. All generated projects use a noir terminal aesthetic with mobile-first responsive design.

**Live Site**: https://bot.inference-arcade.com/
**Repository**: https://github.com/milwrite/javabot/
**Hosting**: Production bot runs on Railway (auto-deploys from main branch)

**Key Features**:
- AI-generated HTML pages & JavaScript features using OpenRouter
- Automatic GitHub commits and deployment to GitHub Pages
- Conversation memory (Discord API with message reactions)
- Noir terminal design system with Courier Prime font and CRT effects
- Mobile-first responsive design (768px, 480px breakpoints, 44px touch targets)
- All games require mobile touch controls for Discord's mobile-forward users

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (with auto-restart)
npm run dev

# Run in production mode
npm start

# RECOMMENDED: Run with comprehensive logging and monitoring
./run-bot.sh

# Run with custom GUI port
./run-bot.sh --gui-port 3001

# Run without GUI dashboard
./run-bot.sh --no-gui
```

**No testing, linting, or build commands** - This project uses direct Node.js execution without build steps or formal testing frameworks.

**Restarting the bot**: After making changes to `index.js`, restart the bot process to reload slash commands and apply code changes.

**Environment Setup**:
- Copy `.env.example` to `.env` before first run
- All required environment variables must be present or bot will exit with error message
- Bot validates all `REQUIRED_ENV_VARS` on startup (see index.js:11-26)

## 📊 Log Preservation System

**CRITICAL**: Use `./run-bot.sh` for comprehensive activity tracking and failure documentation.

**Features**: Activity preservation, session reports, GUI dashboard at http://localhost:3001, health monitoring
**Log Files**: `session-logs/bot-session-{timestamp}-{raw.log|report.json|summary.md}`
**Tracking**: Mentions, tool calls, errors, health metrics, crash analysis

## 🚀 COMMIT PROCEDURES

**CRITICAL**: When working on this codebase, follow these exact commit steps to avoid authentication issues.

### Quick Commit Guide

1. **Stage your changes**:
   ```bash
   git add <files>
   # or for all changes:
   git add .
   ```

2. **Commit with message** (lowercase, detailed, max 100 chars, no Claude Code attribution):
   ```bash
   git commit -m "fix: your commit message here"
   ```

3. **Push using token authentication** (ALWAYS use this exact command):
   ```bash
   source .env && git remote set-url origin https://milwrite:$GITHUB_TOKEN@github.com/milwrite/javabot.git && git push origin main && git remote set-url origin https://github.com/milwrite/javabot.git
   ```

### Push Command Breakdown

The push command MUST:
1. **Source .env first** - Token is not in shell environment by default
2. **Set remote URL with token** - GitHub requires token auth, not password
3. **Push to origin main** - Always push to main branch
4. **Clean up remote URL** - Remove token from .git/config immediately after push

**NEVER use**:
- `git push` alone (will fail with permission denied)
- `git push origin main` without token (same failure)
- SSH URLs like `git@github.com:...` (no SSH keys configured)

### One-Liner for Commit + Push

For convenience, stage, commit, and push in one command:
```bash
git add . && git commit -m "your message" && source .env && git remote set-url origin https://milwrite:$GITHUB_TOKEN@github.com/milwrite/javabot.git && git push origin main && git remote set-url origin https://github.com/milwrite/javabot.git
```

### Bot Auto-Commit Behavior

The bot automatically commits and pushes changes when:
- Writing files via `write_file()` tool
- Editing files via `edit_file()` tool
- Manual commits via `/commit` or `commit_changes()` tool

Note: The bot itself does not use local git remotes for pushing. It commits via the GitHub API (Octokit) using `services/gitHelper.js`, sending the token in an `Authorization` header. No URL‑embedded tokens are used by the bot.

**Commit Message Format**: Following global user instructions:
- Lowercase only
- Detailed but max 100 characters
- No Claude Code attribution

### Troubleshooting Authentication

**Problem**: "fatal: could not read Password" or "Authentication failed"
**Solution**: The GitHub token may be expired or incorrectly formatted
1. Check token is valid in GitHub settings
2. Ensure token has `repo` permissions
3. Use the manual push format above with current token

**Problem**: Remote URL contains embedded token causing issues
**Solution**:
```bash
git remote set-url origin https://github.com/milwrite/javabot.git
```

### Cleaning Up Phantom Slash Commands

Discord caches slash commands globally. If old commands persist in Discord after removal from code:

```bash
# List and clear all global commands (run once)
node -e "
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const clientId = process.env.DISCORD_CLIENT_ID;
rest.get(Routes.applicationCommands(clientId))
  .then(cmds => { console.log('Global commands:', cmds.map(c => '/' + c.name).join(', ')); return cmds; })
  .then(() => rest.put(Routes.applicationCommands(clientId), { body: [] }))
  .then(() => console.log('Cleared. Restart bot to re-register guild commands.'))
  .catch(console.error);
"
```

After running, restart the bot and quit/reopen Discord to clear client cache.

## Architecture Overview

### Modular Architecture
The bot is organized across `index.js` (~4900 lines) and modular services:

**index.js key sections**:
1. Environment configuration and imports (lines 1-35)
2. Configuration constants in `CONFIG` object (lines 68-83)
3. Error tracking system (prevents infinite error loops)
4. Discord client setup and context manager
5. Enhanced LLM with function calling (agentic loop, max 6 iterations)
6. Slash command definitions and handlers
7. Message tracking, @ mention responses, and bot ready event

**Services Modules** (`/services/`):
- `llmRouter.js` - **Primary request router** (LLM-based, uses Gemma 3 12B, provides suggestive guidance)
- `requestClassifier.js` - **Simplified greeting detector** (only detects pure greetings ≤30 chars, returns 'UNKNOWN' for everything else)
- `filesystem.js` - File operations (listFiles, fileExists, readFile, writeFile, editFile, searchFiles)
- `gitHelper.js` - GitHub API operations (octokit, pushFileViaAPI, getExistingFileSha)
- `gamePipeline.js` - Game building pipeline
- `llmClient.js` - OpenRouter API client with role-specific prompts
- `postgres.js` - PostgreSQL logging service (Railway database)

**Request Routing Flow** (for @mentions):
1. `generateRoutingPlan()` runs FIRST - LLM analyzes request, returns `{intent, toolSequence, confidence}`
2. Keyword classifier detects pure greetings (≤30 chars only)
3. **CONVERSATION fast path**: Only triggers for very short greetings when router agrees (`intent='chat' + confidence>=0.6`)
4. **All other requests** go to full agent with tools (including "list games", "commit changes", etc.)
5. **Removed fast paths** (as of Dec 2025): READ_ONLY bypass, COMMIT regex parsing
6. Router guidance is **suggestive, not prescriptive**: "This is a suggested starting point - feel free to explore"

**Config Modules** (`/config/`):
- `models.js` - MODEL_PRESETS, OPENROUTER_URL, reasoning config

**File Organization**:
- `/src/` - All generated HTML pages, JS features, and demos
- `/services/` - Modular service modules (filesystem, git, LLM, pipelines)
- `/config/` - Configuration modules (models, presets)
- `/responses/` - AI responses >2000 chars saved with timestamps
- `index.html` - Main hub page with embedded CSS (no longer uses style.css)
- `page-theme.css` - Shared arcade theme for all /src/ pages
- `projectmetadata.json` - Project collections + metadata (title, icon, caption) loaded dynamically by index.html

### System-V1: Modular Content Pipeline

**Branch**: `system-v1` adds modular AI-driven content creation with `/services/` and `/agents/` directories.

**Pipeline**: Architect → Builder → Tester → Scribe for content generation
- **Architect**: Analyzes request, generates implementation plan
- **Builder**: Creates HTML/JS from plan with mobile-first enforcement
- **Tester**: Validates output with automated checks
- **Scribe**: Generates documentation and updates metadata

**Features**: Content-type-aware generation, iterative quality loop (3 attempts), build log pattern detection

### Known Issues

- Tool API mismatches (camelCase vs snake_case in some places)
- Duplication across edit vs normal loops
- No automated testing (uses runtime validation instead)
- Unbounded growth in `responses/` directory

### Key Integrations

**Discord API**: discord.js v14 with slash commands
- Intents: Guilds, GuildMessages, GuildMessageReactions, MessageContent
- Commands automatically register on bot startup via REST API
- Error handling prevents spam loops (3 errors = 5min cooldown)
- All interactions use `deferReply()` except `/poll`
- Multi-channel support via comma-separated `CHANNEL_ID` env var

**GitHub Integration**:
- Octokit for GitHub API interactions (no local git required for the bot)
- All bot commits target the `main` branch via API
- Branch context derives from repository defaults/config (no reliance on local `git status`)
- Token authentication configured at runtime and sent via `Authorization` header

**OpenRouter AI Integration**:
- **Zero Data Retention (ZDR) ENFORCED** - all requests use `provider.data_collection: 'deny'`
- Only ZDR-compliant models allowed (no OpenAI - they don't support ZDR on OpenRouter)
- Swappable models via `MODEL_PRESETS` (ZDR-compliant only)
- Default: `z-ai/glm-4.7`
- Available: GLM 4.7, Kimi K2, DeepSeek V3.1, Qwen 3, MiMo
- `set_model(model)` - Switch AI model: glm, kimi, deepseek, qwen, mimo (equivalent to `/set-model`)
- `glm` - GLM 4.7 (default)
- `kimi` - K2 (with reasoning)
- `deepseek` - DeepSeek V3.1 Terminus
- Function calling support (filesystem tools, web search)
- 10,000 token output limit for detailed responses
- Automatic 402 error recovery (reduces max_tokens when credits low)
- Automatic 500 error fallback (switches to alternate ZDR model after 2 failures)
- Conversation history fetched from Discord API (5 messages, with reactions, on-demand per channel)

**Noir Terminal Frontend Styling**:
- **Main page**: `index.html` with embedded CSS (self-contained, no external stylesheet)
- **Individual pages**: Link to `page-theme.css` (shared noir theme for all /src/ pages)
- **Current theme**: Unified Noir Terminal across all 45 pages:
  * Primary accent: #ff0000 (red)
  * Secondary accent: #00ffff (cyan)
  * Text color: #7ec8e3 (light blue)
  * Background: #0a0a0a (true black)
- **Typography**: Courier Prime monospace font (terminal aesthetic - standardized across all pages)
- **Effects**: CRT scanlines, flicker animations, glitch effects
- **Visual effects**: Simple gradient background on main page, grid + scanlines on individual pages
- **Project discovery**: `index.html` dynamically loads projects from `projectmetadata.json`
- **Navigation**: All pages include back button (`<a class="home-link" href="../index.html"></a>`) - **CSS shows arrow only via `::before` pseudo-element, any HTML content is hidden**
- **Theme consistency**: Both index.html and page-theme.css use matching noir palette (enforced Dec 2025)

**Project Metadata System**:
- **Location**: `projectmetadata.json` (separate file, loaded via fetch)
- **Structure**: `{ "collections": { ... }, "projects": { "slug": { "title", "icon", "description", "collection" } } }`
- **Collections**: `featured`, `arcade-games`, `utilities-apps`, `stories-content`, `unsorted` (fallback)
- **Auto-update**: `updateIndexWithPage()` and `/sync-index` ensure new pages land in metadata (defaults to `unsorted`)
- **Icon selection**: `getIconForDescription()` auto-assigns emoji based on keywords in description
- **Captions**: 3-6 word summaries generated via `condenseDescription()` but can be edited manually
- **Dynamic loading**: `index.html` fetches `projectmetadata.json`, groups projects by collection, and renders cards automatically

### Data Persistence & Memory

| File/Directory | Purpose | Format | Lifecycle |
|---|---|---|---|
| **projectmetadata.json** | Canonical page registry (index) | JSON: {collections, projects} | Persistent; updated on each page creation |
| **Discord API** | Conversation context (direct from channel) | Fetched via channel.messages.fetch() | 60-second cache; 5 messages on-demand |
| **build-logs/{id}.json** | Per-build pipeline execution logs | JSON array with stages, plans, test results | One per build; kept for history |
| **responses/{timestamp}.txt** | Long responses >2000 chars (Discord limit) | Text with timestamp header | One per response; kept for audit trail |
| **session-logs/*.json/.md** | Bot session reports (failure/success analysis) | JSON + Markdown summaries | One per bot session run; via run-bot.sh |
| **gui-run-logs/*.json** | GUI dashboard history (real-time events) | Serialized panel state | Per-run; cleared on new session |
| **issues/*.md** | Bug reports and fix documentation | Markdown with symptoms, root cause, fix | Per-issue; tracked in git for project history |
| **index.html** | Main page (project hub) | HTML with embedded CSS | Persistent; manually edited theme |
| **page-theme.css** | Shared noir styling (all pages) | CSS with color vars + mobile breakpoints | Persistent; theme source of truth |
| **/src/*.html** | Generated pages (games, pages, features) | Self-contained HTML + inline CSS/JS | Created via `write_file()` tool |
| **PostgreSQL (Railway)** | Long-term event logging | Tables: bot_events, tool_calls, build_stages | Persistent; queryable via `/logs` command |

### PostgreSQL Logging

Optional long-term logging to Railway PostgreSQL database. Enables querying of historical events via `/logs` command.

**Tables:**
- `bot_events` - All events (mentions, tool calls, file changes, errors, agent loops)
- `tool_calls` - Detailed tool execution logs with arguments and results
- `build_stages` - Game pipeline build stages

**Logged Events:**
- Mentions (user, content, channel)
- Tool calls (name, args, result, duration, iteration)
- File changes (action, path, preview)
- Agent loops (command, tools used, result, duration)
- Errors (type, category, message, stack)

**Query via Discord:**
- `/logs recent [type] [limit]` - View recent events
- `/logs errors [period]` - Error statistics (1h, 24h, 7d)
- `/logs stats [days]` - Activity summary

**Query via CLI (for debugging production issues):**
```bash
# Get Railway logs (shows PostgreSQL, not bot logs)
railway logs

# Query PostgreSQL directly for bot events
source .env && psql "$DATABASE_URL" -c "SELECT event_type, to_char(timestamp, 'HH24:MI:SS') as time, payload::text FROM bot_events WHERE timestamp > NOW() - INTERVAL '2 hours' ORDER BY timestamp DESC LIMIT 30;"

# Check recent tool calls
source .env && psql "$DATABASE_URL" -c "SELECT tool_name, to_char(timestamp, 'HH24:MI:SS') as time, SUBSTRING(arguments::text FROM 1 FOR 200) as args FROM tool_calls WHERE timestamp > NOW() - INTERVAL '2 hours' ORDER BY timestamp DESC LIMIT 20;"

# Check for errors
source .env && psql "$DATABASE_URL" -c "SELECT to_char(timestamp, 'HH24:MI:SS') as time, SUBSTRING(payload::text FROM 1 FOR 400) as payload FROM bot_events WHERE event_type = 'error' AND timestamp > NOW() - INTERVAL '3 hours' ORDER BY timestamp DESC LIMIT 15;"
```

**Non-blocking**: All logging is fire-and-forget to avoid impacting bot performance.

### AI Function Calling System

The bot uses OpenRouter's function calling with an **agentic loop** to give the AI autonomous multi-step capabilities. All tools are available via both slash commands AND @mentions:

**Filesystem Tools**:
- `file_exists(path|url)` - **FAST existence check with fuzzy matching**. Use FIRST when given a URL or informal name. Supports:
  * URLs: `https://bot.inference-arcade.com/src/game.html` → extracts path automatically
  * Informal names: `"peanut city"` → tries `src/peanut-city.html`, `src/peanut_city.html`
  * Returns similar file suggestions if not found
- `list_files(path)` - List files grouped by extension for easy scanning
- `read_file(path)` - Read file contents (5000 char limit)
- `write_file(path, content)` - Create/update files completely
- `edit_file(path, old_string, new_string, instructions, replacements)` - Edit existing files via exact string replacement (FAST, preferred) or AI instructions (SLOW, fallback)
  * **Exact mode** (preferred): Provide `old_string` and `new_string` for deterministic replacement (~0.1s)
  * **Batch mode** (fastest for multiple edits): Provide `replacements` array of `{old, new, replace_all?}` objects
    - Example: `[{old: "color: red", new: "color: blue", replace_all: true}, {old: "Title", new: "New Title"}]`
    - Single file read/write, single push - much faster than multiple edit_file calls
  * **AI mode** (fallback): Provide `instructions` for complex multi-location edits (~3-5s)
  * Must use EXACT string from file including all whitespace/indentation
  * String must be unique in file (or use `replace_all: true` in batch mode)

**Repository Tools**:
- `commit_changes(message, files)` - Git add, commit, push to main (equivalent to `/commit`)
- `get_repo_status()` - Check current git status (equivalent to `/status`)

**Configuration Tools**:
- `set_model(model)` - Switch AI model: glm, kimi, deepseek, qwen, mimo (equivalent to `/set-model`)

**Web Search**:
- `web_search(query)` - Search internet for current information (via Perplexity Sonar)
- Automatically triggered for questions about "latest", "recent", "current"

**Agentic Loop (Multi-Step Execution)**:
- AI can chain multiple tool calls across iterations (max 6 rounds, max 5 read-only iterations)
- Example flow: read file → edit based on contents → commit changes
- Tools remain available after each step, enabling complex multi-step tasks
- Console logs show iteration count and tools used per step
- Safety limits: `MAX_ITERATIONS=6`, `MAX_READONLY_ITERATIONS=5`
- **Redundant edit prevention**: Files can only be edited once per conversation to prevent slow repeated edits

**Response Handling**:
- Long responses (>2000 chars) saved to `responses/` directory
- Discord shows truncated version with file path
- Applies to chat, search, and mention responses

### Content Generation Flow

Pages are created via the `write_file()` tool when users ask for new pages, games, or features:

1. AI generates complete HTML that links to `page-theme.css` (shared noir terminal theme)
2. Back button with `.home-link` class included (CSS displays arrow only)
3. Mobile-responsive with appropriate touch controls (D-pad for movement games, direct touch for tap games)
4. **Layout hierarchy**: Canvas → Controls (if needed) → Start Button → Instructions
5. File saved to `src/{name}.html` via `write_file()`, then pushed via GitHub API
6. Metadata updated in `projectmetadata.json`

**Styling Consistency**:
- All new pages link to `page-theme.css` for uniform noir terminal aesthetic
- Color palette: terminal green (#00ff41), red (#ff0000), cyan (#00ffff), black (#0a0a0a)
- Available CSS classes: `.container`, `.card`, `.btn`, `.panel`, `.home-link`, `.mobile-controls`, etc.
- **Back button**: Use `<a class="home-link" href="../index.html"></a>` - CSS hides all text and shows only `←` arrow via pseudo-element
- **Movement games** (snake, maze, platformer): Include D-pad `.mobile-controls` with arrow buttons
- **Touch games** (memory match, simon, tic-tac-toe): Use direct touch on game elements, NO D-pad
- **Economical design**: Small start buttons, tight spacing (5-8px margins)
- **Layout hierarchy**: Controls → Start → Instructions (always in this order)
- Prompts optimized for token efficiency with inline examples

**Reusable Audio Components** (`src/audio/`):

- **SportelloAmbient** - Ambient sound mixer (rain, ocean, wind, fire, whitenoise, heartbeat, chimes, drone). Themes: `sleep` (lavender) or `noir` (cyan/red). Init: `SportelloAmbient.init({ container, sounds, timer, theme })`
- **SportelloNarrator** - TTS for stories using Ralph voice. Init: `SportelloNarrator.init({ selector: '.paragraph', rate: 0.85 })`

### Doc Sportello Personality System

**Response Categories** (`botResponses` object):
- `confirmations` - "yeah man, i got you..."
- `errors` - "oh... yeah something went sideways there"
- `success` - "nice, that worked out pretty smooth"
- `thinking` - "let me think about this for a sec..."

**Modular Prompt System** (Active - Dec 2025):
- **Location**: `personality/` directory with focused modules
- **Token savings**: 30-70% reduction per pipeline stage
- **Anti-hallucination focus**: Strong exploration rules prevent assumptions
- **Modules organized by**: core/, tools/, content/, specialized/, assemblers/
- **See**: `personality/README.md` for full documentation
- **Interactive Visualizer**: `src/prompt-flow-visualizer.html` - SVG flow diagram showing how prompts are assembled for different request types (greeting, edit, build, search) with animated token flow and click-to-inspect module details

**Prompt Assembly by Stage**:
- **Full Agent** (tool execution): ~350 lines with anti-hallucination rules (exploration + context + identity + repo + capabilities + tools)
- **Chat** (conversation): 105 lines (72% reduction)
- **Edit Mode** (file editing): 114 lines (71% reduction)
- **Router** (intent classification): 40 lines (standardized)
- **Content Pipeline**: Architect (~39), Builder (~98), Tester (~46), Scribe (~11)

**Module Structure**:
```
personality/
├── core/          # identity, capabilities, repository, explorationRules, contextRules
├── tools/         # toolCatalog, fileOperations, gitOperations, searchGuidelines
├── content/       # designSystem, cssClasses, mobilePatterns, pageStructure, components
├── specialized/   # routing, editing, agentRoles
├── assemblers/    # Combines modules per stage
└── test/          # Validation scripts
```

**Key Anti-Hallucination Modules**:
- `core/explorationRules.js` - "Never assume, always verify" directives, default to exploration over assumption
- `core/contextRules.js` - Reference resolution ("the game" → check recent actions cache, resolve pronouns)
- `core/repository.js` - Emphasizes `src/site-inventory.html` as THE source of truth for file discovery
- `tools/fileOperations.js` - "NEVER HALLUCINATE - ALWAYS VERIFY" rules at top of module

**Usage**: Call `getBotResponse(category)` for random selection from category.

### Environment Variables

Required in `.env`:
```
DISCORD_TOKEN          # Discord bot token
DISCORD_CLIENT_ID      # Bot application ID (1436782482967101491)
GITHUB_TOKEN           # GitHub PAT with repo permissions
GITHUB_REPO_OWNER      # Repository owner (milwrite)
GITHUB_REPO_NAME       # Repository name (javabot)
GITHUB_REPO_URL        # Full repository URL
CHANNEL_ID             # Comma-separated Discord channel IDs
OPENROUTER_API_KEY     # OpenRouter API key
```

Optional:
```
DATABASE_URL           # PostgreSQL connection string for long-term logging (Railway)
```

**Discord Bot Setup**:
- Public Key: `5c35faa34f67859b7ae2ffe7f5923344e4fee369cc85238385d70b2887e81f3d`
- Required permissions: Send Messages, Use Slash Commands, Embed Links
- Required intents: Guilds, Guild Messages, Message Content, Guild Message Reactions

### Error Handling Pattern

**Error Loop Prevention**:
```javascript
errorTracker.set(`${userId}-${commandName}`, {
    count: errorCount,
    lastError: timestamp
});
```
- Tracks errors per user/command combination
- 3 consecutive errors within 5 minutes = cooldown message
- Cleared on successful command execution

**Interaction Error Handling**:
- All commands defer reply first (except `/poll`)
- Error tracking happens after deferring
- Graceful fallback if reply already sent
- Specific error messages for auth, remote, commit issues

### Message History System

**Discord-Native Context** (replaces agents.md):
- Fetches last 5 messages from Discord API via `channel.messages.fetch()` on-demand
- Context only activated when Bot Sportello receives input in a channel (no startup prefetch)
- 60-second cache per channel prevents rate limiting
- Managed by `DiscordContextManager` class with `buildContextForChannel()` function

**Multi-Channel Monitoring**:
- Parses `CHANNEL_ID` as comma-separated list
- Empty = monitors all channels
- Only tracks non-bot messages from configured channels
- Bot responds to mentions with AI-generated replies using full tool capabilities

**@ Mention Handling**:
- Async handler prevents blocking: `handleMentionAsync(message)`
- **Message deduplication**: Tracks processed message IDs to prevent duplicate responses (common Discord API issue)
- **Full slash command parity**: All tools available via @mentions (create pages, edit files, commit, set model, build games)
- Uses conversation history fetched from Discord API
- Responses automatically saved to `responses/` directory if >2000 chars
- **Commit filtering**: Only prompts for commits if AI changes actual code files (filters out `projectmetadata.json` updates)
- **Git timeout protection**: Git status checks have 5-second timeout to prevent hanging
- **Channel filter debugging**: Console logs `⚠️ [CHANNEL_FILTER]` when mentions are ignored due to channel ID mismatch

## Adding New Commands

1. Add `SlashCommandBuilder` to `commands` array
2. Add case to switch statement in `interactionCreate` handler
3. Create `async function handle{CommandName}(interaction)`
4. Use `getBotResponse()` for personality-consistent messages
5. Include live site URL in embeds: `https://bot.inference-arcade.com/`
6. Commands auto-register on bot restart (no manual deployment)

## Adding New AI Tools (for @mention parity)

To make functionality available via @mentions as well as slash commands:

1. Add tool definition to `personality/tools/toolCatalog.js` (single source of truth)
   - Add to `ALL_TOOLS` array with full JSON schema
   - Tool automatically exports via `.all`, `.editMode`, or `.routingAware` as needed
2. Add handler in the tool execution switch statement in `index.js` (~line 1640)
3. Create helper function (e.g., `async function myTool(args)`)
4. Update capability guidelines in `personality/core/capabilities.js` (high-level "what can I do")
5. Add usage guidelines to appropriate module:
   - File operations → `personality/tools/fileOperations.js`
   - Git operations → `personality/tools/gitOperations.js`
   - Search operations → `personality/tools/searchGuidelines.js`
6. Tools automatically become available to AI during @mention conversations

## Model Switching

The `MODEL` variable is mutable and can be changed at runtime:
```javascript
MODEL = MODEL_PRESETS[modelChoice];
```

Available presets (ZDR-compliant only):
- `glm` - GLM 4.7 (default)
- `kimi` - Kimi K2 Thinking (reasoning)
- `deepseek` - DeepSeek V3.1 Terminus
- `qwen` - Qwen 3 Coder (Alibaba)
- `mimo` - MiMo V2 Flash (Xiaomi)
- `minimax` - Minimax M2.1

**Note**: OpenAI models removed - they don't support Zero Data Retention on OpenRouter.

Changes apply immediately to all subsequent AI calls.

## Mobile & Styling

**Content Creation Guidelines** (Modular System):
- **Design System**: `personality/content/designSystem.js` - Noir theme, colors, typography, fonts
- **CSS Classes**: `personality/content/cssClasses.js` - Complete page-theme.css class reference
- **Mobile Patterns**: `personality/content/mobilePatterns.js` - Interaction patterns (D-pad vs direct-touch)
- **Page Structure**: `personality/content/pageStructure.js` - Required elements, layout hierarchy
- **Components**: `personality/content/components.js` - Reusable audio components

## Key Configuration Constants

**Performance Settings** (defined in `index.js`):
```javascript
const CONFIG = {
    FILE_READ_LIMIT: 5000,           // Max chars for file reading
    RESPONSE_LENGTH_LIMIT: 2000,     // Discord message limit
    RESPONSE_TRUNCATE_LENGTH: 1800,  // Truncate before limit
    AI_MAX_TOKENS: 10000,            // OpenRouter token limit
    AI_TEMPERATURE: 0.7,             // AI creativity setting
    GIT_TIMEOUT: 30000,              // Git operation timeout
    PUSH_TIMEOUT: 60000,             // Git push timeout
    API_TIMEOUT: 60000,              // API request timeout
    // Discord Context Settings
    DISCORD_FETCH_LIMIT: 5,          // Max messages to fetch per request
    DISCORD_CONTEXT_LIMIT: 5,        // Messages to include in LLM context
    DISCORD_CACHE_TTL: 60000,        // Cache duration (1 minute)
    INCLUDE_REACTIONS: true          // Add reaction data to context
};
```

**Error Prevention**: Error tracking (3 errors = 5min cooldown), git timeout protection, graceful fallbacks, response deduplication

## Key Development Patterns

**Discord**: Use `client.once('clientReady', ...)` for v15 compatibility
**Git**: Never embed GITHUB_TOKEN permanently, use only during push operations
**Files**: Use hyphens for page names (`amtrak-journey.html`), verify completeness after git operations
**Edits**: Files can only be edited once per conversation to prevent expensive repeated operations
**Reusable Components**: When implementing a feature that could benefit other pages (audio, TTS, animations, UI patterns), ask if it should be made into a reusable component in `src/audio/` or similar. Only ask when the feature is genuinely reusable - not for one-off page-specific logic.

## Important Dependencies

- **discord.js v14**: Discord bot framework
- **@octokit/rest**: GitHub API integration
- **simple-git**: Git operations
- **axios + axios-retry**: HTTP requests with retry logic
- **dotenv**: Environment variable management
- **express + socket.io**: GUI dashboard server and real-time updates
- **nodemon** (dev): Auto-restart during development

## 🖥️ GUI Dashboard System

**Real-time Monitoring**: WebSocket dashboard at http://localhost:3001 (starts with `./run-bot.sh`)
**Panels**: System Logs, Tool Calls, File Changes, Agent Loops
**Features**: 1000 entry cap per panel, real-time updates, auto-scroll
**Disable**: Use `--no-gui` flag or `NO_GUI=true`

## 🧪 Testing & Verification

**No formal test suite** - validation is done via runtime checks and manual testing.

### Quick Syntax Check
```bash
node --check index.js
```

### Parallel Tool Calls Verification
The bot parallelizes read-only tool execution for efficiency. To verify:

1. **Check logs for parallel execution**:
   ```
   [LLM] Parallel execution: 3 read-only tools
   ```

2. **Test with multi-read request** (via Discord @mention):
   ```
   @Bot Sportello read the contents of snake.html, tetris.html, and memory-match.html
   ```
   - Should show "Parallel execution: 3 read-only tools" in console
   - All three reads execute concurrently (~200ms total vs ~600ms sequential)

3. **Read-only tools** (parallelized): `list_files`, `file_exists`, `search_files`, `read_file`, `get_repo_status`, `git_log`, `web_search`, `deep_research`

4. **Write tools** (sequential): `write_file`, `edit_file`, `delete_file`, `move_file`, `commit_changes`, `set_model`

### PostgreSQL Log Verification
```bash
# Check recent tool calls with timing
source .env && psql "$DATABASE_URL" -c "SELECT tool_name, to_char(timestamp, 'HH24:MI:SS.MS') as time, SUBSTRING(arguments::text FROM 1 FOR 100) as args FROM tool_calls WHERE timestamp > NOW() - INTERVAL '1 hour' ORDER BY timestamp DESC LIMIT 20;"
```

