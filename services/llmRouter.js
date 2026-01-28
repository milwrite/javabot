// services/llmRouter.js
// Pattern-based routing for tool calls (no LLM dependency - instant routing)
// Uses regex patterns to classify intent and extract parameters

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
 * Generate routing plan using pattern matching (instant, no LLM call)
 * @param {string} userMessage - The user's request
 * @param {Object} context - Additional context (recent files, channel history, etc.)
 * @returns {Promise<RoutingPlan>}
 */
async function generateRoutingPlan(userMessage, context = {}) {
    const startTime = Date.now();
    const plan = patternRoute(userMessage, context);
    plan.durationMs = Date.now() - startTime;
    console.log(`[ROUTER] Pattern plan (${plan.durationMs}ms): ${plan.intent} → [${plan.toolSequence.join('→')}]`);
    return plan;
}

/**
 * Pattern-based routing - instant classification via regex
 * @param {string} userMessage - The user's request
 * @param {Object} context - Additional context
 * @returns {RoutingPlan}
 */
function patternRoute(userMessage, context = {}) {
    const lower = userMessage.toLowerCase();

    // Extract file path if present (handles multiple formats)
    const urlMatch = userMessage.match(/bot\.inference-arcade\.com\/([^\s]+)/i);
    const srcMatch = userMessage.match(/src\/([^\s]+\.(?:html|js|css))/i);
    // Informal file references like "part3.html" or "peanut-city.html" (no src/ prefix)
    const informalMatch = userMessage.match(/\b([\w][\w-]*\.(?:html|js|css))\b/i);
    // Priority: explicit src/ > URL > informal reference (prepend src/ for .html)
    const extractedPath = srcMatch ? `src/${srcMatch[1]}`
        : (urlMatch ? urlMatch[1]
        : (informalMatch && informalMatch[1].endsWith('.html') ? `src/${informalMatch[1]}` : null));

    // Use recent files from context for pronoun resolution ("the game", "it", etc.)
    const recentFile = context.recentFiles?.[0] || null;

    // Determine intent and build plan
    let plan = {
        intent: 'chat',
        toolSequence: [],
        parameterHints: {},
        contextNeeded: [],
        confidence: 0.8,
        reasoning: 'Pattern matching',
        clarifyFirst: false,
        clarifyQuestion: null,
        expectedIterations: 1,
        method: 'pattern'
    };

    // Structural transformation intent (e.g., "follow same design as", "match structure of")
    // These need write_file for full replacement, not edit_file for patches
    if (/\b(follow|match|same\s+(design|structure|format|layout)|like|similar\s+to)\b/i.test(lower) && extractedPath) {
        // Extract reference file if mentioned (e.g., "like peanut-city.html")
        const refMatch = lower.match(/(?:like|as|to)\s+(\w[\w-]*\.html)/i);
        const refPath = refMatch ? `src/${refMatch[1]}` : null;

        plan.intent = 'create';
        plan.toolSequence = refPath
            ? ['file_exists', 'read_file', 'read_file', 'write_file']
            : ['file_exists', 'read_file', 'write_file'];
        plan.parameterHints = {
            file_exists: { path: extractedPath },
            read_file: { paths: refPath ? [extractedPath, refPath] : [extractedPath] },
            write_file: { path: extractedPath },
            note: 'Structural transformation - read file(s), then write_file with new structure'
        };
        plan.expectedIterations = refPath ? 4 : 3;
        plan.reasoning = refPath
            ? `Structural transformation: ${extractedPath} → match ${refPath}`
            : `Structural transformation: ${extractedPath}`;
    }
    // Edit intent (targeted changes, not structural overhaul)
    else if (/\b(edit|change|replace|update|fix|modify)\b/.test(lower) && extractedPath) {
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
    // Pronoun reference with recent file context - matches action verbs that imply modification
    // Repairs: fix, edit, broken, wrong, buggy | Enhancements: give, add, make, apply, style
    // Refinements: improve, tweak, polish, simplify | Size: bigger, smaller, resize
    // Removal: remove, hide, cut, trim | Movement: move, swap, center, align
    else if (/\b(it|the\s+(game|page|file)|that)\b/.test(lower) && recentFile && /\b(fix|edit|change|update|modify|broken|isn't|not\s+working|wrong|buggy|glitchy|error|repair|correct|debug|patch|resolve|give|add|make|apply|put|set|turn|include|insert|style|theme|bring|improve|enhance|tweak|adjust|refine|polish|clean|restyle|redesign|redo|optimize|tune|tighten|simplify|streamline|upgrade|revamp|revise|spruce|bigger|smaller|larger|wider|narrower|expand|shrink|resize|scale|remove|delete|drop|cut|trim|reduce|strip|hide|move|swap|switch|flip|rotate|shift|reorder|rearrange|center|align)\b/.test(lower)) {
        plan.intent = 'edit';
        plan.toolSequence = ['file_exists', 'read_file', 'edit_file'];
        plan.parameterHints = {
            file_exists: { path: recentFile },
            read_file: { path: recentFile },
            edit_file: { path: recentFile }
        };
        plan.expectedIterations = 3;
        plan.reasoning = `Pronoun resolved to recent file: ${recentFile}`;
    }
    // Create intent - ONLY if specific details provided (name, type, or clear description)
    // Vague requests like "make a game" or "build something" → chat for clarification
    else if (/\b(create|build|make|generate|new)\b/.test(lower)) {
        // Check for specific indicators: filenames, types, or detailed descriptions
        const hasSpecificName = /\b(called|named)\s+[\w-]+/.test(lower) || informalMatch;
        const hasType = /\b(game|page|feature|calculator|timer|todo|list|quiz|puzzle)\b/.test(lower);
        const hasDetails = userMessage.split(' ').length > 8; // More than 8 words suggests detail

        if (hasSpecificName || (hasType && hasDetails)) {
            plan.intent = 'create';
            plan.toolSequence = ['list_files', 'write_file'];
            plan.expectedIterations = 2;
            plan.reasoning = 'Content creation request with specific details';
        } else {
            // Vague create request - route to chat for clarification
            plan.intent = 'chat';
            plan.confidence = 0.6;
            plan.clarifyFirst = true;
            plan.clarifyQuestion = 'What kind of content would you like? (e.g., game type, page purpose, specific features)';
            plan.reasoning = 'Vague create request - needs clarification before building';
        }
    }
    // Commit intent
    else if (/\b(commit|push|save|deploy)\b/.test(lower)) {
        plan.intent = 'commit';
        plan.toolSequence = ['get_repo_status', 'commit_changes'];
        plan.expectedIterations = 2;
        plan.reasoning = 'Git commit request';
    }
    // Model switch intent
    else if (/\b(switch|use|set)\s+(to\s+)?(glm|kimi|deepseek|qwen|mimo|minimax)\b/i.test(lower)) {
        plan.intent = 'config';
        plan.toolSequence = ['set_model'];
        plan.expectedIterations = 1;
        plan.reasoning = 'Model switch request';
    }
    // Read/list intent
    else if (/\b(list|show|find|search|what|read|check)\b/.test(lower)) {
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
    // Default to chat (let agentic loop handle ambiguous requests)
    else {
        plan.intent = 'chat';
        plan.confidence = 0.5;
        plan.reasoning = 'General request - letting agentic loop decide';
    }

    return plan;
}

/**
 * Build system prompt enhancement based on routing plan
 */
function buildRoutingGuidance(plan) {
    if (!plan || !plan.toolSequence?.length) {
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

    guidance += `\nThis is a suggested starting point - feel free to explore or deviate as needed.`;

    return guidance;
}

module.exports = {
    generateRoutingPlan,
    buildRoutingGuidance,
    patternRoute  // Export for testing
};
