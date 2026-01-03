// services/llmClient.js
// Centralized LLM client for OpenRouter API calls with role-specific prompts

const axios = require('axios');
const axiosRetry = require('axios-retry').default;

// Configure axios with retry logic
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response && error.response.status >= 500);
    },
    onRetry: (retryCount, error, requestConfig) => {
        console.log(`🔄 Retry attempt ${retryCount} for ${requestConfig.url} (${error.message})`);
    },
    shouldResetTimeout: true
});

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;

// Model presets - import from config/models.js for consistency
const { MODEL_PRESETS } = require('../config/models');

// Fallback models for 500 error recovery (ZDR-compliant only)
const FALLBACK_MODELS = [
    'moonshotai/kimi-k2-0905:exacto',
    'qwen/qwen3-coder:exacto',
    'xiaomi/mimo-v2-flash'
];

// Track 500 errors per model for fallback decisions
const model500ErrorCount = new Map();

// Use modular agent roles
const agentRoles = require('../personality/specialized/agentRoles');

const BASE_SYSTEM_CONTEXT = agentRoles.BASE_SYSTEM_CONTEXT;

// Condensed role-specific prompts (use modular)
const ROLE_PROMPTS = {
    architect: agentRoles.architect,
    builder: agentRoles.builder,
    tester: agentRoles.tester,
    scribe: agentRoles.scribe
};

/**
 * Call LLM via OpenRouter with role-specific prompting
 * @param {object} options - Call options
 * @param {string} options.role - Agent role: 'architect' | 'builder' | 'tester' | 'scribe'
 * @param {string} options.systemPrompt - Optional custom system prompt (overrides role default)
 * @param {Array} options.messages - Conversation messages
 * @param {Array} options.tools - Optional function tools
 * @param {string} options.model - Model to use (default: glm)
 * @param {number} options.maxTokens - Max output tokens (default: 10000)
 * @param {number} options.temperature - Temperature (default: 0.7)
 * @param {Function} options.onHeartbeat - Optional callback for progress updates during long calls
 * @returns {object} API response with content and tool_calls
 */
async function callSonnet({
    role,
    systemPrompt = null,
    messages,
    tools = [],
    model = 'glm',
    maxTokens = 10000,
    temperature = 0.7,
    onHeartbeat = null
}) {
    // Use role-specific prompt if no custom prompt provided
    const finalSystemPrompt = systemPrompt || ROLE_PROMPTS[role] || BASE_SYSTEM_CONTEXT;

    // Get model string
    const modelString = MODEL_PRESETS[model] || model;

    const payload = {
        model: modelString,
        messages: [
            { role: 'system', content: finalSystemPrompt },
            ...messages
        ],
        max_tokens: maxTokens,
        temperature: temperature,
        // Enforce Zero Data Retention - only route to providers that don't retain prompts
        provider: {
            data_collection: 'deny'
        }
    };

    // Add tools if provided
    if (tools.length > 0) {
        payload.tools = tools;
    }

    // Set up heartbeat for long-running calls
    let heartbeatInterval = null;
    if (onHeartbeat) {
        let heartbeatCount = 0;
        heartbeatInterval = setInterval(() => {
            heartbeatCount++;
            const message = heartbeatCount === 1
                ? '🔄 still working on this...'
                : `🔄 still processing... (${heartbeatCount * 15}s)`;
            onHeartbeat(message).catch(err => {
                console.warn('Heartbeat callback error:', err.message);
            });
        }, 15000); // Every 15 seconds
    }

    try {
        const response = await axios.post(OPENROUTER_URL, payload, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/milwrite/javabot',
                'X-Title': 'Bot Sportello Game Builder'
            },
            timeout: 60000
        });

        // Clear heartbeat on success
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }

        const choice = response.data.choices[0];

        // Log cache discount if present (OpenRouter prompt caching)
        const cacheDiscount = response.data.cache_discount;
        if (cacheDiscount && cacheDiscount > 0) {
            console.log(`[CACHE] ${(cacheDiscount * 100).toFixed(1)}% discount on ${modelString}`);
        }

        // Reset 500 error count on success
        model500ErrorCount.set(modelString, 0);

        return {
            content: choice.message.content || '',
            tool_calls: choice.message.tool_calls || [],
            finish_reason: choice.finish_reason,
            usage: response.data.usage
        };
    } catch (error) {
        // Clear heartbeat on error
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }
        const status = error.response?.status;
        const errorData = error.response?.data;

        console.error('OpenRouter API error:', errorData || error.message);

        // Handle 402 - Insufficient credits: retry with reduced max_tokens
        if (status === 402) {
            const errorMsg = errorData?.error?.message || '';
            const match = errorMsg.match(/can only afford (\d+)/);

            if (match) {
                const available = parseInt(match[1]);
                const reduced = Math.floor(available * 0.8); // 80% buffer for prompt

                if (reduced >= 500 && maxTokens > reduced) {
                    console.log(`[LLM] 402 error - retrying with reduced max_tokens: ${reduced} (was ${maxTokens})`);

                    // Recursive retry with reduced tokens (no infinite loop - only retries once)
                    return await callSonnet({
                        role,
                        systemPrompt,
                        messages,
                        tools,
                        model,
                        maxTokens: reduced,
                        temperature
                    });
                }
            }

            throw new Error(`LLM API call failed: insufficient credits (402) - requested ${maxTokens} tokens`);
        }

        // Handle 500 - Server errors: try fallback model after axios-retry exhausts retries
        if (status >= 500) {
            // Track consecutive 500 errors for this model
            const currentCount = (model500ErrorCount.get(modelString) || 0) + 1;
            model500ErrorCount.set(modelString, currentCount);

            // After 2 failures with this model, try a fallback
            if (currentCount >= 2) {
                const fallbackModel = FALLBACK_MODELS.find(m => m !== modelString);

                if (fallbackModel) {
                    console.log(`[LLM] Persistent 500 errors (${currentCount}x) - falling back to ${fallbackModel}`);

                    // Reset error count and try fallback
                    model500ErrorCount.set(modelString, 0);

                    return await callSonnet({
                        role,
                        systemPrompt,
                        messages,
                        tools,
                        model: fallbackModel, // Use full model string, not preset key
                        maxTokens,
                        temperature
                    });
                }
            }
        }

        throw new Error(`LLM API call failed: ${error.message}`);
    }
}

/**
 * Helper to extract JSON from LLM response (handles markdown code blocks)
 * @param {string} content - LLM response content
 * @returns {object} Parsed JSON
 */
function extractJSON(content) {
    // Remove markdown code blocks if present
    const cleaned = content
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

    try {
        return JSON.parse(cleaned);
    } catch (error) {
        // Try to find JSON object in the text
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Could not extract valid JSON from response');
    }
}

module.exports = {
    callSonnet,
    MODEL_PRESETS
};