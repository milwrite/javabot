// services/editService.js
// Streamlined edit loop for file modifications via LLM

const axios = require('axios');
const { fileExists, searchFiles, readFile, editFile, listFiles } = require('./filesystem');
const postgres = require('./postgres');
const { OPENROUTER_URL } = require('../config/models');

// Tool definitions for edit operations
const EDIT_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'file_exists',
            description: 'FAST check if a file exists. Use this FIRST when given a URL like bot.inference-arcade.com/src/file.html - pass the URL or path directly.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        oneOf: [
                            { type: 'string', description: 'File path or URL to check' },
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
            description: 'Search for text patterns across files to find what needs editing',
            parameters: {
                type: 'object',
                properties: {
                    pattern: { type: 'string', description: 'Text or regex pattern to search for' },
                    path: {
                        oneOf: [
                            { type: 'string', description: 'Directory or file to search in (default: ./src)' },
                            { type: 'array', items: { type: 'string' }, description: 'Array of files/directories to search' }
                        ]
                    },
                    case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' }
                },
                required: ['pattern']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read contents of a file to understand what needs editing',
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
            name: 'edit_file',
            description: 'Edit an existing file via exact replace, batch, or anchor-range (markers or line range). Prefer exact; use anchor-range for multi-line changes.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to edit' },
                    old_string: { type: 'string', description: 'EXACT string to replace (must be unique in file)' },
                    new_string: { type: 'string', description: 'New string to replace old_string with' },
                    replacements: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                old: { type: 'string', description: 'String to find' },
                                new: { type: 'string', description: 'Replacement string' },
                                replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
                            },
                            required: ['old', 'new']
                        },
                        description: 'BATCH MODE: array of replacements for multiple edits in one call'
                    },
                    start_marker: { type: 'string', description: 'Unique start marker text (appears once)' },
                    end_marker: { type: 'string', description: 'Unique end marker text (appears once, after start)' },
                    new_block: { type: 'string', description: 'Replacement block to insert for marker or line range modes' },
                    include_markers: { type: 'boolean', description: 'If true, replace including markers; else keep markers and replace only inner block (default: false)' },
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
            name: 'list_files',
            description: 'List files to find the right file to edit',
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
    }
];

const EDIT_SYSTEM_SUFFIX = `

You are in EDIT MODE. Focus on making the requested edits quickly and efficiently.

IMPORTANT URL-TO-FILE MAPPING:
- URLs like "https://bot.inference-arcade.com/src/filename.html" map to file path "src/filename.html"
- Remove the base URL and use the path directly: src/tarot-reading.html, src/frogger.html, etc.

EDIT WORKFLOW:
1. If user mentions a URL, extract the filename and look in src/ directory
2. ALWAYS use read_file to examine the current content first
3. ALWAYS use edit_file to make the specific changes requested
4. Respond with confirmation of what was changed

CRITICAL: You MUST use the available tools (read_file, edit_file, search_files). Do not just provide explanations - take action by calling the appropriate tools.

Do not use web search or create new content - only edit existing files.`;

/**
 * Process an edit request through the LLM with tool calling
 * @param {string} userMessage - The user's edit request
 * @param {Array} conversationMessages - Previous conversation context
 * @param {Object} context - Runtime context with dependencies
 * @returns {Object} { text, suggestNormalFlow?, searchContext?, needsClarification? }
 */
async function getEditResponse(userMessage, conversationMessages = [], context = {}) {
    const {
        systemPrompt = '',
        model,
        getApiKey,
        logEvent = console.log,
        logToolCall = () => {},
        logFileChange = () => {},
        getFinalTextResponse,
        getBotResponse = () => 'done'
    } = context;

    let iteration = 0;
    const MAX_ITERATIONS = 3;

    // Track search failures to provide helpful clarification
    const searchFailures = [];
    const searchPatterns = [];

    try {
        const messages = [
            {
                role: 'system',
                content: systemPrompt + EDIT_SYSTEM_SUFFIX
            },
            ...conversationMessages,
            {
                role: 'user',
                content: userMessage
            }
        ];

        let lastResponse;
        let editCompleted = false;

        while (iteration < MAX_ITERATIONS && !editCompleted) {
            iteration++;

            const response = await axios.post(OPENROUTER_URL, {
                model: model,
                messages: messages,
                max_tokens: 10000,
                temperature: 0.7,
                tools: EDIT_TOOLS,
                tool_choice: 'auto'
            }, {
                headers: {
                    'Authorization': `Bearer ${getApiKey()}`,
                    'Content-Type': 'application/json'
                },
                timeout: 45000
            });

            lastResponse = response.data.choices[0].message;

            if (!lastResponse.tool_calls || lastResponse.tool_calls.length === 0) {
                logEvent('EDIT_LOOP', `Iteration ${iteration}: No tool calls returned by AI (text response only)`);
                if (iteration === 1) {
                    postgres.logError({
                        category: 'edit_no_tools',
                        errorType: 'NoToolsReturned',
                        message: 'AI returned text without using tools on first edit iteration',
                        context: {
                            userMessage: userMessage?.substring(0, 200),
                            aiResponse: lastResponse?.content?.substring(0, 200)
                        }
                    });
                }
                break;
            }

            logEvent('EDIT_LOOP', `Iteration ${iteration}: ${lastResponse.tool_calls.length} tools`);

            const toolResults = [];
            for (const toolCall of lastResponse.tool_calls) {
                const functionName = toolCall.function.name;
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments || '{}');
                } catch (parseError) {
                    toolResults.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: 'Error: Invalid JSON in tool arguments'
                    });
                    continue;
                }

                let result;
                const toolStartTime = Date.now();

                if (functionName === 'file_exists') {
                    result = await fileExists(args.path);
                } else if (functionName === 'search_files') {
                    result = await searchFiles(args.pattern, args.path || './src', {
                        caseInsensitive: args.case_insensitive || false
                    });
                    // Track search patterns and failures for clarification
                    searchPatterns.push(args.pattern);
                    if (result.includes('No matches found')) {
                        searchFailures.push({
                            pattern: args.pattern,
                            path: args.path || './src'
                        });
                    }
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'edit_file') {
                    result = await editFile(
                        args.path,
                        args.old_string,
                        args.new_string,
                        args.instructions,
                        args.replacements,
                        {
                            onFileChange: logFileChange,
                            start_marker: args.start_marker,
                            end_marker: args.end_marker,
                            new_block: args.new_block,
                            include_markers: args.include_markers,
                            line_start: args.line_start,
                            line_end: args.line_end
                        }
                    );
                    if (!result.startsWith('Error')) {
                        editCompleted = true;
                        logEvent('EDIT_LOOP', 'Edit completed successfully');
                    }
                } else if (functionName === 'list_files') {
                    result = await listFiles(args.path || './src');
                }

                // Log tool call
                try {
                    const isError = typeof result === 'string' && /^Error\b/.test(result);
                    logToolCall(functionName, args, result, isError ? result : null, {
                        durationMs: Date.now() - toolStartTime,
                        iteration,
                        channelId: null,
                        userId: null
                    });
                } catch (e) {
                    // Non-fatal if logging fails
                }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result
                });
            }

            messages.push(lastResponse);
            messages.push(...toolResults);

            // After edit completes, get final response
            if (editCompleted && getFinalTextResponse) {
                const result = await getFinalTextResponse(messages, EDIT_TOOLS, { maxTokens: 5000 });
                if (result) lastResponse = result;
                break;
            }
        }

        if (iteration >= MAX_ITERATIONS && !editCompleted) {
            logEvent('EDIT_LOOP', 'Max iterations reached without edit - this may not be an edit request');

            const isLikelyNotEdit = /\b(create|generate|make|build|produce|write)\s+(?!.*\b(edit|fix|change|update)\b)/i.test(userMessage);

            if (isLikelyNotEdit) {
                logEvent('EDIT_LOOP', 'Detected likely non-edit request - suggesting normal flow');
                return {
                    text: "hmm, this seems like it might be better suited for the full conversation flow rather than file editing. let me handle this differently...",
                    suggestNormalFlow: true
                };
            }

            // If we had search failures, try to find alternatives and ask for clarification
            if (searchFailures.length > 0) {
                logEvent('EDIT_LOOP', `Search failures detected: ${searchFailures.length} patterns not found`);

                // Search across ALL files for the pattern to find alternatives
                const pattern = searchPatterns[0] || searchFailures[0]?.pattern;
                let alternativeFiles = [];

                if (pattern) {
                    try {
                        const globalSearch = await searchFiles(pattern, './src', { caseInsensitive: true });
                        if (!globalSearch.includes('No matches found')) {
                            // Extract file names from search results
                            const fileMatches = globalSearch.match(/### src\/([^\n]+)/g);
                            if (fileMatches) {
                                alternativeFiles = fileMatches
                                    .map(m => m.replace('### ', ''))
                                    .slice(0, 3);
                            }
                        }
                    } catch (e) {
                        // Ignore search errors
                    }
                }

                // Build clarification message
                const failedFile = searchFailures[0]?.path || 'the specified file';
                const failedPattern = searchFailures[0]?.pattern || 'the requested content';

                let clarificationText = `hmm, i couldn't find "${failedPattern}" in ${failedFile}.`;

                if (alternativeFiles.length > 0) {
                    clarificationText += ` but i did find it in: ${alternativeFiles.join(', ')}. did you mean one of those?`;
                } else {
                    clarificationText += ` could you double-check the file name or tell me exactly what text you want me to change?`;
                }

                logEvent('EDIT_LOOP', 'Returning clarification request');
                return {
                    text: clarificationText,
                    needsClarification: true,
                    searchFailures
                };
            }

            // Force a final response for legitimate edit attempts
            if (getFinalTextResponse) {
                const result = await getFinalTextResponse(messages, EDIT_TOOLS, { maxTokens: 5000 });
                if (result) lastResponse = result;
            }
        }

        const content = lastResponse?.content || `${getBotResponse('success')} changes are live at https://bot.inference-arcade.com/`;
        return {
            text: content,
            searchContext: null
        };

    } catch (error) {
        const errorDetails = error.response?.data || error.message;
        console.error('Edit LLM Error:', errorDetails);

        postgres.logError({
            category: 'edit_llm',
            errorType: error.code || 'LLMError',
            message: typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails),
            stack: error.stack,
            context: { userMessage: userMessage?.substring(0, 200), iteration }
        });

        return { text: getBotResponse('errors'), searchContext: null };
    }
}

module.exports = {
    getEditResponse,
    EDIT_TOOLS,
    EDIT_SYSTEM_SUFFIX
};
