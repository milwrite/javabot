/**
 * Model Configuration for OpenRouter API
 * Defines available models, reasoning configs, and model utilities
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models (2025 latest) - All ZDR-compliant
const MODEL_PRESETS = {
    'glm': 'z-ai/glm-4.6:exacto',
    'deepseek': 'deepseek/deepseek-v3.1-terminus:exacto',
    'kimi': 'moonshotai/kimi-k2.5',
    'kimi-fast': 'moonshotai/kimi-k2-0905:exacto',
    'qwen': 'qwen/qwen3-coder:exacto',
    'minimax': 'minimax/minimax-m2.1',
    'mimo': 'xiaomi/mimo-v2-flash'
};

// Human-readable display names for each model
const MODEL_DISPLAY_NAMES = {
    'glm': 'GLM 4.6 Exacto',
    'deepseek': 'DeepSeek V3.1 Terminus',
    'kimi': 'Kimi K2.5 (Default)',
    'kimi-fast': 'Kimi K2 Fast',
    'qwen': 'Qwen 3 Coder',
    'minimax': 'Minimax M2.1',
    'mimo': 'MiMo V2 Flash'
};

// SINGLE SOURCE OF TRUTH: Default model for all operations
const DEFAULT_MODEL = 'kimi';

// Reasoning configuration per model (interleaved thinking support)
// Models that support reasoning will expose thinking during tool-calling workflows
const REASONING_CONFIG = {
    // Kimi K2.5 - supports reasoning with extended context
    'moonshotai/kimi-k2.5': { effort: 'low' },
    // Kimi K2 thinking (legacy) - mandatory reasoning with <think> tokens
    'moonshotai/kimi-k2-thinking': { effort: 'low' },
    // Models without reasoning support - graceful skip
    'deepseek/deepseek-v3.1-terminus:exacto': null,
    'perplexity/sonar': null,
    'perplexity/sonar-deep-research': null,  // Uses internal reasoning
    'moonshotai/kimi-k2-0905:exacto': null,
    'qwen/qwen3-coder:exacto': null,
    'xiaomi/mimo-v2-flash': null,
    'minimax/minimax-m2.1': null,
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

/**
 * Get display name for a model key
 * @param {string} modelKey - Model preset key
 * @returns {string} - Human-readable display name
 */
function getModelDisplayName(modelKey) {
    return MODEL_DISPLAY_NAMES[modelKey] || modelKey;
}

/**
 * Get slash command choices for model selection
 * @returns {Array} - Array of {name, value} objects for Discord slash commands
 */
function getModelChoices() {
    return Object.keys(MODEL_PRESETS).map(key => ({
        name: MODEL_DISPLAY_NAMES[key] || key,
        value: key
    }));
}

module.exports = {
    OPENROUTER_URL,
    MODEL_PRESETS,
    MODEL_DISPLAY_NAMES,
    DEFAULT_MODEL,
    REASONING_CONFIG,
    getReasoningConfig,
    formatThinkingForDiscord,
    formatThinkingForGUI,
    getDefaultModel,
    isValidModelKey,
    getAvailableModels,
    getModelDisplayName,
    getModelChoices
};
