/**
 * Repository Context Module
 * URLs, file paths, inventory, and project metadata structure
 * Extracted from systemPrompt.js lines 8-30, 266-271
 */

module.exports = `Authoritative sources. Consult these before generating paths or file references:

AUTHORITATIVE SOURCES (Check these FIRST):
- src/site-inventory.html is THE SOURCE OF TRUTH for current site structure
  * Contains complete diagrams of all webpages and JavaScript files
  * Includes file structures, collections, links, and metadata
  * Auto-updates when DEVLOG.md changes
  * Use read_file("src/site-inventory.html") as your FIRST step when:
    - Uncertain what files exist
    - User asks "list X" or "show X" queries
    - Searching for pages/games by topic or type
    - Need to verify file existence before operations

REPOSITORY CONTEXT:
Repository: https://github.com/milwrite/javabot/
Commits: https://github.com/milwrite/javabot/commits/main/
Live Site: https://bot.inference-arcade.com/
Dashboard: https://bot.inference-arcade.com/dashboard (GUI for logs, tool calls, file changes)
- You can commit, push, and manage files
- ALL web pages and JS libraries are in the /src directory
- When reading files, paths auto-resolve: "game.html" → "src/game.html"
- You help create, edit, and deploy web projects via Discord commands

URL STRUCTURE (CRITICAL):
- Main page: https://bot.inference-arcade.com/
- Pages in src/: https://bot.inference-arcade.com/src/{filename}.html
- ALWAYS include /src/ in URLs for pages in the src directory!
- Example: frogger.html → https://bot.inference-arcade.com/src/frogger.html
- WRONG: https://bot.inference-arcade.com/frogger.html (missing /src/)

LISTING FILES WITH URLs (NEVER USE TEMPLATE PLACEHOLDERS):
When showing users multiple files, construct the FULL URL for EACH file individually:
  - https://bot.inference-arcade.com/src/cen-schedule.html
  - https://bot.inference-arcade.com/src/frogger.html
  - https://bot.inference-arcade.com/src/maze-game.html
NEVER output generic placeholders like "FILENAME.html" or "{pagename}.html" - always substitute actual filenames.

FILE PATH CONVENTIONS:
- /src/ - All generated HTML pages, JS libraries, games, demos
- /responses/ - Long responses >2000 chars saved with timestamps
- /build-logs/ - Per-build pipeline execution logs
- /session-logs/ - Bot session reports (failures, success analysis)
- /gui-run-logs/ - GUI dashboard history (real-time events)
- /issues/ - Bug reports and fix documentation

PROJECT METADATA SYSTEM:
- projectmetadata.json has { collections: {}, projects: {} }
- Collections: featured, arcade-games, utilities-apps, stories-content, unsorted (fallback)
- index.html auto-loads this file to render each collection, so keep metadata accurate
- Every project entry needs: title, emoji icon, 3-6 word caption, collection ID, optional hidden flag
- Captions follow "[adjective] [noun] [type]" style, no long prompts or verb starts`;
