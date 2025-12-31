// services/llmRouter.js
// LLM-based intelligent routing for tool calls
// Replaces coarse-grained classification with nuanced routing plans

const axios = require('axios');

// Fast model for routing decisions - Gemma 3 12B (fast, accurate structured output)
const ROUTER_MODEL = process.env.ROUTER_MODEL || 'google/gemma-3-12b-it';
const ROUTER_TIMEOUT_MS = Number(process.env.ROUTER_TIMEOUT_MS || 4000);

/**
 * Tool definitions with metadata for smart routing
 */
const TOOL_CATALOG = {
    file_exists: {
        speed: 'instant',
        cost: 'free',
        purpose: 'Check if file/URL exists before reading',
        prereqFor: ['read_file', 'edit_file'],
        extractsFrom: ['url', 'path', 'filename']
    },
    list_files: {
        speed: 'instant',
        cost: 'free',
        purpose: 'Discover files in directory',
        prereqFor: ['read_file'],
        extractsFrom: ['directory']
    },
    search_files: {
        speed: 'fast',
        cost: 'free',
        purpose: 'Find content across files (grep-like)',
        prereqFor: ['read_file', 'edit_file'],
        extractsFrom: ['pattern', 'keyword', 'search_term']
    },
    read_file: {
        speed: 'fast',
        cost: 'free',
        purpose: 'Read file contents',
        prereqFor: ['edit_file', 'write_file'],
        extractsFrom: ['path', 'filename']
    },
    edit_file: {
        speed: 'slow',
        cost: 'api_call',
        purpose: 'Modify existing file content',
        prereqFor: ['commit_changes'],
        extractsFrom: ['path', 'old_text', 'new_text']
    },
    write_file: {
        speed: 'fast',
        cost: 'free',
        purpose: 'Create or overwrite entire file',
        prereqFor: ['commit_changes'],
        extractsFrom: ['path', 'content']
    },
    commit_changes: {
        speed: 'slow',
        cost: 'git_op',
        purpose: 'Git add/commit/push',
        prereqFor: [],
        extractsFrom: ['message', 'files']
    },
    create_page: {
        speed: 'slow',
        cost: 'api_call',
        purpose: 'Generate new HTML page via AI',
        prereqFor: [],
        extractsFrom: ['name', 'description']
    },
    build_game: {
        speed: 'very_slow',
        cost: 'multi_api',
        purpose: 'Full game pipeline (architect→builder→tester)',
        prereqFor: [],
        extractsFrom: ['title', 'prompt', 'type']
    },
    web_search: {
        speed: 'slow',
        cost: 'api_call',
        purpose: 'Search internet for current information',
        prereqFor: [],
        extractsFrom: ['query']
    },
    get_repo_status: {
        speed: 'instant',
        cost: 'free',
        purpose: 'Check git status',
        prereqFor: ['commit_changes'],
        extractsFrom: []
    },
    set_model: {
        speed: 'instant',
        cost: 'free',
        purpose: 'Switch AI model',
        prereqFor: [],
        extractsFrom: ['model_name']
    }
};

/**
 * Routing plan schema
 * @typedef {Object} RoutingPlan
 * @property {string} intent - Primary intent (edit|create|read|commit|chat|search)
 * @property {string[]} toolSequence - Ordered tools to call
 * @property {Object} parameterHints - Pre-extracted parameters
 * @property {string[]} contextNeeded - What context to pre-load
 * @property {number} confidence - 0-1 confidence score
 * @property {string} reasoning - Why this routing was chosen
 * @property {boolean} clarifyFirst - Should ask user for clarification
 * @property {string} clarifyQuestion - Question to ask if clarifyFirst=true
 * @property {number} expectedIterations - Estimated agentic loop iterations
 */

/**
 * Generate routing plan using LLM
 * @param {string} userMessage - The user's request
 * @param {Object} context - Additional context (recent files, channel history, etc.)
 * @returns {Promise<RoutingPlan>}
 */
async function generateRoutingPlan(userMessage, context = {}) {
    const startTime = Date.now();

    try {
        const routingPrompt = buildRoutingPrompt(userMessage, context);

        // Use modular routing prompt if enabled
        const USE_MODULAR_PROMPTS = process.env.USE_MODULAR_PROMPTS !== 'false';
        const routerSystemPrompt = USE_MODULAR_PROMPTS
            ? require('../personality/assemblers').assembleRouter()
            : `You are a routing optimizer for a Discord bot that manages files and creates content.
Your job is to analyze user requests and output a JSON routing plan.

AVAILABLE TOOLS (ordered by speed):
- file_exists: Instant check if path/URL exists
- list_files: Instant directory listing
- get_repo_status: Instant git status
- set_model: Instant model switch
- search_files: Fast grep across files
- read_file: Fast read file contents
- write_file: Fast create/overwrite file
- edit_file: SLOW - modifies existing file (needs read first)
- commit_changes: SLOW - git operations
- create_page: SLOW - AI generates new HTML page
- web_search: SLOW - internet search
- build_game: VERY SLOW - full game pipeline

ROUTING PRINCIPLES:
1. Always check file_exists before read_file or edit_file
2. Always read_file before edit_file (need to know current content)
3. For URLs like "bot.inference-arcade.com/src/X.html" → extract path "src/X.html"
4. Batch similar operations (multiple reads, then multiple edits)
5. If unclear what file, use search_files or list_files first
6. commit_changes goes LAST after all edits complete

OUTPUT FORMAT (JSON only, no markdown):
{
  "intent": "edit|create|read|commit|chat|search|build",
  "toolSequence": ["file_exists", "read_file", "edit_file"],
  "parameterHints": {
    "file_exists": {"path": "src/game.html"},
    "edit_file": {"mode": "exact"}
  },
  "contextNeeded": ["file_content"],
  "confidence": 0.85,
  "reasoning": "Brief explanation",
  "clarifyFirst": false,
  "clarifyQuestion": null,
  "expectedIterations": 3
}`;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
            model: ROUTER_MODEL,
            messages: [
                {
                    role: 'system',
                    content: routerSystemPrompt
                },
                {
                    role: 'user',
                    content: routingPrompt
                }
            ],
            max_tokens: 500,
            temperature: 0.1,
            response_format: { type: 'json_object' }
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://bot.inference-arcade.com',
                'X-Title': 'Bot Sportello Router'
            },
            timeout: ROUTER_TIMEOUT_MS
        });

        const content = response.data.choices[0].message.content;
        let plan;

        try {
            plan = JSON.parse(content);
        } catch (parseErr) {
            // Try to extract JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                plan = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('No valid JSON in response');
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[ROUTER] Plan generated in ${duration}ms: ${plan.intent} → [${plan.toolSequence?.join('→')}] (confidence: ${plan.confidence})`);

        return {
            ...validatePlan(plan),
            durationMs: duration,
            method: 'llm'
        };

    } catch (error) {
        console.error(`[ROUTER] LLM routing failed: ${error.message}`);
        return fallbackRouting(userMessage, context);
    }
}

/**
 * Build the routing prompt with context
 */
function buildRoutingPrompt(userMessage, context) {
    let prompt = `USER REQUEST: "${userMessage}"`;

    // Add context about recently created/modified files (CRITICAL for follow-up requests)
    if (context.recentFiles?.length) {
        prompt += `\n\nRECENTLY CREATED/MODIFIED FILES (use these for "it", "the page", "isn't working" references): ${context.recentFiles.join(', ')}`;
    }

    // Add action summary for more context
    if (context.actionSummary) {
        prompt += `\n\nRECENT BOT ACTIONS: ${context.actionSummary}`;
    }

    // Add context about files in src/
    if (context.availableFiles?.length) {
        prompt += `\n\nFILES IN src/: ${context.availableFiles.slice(0, 20).join(', ')}${context.availableFiles.length > 20 ? '...' : ''}`;
    }

    // Add conversation context
    if (context.conversationSummary) {
        prompt += `\n\nCONVERSATION CONTEXT: ${context.conversationSummary}`;
    }

    // Extract obvious parameters from request
    const urlMatch = userMessage.match(/bot\.inference-arcade\.com\/([^\s]+)/i);
    const srcMatch = userMessage.match(/src\/([^\s]+\.(?:html|js|css))/i);

    if (urlMatch || srcMatch) {
        const extractedPath = srcMatch ? `src/${srcMatch[1]}` : urlMatch[1];
        prompt += `\n\nEXTRACTED PATH: ${extractedPath}`;
    }

    prompt += '\n\nGenerate routing plan JSON:';
    return prompt;
}

/**
 * Validate and normalize the routing plan
 */
function validatePlan(plan) {
    const defaults = {
        intent: 'chat',
        toolSequence: [],
        parameterHints: {},
        contextNeeded: [],
        confidence: 0.5,
        reasoning: 'No reasoning provided',
        clarifyFirst: false,
        clarifyQuestion: null,
        expectedIterations: 1
    };

    const validated = { ...defaults, ...plan };

    // Ensure toolSequence is array
    if (!Array.isArray(validated.toolSequence)) {
        validated.toolSequence = [];
    }

    // Filter to only valid tools
    validated.toolSequence = validated.toolSequence.filter(t => TOOL_CATALOG[t]);

    // Ensure confidence is 0-1
    validated.confidence = Math.max(0, Math.min(1, validated.confidence || 0.5));

    // Add prerequisite tools if missing
    validated.toolSequence = ensurePrerequisites(validated.toolSequence);

    return validated;
}

/**
 * Ensure prerequisite tools are in sequence
 * e.g., if edit_file is in sequence, read_file should come before it
 */
function ensurePrerequisites(sequence) {
    const result = [];
    const seen = new Set();

    for (const tool of sequence) {
        // Check what this tool needs
        const toolInfo = TOOL_CATALOG[tool];
        if (!toolInfo) continue;

        // For edit_file, ensure read_file comes first
        if (tool === 'edit_file' && !seen.has('read_file') && !sequence.includes('read_file')) {
            // Also ensure file_exists before read
            if (!seen.has('file_exists')) {
                result.push('file_exists');
                seen.add('file_exists');
            }
            result.push('read_file');
            seen.add('read_file');
        }

        // For read_file, ensure file_exists comes first (but not always necessary)
        if (tool === 'read_file' && !seen.has('file_exists') && !sequence.includes('file_exists')) {
            result.push('file_exists');
            seen.add('file_exists');
        }

        if (!seen.has(tool)) {
            result.push(tool);
            seen.add(tool);
        }
    }

    return result;
}

/**
 * Fast fallback routing when LLM fails
 * Uses pattern matching similar to requestClassifier but outputs a plan
 */
function fallbackRouting(userMessage, context = {}) {
    const lower = userMessage.toLowerCase();

    // Extract file path if present
    const urlMatch = userMessage.match(/bot\.inference-arcade\.com\/([^\s]+)/i);
    const srcMatch = userMessage.match(/src\/([^\s]+\.(?:html|js|css))/i);
    const extractedPath = srcMatch ? `src/${srcMatch[1]}` : (urlMatch ? urlMatch[1] : null);

    // Determine intent and build plan
    let plan = {
        intent: 'chat',
        toolSequence: [],
        parameterHints: {},
        contextNeeded: [],
        confidence: 0.6,
        reasoning: 'Fallback pattern matching',
        clarifyFirst: false,
        clarifyQuestion: null,
        expectedIterations: 1,
        method: 'fallback'
    };

    // Edit intent
    if (/\b(edit|change|replace|update|fix|modify)\b/.test(lower) && extractedPath) {
        plan.intent = 'edit';
        plan.toolSequence = ['file_exists', 'read_file', 'edit_file'];
        plan.parameterHints = {
            file_exists: { path: extractedPath },
            read_file: { path: extractedPath },
            edit_file: { path: extractedPath }
        };
        plan.expectedIterations = 3;
        plan.reasoning = `Edit request with explicit path: ${extractedPath}`;
    }
    // Create intent
    else if (/\b(create|build|make|generate|new)\b/.test(lower)) {
        if (/\b(game|play|interactive)\b/.test(lower)) {
            plan.intent = 'build';
            plan.toolSequence = ['build_game'];
            plan.expectedIterations = 1;
            plan.reasoning = 'Game creation request';
        } else {
            plan.intent = 'create';
            plan.toolSequence = ['create_page'];
            plan.expectedIterations = 1;
            plan.reasoning = 'Page creation request';
        }
    }
    // Commit intent
    else if (/\b(commit|push|save|deploy)\b/.test(lower)) {
        plan.intent = 'commit';
        plan.toolSequence = ['get_repo_status', 'commit_changes'];
        plan.expectedIterations = 2;
        plan.reasoning = 'Git commit request';
    }
    // Read/list intent
    else if (/\b(list|show|find|search|what|read)\b/.test(lower)) {
        if (extractedPath) {
            plan.intent = 'read';
            plan.toolSequence = ['file_exists', 'read_file'];
            plan.parameterHints = {
                file_exists: { path: extractedPath },
                read_file: { path: extractedPath }
            };
            plan.expectedIterations = 2;
        } else if (/\b(search|find|grep)\b/.test(lower)) {
            plan.intent = 'search';
            plan.toolSequence = ['search_files'];
            plan.expectedIterations = 1;
        } else {
            plan.intent = 'read';
            plan.toolSequence = ['list_files'];
            plan.expectedIterations = 1;
        }
        plan.reasoning = 'Read/search request';
    }
    // Web search
    else if (/\b(latest|current|recent|news|what is|who is)\b/.test(lower)) {
        plan.intent = 'search';
        plan.toolSequence = ['web_search'];
        plan.expectedIterations = 1;
        plan.reasoning = 'Web search for current information';
    }
    // Default to chat
    else {
        plan.reasoning = 'General conversation, no specific tools needed';
    }

    console.log(`[ROUTER] Fallback plan: ${plan.intent} → [${plan.toolSequence.join('→')}]`);
    return plan;
}

/**
 * Get tool metadata
 */
function getToolInfo(toolName) {
    return TOOL_CATALOG[toolName] || null;
}

/**
 * Filter tools based on routing plan
 * Returns a subset of tools optimized for the plan
 */
function filterToolsForPlan(allTools, plan) {
    if (!plan.toolSequence?.length) {
        return allTools; // No filtering if no sequence
    }

    // Prioritize tools in sequence, but include all tools for flexibility
    const priorityTools = new Set(plan.toolSequence);

    // Sort tools: priority tools first, then others
    return [...allTools].sort((a, b) => {
        const aName = a.function?.name;
        const bName = b.function?.name;
        const aPriority = priorityTools.has(aName) ? 0 : 1;
        const bPriority = priorityTools.has(bName) ? 0 : 1;
        return aPriority - bPriority;
    });
}

/**
 * Build system prompt enhancement based on routing plan
 */
function buildRoutingGuidance(plan) {
    if (!plan.toolSequence?.length) {
        return '';
    }

    let guidance = '\n\n## ROUTING GUIDANCE\n';
    guidance += `Intent: ${plan.intent}\n`;
    guidance += `Suggested tool sequence: ${plan.toolSequence.join(' → ')}\n`;

    if (Object.keys(plan.parameterHints).length > 0) {
        guidance += `\nParameter hints:\n`;
        for (const [tool, hints] of Object.entries(plan.parameterHints)) {
            guidance += `- ${tool}: ${JSON.stringify(hints)}\n`;
        }
    }

    if (plan.reasoning) {
        guidance += `\nReasoning: ${plan.reasoning}\n`;
    }

    guidance += `\nThis is a suggested starting point - feel free to explore or deviate as needed. When uncertain, default to exploration (list_files, search_files, site-inventory).`;

    return guidance;
}

module.exports = {
    generateRoutingPlan,
    buildRoutingGuidance
};
