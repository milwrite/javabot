# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bot Sportello is a Discord bot with a laid-back Doc Sportello personality that manages a web development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered content generation through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage web pages and JavaScript libraries through Discord commands while maintaining a chill, slightly spacey but helpful personality. All generated projects use a noir terminal aesthetic with mobile-first responsive design.

**Live Site**: https://bot.inference-arcade.com/
**Repository**: https://github.com/milwrite/javabot/

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
- Creating new pages (`/add-page`, `create_page()`)
- Adding features (`/add-feature`, `create_feature()`) 
- Editing files (`edit_file()` function)
- Building games (`/build-game`, `build_game()`)
- Manual commits (`/commit`, `commit_changes()`)

**Authentication**: The bot uses `getEncodedRemoteUrl()` which formats URLs as:
```
https://milwrite:TOKEN@github.com/milwrite/javabot.git
```
This function properly encodes the GitHub token and uses `milwrite` as the username for authentication.

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

## Architecture Overview

### Single-File Architecture
The entire bot is contained in `index.js` (~3700+ lines) with these key sections in order:
1. Environment configuration and imports (lines 1-27)
2. Configuration constants in `CONFIG` object (lines 29-41)
3. Error tracking system (prevents infinite error loops, lines 43-70)
4. Message history tracking setup (lines 72-87)
5. Channel ID parsing for multi-channel support (lines 89-92)
6. Discord client and GitHub (Octokit + simple-git) setup (lines 94-108)
7. Git timeout wrapper and logging utilities
8. OpenRouter configuration with model presets (~line 139)
9. Bot personality system (`botResponses`, `SYSTEM_PROMPT`) (~line 150-290)
10. Discord context manager (direct API fetching, replaces agents.md)
11. Filesystem tools (list/read/write/edit files) (~line 715-870)
12. Content creation tools (create_page, create_feature) (~line 870-1320)
13. Web search and configuration tools (set_model, update_style, build_game) (~line 1322-1450)
14. Enhanced LLM with function calling (agentic loop, max 10 iterations) (~line 1452-1700)
15. Slash command definitions array (~line 1770)
16. Command handlers (one `handle*` function per command) (~line 2260+)
17. Message tracking, @ mention responses, and bot ready event (~line 2143+)

**File Organization**:
- `/src/` - All generated HTML pages, JS features, and demos
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

### Key Integrations

**Discord API**: discord.js v14 with slash commands
- Intents: Guilds, GuildMessages, GuildMessageReactions, MessageContent
- Commands automatically register on bot startup via REST API
- Error handling prevents spam loops (3 errors = 5min cooldown)
- All interactions use `deferReply()` except `/poll`
- Multi-channel support via comma-separated `CHANNEL_ID` env var

**GitHub Integration**:
- simple-git for local operations (add, commit, push)
- Octokit for GitHub API interactions
- All commits push to `main` branch automatically
- Dynamic branch detection via `git.status().current`
- Token authentication configured at runtime

**OpenRouter AI Integration**:
- **Zero Data Retention (ZDR) ENFORCED** - all requests use `provider.data_collection: 'deny'`
- Only ZDR-compliant models allowed (no OpenAI - they don't support ZDR on OpenRouter)
- Swappable models via `MODEL_PRESETS` (ZDR-compliant only)
- Default: `anthropic/claude-haiku-4.5`
- Available: Claude Haiku/Sonnet 4.5, Kimi K2, Gemini 2.5, GLM 4.6
- Function calling support (filesystem tools, web search)
- 10,000 token output limit for detailed responses
- Automatic 402 error recovery (reduces max_tokens when credits low)
- Automatic 500 error fallback (switches to alternate ZDR model after 2 failures)
- Conversation history fetched from Discord API (20 messages with reactions)

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
- **Navigation**: All pages include standardized home link (`<a class="home-link" href="../index.html">← HOME</a>`)
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
| **Discord API** | Conversation context (direct from channel) | Fetched via channel.messages.fetch() | 60-second cache; 20 messages with reactions |
| **build-logs/{id}.json** | Per-build pipeline execution logs | JSON array with stages, plans, test results | One per build; kept for history |
| **responses/{timestamp}.txt** | Long responses >2000 chars (Discord limit) | Text with timestamp header | One per response; kept for audit trail |
| **session-logs/*.json/.md** | Bot session reports (failure/success analysis) | JSON + Markdown summaries | One per bot session run; via run-bot.sh |
| **gui-run-logs/*.json** | GUI dashboard history (real-time events) | Serialized panel state | Per-run; cleared on new session |
| **issues/*.md** | Bug reports and fix documentation | Markdown with symptoms, root cause, fix | Per-issue; tracked in git for project history |
| **index.html** | Main page (project hub) | HTML with embedded CSS | Persistent; manually edited theme |
| **page-theme.css** | Shared noir styling (all pages) | CSS with color vars + mobile breakpoints | Persistent; theme source of truth |
| **/src/*.html** | Generated pages (games, pages, features) | Self-contained HTML + inline CSS/JS | Created by `/add-page`, `/build-game`, etc. |

### Available Slash Commands

| Command | Handler | Purpose |
|---------|---------|---------|
| `/commit <message> [files]` | `handleCommit` | Git add, commit, push to main |
| `/add-page <name> <description>` | `handleAddPage` | Generate self-contained HTML page |
| `/add-feature <name> <description>` | `handleAddFeature` | Generate JS feature/component + demo |
| `/build-game <title> <prompt> [type]` | `handleBuildGame` | **NEW**: AI-driven game pipeline (Architect→Builder→Tester→Scribe) |
| `/status` | `handleStatus` | Show repo status + live site link |
| `/chat <message>` | `handleChat` | AI conversation with context |
| `/search <query>` | `handleSearch` | Web search via OpenRouter |
| `/set-model <model>` | `handleSetModel` | Switch AI model at runtime |
| `/set-prompt <action> [content]` | `handleSetPrompt` | Modify bot personality/system prompt at runtime |
| `/update-style <preset> [description]` | `handleUpdateStyle` | Update website styling with presets or AI-generated custom CSS |
| `/poll <question>` | `handlePoll` | Yes/no poll with reactions |

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
- `edit_file(path, old_string, new_string, instructions)` - Edit existing files via exact string replacement (FAST, preferred) or AI instructions (SLOW, fallback)
  * **Exact mode** (preferred): Provide `old_string` and `new_string` for deterministic replacement (~0.1s)
  * **AI mode** (fallback): Provide `instructions` for complex multi-location edits (~3-5s)
  * Must use EXACT string from file including all whitespace/indentation
  * String must be unique in file (or provide more context to make it unique)

**Content Creation Tools**:
- `create_page(name, description)` - Generate and deploy a new HTML page (equivalent to `/add-page`)
- `create_feature(name, description)` - Generate JS library + demo page (equivalent to `/add-feature`)
- `build_game(title, prompt, type)` - Full game pipeline with testing (equivalent to `/build-game`)

**Repository Tools**:
- `commit_changes(message, files)` - Git add, commit, push to main (equivalent to `/commit`)
- `get_repo_status()` - Check current git status (equivalent to `/status`)

**Configuration Tools**:
- `set_model(model)` - Switch AI model: haiku, sonnet, kimi, gpt5, gemini (equivalent to `/set-model`)
- `update_style(preset, description)` - Change website theme (equivalent to `/update-style`)

**Web Search**:
- `web_search(query)` - Search internet for current information (via Perplexity Sonar)
- Automatically triggered for questions about "latest", "recent", "current"

**Agentic Loop (Multi-Step Execution)**:
- AI can chain multiple tool calls across iterations (max 10 rounds)
- Example flow: read file → edit based on contents → commit changes
- Tools remain available after each step, enabling complex multi-step tasks
- Console logs show iteration count and tools used per step
- Safety limit prevents infinite loops
- **Redundant edit prevention**: Files can only be edited once per conversation to prevent slow repeated edits

**Response Handling**:
- Long responses (>2000 chars) saved to `responses/` directory
- Discord shows truncated version with file path
- Applies to chat, search, and mention responses

### Content Generation Flow

**`/add-page`**:
1. User provides name + description
2. AI generates HTML that links to `page-theme.css` (shared noir terminal theme)
3. Prompt specifies: noir terminal colors, Courier Prime font, CSS classes to use
4. Home link with `.home-link` class automatically included
5. Mobile-responsive with touch controls for games
6. **Layout hierarchy enforced**: Canvas → Controls → Start Button → Instructions
7. **Economical spacing**: Tight margins (5-8px), smaller start buttons (0.85-0.95em)
8. File saved to `src/{name}.html` and added to `projectmetadata.json`
9. Live URL shown in Discord embed

**`/add-feature`**:
1. User provides feature name + description of what it should do
2. First AI call: Generate `.js` file (library, component, utility, etc.)
3. Second AI call: Generate demo HTML that links to `page-theme.css`
4. Both files saved to `src/` directory and metadata updated
5. Live demo URL shown in Discord embed
6. Flexible enough for libraries, UI components, interactive elements, utilities

**Styling Consistency**:
- All new pages link to `page-theme.css` for uniform noir terminal aesthetic
- Color palette: terminal green (#00ff41), red (#ff0000), cyan (#00ffff), black (#0a0a0a)
- Available CSS classes: `.container`, `.card`, `.btn`, `.panel`, `.home-link`, `.mobile-controls`, etc.
- Games MUST include `.mobile-controls` with touch buttons (Discord is mobile-forward)
- **Economical design**: Small start buttons, tight spacing (5-8px margins)
- **Layout hierarchy**: Controls → Start → Instructions (always in this order)
- Prompts optimized for token efficiency with inline examples

**`/update-style`**: Updates website theme with presets (noir-terminal, neon-arcade, dark-minimal, retro-terminal) or AI-generated custom CSS. Modifies embedded CSS in `index.html`.

**Bot Sportello Narrator (TTS Component)**:
When generating story pages or content that should be read aloud, use the reusable TTS component:

```html
<!-- Add container where you want controls to appear -->
<div id="narrator-controls"></div>

<!-- Include the narrator script -->
<script src="sportello-narrator.js"></script>

<!-- Initialize with options -->
<script>
SportelloNarrator.init({
    voice: 'Ralph',           // Bot Sportello's voice (Ralph only)
    selector: '.paragraph',   // CSS selector for text to read
    titleSelector: '.chapter-title',  // Optional: chapter titles
    rate: 0.85,              // Speech rate (slower for noir atmosphere)
    pitch: 0.9,              // Slightly deeper pitch
    narratorName: 'Bot Sportello'  // Display name in controls
});
</script>
```

- Located at `src/sportello-narrator.js`
- Auto-injects noir-styled control panel CSS
- Uses Ralph voice exclusively (Bot Sportello's voice)
- Includes play/pause/stop, voice selector, reading progress
- Highlights current paragraph with red left-border
- Mobile-responsive controls

### Doc Sportello Personality System

**Response Categories** (`botResponses` object):
- `confirmations` - "yeah man, i got you..."
- `errors` - "oh... yeah something went sideways there"
- `success` - "nice, that worked out pretty smooth"
- `thinking` - "let me think about this for a sec..."

**System Prompt** (`SYSTEM_PROMPT`):
- **Mutable at runtime** via `/set-prompt` command (view, reset, add, replace)
- Defines laid-back, slightly spacey personality
- Lists available capabilities (file ops, web search, git)
- Instructs AI when to use each tool
- Mandates short responses (1-2 sentences)
- Always links to live site when sharing pages
- Includes optimization to prevent "Bot Sportello:" name duplication

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
- Fetches last 20 messages directly from Discord API via `channel.messages.fetch()`
- Includes reaction data for community sentiment awareness: `[reactions: 👍(3) ❤️(1)]`
- 60-second cache per channel prevents rate limiting
- Context fetched on bot startup for immediate availability after restart
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

1. Add tool definition to `tools` array in `getLLMResponse()` (~line 1500)
2. Add handler in the tool execution switch statement (~line 1640)
3. Create helper function (e.g., `async function myTool(args)`)
4. Update SYSTEM_PROMPT's "AVAILABLE CAPABILITIES" section
5. Tools automatically become available to AI during @mention conversations

## Recent Updates & Style Consistency (Dec 2025)

**Comprehensive Style Unification**:
All 45 HTML pages in `/src/` have been unified to use consistent noir terminal aesthetic:
- Fixed 2 broken CSS paths (missing `../` relative path)
- Converted 5 purple gradient files to noir palette
- Converted 2 green theme games to noir colors
- Converted 4 custom-themed files to noir aesthetic
- Standardized all 43 home links to: `<a class="home-link" href="../index.html">← HOME</a>`
- Added missing CSS links to page-theme.css (10 files)
- Ensured all files use Courier Prime font for consistency

**Design System Enforcement**:
When generating new pages, AI must enforce:
1. Link to `../page-theme.css` as primary stylesheet
2. Courier Prime font as standard (no custom fonts unless specifically requested)
3. Noir color palette only (red #ff0000, cyan #00ffff, light blue #7ec8e3, black #0a0a0a)
4. Standard home link pattern with "← HOME" text
5. Conservative CSS approach: only component-specific overrides in embedded `<style>` tags

**Future Maintenance**:
- Do NOT add new color schemes or fonts without updating all 45 existing pages
- Any style changes to `page-theme.css` automatically apply across entire site
- Broken CSS links or custom fonts are now considered technical debt

## Key Development Patterns

**Git Operations**:
- Always push to main after commit
- Use `interaction.editReply()` for progress updates
- Lowercase commit messages without attribution
- Check `git.status()` before operations

**AI Content Generation**:
- Optimize prompts for token efficiency
- Clean markdown code blocks from responses
- Inject home link fallback if AI doesn't include it
- Use template literals for HTML generation

**Discord Embeds**:
- Always include live site URLs
- Use themed colors (purple for pages, orange for functions, red for model)
- Show timestamp on all embeds
- Use Doc Sportello responses in descriptions

**File Operations**:
- All generated content goes to `src/` directory
- Create directories with `{ recursive: true }`
- Long responses saved to `responses/` directory with timestamps

## Model Switching

The `MODEL` variable is mutable and can be changed at runtime:
```javascript
MODEL = MODEL_PRESETS[modelChoice];
```

Available presets (ZDR-compliant only):
- `haiku` - Claude Haiku 4.5 (fast, cheap)
- `sonnet` - Claude Sonnet 4.5 (balanced)
- `kimi` - Kimi K2 Thinking (reasoning)
- `gemini` - Gemini 2.5 Pro (Google)
- `glm` - GLM 4.6 (Z-AI)

**Note**: OpenAI models removed - they don't support Zero Data Retention on OpenRouter.

Changes apply immediately to all subsequent AI calls.

## Mobile Responsiveness Standards

**CRITICAL**: All pages must be mobile-responsive and fully scrollable. The bot MUST implement these patterns consistently:

### Required Mobile Features

**1. Viewport and Overflow Settings**:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```
```css
body {
    overflow-x: auto;
    overflow-y: auto;
    padding: 20px; /* or appropriate mobile padding */
}
```

**2. Mobile Breakpoints (MANDATORY)**:
```css
@media (max-width: 768px) {
    /* Tablet/mobile landscape */
    body { padding: 10px; }
    .container { max-width: 100%; }
    /* Touch targets minimum 44px */
    .btn, .control-btn, .number-btn { min-height: 44px; }
}

@media (max-width: 480px) {
    /* Mobile portrait */
    body { padding: 5px; }
    /* Smaller text and spacing */
    h1 { font-size: 1.8em; }
}
```

**3. Touch-Friendly Interactions**:
- All buttons minimum 44px height/width for accessibility
- Form inputs minimum 44px height
- Adequate spacing between clickable elements (minimum 8px gap)
- No hover-only functionality (provide tap alternatives)

### Mobile Control Implementation (CRITICAL)

**Preventing Zoom on Button Tap** - Mobile Safari/Chrome zoom when buttons are tapped rapidly. Fix with:

```css
.mobile-btn, .control-btn, .aim-btn {
    touch-action: manipulation;  /* PREVENTS ZOOM */
    -webkit-tap-highlight-color: transparent;
    min-height: 50px;
    min-width: 50px;
    font-size: 20px;  /* Readable arrows */
}
```

**JavaScript Event Handlers** - Use `touchstart` with `preventDefault`, not just `click`:

```javascript
// CORRECT: touchstart with preventDefault prevents zoom
btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleInput();
}, { passive: false });

// Add click as fallback for desktop
btn.addEventListener('click', (e) => {
    e.preventDefault();
    handleInput();
});
```

**Control Positioning** - Place mobile controls DIRECTLY below canvas, before other content.

### UI Layout Hierarchy for Games (CRITICAL)

**MANDATORY Element Order**: All game pages MUST follow this exact structure for optimal mobile UX:

```
1. Title/Header (compact, minimal)
2. Game Canvas/Play Area
3. Mobile Controls (d-pad, joystick, etc.)
4. Start/Action Buttons (smaller, economical)
5. Instructions/How to Play
6. Additional Info (stats, legend - only if essential)
```

**Key Principles**:
- **Controls above start button**: Mobile controls must be immediately visible with the canvas
- **Start button above instructions**: Don't make users scroll past instructions to start playing
- **Economical spacing**: Use tight margins (5-8px) instead of generous spacing (15-20px)
- **Above-the-fold priority**: Canvas + controls must be visible without scrolling on mobile
- **Remove unnecessary text**: If stats/legend interfere with visibility, move them below or remove them

**Start Button Sizing** - Keep start buttons compact and unobtrusive:
```css
.start-btn, .action-btn {
    font-size: 0.85em - 0.95em;  /* Smaller than previous 1.2-1.3em */
    padding: 8px 20px;            /* Reduced from 12-15px */
    min-height: 44px;             /* Maintain touch target */
}
```

**Bad Example** (old pattern):
```html
<!-- DON'T DO THIS -->
<canvas></canvas>
<div class="instructions">Long how to play...</div>
<div class="mobile-controls"></div>
<button class="start-btn">START</button>  <!-- Too far down! -->
```

**Good Example** (current standard):
```html
<!-- DO THIS -->
<h1>Game Title</h1>
<canvas></canvas>
<div class="mobile-controls"></div>
<button class="start-btn">START</button>  <!-- Immediately accessible -->
<div class="instructions">How to play...</div>
```

**Spacing Economy** - Reduce margins throughout:
```css
/* BEFORE: Too spacious */
.game-header { margin-bottom: 20px; }
.message-box { padding: 15px; margin: 15px 0; }

/* AFTER: Economical */
.game-header { margin-bottom: 8px; }
.message-box { padding: 8px; margin: 5px 0; }
```

### Standard Mobile D-Pad Controls

**Standard Pattern**: 3x3 grid with directional arrows, 140px max-width, touch-optimized buttons with `touch-action: manipulation`. Use for all directional games (snake, maze, etc.).

### Game-Specific Mobile Patterns

**Canvas Games**: Max-width 95vw on mobile, responsive height  
**Grid Games**: Max-width 90vw, tighter gaps, smaller fonts on mobile

### Mobile Requirements Summary

**Required**: Viewport meta, responsive breakpoints (@768px, @480px), 44px+ touch targets, scrollable content
**Avoid**: `overflow: hidden`, fixed widths without fallbacks, sub-44px touch targets  
**Layout Order**: Canvas → Controls → Start Button → Instructions

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
    DISCORD_FETCH_LIMIT: 20,         // Max messages to fetch per request
    DISCORD_CONTEXT_LIMIT: 20,       // Messages to include in LLM context
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

## Architecture Notes

**Single-File Design**: `index.js` (~6,585 lines) contains all bot logic for simplicity and easy understanding

**Known Issues**:
- Tool API mismatches (camelCase vs snake_case)
- Duplication across edit vs normal loops
- No automated testing (uses runtime validation instead)
- Unbounded growth in `responses/` directory

**Design Rationale**: Prioritizes rapid iteration and observability over perfect separation of concerns
