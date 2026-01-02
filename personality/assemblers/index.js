/**
 * Prompt Assemblers Module
 * Combines modular prompts for each pipeline stage
 * Reduces token usage by loading only necessary context per stage
 */

// PostgreSQL logging for prompt analytics
let postgres;
try {
    postgres = require('../../services/postgres');
} catch (e) {
    // Allow module to work even if postgres not available
    postgres = { logPromptUsage: () => {} };
}

/**
 * Log prompt assembly for analytics
 * @param {string} role - The assembler role (fullAgent, router, etc.)
 * @param {string[]} modules - List of modules assembled
 * @param {number} charCount - Total character count of assembled prompt
 */
function logPromptAssembly(role, modules, charCount) {
    // Estimate tokens (rough approximation: 1 token ≈ 4 chars)
    const tokenEstimate = Math.round(charCount / 4);

    postgres.logPromptUsage({
        role,
        modules,
        tokenEstimate
    });
}

// Core modules (identity, capabilities, repository, exploration, context)
const identity = require('../core/identity');
const capabilities = require('../core/capabilities');
const repository = require('../core/repository');
const explorationRules = require('../core/explorationRules');
const contextRules = require('../core/contextRules');

// Tool modules (tool catalog, file ops, git ops, search)
const { all: allTools, editMode: editModeTools, routingAware: routingToolNames } = require('../tools/toolCatalog');
const fileOperations = require('../tools/fileOperations');
const gitOperations = require('../tools/gitOperations');
const searchGuidelines = require('../tools/searchGuidelines');

// Content modules (design system, CSS classes, mobile patterns, page structure, components)
const designSystem = require('../content/designSystem');
const cssClasses = require('../content/cssClasses');
const mobilePatterns = require('../content/mobilePatterns');
const pageStructure = require('../content/pageStructure');
const components = require('../content/components');

// Specialized modules (routing, editing, agent roles)
const routing = require('../specialized/routing');
const editing = require('../specialized/editing');
const agentRoles = require('../specialized/agentRoles');

/**
 * Assemble full agent prompt (for tool execution stage)
 * Includes: exploration rules, context rules, identity, repository, capabilities, file ops, git, search
 * Token estimate: ~350 lines (vs 372 in monolithic, but with stronger anti-hallucination rules)
 * Usage: index.js getLLMResponse() agentic loop
 */
function assembleFullAgent() {
    const modules = ['explorationRules', 'contextRules', 'identity', 'repository', 'capabilities', 'fileOperations', 'gitOperations', 'searchGuidelines'];
    const result = [
        explorationRules,
        '\n\n',
        contextRules,
        '\n\n',
        identity,
        '\n\n',
        repository,
        '\n\n',
        capabilities,
        '\n\n',
        fileOperations,
        '\n\n',
        gitOperations,
        '\n\n',
        searchGuidelines
    ].join('');
    logPromptAssembly('fullAgent', modules, result.length);
    return result;
}

/**
 * Assemble router prompt (for fast routing stage)
 * Includes: minimal routing context with tool awareness
 * Token estimate: ~100 lines (standardized vs custom)
 * Usage: services/llmRouter.js generateRoutingPlan()
 */
function assembleRouter() {
    logPromptAssembly('router', ['routing'], routing.length);
    return routing;
}

/**
 * Assemble edit mode prompt (for edit workflow stage)
 * Includes: identity (personality), repository URLs/paths, file operations, edit workflow enforcement
 * Token estimate: ~150 lines (vs 398 with full system prompt + suffix)
 * Usage: services/editService.js getEditResponse()
 */
function assembleEditMode() {
    const modules = ['identity', 'repository', 'fileOperations', 'editing'];
    const result = [
        identity,
        '\n\n',
        repository,
        '\n\n',
        fileOperations,
        '\n\n',
        editing
    ].join('');
    logPromptAssembly('editMode', modules, result.length);
    return result;
}

/**
 * Assemble chat prompt (for conversation fast path)
 * Includes: identity (personality), capabilities, repository URLs
 * Token estimate: ~100 lines (vs 372 full system prompt)
 * Usage: index.js mention handler chat fast path
 */
function assembleChat() {
    const modules = ['identity', 'repository', 'capabilities'];
    const result = [
        identity,
        '\n\n',
        repository,
        '\n\n',
        capabilities
    ].join('');
    logPromptAssembly('chat', modules, result.length);
    return result;
}

/**
 * Assemble architect prompt (for content pipeline planning)
 * Includes: BASE_SYSTEM_CONTEXT + architect role instructions
 * Token estimate: ~100 lines
 * Usage: agents/gameArchitect.js, services/llmClient.js
 */
function assembleArchitect() {
    const prompt = agentRoles.architect;
    logPromptAssembly('architect', ['agentRoles.architect'], prompt.length);
    return prompt;
}

/**
 * Assemble builder prompt (for content generation)
 * Includes: BASE_SYSTEM_CONTEXT + TEMPLATE_PROMPT + builder instructions
 * Token estimate: ~400 lines (includes full template catalog)
 * Usage: agents/gameBuilder.js, services/llmClient.js
 */
function assembleBuilder() {
    const prompt = agentRoles.builder;
    logPromptAssembly('builder', ['agentRoles.builder'], prompt.length);
    return prompt;
}

/**
 * Assemble tester prompt (for content validation)
 * Includes: BASE_SYSTEM_CONTEXT + validation rules + scoring
 * Token estimate: ~150 lines
 * Usage: agents/gameTester.js, services/llmClient.js
 */
function assembleTester() {
    const prompt = agentRoles.tester;
    logPromptAssembly('tester', ['agentRoles.tester'], prompt.length);
    return prompt;
}

/**
 * Assemble scribe prompt (for metadata generation)
 * Includes: metadata rules + Doc Sportello voice for release notes
 * Token estimate: ~60 lines
 * Usage: agents/gameScribe.js, services/llmClient.js
 */
function assembleScribe() {
    const prompt = agentRoles.scribe;
    logPromptAssembly('scribe', ['agentRoles.scribe'], prompt.length);
    return prompt;
}

/**
 * Assemble content creation prompt (for /add-page, /add-feature)
 * Includes: full content creation context with design system
 * Token estimate: ~500 lines (comprehensive content creation)
 * Usage: When creating pages/features via slash commands
 */
function assembleContentCreation() {
    const modules = ['identity', 'repository', 'designSystem', 'cssClasses', 'mobilePatterns', 'pageStructure', 'components'];
    const result = [
        identity,
        '\n\n',
        repository,
        '\n\n',
        designSystem,
        '\n\n',
        cssClasses,
        '\n\n',
        mobilePatterns,
        '\n\n',
        pageStructure,
        '\n\n',
        components
    ].join('');
    logPromptAssembly('contentCreation', modules, result.length);
    return result;
}

// Export tool definitions for direct use
module.exports = {
    // Assembler functions
    assembleFullAgent,
    assembleRouter,
    assembleEditMode,
    assembleChat,
    assembleArchitect,
    assembleBuilder,
    assembleTester,
    assembleScribe,
    assembleContentCreation,

    // Tool definitions (for direct import)
    tools: allTools,
    editModeTools,
    routingToolNames
};
