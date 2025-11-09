# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bot Sportello is a Discord bot with a laid-back Doc Sportello personality that manages a web development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered content generation through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage web pages and JavaScript libraries through Discord commands while maintaining a chill, slightly spacey but helpful personality.

**Live Site**: https://milwrite.github.io/javabot/
**Repository**: https://github.com/milwrite/javabot/

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

## Architecture Overview

### Single-File Architecture
The entire bot is contained in `index.js` (~2536 lines) with these key sections in order:
1. Environment configuration and imports
2. Error tracking system (prevents infinite error loops)
3. OpenRouter configuration with model presets
4. Discord client setup with specific intents
5. GitHub integration (Octokit + simple-git)
6. Bot personality system (`botResponses`, `SYSTEM_PROMPT`)
7. Message history tracking (`agents.md`)
8. Filesystem tools (list/read/write files)
9. Web search functionality
10. Enhanced LLM with function calling (tool use)
11. Slash command definitions array
12. Command handlers (one `handle*` function per command)
13. Message tracking and mention responses

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
- **Main arcade page**: `index.html` + `style.css` (homepage styling)
- **Individual pages**: Link to `page-theme.css` (shared arcade theme for all pages)
- **Current theme**: Soft Arcade (mint green #7dd3a0, dark blue-gray background)
- **Typography**: Press Start 2P font from Google Fonts (retro pixel aesthetic)
- **Visual effects**: Subtle grid background with scanlines overlay
- **Project discovery**: `index.html` loads projects from `projectmetadata.json`
- **Navigation**: All pages include styled home button linking back to arcade
- **Theme updates**: `/update-style` command updates `style.css` (homepage only)
- **Consistency**: New pages automatically use `page-theme.css` for uniform styling

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
| `/update-style <preset> [description]` | `handleUpdateStyle` | Update website styling with presets or AI-generated custom CSS |
| `/sync-index` | `handleSyncIndex` | Sync projectmetadata.json with all HTML files in /src |
| `/poll <question>` | `handlePoll` | Yes/no poll with reactions |

### AI Function Calling System

The bot uses OpenRouter's function calling to give the AI autonomous access to:

**Filesystem Tools**:
- `list_files(path)` - List files in repository directories
- `read_file(path)` - Read file contents (5000 char limit)
- `write_file(path, content)` - Create/update files completely
- `edit_file(path, instructions)` - Edit existing files using AI with natural language instructions (e.g., "change background to blue", "fix syntax error", "add new function")

**Web Search**:
- `web_search(query)` - Search internet for current information
- Automatically triggered for questions about "latest", "recent", "current"
- Used for documentation, library versions, news

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
- All new pages automatically link to `page-theme.css` for uniform arcade aesthetic via `ensureStylesheetInHTML()` function
- Prompts specify arcade color palette: mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32)
- Available CSS classes: `.container`, `.card`, `.btn`, `.panel`, `.home-link`, etc.
- Automatic inclusion of Press Start 2P font from Google Fonts
- Prompts optimized for token efficiency with inline examples

**`/update-style`**:
1. User selects preset or "Custom" with description
2. Built-in presets stored in `stylePresets` object (around line 1837):
   - `soft-arcade` - Current style (mint green, dark blue-gray)
   - `neon-arcade` - Intense bright green with animations
   - `dark-minimal` - Clean modern dark theme
   - `retro-terminal` - Classic green terminal style
3. For custom: AI generates complete CSS based on description
4. Writes to `style.css`, commits, pushes to GitHub
5. Shows confirmation with live site link

All presets include complete CSS for all site elements (body, header, cards, buttons, footer).

**`/sync-index`**:
1. Automatically scans `/src` directory for all HTML files  
2. Updates `projectmetadata.json` to include any missing files with default metadata
3. Uses `getIconForDescription()` to assign appropriate emoji icons
4. Generates proper descriptions from filename (e.g., "weekend-planner" → "Weekend Planner")
5. Runs automatically on bot startup to keep metadata in sync
6. Can be triggered manually when new files are added outside the bot commands

**Project Metadata System**:
- `projectmetadata.json` serves as the central registry for all pages in the arcade
- `index.html` dynamically loads and displays projects from this file via JavaScript
- Missing files are automatically detected and added with reasonable defaults
- Supports custom icons and descriptions for each project

### Doc Sportello Personality System

**Response Categories** (`botResponses` object):
- `confirmations` - "yeah man, i got you..."
- `errors` - "oh... yeah something went sideways there"
- `success` - "nice, that worked out pretty smooth"
- `thinking` - "let me think about this for a sec..."

**System Prompt** (`SYSTEM_PROMPT`):
- Defines laid-back, slightly spacey Doc Sportello personality
- **Should include complete list of available Discord slash commands** (`/commit`, `/add-page`, `/add-feature`, `/status`, `/chat`, `/search`, `/set-model`, `/update-style`, `/sync-index`, `/poll`)
- **Should list all function calling tools with descriptions** (filesystem tools, web search, git operations, page creation)
- Instructs AI when to use each tool appropriately
- Repository context with live site and GitHub URLs
- Mandates short responses (1-2 sentences) consistent with personality
- Always links to live site when sharing pages
- Includes web search guidelines for current information
- File operation instructions for repository management
- **Note**: Current system prompt should be expanded to include awareness of all available commands and capabilities for better AI assistance

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
- Bot responds to mentions with AI-generated replies

## System Prompt Enhancement Recommendations

The current `SYSTEM_PROMPT` should be expanded to include:

```javascript
const ENHANCED_SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with web development projects...

AVAILABLE DISCORD COMMANDS:
- /commit <message> [files] - Git add, commit, push changes
- /add-page <name> <description> - Generate HTML page with arcade theme
- /add-feature <name> <description> - Generate JS library + demo page  
- /status - Show repository status and live site
- /chat <message> - Conversation with full context
- /search <query> - Web search for current information
- /set-model <model> - Switch AI model (haiku/sonnet/kimi/gpt5/gemini)
- /update-style <preset> [description] - Update website styling
- /sync-index - Sync projectmetadata.json with /src HTML files
- /poll <question> - Create yes/no poll with reactions

FUNCTION CALLING TOOLS AVAILABLE:
- list_files(path) - List repository files
- read_file(path) - Read file contents  
- write_file(path, content) - Create/update files
- edit_file(path, instructions) - Edit files with natural language
- create_page(name, description) - Generate complete HTML page
- create_feature(name, description) - Generate JS feature + demo
- commit_changes(message, files) - Git operations
- get_repo_status() - Repository status
- web_search(query) - Internet search

When users ask about capabilities, reference these commands and tools specifically.`;
```

## Adding New Commands

1. Add `SlashCommandBuilder` to `commands` array
2. Add case to switch statement in `interactionCreate` handler
3. Create `async function handle{CommandName}(interaction)`
4. Use `getBotResponse()` for personality-consistent messages
5. Include live site URL in embeds: `https://milwrite.github.io/javabot/`
6. Commands auto-register on bot restart (no manual deployment)
7. **Update system prompt to include new command in the available commands list**

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

**HTML Generation Pipeline**:
- `cleanMarkdownCodeBlocks()` removes code fences from AI responses
- `ensureStylesheetInHTML()` automatically injects `page-theme.css` and Google Fonts
- `ensureHomeLinkInHTML()` adds navigation home button if missing
- All functions work together to ensure consistent page structure

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

**Error Prevention**:
- Error tracking prevents infinite loops (3 errors = 5min cooldown)
- Automatic cleanup of error tracking entries every 5 minutes
- All git operations wrapped with timeout protection
- Graceful fallbacks for failed Discord interactions

## Important Dependencies

- **discord.js v14**: Discord bot framework
- **@octokit/rest**: GitHub API integration
- **simple-git**: Git operations
- **axios + axios-retry**: HTTP requests with retry logic
- **dotenv**: Environment variable management
- **nodemon** (dev): Auto-restart during development
