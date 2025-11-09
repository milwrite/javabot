# Bot Sportello - Discord Game Development Bot

A Discord bot with Doc Sportello's personality that generates Phaser 3 games and manages a JavaScript game development repository.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment setup:**
   - Copy `.env.example` to `.env`
   - Fill in your credentials:
     - `DISCORD_TOKEN`: Your Discord bot token
     - `GITHUB_TOKEN`: GitHub personal access token with repo permissions
     - `CHANNEL_ID`: Comma-separated Discord channel IDs for bot monitoring (e.g., "123,456,789")
     - `OPENROUTER_API_KEY`: OpenRouter API key for AI game generation

3. **Discord Bot Setup:**
   - Application ID: `1436782482967101491` (already configured)
   - Public Key: `5c35faa34f67859b7ae2ffe7f5923344e4fee369cc85238385d70b2887e81f3d`
   - Bot needs permissions: Send Messages, Use Slash Commands, Embed Links
   - Required Intents: Guilds, Guild Messages, Message Content, Guild Message Reactions

4. **GitHub Setup:**
   - Create a personal access token with `repo` permissions
   - Repository: https://github.com/milwrite/javabot/

## Commands

- `/commit <message> [files]` - Commit and push changes to GitHub
- `/create-game <name> <description>` - Generate a new Phaser 3 game with AI
- `/status` - Check repository status
- `/chat <message>` - Have a conversation with Bot Sportello
- `/poll <question>` - Create a yes/no poll

## Features

- **AI-Generated Games**: Uses Claude Haiku to generate complete, playable Phaser 3 games
- **Multi-Channel Monitoring**: Tracks conversations across multiple Discord channels
- **Conversation Memory**: Remembers last 100 messages for context
- **Auto-Commit**: Automatically stages, commits, and pushes to GitHub
- **Doc Sportello Personality**: Laid-back, slightly spacey but helpful vibe

## Running

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## Game Development

Games are created using the Phaser 3 framework and stored in the `/games` directory. Each game includes:
- JavaScript file with complete game logic
- HTML file with Phaser CDN and game container
- Working example: `games/example.js`
