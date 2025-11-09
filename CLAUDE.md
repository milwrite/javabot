# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bot Sportello is a Discord bot with a laid-back Doc Sportello personality that manages a JavaScript game development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered conversations through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage JavaScript games through Discord commands while maintaining a chill, slightly spacey but helpful personality.

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
The entire bot is contained in `index.js` with these key sections:
- Environment configuration and imports
- Error tracking system (prevents infinite error loops)
- Discord client setup with specific intents
- GitHub integration via Octokit and simple-git
- OpenRouter AI integration for chat functionality
- Doc Sportello personality response system
- Slash command definitions
- Command handlers (one per command)

### Key Integrations

**Discord API**: Uses discord.js v14 with slash commands
- Intents: Guilds, GuildMessages, GuildMessageReactions, MessageContent
- Commands automatically register on bot startup
- Error handling prevents spam loops with tracking system
- All interactions are deferred except for polls
- Supports multiple channels via comma-separated `CHANNEL_ID` env var

**GitHub Integration**:
- Uses simple-git for local operations
- Octokit for GitHub API interactions
- Automated commit/push workflows to `main` branch
- Repository: https://github.com/milwrite/javabot/
- Dynamic branch detection using `git.status().current`

**AI Integration**:
- OpenRouter API with model: `anthropic/claude-3.5-haiku`
- Doc Sportello personality prompt system
- Chat command for AI conversations
- Conversation history tracked in `agents.md`

### Command Structure

Commands are defined in the `commands` array and handled by corresponding `handle*` functions:
- `/commit <message> [files]` - Git operations (stage, commit, push to main)
- `/create-game <name> <description>` - Generate new game files (vanilla template only)
- `/status` - Repository status check
- `/chat <message>` - AI-powered conversations with Doc Sportello personality
- `/poll <question>` - Yes/no polls with emoji reactions

### Doc Sportello Personality System

The `botResponses` object contains categorized response arrays:
- `confirmations`, `errors`, `success`, `thinking`
- `getBotResponse(category)` randomly selects appropriate laid-back responses
- System prompt defines chill, concise, slightly spacey conversational style
- All responses are short and casual: "yeah man", "right on", "cool cool"
- Occasionally references coffee but doesn't force it

### Environment Variables

Required environment variables:
- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Bot application ID
- `GITHUB_TOKEN` - GitHub personal access token with repo permissions
- `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_REPO_URL` - Repository details
- `CHANNEL_ID` - Comma-separated list of Discord channel IDs for message tracking (e.g., "123,456,789")
- `OPENROUTER_API_KEY` - AI service API key

### Error Handling

Implements error loop prevention:
- Tracks errors per user/command combination
- Limits to 3 consecutive errors before 5-minute cooldown
- Chill error messages match Doc Sportello personality
- Graceful Discord interaction handling (all commands use `deferReply()` except polls)
- Error tracking happens after deferring to avoid timing issues

### Game Templates

The `/create-game` command uses a vanilla template:
- Full class-based game structure with constructor, update, render methods
- Includes HTML boilerplate and JavaScript game loops
- Generated files include both `.js` and `.html` files in `/games` directory

### Message History System

Conversation tracking via `agents.md`:
- Tracks last 20 messages from Discord
- Monitors multiple channels specified in `CHANNEL_ID` env var
- Provides context for AI conversations
- Auto-updates through `addToHistory()` and `updateAgentsFile()`
- Used by chat command for personalized responses

### Multi-Channel Support

Channel monitoring implementation:
- Parses `CHANNEL_ID` as comma-separated list
- Creates `CHANNEL_IDS` array from split values
- Uses `CHANNEL_IDS.includes()` to check message origin
- If `CHANNEL_ID` is empty, monitors all channels
- Logs all configured channels on startup

## Adding New Commands

1. Add command definition to `commands` array using `SlashCommandBuilder`
2. Add case to switch statement in `interactionCreate` handler
3. Create corresponding `handle*` function
4. Commands auto-register on bot restart
5. Use `getBotResponse()` for consistent Doc Sportello messaging

## Key Patterns

- All commands use Doc Sportello personality responses (chill, concise)
- Git operations include progress updates via `interaction.editReply()`
- Error messages are randomized through `getBotResponse('errors')`
- Commands that take time use `deferReply()` except polls
- Game templates use template literals with variable substitution
- All git pushes target the `main` branch with dynamic branch detection
- Commit messages should be lowercase without Claude Code attribution
