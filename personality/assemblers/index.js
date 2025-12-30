/**
 * Prompt Assemblers Module
 * Combines modular prompts for each pipeline stage
 * Reduces token usage by loading only necessary context per stage
 */

// Core modules (identity, capabilities, repository)
const identity = require('../core/identity');
const capabilities = require('../core/capabilities');
const repository = require('../core/repository');

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
 * Includes: core identity, capabilities, repository, all tools, file ops, git, search
 * Token estimate: ~250 lines (vs 372 in monolithic)
 * Usage: index.js getLLMResponse() agentic loop
 */
function assembleFullAgent() {
    return [
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
}

/**
 * Assemble router prompt (for fast routing stage)
 * Includes: minimal routing context with tool awareness
 * Token estimate: ~100 lines (standardized vs custom)
 * Usage: services/llmRouter.js generateRoutingPlan()
 */
function assembleRouter() {
    return routing;
}

/**
 * Assemble edit mode prompt (for edit workflow stage)
 * Includes: repository URLs/paths, file operations, edit workflow enforcement
 * Token estimate: ~120 lines (vs 398 with full system prompt + suffix)
 * Usage: services/editService.js getEditResponse()
 */
function assembleEditMode() {
    return [
        repository,
        '\n\n',
        fileOperations,
        '\n\n',
        editing
    ].join('');
}

/**
 * Assemble chat prompt (for conversation fast path)
 * Includes: identity (personality), capabilities, repository URLs
 * Token estimate: ~100 lines (vs 372 full system prompt)
 * Usage: index.js mention handler chat fast path
 */
function assembleChat() {
    return [
        identity,
        '\n\n',
        repository,
        '\n\n',
        capabilities
    ].join('');
}

/**
 * Assemble architect prompt (for content pipeline planning)
 * Includes: BASE_SYSTEM_CONTEXT + architect role instructions
 * Token estimate: ~100 lines
 * Usage: agents/gameArchitect.js, services/llmClient.js
 */
function assembleArchitect() {
    return agentRoles.architect;
}

/**
 * Assemble builder prompt (for content generation)
 * Includes: BASE_SYSTEM_CONTEXT + TEMPLATE_PROMPT + builder instructions
 * Token estimate: ~400 lines (includes full template catalog)
 * Usage: agents/gameBuilder.js, services/llmClient.js
 */
function assembleBuilder() {
    return agentRoles.builder;
}

/**
 * Assemble tester prompt (for content validation)
 * Includes: BASE_SYSTEM_CONTEXT + validation rules + scoring
 * Token estimate: ~150 lines
 * Usage: agents/gameTester.js, services/llmClient.js
 */
function assembleTester() {
    return agentRoles.tester;
}

/**
 * Assemble scribe prompt (for metadata generation)
 * Includes: metadata rules + Doc Sportello voice for release notes
 * Token estimate: ~60 lines
 * Usage: agents/gameScribe.js, services/llmClient.js
 */
function assembleScribe() {
    return agentRoles.scribe;
}

/**
 * Assemble content creation prompt (for /add-page, /add-feature)
 * Includes: full content creation context with design system
 * Token estimate: ~500 lines (comprehensive content creation)
 * Usage: When creating pages/features via slash commands
 */
function assembleContentCreation() {
    return [
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
