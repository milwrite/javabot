// services/requestClassifier.js
// LLM-based request classification to replace brittle keyword matching

const axios = require('axios');

/**
 * Classify user requests - uses fast keyword matching by default
 * LLM classification is optional (set useLLM: true in options)
 * @param {string} prompt - User's request message
 * @param {object} options - Classification options
 * @returns {object} Classification result with type and confidence
 */
async function classifyRequest(prompt, options = {}) {
    const {
        // Default to keyword-based classification (no API call)
        useLLM = process.env.CLASSIFIER_USE_LLM === 'true',
        model = process.env.CLASSIFIER_MODEL || 'z-ai/glm-4.7',
        apiKey = process.env.OPENROUTER_API_KEY,
        timeoutMs = Number(process.env.CLASSIFIER_TIMEOUT_MS || 3500)
    } = options;

    // Fast path: use keyword matching (no API call)
    if (!useLLM) {
        const result = fallbackClassification(prompt, { method: 'keyword' });
        console.log(`[CLASSIFIER] "${prompt.substring(0, 50)}..." → ${result.type} (keyword)`);
        return result;
    }

    // LLM path (optional - only when explicitly enabled)
    const http = axios.create();

    try {
        if (!apiKey) {
            return fallbackClassification(prompt, { method: 'no-api-key' });
        }

        const classificationPrompt = `Classify the following user request into ONE of these categories:

1. **SIMPLE_EDIT** - Simple text replacement or small content changes (e.g., "change the title to X", "replace this text with that")
2. **FUNCTIONALITY_FIX** - Fixing bugs, debugging, CSS issues, JavaScript problems, or improving functionality (e.g., "fix the button", "debug this", "make mobile responsive", "isn't working")
3. **CREATE_NEW** - User wants to create something new from scratch (new page, game, feature, content, etc.)
4. **COMMIT** - Git operations like committing, pushing, saving changes (e.g., "commit this", "save this", "push changes")
5. **READ_ONLY** - User wants information, wants to see/list/find something, or is asking a question without requesting changes
6. **CONVERSATION** - General chat, greeting, or discussion not requiring file operations

User request: "${prompt}"

Analyze the intent carefully:
- Simple content changes → SIMPLE_EDIT
- Bug fixes, styling issues, functionality problems → FUNCTIONALITY_FIX  
- New content creation → CREATE_NEW
- Git/commit operations → COMMIT
- Information requests → READ_ONLY
- General chat → CONVERSATION

CRITICAL: 
- Requests involving "commit", "save", "push", "git" are COMMIT operations
- Requests involving "fix", "debug", "not working", "CSS", "JS", "styling", "responsive", "mobile" are FUNCTIONALITY_FIX, not SIMPLE_EDIT

Respond with ONLY one of these exact words: SIMPLE_EDIT, FUNCTIONALITY_FIX, CREATE_NEW, COMMIT, READ_ONLY, or CONVERSATION`;

        const start = Date.now();
        const response = await http.post('https://openrouter.ai/api/v1/chat/completions', {
            model,
            messages: [
                {
                    role: 'system',
                    content: 'You are a request classifier. Respond with only the classification category, nothing else.'
                },
                {
                    role: 'user', 
                    content: classificationPrompt
                }
            ],
            max_tokens: 10, // Increased to handle longest classification name (FUNCTIONALITY_FIX)
            temperature: 0.0 // Deterministic classification
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: timeoutMs,
            // Treat non-200 as error immediately
            validateStatus: (status) => status === 200
        });

        const classification = response.data.choices[0].message.content.trim().toUpperCase();
        
        // Validate the classification
        const validTypes = ['SIMPLE_EDIT', 'FUNCTIONALITY_FIX', 'CREATE_NEW', 'COMMIT', 'READ_ONLY', 'CONVERSATION'];
        if (!validTypes.includes(classification)) {
            console.error(`Invalid classification received: ${classification}`);
            // Fallback to keyword-based detection as backup
            return fallbackClassification(prompt, { method: 'invalid-llm' });
        }

        const duration = Date.now() - start;
        console.log(`[CLASSIFIER] "${prompt.substring(0, 50)}..." → ${classification} (${duration}ms via llm:${model})`);
        
        return {
            type: classification,
            isEdit: classification === 'SIMPLE_EDIT',
            isFunctionalityFix: classification === 'FUNCTIONALITY_FIX',
            isCreate: classification === 'CREATE_NEW',
            isCommit: classification === 'COMMIT',
            isReadOnly: classification === 'READ_ONLY',
            isConversation: classification === 'CONVERSATION',
            method: 'llm',
            durationMs: duration
        };

    } catch (error) {
        console.error('[CLASSIFIER] LLM classification failed:', error.message);
        // Fallback to simple keyword detection if LLM fails
        return fallbackClassification(prompt, { method: 'llm-fail' });
    }
}

/**
 * Fallback keyword-based classification (used if LLM fails)
 * Much simpler and more conservative than the old system
 */
function fallbackClassification(prompt, meta = {}) {
    const lowerPrompt = prompt.toLowerCase();

    // Conservative fallback - when LLM fails, default to normal chat flow
    // This ensures functionality fixes get proper tool access

    // Fast path: common greetings/small talk → CONVERSATION
    const trimmed = lowerPrompt.trim();
    const greetOnly = trimmed.replace(/[^a-z\s']/g, '');
    const greetingPatterns = [
        /^hi\b/, /^hey\b/, /^hello\b/, /^yo\b/, /^sup\b/,
        /^what['’]s up\b/, /^what is up\b/, /^whats up\b/, /^hiya\b/, /^howdy\b/,
        /^good (morning|evening|afternoon)\b/, /^(yo|sup|hey|hi)$/
    ];
    const isGreeting = greetingPatterns.some(re => re.test(greetOnly));
    const isVeryShort = trimmed.length <= 20 && !/(file|src\/|git|commit|push|create|build|fix)/.test(trimmed);
    if (isGreeting || isVeryShort) {
        return {
            type: 'CONVERSATION',
            isEdit: false,
            isCreate: false,
            isCommit: false,
            isReadOnly: false,
            isConversation: true,
            method: meta.method || 'fallback'
        };
    }

    // READ-ONLY queries about git history (must check BEFORE commit check)
    // Handles: "list commit messages", "show commit history", "previous commits", "git log"
    const gitHistoryPatterns = [
        'commit message', 'commit history', 'commit log',
        'previous commit', 'recent commit', 'last commit',
        'show commit', 'list commit', 'search commit',
        'git log', 'git history'
    ];
    if (gitHistoryPatterns.some(pattern => lowerPrompt.includes(pattern))) {
        return {
            type: 'READ_ONLY',
            isEdit: false,
            isCreate: false,
            isCommit: false,
            isReadOnly: true,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }

    // Clear commit indicators (create a NEW commit)
    if (lowerPrompt.includes('commit this') ||
        lowerPrompt.includes('commit the') ||
        lowerPrompt.includes('make a commit') ||
        lowerPrompt.includes('save this') ||
        lowerPrompt.includes('push this') ||
        lowerPrompt.includes('push changes') ||
        lowerPrompt.includes('git add') ||
        lowerPrompt.includes('save changes')) {
        return {
            type: 'COMMIT',
            isEdit: false,
            isCreate: false,
            isCommit: true,
            isReadOnly: false,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }

    // Clear create indicators
    if (lowerPrompt.includes('create') || 
        lowerPrompt.includes('build') || 
        lowerPrompt.includes('make a') ||
        lowerPrompt.includes('produce') ||
        lowerPrompt.includes('generate') ||
        lowerPrompt.includes('new')) {
        return {
            type: 'CREATE_NEW',
            isEdit: false,
            isCreate: true,
            isCommit: false,
            isReadOnly: false,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }

    // Treat URL+edit intent as SIMPLE_EDIT (e.g., bot.inference-arcade.com/src/... edit ...)
    const mentionsSrcUrl = /(bot\.inference-arcade\.com\/src\/|(^|\s)src\/[^\s]+\.(html|js|css)\b)/i.test(lowerPrompt);
    const hasEditVerb = /\b(edit|change|replace|update|set|make)\b/i.test(lowerPrompt);
    if (mentionsSrcUrl && hasEditVerb) {
        return {
            type: 'SIMPLE_EDIT',
            isEdit: true,
            isCreate: false,
            isCommit: false,
            isReadOnly: false,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }

    // Simple edit indicators (text/content changes without fix/bug keywords)
    // Must check BEFORE functionality fix to catch "change X to Y" patterns
    const simpleEditPatterns = [
        /\b(change|replace|update|set|make)\b.+\b(to|with|instead of)\b/i,
        /\b(title|text|heading|label|name|unit|units)\b.+\b(should be|says?|to)\b/i,
        /\bedit\b.*\b(file|page|webpage|content|html)\b/i,
        /\bin\s+src\/.*\b(change|replace|update|edit)\b/i
    ];
    if (simpleEditPatterns.some(re => re.test(lowerPrompt))) {
        return {
            type: 'SIMPLE_EDIT',
            isEdit: true,
            isCreate: false,
            isCommit: false,
            isReadOnly: false,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }

    // Functionality fix indicators (route to tool-enabled flow)
    if (/(\bfix\b|\bbug\b|\bbroken\b|\berror\b|\bdebug\b|\bnot working\b|\bisn'?t working\b|css|style|responsive|mobile|layout|button|align|center|font|color)/.test(lowerPrompt)) {
        return {
            type: 'FUNCTIONALITY_FIX',
            isEdit: false,
            isFunctionalityFix: true,
            isCreate: false,
            isCommit: false,
            isReadOnly: false,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }
    
    // Clear read-only indicators
    if (lowerPrompt.startsWith('show') ||
        lowerPrompt.startsWith('list') ||
        lowerPrompt.startsWith('find') ||
        lowerPrompt.startsWith('what') ||
        lowerPrompt.startsWith('search')) {
        return {
            type: 'READ_ONLY',
            isEdit: false,
            isCreate: false,
            isCommit: false,
            isReadOnly: true,
            isConversation: false,
            method: meta.method || 'fallback'
        };
    }
    
    // Default to conversation for safety
    return {
        type: 'CONVERSATION',
        isEdit: false,
        isCreate: false,
        isCommit: false,
        isReadOnly: false,
        isConversation: true,
        method: meta.method || 'fallback'
    };
}

module.exports = {
    classifyRequest,
    fallbackClassification
};
