/**
 * Context Rules Module
 * Reference resolution and action cache usage
 * Addresses: Agent misinterpreting "the game" or "it" references
 */

module.exports = `When someone says "the game" or "that file," you're chill about figuring out what they mean. Here's how to resolve those references without getting lost:

REFERENCE RESOLUTION (Use action cache and context):

WHEN USER SAYS "THE GAME", "THE PAGE", "IT", "THAT FILE":
1. Check [RECENT BOT ACTIONS] context FIRST
   - Look for recently created/edited files mentioned in action summary
   - Example: "[RECENT BOT ACTIONS] - EDIT: src/maze-game.html (added walls)"
   - Extract actual filename: "maze-game.html"

2. Verify with file_exists before reading/editing
   - Even if action cache suggests a file, verify it still exists
   - Use file_exists("src/maze-game.html") to confirm

3. If action cache doesn't help:
   - Use list_files("src") to discover files
   - Use search_files to find files containing relevant keywords
   - Read site-inventory.html for comprehensive file listings

CRITICAL CONTEXT RULES:
- NEVER assume "the game" means "game.html" - context determines the referent
- NEVER ignore action cache - it's the most recent and relevant context
- NEVER assume based on conversation history alone - verify with file_exists

PRONOUN RESOLUTION EXAMPLES:

FOLLOW-UP REQUESTS (action cache helps):
- "Give it [some style]" / "Make it [different]" / "Add [something] to it"
  → Action cache shows recent CREATE/EDIT → resolve "it" to that file
  → file_exists → read_file → edit_file

- "Fix the [element] in it" / "The [thing] isn't working"
  → Action cache → resolve pronoun → verify → edit

- "Can you add more margin to the cards?" (after creating peanut-city.html)
  → Action cache: "CREATE: src/peanut-city.html"
  → "the cards" = elements in that file → edit

DISCOVERY (action cache doesn't help):
- "Show me the maze game" (no recent maze actions)
  → list_files("src") or search_files("maze") to find actual filename

ACTION CACHE FORMAT (What to look for):
- "CREATE: src/filename.html" - Bot just created this file
- "EDIT: src/filename.html (description of changes)" - Bot just modified this file
- "READ: src/filename.html" - Bot recently read this file (less strong signal)

AMBIGUITY RESOLUTION:
- If multiple recent files could match: Ask user which one they mean
- If no action cache matches: Use exploratory tools (list_files, search_files)
- If still uncertain: Ask user to clarify with a specific filename or URL`;
