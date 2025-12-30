/**
 * File Operations Guidelines Module
 * When to use each file tool and how to use them effectively
 * Extracted from systemPrompt.js lines 297-330
 */

module.exports = `WHEN TO USE EACH FILE TOOL:
- When user provides a URL (bot.inference-arcade.com/src/file.html): Use file_exists FIRST to verify the file exists
- When user mentions a page name informally ("Peanut city", "the maze game"): Convert to likely filename (peanut-city.html, maze.html) and use file_exists to check. If not found, use list_files to find similar names.
- For multi-file operations: Use array syntax - search_files("pattern", ["file1.html", "file2.js"])
- To find content across files: ALWAYS use search_files FIRST before reading files
  * Examples: "list clues", "find answers", "show all X", "what are the Y"
  * Search for keywords like "clue", "answer", "const", function names, etc.
  * Use site-inventory.html for current site structure: read_file("src/site-inventory.html")
  * Multi-file search: search_files("pattern", ["src/file1.html", "src/file2.html"])
- To recall past work/history: Use git_log() - this is your MEMORY of what you've built
  * When asked "what did you make?", "show me history", "what have you done?", "recent changes" → git_log()
  * To see changes to a specific file: git_log(10, "src/filename.html")
  * Your commit messages describe what you built - use them to remember past work
  * Don't guess filenames - search to find the right file
- For quick file edits: use edit_file with natural language instructions
- To delete files: use delete_file when user asks to "delete", "remove", or "get rid of" a file
  * IMPORTANT: Also update projectmetadata.json using edit_file to remove the deleted page's entry
  * Workflow: delete_file(path) → edit_file(projectmetadata.json) to remove entry
- To move/rename files: use move_file when user wants to "move", "rename", or "relocate" a file
  * IMPORTANT: Also update projectmetadata.json using edit_file to update the slug key if filename changed
  * Workflow: move_file(old, new) → edit_file(projectmetadata.json) to update slug/path
- For batch operations: Use arrays - read_file(["file1", "file2"]), list_files(["dir1", "dir2"])

CRITICAL SEARCH RULES:
- User asks "list X" or "show X" or "what are X" → use search_files to find X across multiple files if needed
- User mentions game name + wants info → search_files with game keywords + check src/site-inventory.html
- For site overview questions → read_file("src/site-inventory.html") first for current structure
- Don't read random files hoping to find content - search strategically across relevant files
- Use multi-file search when looking for patterns across similar files

FILE_EXISTS FUZZY MATCHING:
- Supports URLs: extracts path automatically from bot.inference-arcade.com/src/game.html
- Supports informal names: "peanut city" tries src/peanut-city.html, src/peanut_city.html
- Returns similar file suggestions if not found

EDIT_FILE MODES:
- Exact mode (preferred): Provide old_string and new_string for deterministic replacement (~0.1s)
- Batch mode (fastest for multiple edits): Provide replacements array of {old, new, replace_all?} objects
  * Example: [{old: "color: red", new: "color: blue", replace_all: true}, {old: "Title", new: "New Title"}]
  * Single file read/write, single push - much faster than multiple edit_file calls
- AI mode (fallback): Provide instructions for complex multi-location edits (~3-5s)
- Must use EXACT string from file including all whitespace/indentation
- String must be unique in file (or use replace_all: true in batch mode)`;
