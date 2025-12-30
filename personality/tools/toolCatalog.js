/**
 * Tool Catalog Module
 * Canonical source of truth for all tool definitions
 * Replaces duplicated definitions in index.js, editService.js, llmRouter.js
 * Extracted from index.js lines 1705-1950
 */

// Full tool definitions with JSON schemas (for OpenRouter function calling)
const ALL_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'list_files',
            description: 'List files in a directory in the repository. Returns files grouped by extension for easy scanning.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        oneOf: [
                            { type: 'string', description: 'Directory path (default: ./src)' },
                            { type: 'array', items: { type: 'string' }, description: 'Array of directories to list' }
                        ]
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'file_exists',
            description: 'FAST check if a file exists. Use this FIRST when a user provides a URL like bot.inference-arcade.com/src/file.html - pass the URL or path directly and it will check existence. Returns EXISTS with size or NOT FOUND.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        oneOf: [
                            { type: 'string', description: 'File path or URL to check (e.g., "src/game.html" or "https://bot.inference-arcade.com/src/game.html")' },
                            { type: 'array', items: { type: 'string' }, description: 'Array of paths/URLs to check' }
                        ]
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'search_files',
            description: 'Search for text patterns across files (like grep). Supports regex patterns. Use this to find specific content, keywords, or code across multiple files.',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Text or regex pattern to search for (e.g., "clue", "answer.*:", "const \\w+")' },
                    path: {
                        oneOf: [
                            { type: 'string', description: 'Directory or file to search in (default: ./src)' },
                            { type: 'array', items: { type: 'string' }, description: 'Array of files/directories to search' }
                        ]
                    },
                    case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
                    file_pattern: { type: 'string', description: 'Filter by filename pattern (e.g., ".html", "crossword")' }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read contents of a file from the repository',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        oneOf: [
                            { type: 'string', description: 'File path to read' },
                            { type: 'array', items: { type: 'string' }, description: 'Array of files to read' }
                        ]
                    }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'write_file',
            description: 'Create or update a file in the repository',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to write' },
                    content: { type: 'string', description: 'Content to write to the file' }
                },
                required: ['path', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit_file',
            description: 'Edit a file via exact replace (preferred), batch, anchor-range (markers/line range), or instructions (last resort).',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to edit (e.g., "src/example.html", "index.html", "style.css")' },
                    old_string: { type: 'string', description: 'EXACT string to replace (including all whitespace). Must be unique.' },
                    new_string: { type: 'string', description: 'New string to replace old_string with.' },
                    instructions: { type: 'string', description: 'FALLBACK: Natural language instructions (slow); avoid unless necessary.' },
                    replacements: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                old: { type: 'string', description: 'EXACT string to find. Accepts: old OR old_string' },
                                new: { type: 'string', description: 'Replacement string. Accepts: new OR new_string' },
                                replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
                            }
                        },
                        description: 'BATCH MODE: Array of {old, new, replace_all?} objects. Both old/new and old_string/new_string are accepted. IMPORTANT: read_file first to verify exact strings!'
                    },
                    start_marker: { type: 'string', description: 'Unique start marker text' },
                    end_marker: { type: 'string', description: 'Unique end marker text (after start)' },
                    new_block: { type: 'string', description: 'Replacement block for marker/line modes' },
                    include_markers: { type: 'boolean', description: 'If true, replace including markers (default false)' },
                    line_start: { type: 'integer', description: '1-based start line (inclusive) for line range mode' },
                    line_end: { type: 'integer', description: '1-based end line (inclusive) for line range mode' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delete_file',
            description: 'Delete a file from the repository. Removes file locally and pushes deletion to GitHub. Use when user wants to remove/delete files.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to delete (e.g., "src/old-page.html")' }
                },
                required: ['path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'move_file',
            description: 'Move or rename a file in the repository. Copies content to new location, deletes original, and pushes both changes to GitHub.',
            parameters: {
                type: 'object',
                properties: {
                    old_path: { type: 'string', description: 'Current file path (e.g., "src/old-name.html")' },
                    new_path: { type: 'string', description: 'New file path (e.g., "src/new-name.html")' }
                },
                required: ['old_path', 'new_path']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'commit_changes',
            description: 'Git add, commit, and push changes to the repository',
            parameters: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Commit message' },
                    files: { type: 'string', description: 'Files to commit (default: "." for all)' }
                },
                required: ['message']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_repo_status',
            description: 'Get repository status via GitHub API (https://github.com/milwrite/javabot/commits/main/)',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'git_log',
            description: 'Get commit history via GitHub API. Shows recent commits with hash, author, date, and message.',
            parameters: {
                type: 'object',
                properties: {
                    count: { type: 'number', description: 'Number of commits to show (default: 10, max: 50)' },
                    file: { type: 'string', description: 'Optional: show commits for a specific file only' },
                    oneline: { type: 'boolean', description: 'Compact one-line format (default: false)' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'web_search',
            description: 'Search the web for current information, news, documentation, or recent updates',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'deep_research',
            description: 'Comprehensive multi-step research with citations and sources. ONLY use when user explicitly says the words "deep research" in their message. Do NOT use for general research questions. Takes 1-3 minutes.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Detailed research question or topic' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'set_model',
            description: 'Switch the AI model used for responses. ZDR-compliant models: glm (default), kimi, kimi-fast, deepseek, qwen, minimax, mimo',
            parameters: {
                type: 'object',
                properties: {
                    model: {
                        type: 'string',
                        description: 'Model preset name. glm = GLM-4.7 (default), kimi = with reasoning, kimi-fast = without.',
                        enum: ['glm', 'kimi', 'kimi-fast', 'deepseek', 'qwen', 'minimax', 'mimo']
                    }
                },
                required: ['model']
            }
        }
    }
];

// Edit mode subset (file operations only)
const EDIT_MODE_TOOLS = ALL_TOOLS.filter(tool =>
    ['file_exists', 'list_files', 'search_files', 'read_file', 'edit_file'].includes(tool.function.name)
);

// Routing awareness subset (tool names only for fast routing)
const ROUTING_TOOL_NAMES = ALL_TOOLS.map(tool => tool.function.name);

module.exports = {
    all: ALL_TOOLS,
    editMode: EDIT_MODE_TOOLS,
    routingAware: ROUTING_TOOL_NAMES
};
