# JavaBot - Discord Game Development Bot

A Discord bot with David Lynch's personality that helps manage a JavaScript game development repository.

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
     - `CHANNEL_ID`: Discord channel ID for bot operations

3. **Discord Bot Setup:**
   - Application ID: `1436782482967101491` (already configured)
   - Public Key: `5c35faa34f67859b7ae2ffe7f5923344e4fee369cc85238385d70b2887e81f3d`
   - Bot needs permissions: Send Messages, Use Slash Commands, Embed Links

4. **GitHub Setup:**
   - Create a personal access token with `repo` permissions
   - Repository: https://github.com/milwrite/javabot/

## Commands

- `/commit <message> [files]` - Commit and push changes
- `/create-game <name> [template]` - Create new game file
- `/status` - Check repository status
- `/lynch` - Get David Lynch wisdom

## Running

```bash
npm start
```

For development:
```bash
npm run dev
```