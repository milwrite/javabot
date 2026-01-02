# Repository Guidelines

## Project Structure & Module Organization
- `index.js` — main bot orchestrator (Discord events, tools, routes).
- `services/` — modules for filesystem, PostgreSQL logging, request classification, GitHub API.
- `config/` — model presets and API config.
- `src/` — generated/static site pages (HTML/CSS/JS).
- `scripts/` — utilities (GUI server, run-bot, DB schema/queries).
- `logs/` — session, build, GUI, and Railway logs.
- `tests/` — lightweight Node test scripts (run with `node`).

## Build, Test, and Development Commands
- `npm install` — install dependencies.
- `npm run dev` — run with nodemon for auto-restart.
- `npm start` — run the bot (production-like).
- `./scripts/run-bot.sh` — recommended: starts bot + GUI dashboard + session logging.
- Example tests: `node tests/edit-tool.test.js`, `node tests/test-search.js`.

## Coding Style & Naming Conventions
- JavaScript with 4‑space indentation; prefer early returns and small functions.
- Filenames: kebab-case for pages in `src/` (e.g., `super-flu-thermometer.html`).
- Variables/functions: lowerCamelCase; constants/env: UPPER_SNAKE_CASE.
- Keep changes focused; avoid speculative refactors. Match existing patterns.

## Testing Guidelines
- No formal framework; tests are ad‑hoc Node scripts in `tests/`.
- Name tests with `.test.js`; keep self-contained and fast.
- Prefer targeted checks for tools you modify (filesystem edits, search, logging) and run via `node path/to/test.js`.

## Commit & Pull Request Guidelines
- Commit messages: lowercase, concise, max ~100 chars; no attribution.
- Include clear description, scope of files, and user-facing impact.
- For UI/page changes: add before/after screenshots and live URL (`https://bot.inference-arcade.com/src/...`).
- Reference related issues; keep PRs small and reviewable.

## Security & Configuration Tips
- Copy `.env.example` → `.env`; required: `DISCORD_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `OPENROUTER_API_KEY`. Optional: `DATABASE_URL` (Railway Postgres).
- Never commit secrets. Prefer GitHub API pushes (Octokit) from services/gitHelper.js.
- CLI push (token-embedded):

  ```bash
  # push current branch to main using GITHUB_TOKEN, then restore clean remote
  source .env && \
  git remote set-url origin https://milwrite:$GITHUB_TOKEN@github.com/milwrite/javabot.git && \
  git push origin main && \
  git remote set-url origin https://github.com/milwrite/javabot.git
  ```

  Convenience (stage+commit+push):

  ```bash
  git add . && git commit -m "your message" && \
  source .env && \
  git remote set-url origin https://milwrite:$GITHUB_TOKEN@github.com/milwrite/javabot.git && \
  git push origin main && \
  git remote set-url origin https://github.com/milwrite/javabot.git
  ```

## Architecture Overview (Quick)
- Discord bot routes → tool calling → services (filesystem, GitHub, Postgres) → auto-commit + deploy.
- Persistent telemetry stored in Railway Postgres (`bot_events`, `tool_calls`).
- Edits: prefer exact/batch; use anchor-range options for multi-line changes.
