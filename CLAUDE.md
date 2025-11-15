# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bot Sportello is a Discord bot with a laid-back Doc Sportello personality that manages a web development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered content generation through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage web pages and JavaScript libraries through Discord commands while maintaining a chill, slightly spacey but helpful personality. All generated projects use a retro arcade aesthetic with mobile-responsive design.

**Live Site**: https://milwrite.github.io/javabot/
**Repository**: https://github.com/milwrite/javabot/

**Key Features**:
- AI-generated HTML pages & JavaScript features using OpenRouter
- Automatic GitHub commits and deployment to GitHub Pages
- Conversation memory (last 100 messages in `agents.md`)
- Retro arcade design system with Press Start 2P font
- Mobile-first responsive design (768px, 480px breakpoints, 44px touch targets)

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (with auto-restart)
npm run dev

# Run in production mode
npm start
```

**No testing, linting, or build commands** - This project uses direct Node.js execution without build steps or formal testing frameworks.

**Restarting the bot**: After making changes to `index.js`, restart the bot process to reload slash commands and apply code changes.

**Environment Setup**:
- Copy `.env.example` to `.env` before first run
- All required environment variables must be present or bot will exit with error message
- Bot validates all `REQUIRED_ENV_VARS` on startup (see index.js:11-26)

## Architecture Overview

### Single-File Architecture
The entire bot is contained in `index.js` (~2000+ lines) with these key sections in order:
1. Environment configuration and imports (lines 1-27)
2. Configuration constants in `CONFIG` object (lines 29-41)
3. Error tracking system (prevents infinite error loops, lines 43-70)
4. Message history tracking setup (lines 72-76)
5. Channel ID parsing for multi-channel support (lines 77-80)
6. Discord client and GitHub (Octokit + simple-git) setup (lines 82-95)
7. Git timeout wrapper and logging utilities
8. OpenRouter configuration with model presets
9. Bot personality system (`botResponses`, `SYSTEM_PROMPT`)
10. Conversation history management (`agents.md` file operations)
11. Filesystem tools (list/read/write/edit files)
12. Web search functionality
13. Enhanced LLM with function calling (agentic loop, max 10 iterations)
14. Slash command definitions array
15. Command handlers (one `handle*` function per command)
16. Message tracking, @ mention responses, and bot ready event

**File Organization**:
- `/src/` - All generated HTML pages, JS features, and demos
- `/responses/` - AI responses >2000 chars saved with timestamps
- `agents.md` - Conversation history (last 100 messages)
- `index.html` - Main hub page with embedded CSS (no longer uses style.css)
- `page-theme.css` - Shared arcade theme for all /src/ pages
- `projectmetadata.json` - Project metadata (icon, description) loaded dynamically by index.html

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
- Swappable models via `MODEL_PRESETS` (2025 latest models)
- Default: `anthropic/claude-haiku-4.5`
- Available: Claude Haiku/Sonnet 4.5, Kimi K2, GPT-5 Nano, Gemini 2.5
- Function calling support (filesystem tools, web search)
- 10,000 token output limit for detailed responses
- Conversation history from `agents.md` (100 messages max)

**Arcade Frontend Styling**:
- **Main arcade page**: `index.html` with embedded CSS (self-contained, no external stylesheet)
- **Individual pages**: Link to `page-theme.css` (shared arcade theme for all /src/ pages)
- **Current theme**: Soft Arcade (mint green #7dd3a0, dark blue-gray background)
- **Typography**: Press Start 2P font from Google Fonts (retro pixel aesthetic)
- **Visual effects**: Simple gradient background on main page, grid + scanlines on individual pages
- **Project discovery**: `index.html` dynamically loads projects from `projectmetadata.json`
- **Navigation**: All pages include styled home button linking back to index.html
- **Theme consistency**: Both index.html and page-theme.css use matching color palette

**Project Metadata System**:
- **Location**: `projectmetadata.json` (separate file, loaded via fetch)
- **Structure**: `{ "page-name": { "icon": "🎮", "description": "Page description" } }`
- **Auto-update**: `updateIndexWithPage()` function adds new pages to projectmetadata.json
- **Icon selection**: `getIconForDescription()` auto-assigns emoji based on keywords in description
- **Fallback**: Pages without metadata display with default 🌐 icon and "Interactive web project" description
- **Dynamic loading**: index.html fetches projectmetadata.json on page load and generates cards

### Available Slash Commands

| Command | Handler | Purpose |
|---------|---------|---------|
| `/commit <message> [files]` | `handleCommit` | Git add, commit, push to main |
| `/add-page <name> <description>` | `handleAddPage` | Generate self-contained HTML page |
| `/add-feature <name> <description>` | `handleAddFeature` | Generate JS feature/component + demo |
| `/status` | `handleStatus` | Show repo status + live site link |
| `/chat <message>` | `handleChat` | AI conversation with context |
| `/search <query>` | `handleSearch` | Web search via OpenRouter |
| `/set-model <model>` | `handleSetModel` | Switch AI model at runtime |
| `/set-prompt <action> [content]` | `handleSetPrompt` | Modify bot personality/system prompt at runtime |
| `/update-style <preset> [description]` | `handleUpdateStyle` | Update website styling with presets or AI-generated custom CSS |
| `/poll <question>` | `handlePoll` | Yes/no poll with reactions |

### AI Function Calling System

The bot uses OpenRouter's function calling with an **agentic loop** to give the AI autonomous multi-step capabilities:

**Filesystem Tools**:
- `list_files(path)` - Recursively list all files with paths, types, sizes organized by category (HTML, CSS, JS, JSON). Automatically discovers subdirectories.
- `read_file(path)` - Read file contents (5000 char limit)
- `write_file(path, content)` - Create/update files completely
- `edit_file(path, instructions)` - Edit existing files using AI with natural language instructions (e.g., "change background to blue", "fix syntax error", "add new function")

**Web Search**:
- `web_search(query)` - Search internet for current information
- Automatically triggered for questions about "latest", "recent", "current"
- Used for documentation, library versions, news

**Agentic Loop (Multi-Step Execution)**:
- AI can chain multiple tool calls across iterations (max 10 rounds)
- Example flow: read file → edit based on contents → commit changes
- Tools remain available after each step, enabling complex multi-step tasks
- Console logs show iteration count and tools used per step
- Safety limit prevents infinite loops

**Response Handling**:
- Long responses (>2000 chars) saved to `responses/` directory
- Discord shows truncated version with file path
- Applies to chat, search, and mention responses

### Content Generation Flow

**`/add-page`**:
1. User provides name + description
2. AI generates HTML that links to `page-theme.css` (shared arcade theme)
3. Prompt specifies: arcade colors, Press Start 2P font, CSS classes to use
4. Home link with `.home-link` class automatically included
5. File saved to `src/{name}.html` and added to `projectmetadata.json`
6. Live URL shown in Discord embed

**`/add-feature`**:
1. User provides feature name + description of what it should do
2. First AI call: Generate `.js` file (library, component, utility, etc.)
3. Second AI call: Generate demo HTML that links to `page-theme.css`
4. Both files saved to `src/` directory and metadata updated
5. Live demo URL shown in Discord embed
6. Flexible enough for libraries, UI components, interactive elements, utilities

**Styling Consistency**:
- All new pages link to `page-theme.css` for uniform arcade aesthetic
- Prompts specify arcade color palette: mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32)
- Available CSS classes: `.container`, `.card`, `.btn`, `.panel`, `.home-link`, etc.
- Prompts optimized for token efficiency with inline examples

**`/update-style`**:
1. User selects preset or "Custom" with description
2. Built-in presets stored in `stylePresets` object:
   - `soft-arcade` - Current style (mint green, dark blue-gray)
   - `neon-arcade` - Intense bright green with animations
   - `dark-minimal` - Clean modern dark theme
   - `retro-terminal` - Classic green terminal style
3. For custom: AI generates complete CSS based on description
4. Updates embedded CSS in `index.html`, commits, pushes to GitHub
5. Shows confirmation with live site link

**Note**: This command was originally designed to update `style.css`, but now modifies the embedded CSS in `index.html` directly since the main page is self-contained.

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

**`agents.md` File**:
- Stores last 100 messages from tracked channels
- Format: timestamp, username, message, isBot flag
- Updated via `addToHistory()` and `updateAgentsFile()`
- Provides context for `/chat` command
- Shows last 50 messages in file, uses last 50 for AI context

**Multi-Channel Monitoring**:
- Parses `CHANNEL_ID` as comma-separated list
- Empty = monitors all channels
- Only tracks non-bot messages from configured channels
- Bot responds to mentions with AI-generated replies using full tool capabilities

**@ Mention Handling**:
- Async handler prevents blocking: `handleMentionAsync(message)`
- **Message deduplication**: Tracks processed message IDs to prevent duplicate responses (common Discord API issue)
- Full AI tool access: can create pages, edit files, search web, commit changes
- Uses conversation history from `agents.md` for context
- Debounced file writes (5 second delay) to prevent excessive I/O
- Responses automatically saved to `responses/` directory if >2000 chars
- **Commit filtering**: Only prompts for commits if AI changes actual code files (filters out `agents.md` and `projectmetadata.json` updates)
- **Git timeout protection**: Git status checks have 5-second timeout to prevent hanging

## Adding New Commands

1. Add `SlashCommandBuilder` to `commands` array
2. Add case to switch statement in `interactionCreate` handler
3. Create `async function handle{CommandName}(interaction)`
4. Use `getBotResponse()` for personality-consistent messages
5. Include live site URL in embeds: `https://milwrite.github.io/javabot/`
6. Commands auto-register on bot restart (no manual deployment)

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

Available presets (2025 models):
- `haiku` - Claude Haiku 4.5 (fast, cheap)
- `sonnet` - Claude Sonnet 4.5 (balanced)
- `kimi` - Kimi K2 Thinking (reasoning)
- `gpt5` - GPT-5 Nano (latest OpenAI)
- `gemini` - Gemini 2.5 Flash Lite (Google)

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

### Game-Specific Mobile Patterns

**For Canvas Games** (like Frogger, Snake):
```css
canvas {
    max-width: 100%;
    height: auto;
    display: block;
}

@media (max-width: 768px) {
    canvas {
        max-width: 95vw;
        max-height: 60vh;
    }
}

/* Mobile touch controls */
.mobile-controls {
    display: none;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

@media (max-width: 768px) {
    .mobile-controls { display: grid; }
}
```

**For Grid Games** (like Sudoku):
```css
.game-grid {
    max-width: 100%;
    aspect-ratio: 1;
}

@media (max-width: 768px) {
    .game-grid {
        max-width: 90vw;
        gap: 1px; /* Tighter gaps on mobile */
    }
    .cell {
        font-size: 12px;
        min-height: 30px;
    }
}
```

### Common Anti-Patterns to AVOID

❌ **Never use**: `overflow: hidden` on body (prevents scrolling)  
❌ **Never use**: Fixed widths without max-width fallbacks  
❌ **Never use**: Touch targets smaller than 44px  
❌ **Never use**: Viewport-breaking fixed positioning  

✅ **Always use**: `overflow-x: auto; overflow-y: auto` for scrollability  
✅ **Always use**: Responsive units (vw, vh, %, em, rem)  
✅ **Always use**: Flexible layouts (flexbox, grid with auto-fit)  

### Page Layout Standards

**Consistent Mobile Structure**:
```css
body {
    min-height: 100vh;
    overflow-x: auto;
    overflow-y: auto;
    padding: 10px;
}

.container, .game-container {
    max-width: 100%;
    margin: 0 auto;
    padding-bottom: 50px; /* Space for scrolling */
}

@media (max-width: 768px) {
    body { 
        align-items: flex-start; /* Top-align on mobile */
        padding-top: 80px; /* Space for home button */
    }
}
```

### Implementation Checklist

When creating or updating any page, the bot MUST verify:

- [ ] Viewport meta tag present
- [ ] Body has proper overflow settings (auto, not hidden)
- [ ] Mobile breakpoints at 768px and 480px minimum
- [ ] All buttons/inputs minimum 44px touch targets
- [ ] Content scrollable on mobile without horizontal overflow
- [ ] Text readable at mobile sizes (minimum 14px)
- [ ] Home button doesn't interfere with content on mobile
- [ ] Games have mobile controls if needed
- [ ] Consistent spacing and padding patterns

The bot should reference `frogger.html` and `sudoku.html` as exemplary implementations of mobile responsiveness.

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
};
```

**Error Prevention & Performance**:
- Error tracking prevents infinite loops (3 errors = 5min cooldown)
- Automatic cleanup of error tracking entries every 5 minutes
- All git operations wrapped with timeout protection (5-30 seconds depending on operation)
- Graceful fallbacks for failed Discord interactions
- Memory optimizations: aggressive message history pruning, garbage collection triggers
- Efficient logging system with development-only details
- Response deduplication prevents "Bot Sportello: Bot Sportello:" patterns
- Message deduplication in mention handler prevents duplicate responses from Discord API glitches

## Critical Bug Fixes & Lessons Learned

**Discord.js Event Names**:
- Use `client.once('ready', ...)` NOT `client.once('clientReady', ...)`
- The `clientReady` event name is deprecated and causes bot startup hangs
- Discord.js v14 uses `'ready'`, v15 will rename to `'clientReady'`

**iCloud Drive Corruption**:
- **Never run the bot from an iCloud-synced directory** (e.g., ~/Desktop on macOS)
- iCloud offloads .git files causing "Stale NFS file handle" errors and git hangs
- Symptoms: git operations timeout, "dataless" file attributes, Operation timed out errors
- Solution: Move project to non-iCloud location (e.g., ~/projects/)

**Git Remote URL Management**:
- Never embed GITHUB_TOKEN in git remote URL permanently
- Use token only during push operations, then remove: `git remote set-url origin https://github.com/...`
- Embedded tokens in .git/config can cause authentication issues and security risks

**Mention Handler Deduplication**:
- Discord's messageCreate event can fire twice for same message (network issues, API quirks)
- Always track processed message IDs in a Set to prevent duplicate AI responses
- Clean up old IDs periodically to prevent memory leaks (keep last 100)

## Important Dependencies

- **discord.js v14**: Discord bot framework
- **@octokit/rest**: GitHub API integration
- **simple-git**: Git operations
- **axios + axios-retry**: HTTP requests with retry logic
- **dotenv**: Environment variable management
- **nodemon** (dev): Auto-restart during development
