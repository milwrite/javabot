# Bot Sportello - Web Development Discord Bot

A laid-back Discord bot with Doc Sportello's personality that helps create and manage web projects in a JavaScript repository. Generates HTML pages, interactive features, and web apps with a retro arcade aesthetic.

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
     - `OPENROUTER_API_KEY`: OpenRouter API key for AI code generation

3. **Discord Bot Setup:**
   - Application ID: `1436782482967101491` (already configured)
   - Public Key: `5c35faa34f67859b7ae2ffe7f5923344e4fee369cc85238385d70b2887e81f3d`
   - Bot needs permissions: Send Messages, Use Slash Commands, Embed Links
   - Required Intents: Guilds, Guild Messages, Message Content, Guild Message Reactions

4. **GitHub Setup:**
   - Create a personal access token with `repo` permissions
   - Repository: https://github.com/milwrite/javabot/
   - Live site: https://milwrite.github.io/javabot/

## Commands

### Content Generation
- `/add-page <name> <description>` - Generate a new HTML page with arcade styling
- `/add-feature <name> <description>` - Generate an interactive JavaScript feature with demo page
- `/update-style <preset> [description]` - Update website styling (presets: soft-arcade, neon-arcade, dark-minimal, retro-terminal, or custom)

### Git Operations
- `/commit <message> [files]` - Commit and push changes to GitHub
- `/status` - Check repository status and view live site link

### AI Interaction
- `/chat <message>` - Have a conversation with Bot Sportello (uses conversation history and can perform file operations)
- `/search <query>` - Search the web for current information
- `/set-model <model>` - Switch AI model (haiku, sonnet, kimi, gpt5, gemini)
- `/set-prompt <action> [content]` - View, reset, add to, or replace the bot's system prompt

### Utility
- `/poll <question>` - Create a yes/no poll with reactions

## Features

- **AI-Generated Pages & Features**: Uses Claude to generate complete, responsive web projects
- **Arcade Aesthetic**: Retro pixel design system with mint green accent colors
- **Mobile Responsive**: All pages built with mobile-first approach (768px, 480px breakpoints)
- **Auto-Deployment**: Automatically commits and pushes to GitHub Pages
- **Conversation Memory**: Remembers last 100 messages for context
- **Doc Sportello Personality**: Laid-back, slightly spacey but helpful vibe

## Running

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## Design System

All projects use the arcade theme with:
- **Color Palette**: Mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32), lighter green text (#95c9ad)
- **Typography**: Press Start 2P font for retro pixel aesthetic
- **CSS Framework**: Shared `page-theme.css` with pre-built component classes
- **Mobile First**: Touch targets minimum 44px, responsive layouts

## Project Structure

```
/src
  ├── index.html              - Main hub page
  ├── page-theme.css          - Shared arcade design system
  ├── [page-name].html        - Individual web pages
  ├── [feature-name].js       - Interactive features & libraries
  └── [feature-name].html     - Feature demo pages
```

## Creating Projects

### Pages
Generate a full HTML page with styling:
```
/create-page <name> <description>
```

### Features
Generate a reusable JavaScript component or library:
```
/create-feature <name> <description>
```

Both automatically:
- Link to the arcade theme CSS
- Include responsive mobile design
- Add navigation back to index.html
- Update the index.html hub
- Deploy to GitHub Pages
