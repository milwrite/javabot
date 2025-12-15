// services/requestClassifier.js
// LLM-based request classification to replace brittle keyword matching

const axios = require('axios');

/**
 * Use LLM to intelligently classify user requests
 * @param {string} prompt - User's request message
 * @param {object} options - Classification options
 * @returns {object} Classification result with type and confidence
 */
async function classifyRequest(prompt, options = {}) {
    // Try to get global MODEL if available, fallback to env or default
    const globalModel = typeof MODEL !== 'undefined' ? MODEL : null;
    
    const { 
        model = globalModel || process.env.MODEL || 'anthropic/claude-haiku-4.5',
        apiKey = process.env.OPENROUTER_API_KEY 
    } = options;

    try {
        const classificationPrompt = `Classify the following user request into ONE of these categories:

1. **EDIT_EXISTING** - User wants to modify, update, fix, or change something that already exists (a file, page, game, etc.)
2. **CREATE_NEW** - User wants to create something new from scratch (new page, game, feature, content, etc.)
3. **READ_ONLY** - User wants information, wants to see/list/find something, or is asking a question without requesting changes
4. **CONVERSATION** - General chat, greeting, or discussion not requiring file operations

User request: "${prompt}"

Analyze the intent carefully. Look for:
- References to existing items (e.g., "the game", "that page", specific file names) → likely EDIT_EXISTING
- Requests for new content (e.g., "create", "make a new", "build", "produce a webpage") → likely CREATE_NEW
- Questions or information requests (e.g., "what is", "show me", "list", "find") → likely READ_ONLY
- General conversation (e.g., "hello", "thanks", "how are you") → likely CONVERSATION

IMPORTANT: Phrases like "make it a webpage" or "make it interactive" when referring to NEW content should be CREATE_NEW, not EDIT_EXISTING.

Respond with ONLY one of these exact words: EDIT_EXISTING, CREATE_NEW, READ_ONLY, or CONVERSATION`;

        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
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
            max_tokens: 50,
            temperature: 0.1 // Low temperature for consistent classification
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 5000
        });

        const classification = response.data.choices[0].message.content.trim().toUpperCase();
        
        // Validate the classification
        const validTypes = ['EDIT_EXISTING', 'CREATE_NEW', 'READ_ONLY', 'CONVERSATION'];
        if (!validTypes.includes(classification)) {
            console.error(`Invalid classification received: ${classification}`);
            // Fallback to keyword-based detection as backup
            return fallbackClassification(prompt);
        }

        console.log(`[CLASSIFIER] "${prompt.substring(0, 50)}..." → ${classification}`);
        
        return {
            type: classification,
            isEdit: classification === 'EDIT_EXISTING',
            isCreate: classification === 'CREATE_NEW',
            isReadOnly: classification === 'READ_ONLY',
            isConversation: classification === 'CONVERSATION',
            method: 'llm'
        };

    } catch (error) {
        console.error('[CLASSIFIER] LLM classification failed:', error.message);
        // Fallback to simple keyword detection if LLM fails
        return fallbackClassification(prompt);
    }
}

/**
 * Fallback keyword-based classification (used if LLM fails)
 * Much simpler and more conservative than the old system
 */
function fallbackClassification(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Clear edit indicators (must be very specific)
    if (lowerPrompt.includes('edit the') || 
        lowerPrompt.includes('update the') || 
        lowerPrompt.includes('fix the') ||
        lowerPrompt.includes('change the') ||
        lowerPrompt.includes('modify the')) {
        return {
            type: 'EDIT_EXISTING',
            isEdit: true,
            isCreate: false,
            isReadOnly: false,
            isConversation: false,
            method: 'fallback'
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
            isReadOnly: false,
            isConversation: false,
            method: 'fallback'
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
            isReadOnly: true,
            isConversation: false,
            method: 'fallback'
        };
    }
    
    // Default to conversation for safety
    return {
        type: 'CONVERSATION',
        isEdit: false,
        isCreate: false,
        isReadOnly: false,
        isConversation: true,
        method: 'fallback'
    };
}

module.exports = {
    classifyRequest,
    fallbackClassification
};