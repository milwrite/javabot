/**
 * Model Configuration for OpenRouter API
 * Defines available models, reasoning configs, and model utilities
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models (2025 latest) - All ZDR-compliant
const MODEL_PRESETS = {
    'glm': 'z-ai/glm-4.6:exacto',
    'kimi': 'moonshotai/kimi-k2-thinking',
    'kimi-fast': 'moonshotai/kimi-k2-0905:exacto',
    'qwen': 'qwen/qwen3-coder',
    'gemini': 'google/gemini-2.5-pro',
    'minimax': 'minimax/minimax-m2'
};

// SINGLE SOURCE OF TRUTH: Default model for all operations
const DEFAULT_MODEL = 'glm';

// Reasoning configuration per model (interleaved thinking support)
// Models that support reasoning will expose thinking during tool-calling workflows
const REASONING_CONFIG = {
    // Kimi K2 thinking - mandatory reasoning with <think> tokens (default)
    'moonshotai/kimi-k2-thinking': { effort: 'low' },
    // Gemini - supports reasoning
    'google/gemini-2.5-pro': { effort: 'low' },
    // Models without reasoning support - graceful skip
    'perplexity/sonar': null,
    'moonshotai/kimi-k2-0905:exacto': null,
    'qwen/qwen3-coder': null,
    'z-ai/glm-4.6:exacto': null,
    'default': null  // Fallback: no reasoning for unknown models
};

/**
 * Get reasoning config for a model
 * @param {string} model - Model identifier
 * @returns {object|null} - Reasoning config or null if not supported
 */
function getReasoningConfig(model) {
    return REASONING_CONFIG[model] || REASONING_CONFIG['default'];
}

/**
 * Format reasoning for Discord (condensed 80 char summary)
 * Currently disabled - returns null
 * @param {string} reasoning - Raw reasoning text
 * @returns {null}
 */
function formatThinkingForDiscord(reasoning) {
    return null;
}

/**
 * Format reasoning for GUI (fuller display)
 * Currently disabled - returns null
 * @param {string} reasoning - Raw reasoning text
 * @returns {null}
 */
function formatThinkingForGUI(reasoning) {
    return null;
}

/**
 * Get the default model identifier
 * @returns {string} - Default model string
 */
function getDefaultModel() {
    return MODEL_PRESETS[DEFAULT_MODEL];
}

/**
 * Check if a model key is valid
 * @param {string} modelKey - Model preset key
 * @returns {boolean}
 */
function isValidModelKey(modelKey) {
    return modelKey in MODEL_PRESETS;
}

/**
 * Get available model keys
 * @returns {string[]}
 */
function getAvailableModels() {
    return Object.keys(MODEL_PRESETS);
}

module.exports = {
    OPENROUTER_URL,
    MODEL_PRESETS,
    DEFAULT_MODEL,
    REASONING_CONFIG,
    getReasoningConfig,
    formatThinkingForDiscord,
    formatThinkingForGUI,
    getDefaultModel,
    isValidModelKey,
    getAvailableModels
};
