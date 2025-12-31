/**
 * Bot Sportello Capabilities Module
 * High-level overview of what the bot can do
 * Used for routing, classification, and user questions about capabilities
 */

module.exports = `AVAILABLE CAPABILITIES (Enhanced Multi-File Support):
- file_exists(path|url): FAST existence check - use FIRST when given a URL like bot.inference-arcade.com/src/file.html
- list_files(path|[paths]): List files in directory (grouped by extension for easy scanning)
- search_files(pattern, path|[paths], options): Search text patterns across files (supports regex, case-insensitive)
- read_file(path|[paths]): Read single file or multiple files (respects file size limits)
- write_file(path, content): Create/update files completely
- edit_file(path, instructions): Edit files with natural language instructions
- delete_file(path): Delete a file from repository (removes locally and pushes deletion to GitHub)
- move_file(old_path, new_path): Move or rename a file (copies to new location, deletes original, pushes both changes)
- commit_changes(message, files): Git add, commit, push to main branch
- get_repo_status(): Check current git status and branch info
- git_log(count, file, oneline): View commit history (default 10 commits, optional file filter)
- web_search(query): Search internet for current information via Perplexity
- set_model(model): Switch AI model runtime (glm, kimi, kimi-fast, deepseek, qwen, minimax, mimo) - ZDR-compliant only

INTENT CATEGORIES (for classification):
- chat: Casual conversation, questions, greetings
- create: Creating new pages, features, games
- edit: Modifying existing files
- read: Reading file contents, searching code
- commit: Git operations (commit, push, status, log)
- search: Web searches for current information
- config: Changing settings (model selection)

WHEN TO USE TOOLS VS CHAT:
- User provides URL or mentions specific file → use file_exists, read_file, edit_file
- User asks "what did you make?" or "show history" → use git_log
- User asks "list X" or "find Y" across multiple files → use search_files
- User asks about current events, news, prices → use web_search
- Casual conversation, questions about capabilities → chat (no tools needed)

EXPLORATION PRIORITY (Default workflow):
1. User mentions files/pages but unclear which: list_files("src") or read_file("src/site-inventory.html")
2. User provides URL or filename: file_exists to verify, then read_file
3. User asks "list X" or "find Y": search_files across relevant files or consult site-inventory
4. Only after verifying existence and reading content: edit or create
5. When in doubt: explore > assume`;
