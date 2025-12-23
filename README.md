# Bot Sportello — Discord Agent + Noir Web Arcade

A Discord-first, agentic web dev bot in Doc Sportello’s voice. It builds pages, features, and small apps into `src/`, pushes to GitHub Pages, and exposes an in-browser GUI to observe tool calls, file edits, and agent loops in real time.

Live site: `https://bot.inference-arcade.com/`
Repo: `https://github.com/milwrite/javabot/`

**What it does**
- Generates new pages/features and ships them to `src/` with mobile-first styling.
- Fixes and edits existing files by invoking repo tools via OpenRouter tool-calling.
- Runs a 4‑agent content pipeline (Architect → Builder → Tester → Scribe) for bigger builds.
- Commits/pushes to GitHub (auto-deploy to Pages) and logs everything to a local GUI.

**Design system**
- Theme: Noir Terminal (sky blue `#7ec8e3`, red `#ff0000`, cyan `#00ffff`, near‑black `#0a0a0a`).
- Type: `Courier Prime` monospace via Google Fonts.
- Shared CSS: `page-theme.css` (home-link, components, mobile controls patterns).
- Optional starfield: include `../stars.js` on a page to render a twinkling sky.

## Setup

- Node 18+ recommended
- Copy `.env.example` → `.env` and set:
  - `DISCORD_TOKEN` — Bot token
  - `DISCORD_CLIENT_ID` — Application client ID
  - `GITHUB_TOKEN` — PAT with `repo` scope
  - `GITHUB_REPO_OWNER` — e.g., `milwrite`
  - `GITHUB_REPO_NAME` — e.g., `javabot`
  - `GITHUB_REPO_URL` — repo HTTPS URL (used in embeds)
  - `OPENROUTER_API_KEY` — OpenRouter key
  - `CHANNEL_ID` — optional, comma‑separated channel IDs to restrict handling
  - `GUI_PORT` — optional, GUI port (default `3001`)
  - `NO_GUI` — set to `true` to disable the GUI

Install and run:
- `npm install`
- `npm start` (or `npm run dev` with nodemon)
- Optional launcher with log preservation: `./run-bot.sh [--no-gui] [--gui-port 3002]`

## Architecture

**Top‑level**
- `index.js` — Discord orchestrator, tool implementations, agent loop, command handlers, git and OpenRouter wiring.
- `services/` — integrations + pipeline orchestrators:
  - `llmClient.js` — OpenRouter client + role prompts (Architect/Builder/Tester/Scribe)
  - `gamePipeline.js` — plans → builds → tests → docs (returns files + live URL)
  - `buildLogs.js` — structured logs per build; summarizes recurrent issues
  - `requestClassifier.js` — LLM classifier (create vs fix vs edit vs read‑only)
- `agents/` — role prompts and logic wrappers used by the pipeline
  - `gameArchitect.js`, `gameBuilder.js`, `gameTester.js`, `gameScribe.js`
- `gui-server.js` + `gui/` — Express + Socket.IO dashboard with panels for logs, tool calls, file changes, agent loops
- Frontend site:
  - `index.html` hub renders from `projectmetadata.json`
  - `src/` pages and demos; `page-theme.css` shared theme; `stars.js` optional effect
  - `generateSiteInventory.js` builds `SITE_INVENTORY.md` (auto‑runs on `DEVLOG.md` changes)

**Data & memory**
- `projectmetadata.json` — canonical page list + collections powering the homepage.
- `agents.md` — rolling memory: summary of older chat + last ~15 messages.
- `build-logs/*.json` — per‑build pipeline logs (used for pattern summaries).
- `responses/` — full text for outputs > 2,000 chars (Discord limit safe‑keeping).

## Call Flow

**Slash commands**
- `client.once('clientReady', ...)` registers commands (guild‑scoped if `CHANNEL_ID` set, else global).
- `interactionCreate` dispatches to handlers (e.g., `handleBuildGame`, `handleCommit`).
- Some flows show confirmation buttons (e.g., commit) using message components.

**@ Mentions**
- `messageCreate` tracks history and routes mentions to `handleMentionAsync`.
- `requestClassifier` calls OpenRouter to decide the path:
  - CREATE_NEW → `runGamePipeline(...)` (Architect → Builder → Tester → Scribe).
  - FUNCTIONALITY_FIX or SIMPLE_EDIT → normal agent loop with repo tools.
  - READ_ONLY → direct LLM answer (no file edits).
- Long answers are truncated in Discord and saved fully to `responses/`.

**Content pipeline (services/gamePipeline.js)**
- Architect: classify type, produce plan (files, slug, features, collection).
- Builder: generate complete HTML/JS with required mobile/UX constraints.
- Tester: automated checks + LLM validation, produce score and issues.
- Scribe: documentation + metadata; updates `projectmetadata.json`.
- Caller commits/pushes; live page at `https://.../src/<slug>.html`.

## Repo Tools (Tool‑Calling)

Available to the LLM via OpenRouter function‑calling; implemented in `index.js`:
- `list_files(path | paths[])` — list directory contents.
- `search_files(pattern, path | paths[], options)` — grep‑like search across files.
- `read_file(path | paths[])` — read one or many files (size‑capped).
- `write_file(path, content)` — create/overwrite a file.
- `edit_file(path, old_string?, new_string?, instructions?)` — prefer exact replace; fall back to instruction‑based edit.
- `create_page(name, description)` — generate a single HTML page and update index.
- `create_feature(name, description)` — generate a JS library + demo HTML.
- `commit_changes(message, files='.')` — stage/commit/push.
- `get_repo_status()` — branch and changed files, plus live site link.
- `web_search(query)` — calls `perplexity/sonar` via OpenRouter for sources.
- `set_model(model)` — switch model preset.
- `update_style(preset, description?)` — return plan for theme changes (manual CSS edit).
- `build_game(title, prompt, type)` — shortcut to the multi‑agent pipeline.

Agent loop details:
- Tool loop runs up to 6 iterations; logs each iteration to the GUI.
- After a “primary action” (create/edit/commit/build), the bot requests one last natural text reply with `tool_choice: 'none'` and exits.

## Third‑Party Integrations

- Discord: `discord.js` v14 (slash commands, buttons, embeds; intents include Guilds, Messages, Reactions, Message Content).
- OpenRouter: `chat/completions` with model presets (Haiku/Sonnet/GPT‑5.1 Codex/Gemini/Kimi/GLM); axios‑retry, timeouts, structured tool calls.
- GitHub: `simple-git` for add/commit/push; GitHub Pages deploys from `main`. Remote URL is set with a tokenized HTTPS on push.
- Perplexity: `perplexity/sonar` model via OpenRouter for web search.
- GUI: Express + Socket.IO server at `http://localhost:${GUI_PORT||3001}` (disable with `NO_GUI=true`).

## Commands

Content & pipeline:
- `/add-page <name> <description>` — generate one HTML page.
- `/add-feature <name> <description>` — generate a JS library + demo page.
- `/build-game <title> <prompt> [type]` — multi‑agent pipeline build.
- `/build-puzzle <theme> [difficulty]` — story riddle with p5.js viz.

Repo & admin:
- `/commit <message> [files]` — staged commit with confirm buttons; pushes to `main`.
- `/status` — branch and changed files summary + live URL.
- `/sync-index` — ensure `projectmetadata.json` backfills from `src/*.html`.

AI & utilities:
- `/chat <message>` — chat with full repo tool access.
- `/search <query>` — web search via Perplexity (saved to `responses/` if long).
- `/set-model <model>` — `haiku|sonnet|kimi|gpt5|gemini|glm`.
- `/set-prompt <view|reset|add|replace> [content]` — system prompt controls.
- `/update-style <preset> [description]` — preset or “custom” guidance.
- `/poll <question>` — quick yes/no reactions.

## Frontend Site

- `index.html` renders collections and links from `projectmetadata.json`.
- Pages live at `https://bot.inference-arcade.com/src/<page>.html`.
- Include the back/home link: `<a href="../index.html" class="home-link">← HOME</a>`.
- Use `page-theme.css` classes/components; follow mobile‑first guidance.
- `generateSiteInventory.js` writes `SITE_INVENTORY.md`; a watcher updates it whenever `DEVLOG.md` changes.

## URL ↔ File Mapping

- URL `https://bot.inference-arcade.com/src/filename.html` maps to file `src/filename.html`.
- The edit loop extracts filenames from URLs and edits `src/` accordingly.

## Observability & Logs

- GUI Dashboard: `http://localhost:3001` (or `GUI_PORT`); panels for logs, tool calls, file changes, agent loops.
- Build logs: `build-logs/<id>.json` with stage-by-stage entries; summaries inform the architect prompt.
- Long outputs: written under `responses/` and linked from Discord.
- Memory file: `agents.md` (recent messages + optional summary).

## Security Notes

- The bot sets the remote URL with a tokenized HTTPS string to push. Consider a GitHub App or ephemeral credential helpers for tighter security (see ARCHITECTURE_REVIEW.md).
- Restrict channels via `CHANNEL_ID` to avoid unintended triggers.

## Development

- Start with GUI: `npm start` (or `./run-bot.sh`).
- Disable GUI: `NO_GUI=true npm start`.
- Test the GUI standalone: `node test-gui.js`.
- New pages/features appear on the live site after GitHub Pages deploys (usually 1–2 minutes).

## Project Structure

```
javabot/
├── index.js                  # Discord orchestrator, tools, agent loop
├── services/                 # OpenRouter + pipeline + logs + classifier
├── agents/                   # Architect/Builder/Tester/Scribe wrappers
├── gui-server.js, gui/       # Local dashboard (logs/tools/files/loops)
├── index.html                # Hub rendering from projectmetadata.json
├── page-theme.css, stars.js  # Shared styling and optional background
├── src/                      # All shipped pages and demos
├── projectmetadata.json      # Canonical metadata used by the hub
├── generateSiteInventory.js  # Builds SITE_INVENTORY.md on DEVLOG changes
├── build-logs/, responses/   # Pipeline logs and long outputs
└── agents.md                 # Rolling memory for context
```

## Troubleshooting

- Commands not visible: Ensure slash commands registered (check bot logs after `clientReady`) and the bot has the correct scopes in your server.
- No edits happening: Confirm `OPENROUTER_API_KEY` and model availability; check GUI Tool Calls panel.
- Push/auth errors: verify `GITHUB_TOKEN` scope and that origin remote is updated; see logs.
- Live page 404: wait 1–2 minutes for GitHub Pages; confirm URL has `/src/` segment.

—
See `ARCHITECTURE_REVIEW.md` for current issues and suggested improvements.
