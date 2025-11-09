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

## Architecture Overview

### Single-File Architecture
The entire bot is contained in `index.js` (~1838 lines) with these key sections in order:
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
| `/poll <question>` | `handlePoll` | Yes/no poll with reactions |

### AI Function Calling System

The bot uses OpenRouter's function calling to give the AI autonomous access to:

**Filesystem Tools**:
- `list_files(path)` - List files in repository directories
- `read_file(path)` - Read file contents (5000 char limit)
- `write_file(path, content)` - Create/update files

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
- All new pages link to `page-theme.css` for uniform arcade aesthetic
- Prompts specify arcade color palette: mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32)
- Available CSS classes: `.container`, `.card`, `.btn`, `.panel`, `.home-link`, etc.
- Prompts optimized for token efficiency with inline examples

**`/update-style`**:
1. User selects preset or "Custom" with description
2. Built-in presets stored in `stylePresets` object (lines 1140-1771):
   - `soft-arcade` - Current style (mint green, dark blue-gray)
   - `neon-arcade` - Intense bright green with animations
   - `dark-minimal` - Clean modern dark theme
   - `retro-terminal` - Classic green terminal style
3. For custom: AI generates complete CSS based on description
4. Writes to `style.css`, commits, pushes to GitHub
5. Shows confirmation with live site link

All presets include complete CSS for all site elements (body, header, cards, buttons, footer).

### Doc Sportello Personality System

**Response Categories** (`botResponses` object):
- `confirmations` - "yeah man, i got you..."
- `errors` - "oh... yeah something went sideways there"
- `success` - "nice, that worked out pretty smooth"
- `thinking` - "let me think about this for a sec..."

**System Prompt** (`SYSTEM_PROMPT`):
- Defines laid-back, slightly spacey personality
- Lists available capabilities (file ops, web search, git)
- Instructs AI when to use each tool
- Mandates short responses (1-2 sentences)
- Always links to live site when sharing pages

**Usage**: Call `getBotResponse(category)` for random selection from category.

### Environment Variables

Required in `.env`:
```
DISCORD_TOKEN          # Discord bot token
DISCORD_CLIENT_ID      # Bot application ID
GITHUB_TOKEN           # GitHub PAT with repo permissions
GITHUB_REPO_OWNER      # Repository owner (milwrite)
GITHUB_REPO_NAME       # Repository name (javabot)
GITHUB_REPO_URL        # Full repository URL
CHANNEL_ID             # Comma-separated Discord channel IDs
OPENROUTER_API_KEY     # OpenRouter API key
```

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
