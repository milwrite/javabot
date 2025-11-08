# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Discord bot with David Lynch's personality that manages a JavaScript game development repository. The bot integrates Discord slash commands with GitHub operations and AI-powered conversations through OpenRouter's API.

**Core Purpose**: Help users create, commit, and manage JavaScript games through Discord commands while maintaining the Lynch personality.

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
- Lynch personality responses system
- Slash command definitions
- Command handlers (one per command)

### Key Integrations

**Discord API**: Uses discord.js v14 with slash commands
- Intents: Guilds, GuildMessages, GuildMessageReactions
- Commands automatically register on bot startup
- Error handling prevents spam loops with tracking system

**GitHub Integration**: 
- Uses simple-git for local operations
- Octokit for GitHub API interactions  
- Automated commit/push workflows
- Repository: https://github.com/milwrite/javabot/

**AI Integration**:
- OpenRouter API with model: `anthropic/claude-3-5-haiku-4-5`
- Lynch personality prompt system
- Chat command for AI conversations

### Command Structure

Commands are defined in the `commands` array and handled by corresponding `handle*` functions:
- `/commit` - Git operations (stage, commit, push)
- `/create-game` - Generate new game files from templates
- `/status` - Repository status check
- `/lynch` - Random Lynch wisdom
- `/chat` - AI-powered conversations
- `/poll` - Yes/no polls with reactions

### Lynch Personality System

The `lynchPersonality` object contains categorized response arrays:
- `greetings`, `confirmations`, `errors`, `success`, `thinking`
- `getLynchResponse(category)` randomly selects appropriate responses
- System prompt defines Lynch's conversational style and GitHub workflow guidance

### Environment Variables

Required environment variables (see `.env.example`):
- `DISCORD_TOKEN` - Discord bot token
- `DISCORD_CLIENT_ID` - Bot application ID
- `GITHUB_TOKEN` - GitHub personal access token with repo permissions
- `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_REPO_URL` - Repository details
- `CHANNEL_ID` - Dedicated Discord channel
- `OPENROUTER_API_KEY` - AI service API key

### Error Handling

Implements error loop prevention:
- Tracks errors per user/command combination
- Limits to 3 consecutive errors before 5-minute cooldown
- Different error messages for different failure types
- Graceful Discord interaction handling (deferred vs immediate replies)

### Game Templates

The `/create-game` command supports multiple templates:
- `vanilla` - Full class-based game structure
- `canvas` - Simple canvas-based game
- Templates include HTML boilerplate and JavaScript game loops

## Adding New Commands

1. Add command definition to `commands` array using `SlashCommandBuilder`
2. Add case to switch statement in `interactionCreate` handler
3. Create corresponding `handle*` function
4. Commands auto-register on bot restart

## Key Patterns

- All commands use Lynch personality responses
- Git operations include progress updates via `interaction.editReply()`
- Error messages are randomized through `getLynchResponse('errors')`
- Commands that take time use `deferReply()` except chat and poll
- Game templates use template literals with variable substitution