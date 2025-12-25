require('dotenv').config({ override: true });
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Octokit } = require('@octokit/rest');
// simple-git removed - using GitHub API instead for Railway compatibility
const fs = require('fs').promises;
const fsSync = require('fs');
const { execSync } = require('child_process');

// Git binary detection removed - using GitHub API for all operations
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

// Game pipeline modules (system-v1)
const { runGamePipeline, commitGameFiles, isGameRequest, isEditRequest } = require('./services/gamePipeline');
const { getRecentPatternsSummary } = require('./services/buildLogs');
const { classifyRequest } = require('./services/requestClassifier');

// Filesystem and Git tools (Phase 2 extraction)
const { listFiles: listFilesService, fileExists: fileExistsService, readFile: readFileService, writeFile: writeFileService, editFile: editFileService, searchFiles: searchFilesService } = require('./services/filesystem');
const { pushFileViaAPI } = require('./services/gitHelper');
const { deepResearch, formatForDiscord: formatDeepResearchForDiscord, generateReportHTML, DEEP_RESEARCH_MODEL } = require('./services/deepResearch');

// Modular imports (Phase 1 extraction)
const { getBotResponse, botResponses } = require('./personality/botResponses');
const { DEFAULT_SYSTEM_PROMPT } = require('./personality/systemPrompt');

// Site inventory system
const { generateSiteInventory } = require('./scripts/generateSiteInventory.js');

// Site configuration - Single source of truth
const SITE_CONFIG = require('./site-config.js');

// GUI Server for verbose logging
const BotGUIServer = require('./scripts/gui-server.js');
let guiServer = null;

// PostgreSQL logging service
const postgres = require('./services/postgres');

// Edit service (streamlined edit loop)
const { getEditResponse: getEditResponseService } = require('./services/editService');

// Validate required environment variables
const REQUIRED_ENV_VARS = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'GITHUB_TOKEN',
    'GITHUB_REPO_OWNER',
    'GITHUB_REPO_NAME',
    'GITHUB_REPO_URL',
    'OPENROUTER_API_KEY'
];

const missingVars = REQUIRED_ENV_VARS.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:', missingVars.join(', '));
    console.error('Please check your .env file');
    process.exit(1);
}

// Validate GitHub token format and configuration
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken.startsWith('ghp_') && !githubToken.startsWith('github_pat_')) {
    console.warn('⚠️ GitHub token format may be invalid - should start with ghp_ or github_pat_');
}

console.log('✅ All required environment variables loaded');
if (process.env.NODE_ENV === 'development') {
    console.log(`🔐 GitHub token (prefix): ${githubToken.substring(0, 8)}...`);
} else {
    console.log('🔐 GitHub token loaded');
}
console.log(`📂 Repository: ${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}`);

// OpenRouter API Key Management with Fallback
let activeOpenRouterKey = process.env.OPENROUTER_API_KEY;
let usingFallbackKey = false;

function getOpenRouterKey() {
    return activeOpenRouterKey;
}

function switchToFallbackKey() {
    if (!usingFallbackKey && process.env.OPENROUTER_FALLBACK) {
        activeOpenRouterKey = process.env.OPENROUTER_FALLBACK;
        usingFallbackKey = true;
        console.log('🔄 Switched to fallback OpenRouter API key');
        return true;
    }
    return false;
}

if (process.env.OPENROUTER_FALLBACK) {
    console.log('🔑 Fallback OpenRouter key configured');
}

// Initialize GUI server
if (!process.env.NO_GUI) {
    guiServer = new BotGUIServer(process.env.GUI_PORT || 3001);
    guiServer.start().catch(err => {
        console.error('Failed to start GUI server:', err);
        guiServer = null;
    });
}

// Initialize PostgreSQL logging (non-blocking)
postgres.init().catch(err => {
    console.error('[POSTGRES] Init failed:', err.message);
});

// Configuration constants
const CONFIG = {
    FILE_READ_LIMIT: 5000,
    RESPONSE_LENGTH_LIMIT: 2000,
    RESPONSE_TRUNCATE_LENGTH: 1800,
    POLL_DURATION: 60000,
    AI_MAX_TOKENS: 10000,
    AI_TEMPERATURE: 0.7,
    GIT_TIMEOUT: 30000,
    PUSH_TIMEOUT: 60000,
    API_TIMEOUT: 60000,
    DISCORD_FETCH_LIMIT: 10,       // Max messages to fetch per Discord API request
    DISCORD_CONTEXT_LIMIT: 10,     // Messages to include in LLM context
    DISCORD_CACHE_TTL: 60000,     // Cache duration (1 minute)
    INCLUDE_REACTIONS: true       // Add reaction data to context
};

const DEFAULT_COLLECTIONS = {
    'featured': { title: '🎯 Featured', description: 'Spotlight builds and journeys', order: 1 },
    'arcade-games': { title: '🕹️ Arcade Games', description: 'Mobile-ready noir cabinets', order: 2 },
    'utilities-apps': { title: '📋 Utilities & Apps', description: 'Planners, trackers, calculators', order: 3 },
    'stories-content': { title: '📖 Stories & Content', description: 'Letters, recipes, transmissions', order: 4 },
    'unsorted': { title: '🗂️ Unsorted', description: 'Pages awaiting placement', order: 99 }
};

// Error tracking to prevent loops
const errorTracker = new Map();
const MAX_ERROR_COUNT = 3;
const ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes

// Action cache - stores recent tool actions per channel for conversational context
// This allows follow-up requests like "add more margin to the cards" to know which file was edited
const actionCache = new Map(); // channelId -> { actions: [], timestamp }
const ACTION_CACHE_CONFIG = {
    MAX_ACTIONS_PER_CHANNEL: 5,     // Keep last 5 actions
    ACTION_TTL: 10 * 60 * 1000,     // 10 minutes - longer than Discord cache to survive cache refreshes
};

// Record an action to the cache for conversational context
function recordAction(channelId, action) {
    const entry = actionCache.get(channelId) || { actions: [], timestamp: Date.now() };

    // Add action with metadata
    entry.actions.push({
        type: action.type,          // 'edit', 'create', 'write', 'commit', etc.
        file: action.file,          // file path that was modified
        summary: action.summary,    // brief description of what was done
        timestamp: Date.now()
    });

    // Trim to max actions
    if (entry.actions.length > ACTION_CACHE_CONFIG.MAX_ACTIONS_PER_CHANNEL) {
        entry.actions = entry.actions.slice(-ACTION_CACHE_CONFIG.MAX_ACTIONS_PER_CHANNEL);
    }

    entry.timestamp = Date.now();
    actionCache.set(channelId, entry);

    console.log(`[ACTION_CACHE] Recorded ${action.type} on ${action.file} for channel ${channelId}`);
}

// Get recent actions for a channel (for context injection)
function getRecentActions(channelId) {
    const entry = actionCache.get(channelId);
    if (!entry) return [];

    // Check TTL
    if (Date.now() - entry.timestamp > ACTION_CACHE_CONFIG.ACTION_TTL) {
        actionCache.delete(channelId);
        console.log(`[ACTION_CACHE] Expired actions for channel ${channelId}`);
        return [];
    }

    return entry.actions;
}

// Build an action context summary for the LLM
function buildActionContextSummary(channelId) {
    const actions = getRecentActions(channelId);
    if (actions.length === 0) return null;

    const actionLines = actions.map(a =>
        `- ${a.type.toUpperCase()}: ${a.file}${a.summary ? ` (${a.summary})` : ''}`
    );

    return `[RECENT BOT ACTIONS - use this context for follow-up requests]\n${actionLines.join('\n')}`;
}

// GUI logging helper functions
function logToGUI(level, message, data = {}) {
    if (guiServer) {
        guiServer.log(level, message, data);
    }
}
// Make logToGUI available globally for other modules
global.logToGUI = logToGUI;

function logToolCall(toolName, args, result, error = null, options = {}) {
    if (guiServer) {
        guiServer.logToolCall(toolName, args, result, error);
    }
    // Log to PostgreSQL (fire-and-forget)
    postgres.logToolCall({
        toolName,
        args,
        result: typeof result === 'string' ? result : JSON.stringify(result),
        error: error ? String(error) : null,
        durationMs: options.durationMs,
        iteration: options.iteration,
        channelId: options.channelId,
        userId: options.userId
    });
}

function logFileChange(action, path, content = null, oldContent = null, channelId = null) {
    if (guiServer) {
        guiServer.logFileChange(action, path, content, oldContent);
    }
    // Log to PostgreSQL (fire-and-forget)
    postgres.logFileChange({
        action,
        path,
        contentPreview: content ? content.slice(0, 500) : null,
        channelId
    });
}

function startAgentLoop(command, user, channel) {
    if (guiServer) {
        return guiServer.startAgentLoop(command, user, channel);
    }
    return null;
}

function updateAgentLoop(iteration, toolsUsed, thinking = null) {
    if (guiServer) {
        guiServer.updateAgentLoop(iteration, toolsUsed, thinking);
    }
}

function endAgentLoop(result, error = null, options = {}) {
    if (guiServer) {
        guiServer.endAgentLoop(result, error);
    }
    // Log to PostgreSQL (fire-and-forget)
    if (options.command) {
        postgres.logAgentLoop({
            command: options.command,
            toolsUsed: options.toolsUsed || [],
            finalResult: result,
            status: error ? 'error' : 'completed',
            durationMs: options.durationMs,
            userId: options.userId,
            channelId: options.channelId
        });
    }
}

// Periodic cleanup of error tracker to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, data] of errorTracker.entries()) {
        if (now - data.lastError > ERROR_RESET_TIME) {
            expiredKeys.push(key);
        }
    }

    expiredKeys.forEach(key => errorTracker.delete(key));

    if (expiredKeys.length > 0) {
        logEvent('CLEANUP', `Cleaned up ${expiredKeys.length} expired error tracking entries`);
    }

    // Additional memory cleanup - force garbage collection of old message objects
    if (messageHistory.length > 50 && global.gc) {
        global.gc();
        logEvent('GC', 'Forced garbage collection for memory optimization');
    }
}, ERROR_RESET_TIME);

// Message history tracking
const messageHistory = [];
const MAX_HISTORY = 100; // Increased from 20 to 100

// Parse channel IDs (supports comma-separated list)
const CHANNEL_IDS = process.env.CHANNEL_ID
    ? process.env.CHANNEL_ID.split(',').map(id => id.trim())
    : [];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});

// simpleGit removed - all git operations now use GitHub API via services/gitHelper.js

// Discord Context Manager - fetches message history directly from Discord API
// Replaces agents.md file-based memory with real-time Discord awareness
class DiscordContextManager {
    constructor(discordClient) {
        this.client = discordClient;
        this.cache = new Map(); // channelId -> { messages, timestamp }
    }

    // Keep cache hot when new messages arrive (prevents stale context within TTL)
    upsertMessage(discordMessage, limit = CONFIG.DISCORD_FETCH_LIMIT) {
        const channelId = discordMessage.channel.id;
        const cached = this.cache.get(channelId);

        // Start fresh if we have no cache yet
        if (!cached) {
            this.cache.set(channelId, {
                data: [discordMessage],
                timestamp: Date.now()
            });
            return;
        }

        // Replace or append message, then trim to most recent N chronologically
        const updated = [...cached.data];
        const idx = updated.findIndex(msg => msg.id === discordMessage.id);
        if (idx >= 0) {
            updated[idx] = discordMessage;
        } else {
            updated.push(discordMessage);
        }

        // Sort by creation time to keep chronological order, then trim
        updated.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const trimmed = updated.slice(-limit);

        this.cache.set(channelId, {
            data: trimmed,
            timestamp: Date.now()
        });
    }

    // Fetch message history from Discord API with caching
    async fetchChannelHistory(channel, limit = CONFIG.DISCORD_FETCH_LIMIT) {
        const cacheKey = channel.id;
        const cached = this.cache.get(cacheKey);

        // Return cache if fresh
        if (cached && Date.now() - cached.timestamp < CONFIG.DISCORD_CACHE_TTL) {
            console.log(`[CONTEXT] Using cached history for #${channel.name || channel.id} (${cached.data.length} messages)`);
            return cached.data;
        }

        try {
            console.log(`[CONTEXT] Fetching ${limit} messages from #${channel.name || channel.id}`);

            // Discord.js channel.messages.fetch()
            const messages = await channel.messages.fetch({ limit });

            // Convert Collection to array, reverse for chronological order
            const messageArray = Array.from(messages.values()).reverse();

            // Cache the result
            this.cache.set(cacheKey, {
                data: messageArray,
                timestamp: Date.now()
            });

            console.log(`[CONTEXT] Cached ${messageArray.length} messages for #${channel.name || channel.id}`);
            return messageArray;
        } catch (error) {
            console.error(`[CONTEXT] Failed to fetch history:`, error.message);
            return null;
        }
    }

    // Convert a Discord message to LLM-ready format with reactions
    formatMessageForLLM(discordMessage) {
        const author = discordMessage.author;
        const isBot = author.bot && author.id === this.client.user?.id;

        let content = discordMessage.content || '';

        // Strip bot mentions for cleaner context
        content = content.replace(/<@!?\d+>/g, '').trim();

        // Skip empty messages
        if (!content) return null;

        // Build formatted content string
        // Important: avoid prefixing assistant messages with the bot name,
        // because the model may mimic it and duplicate prefixes.
        let formattedContent = isBot ? content : `${author.username}: ${content}`;

        // Add reaction summary if configured and present
        if (CONFIG.INCLUDE_REACTIONS && discordMessage.reactions?.cache?.size > 0) {
            const reactions = Array.from(discordMessage.reactions.cache.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 3) // Top 3 reactions
                .map(r => `${r.emoji.name}(${r.count})`)
                .join(' ');
            formattedContent += ` [reactions: ${reactions}]`;
        }

        return {
            role: isBot ? 'assistant' : 'user',
            content: formattedContent,
            timestamp: discordMessage.createdTimestamp
        };
    }

    // Build LLM context from Discord channel history
    async buildContextFromChannel(channel, maxMessages = CONFIG.DISCORD_CONTEXT_LIMIT) {
        const history = await this.fetchChannelHistory(channel, maxMessages + 5);

        if (!history || history.length === 0) {
            console.log(`[CONTEXT] No history available for channel`);
            return [];
        }

        // Format messages for LLM, filtering out nulls (empty messages)
        const formatted = history
            .map(msg => this.formatMessageForLLM(msg))
            .filter(msg => msg !== null)
            .slice(-maxMessages);

        console.log(`[CONTEXT] Built context: ${formatted.length} messages from Discord`);
        // Debug: show what's in the context window
        formatted.forEach((msg, i) => {
            console.log(`[CONTEXT] ${i+1}. [${msg.role}] ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        });
        return formatted;
    }

    // Invalidate cache for a channel (call when we know messages changed)
    invalidateCache(channelId) {
        if (this.cache.has(channelId)) {
            this.cache.delete(channelId);
            console.log(`[CONTEXT] Cache invalidated for channel ${channelId}`);
        }
    }

    // Get channel metadata for enhanced context
    getChannelMetadata(channel) {
        return {
            name: channel.name || 'DM',
            topic: channel.topic || null,
            type: channel.type,
            isThread: typeof channel.isThread === 'function' ? channel.isThread() : false
        };
    }
}

// Global context manager instance (initialized in clientReady)
let contextManager = null;


// Note: getEncodedRemoteUrl removed (migrated to GitHub API via services/gitHelper)

// pushWithAuth removed - now using pushFileViaAPI from services/gitHelper.js
// All git push operations use GitHub API instead of git CLI for Railway compatibility

// initializeGitRemote removed - GitHub API doesn't need local git remote setup

// gitWithTimeout removed - GitHub API has its own timeout handling

// Discord interaction timeout handler with automatic fallback to channel messages
// Discord interactions expire after 15 minutes - this detects and handles that gracefully
async function safeEditReply(interactionOrMessage, content, options = {}) {
    const isInteraction = interactionOrMessage.isCommand?.() || interactionOrMessage.deferred !== undefined;

    if (isInteraction) {
        const interaction = interactionOrMessage;

        try {
            // Discord interactions expire after 15 minutes (900000ms)
            const age = Date.now() - interaction.createdTimestamp;
            const INTERACTION_TIMEOUT = 840000; // 14 min safety margin

            if (age > INTERACTION_TIMEOUT) {
                console.warn(`⚠️ Interaction age: ${Math.round(age/1000)}s - near expiration, attempting fallback`);

                // Interaction likely expired - send to channel instead
                const fallbackContent = typeof content === 'string' ? content : '';
                const fallbackEmbeds = options.embeds || (content.embeds ? content.embeds : []);

                await interaction.channel.send({
                    content: `<@${interaction.user.id}> ${fallbackContent}`,
                    embeds: fallbackEmbeds
                });

                console.log('✅ Sent fallback message to channel (interaction expired)');
                return { success: true, usedFallback: true };
            }

            // Interaction still valid - use normal edit
            if (typeof content === 'string') {
                await interaction.editReply({ content, ...options });
            } else {
                await interaction.editReply(content);
            }

            return { success: true, usedFallback: false };

        } catch (error) {
            // Handle specific Discord error codes
            if (error.code === 10062 || error.message?.includes('Unknown interaction')) {
                console.error('❌ Interaction expired (10062) - sending fallback to channel');

                try {
                    const fallbackContent = typeof content === 'string' ? content : '';
                    const fallbackEmbeds = options.embeds || (content.embeds ? content.embeds : []);

                    await interaction.channel.send({
                        content: `<@${interaction.user.id}> ${fallbackContent}`,
                        embeds: fallbackEmbeds
                    });

                    return { success: true, usedFallback: true };
                } catch (fallbackError) {
                    console.error('❌ Fallback channel message also failed:', fallbackError.message);
                    return { success: false, error: fallbackError.message };
                }
            }

            // Other error - re-throw
            throw error;
        }
    } else {
        // It's a message object (from @mention) - use edit
        const message = interactionOrMessage;

        try {
            if (typeof content === 'string') {
                await message.edit(content);
            } else if (content.embeds) {
                await message.edit({ embeds: content.embeds });
            } else {
                await message.edit(content);
            }

            return { success: true, usedFallback: false };
        } catch (error) {
            console.error('❌ Message edit failed:', error.message);
            return { success: false, error: error.message };
        }
    }
}

// Enhanced error logging and tracking for better debugging
const errorLogger = {
    log: (context, error, metadata = {}) => {
        const timestamp = new Date().toISOString();
        const errorEntry = {
            timestamp,
            context,
            message: error.message || error,
            stack: error.stack,
            metadata
        };
        
        console.error(`[${context}] ${timestamp}:`, error.message || error);
        if (error.stack && !error.message?.includes('timeout')) {
            console.error('Stack:', error.stack);
        }
        
        // Log additional metadata if present
        if (Object.keys(metadata).length > 0) {
            console.error('Metadata:', JSON.stringify(metadata, null, 2));
        }
        
        // Track authentication-related errors specifically
        if (error.message?.includes('authentication') || 
            error.message?.includes('Permission') ||
            error.message?.includes('fatal: could not read') ||
            error.message?.includes('remote: Invalid username or password')) {
            console.error('🔐 AUTHENTICATION ERROR DETECTED - Check GitHub token');
            if (guiServer) {
                guiServer.log('error', 'AUTH_ERROR', { context, error: error.message });
            }
        }
        
        return errorEntry;
    },
    
    track: (errorEntry) => {
        // Track error for patterns (could be enhanced to write to file)
        if (guiServer) {
            guiServer.log('error', errorEntry.context, { message: errorEntry.message, metadata: errorEntry.metadata });
        }
    }
};

// Pipeline validation and recovery system
const pipelineValidator = {
    // Validate git repository state using GitHub API
    async validateGitState() {
        try {
            const { getRepoStatus } = require('./services/gitHelper');
            const status = await getRepoStatus('main');
            
            return {
                valid: true,
                branch: status.current || 'main',
                hasChanges: false, // GitHub API doesn't track local changes
                status
            };
        } catch (error) {
            errorLogger.log('VALIDATE_GIT_STATE', error);
            return { valid: false, error: error.message };
        }
    },
    
    // Validate environment variables are present
    validateEnvironment() {
        const required = ['GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME'];
        const missing = required.filter(env => !process.env[env]);
        
        if (missing.length > 0) {
            const error = new Error(`Missing environment variables: ${missing.join(', ')}`);
            errorLogger.log('VALIDATE_ENV', error);
            return { valid: false, missing };
        }
        
        return { valid: true };
    },
    
    // Validate file operations before committing
    async validateFileOperations(filePaths) {
        const issues = [];
        
        for (const filePath of filePaths) {
            try {
                const stats = await fs.stat(filePath);
                if (stats.size === 0) {
                    issues.push(`${filePath} is empty`);
                }
                
                // Check if HTML files are valid (basic check)
                if (filePath.endsWith('.html')) {
                    const content = await fs.readFile(filePath, 'utf-8');
                    if (!content.includes('</html>')) {
                        issues.push(`${filePath} appears to be incomplete (missing closing html tag)`);
                    }
                }
            } catch (error) {
                issues.push(`${filePath} cannot be accessed: ${error.message}`);
            }
        }
        
        return {
            valid: issues.length === 0,
            issues
        };
    }
};

// Configure axios with retry logic
axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (error) => {
        // Retry on network errors or 5xx errors
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response && error.response.status >= 500);
    },
    onRetry: (retryCount, error, requestConfig) => {
        console.log(`🔄 Retry attempt ${retryCount} for ${requestConfig.url} (${error.message})`);
    },
    shouldResetTimeout: true
});

// Import model configuration from config module (SINGLE SOURCE OF TRUTH)
const {
    MODEL_PRESETS,
    DEFAULT_MODEL,
    OPENROUTER_URL,
    getReasoningConfig,
    formatThinkingForDiscord,
    formatThinkingForGUI,
    getModelDisplayName,
    getModelChoices
} = require('./config/models');

let MODEL = MODEL_PRESETS[DEFAULT_MODEL];

// Get final text-only response (consolidated helper to reduce duplicate API calls)
async function getFinalTextResponse(messages, tools, options = {}) {
    const { completedActions = 0, maxTokens = 10000 } = options;
    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: messages,
            max_tokens: maxTokens,
            temperature: 0.7,
            tools: tools,
            tool_choice: 'none', // Force text response without more tool calls
            provider: { data_collection: 'deny' }
        }, {
            headers: {
                'Authorization': `Bearer ${getOpenRouterKey()}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        return response.data.choices[0].message;
    } catch (error) {
        logEvent('LLM', `Final response error: ${error.message}`);
        // Provide in-character fallback response if we had completed actions
        if (completedActions > 0) {
            return {
                content: `${getBotResponse('success')} changes are live at https://bot.inference-arcade.com/`
            };
        }
        return null;
    }
}

// API Health tracking
let apiHealthStatus = {
    lastCheck: null,
    isHealthy: true,
    consecutiveFailures: 0,
    lastError: null,
    lastSuccessfulModel: MODEL_PRESETS[DEFAULT_MODEL]
};

// Check API health with quick test request
async function checkAPIHealth() {
    try {
        const testResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL_PRESETS[DEFAULT_MODEL],
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 10,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${getOpenRouterKey()}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000,
            validateStatus: (status) => status < 500
        });

        if (testResponse.status === 200) {
            apiHealthStatus.isHealthy = true;
            apiHealthStatus.consecutiveFailures = 0;
            apiHealthStatus.lastError = null;
            apiHealthStatus.lastSuccessfulModel = MODEL_PRESETS[DEFAULT_MODEL];
            logEvent('API_HEALTH', 'API healthy');
        } else {
            apiHealthStatus.isHealthy = false;
            apiHealthStatus.lastError = `Status ${testResponse.status}`;
        }
        apiHealthStatus.lastCheck = new Date();
        
    } catch (error) {
        apiHealthStatus.isHealthy = false;
        apiHealthStatus.consecutiveFailures++;
        apiHealthStatus.lastError = error.message;
        apiHealthStatus.lastCheck = new Date();
        logEvent('API_HEALTH', `Health check failed (${apiHealthStatus.consecutiveFailures}x): ${error.message}`);
        
        // If API is down for too long, log warning
        if (apiHealthStatus.consecutiveFailures >= 3) {
            console.warn(`⚠️ OpenRouter API appears to be down (${apiHealthStatus.consecutiveFailures} consecutive failures)`);
        }
    }
}

// Start health checks 4 times per day (every 6 hours)
setInterval(checkAPIHealth, 6 * 60 * 60 * 1000);
// Run initial check after 10 seconds
setTimeout(checkAPIHealth, 10000);

// Mutable system prompt - can be changed at runtime
let SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

// Note: botResponses and getBotResponse are imported from ./personality/botResponses.js

// Clean and format bot responses for better markdown rendering
function cleanBotResponse(response) {
    if (!response) return '';

    // Remove "Bot Sportello:" prefix patterns (including duplicates)
    let cleaned = response
        .replace(/^(?:\s*(?:Bot\s+)?Sportello\s*:\s*)+/i, '')
        .replace(/^(?:\s*Doc\s+Sportello\s*:\s*)+/i, '');

    // Strip any tool-call markup that some models emit in plain text
    cleaned = cleaned
        .replace(/<[^>]*tool_call[^>]*>[\s\S]*?<\/[^>]*tool_call>/gi, '')
        .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
        .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
        .replace(/<[^>]*tool_call[^>]*>/gi, '')
        .replace(/<\/?(invoke|parameter)\b[^>]*>/gi, '')
        .replace(/^<[^>\n]*(tool_call|invoke|parameter)[^>\n]*>\s*$/gmi, '');

    // Also strip accidental plain-text tool call lines like
    // "functions.read_file: { ... }" or "functions.search_files: ..."
    cleaned = cleaned.replace(/^functions\.[a-zA-Z0-9_\-]+\s*:\s*.*$/gmi, '').trim();

    // Improve markdown formatting with proper spacing
    cleaned = cleaned
        // Add blank line before headers (##, ###, etc)
        .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
        // Add blank line after headers
        .replace(/(#{1,6}\s[^\n]+)\n([^\n])/g, '$1\n\n$2')
        // Add blank line before lists (-, *, 1., etc)
        .replace(/([^\n])\n([\-\*]|\d+\.)\s/g, '$1\n\n$2 ')
        // Add blank line before code blocks
        .replace(/([^\n])\n```/g, '$1\n\n```')
        // Add blank line after code blocks
        .replace(/```\n([^\n])/g, '```\n\n$1')
        // Add blank line before bold sections (ACROSS:, DOWN:, etc)
        .replace(/([^\n])\n(\*\*[A-Z][^\*]+\*\*)/g, '$1\n\n$2')
        // Fix multiple consecutive blank lines (max 2)
        .replace(/\n{3,}/g, '\n\n');

    return cleaned;
}

// Efficient logging system - only log important events
function logEvent(type, message, details = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${type}: ${message}`);
    if (details && process.env.NODE_ENV === 'development') {
        console.log(details);
    }
    
    // Log to GUI
    const level = type === 'ERROR' ? 'error' : 
                  type === 'WARN' ? 'warn' : 
                  type === 'DEBUG' ? 'debug' : 'info';
    logToGUI(level, `${type}: ${message}`, details || {});
}

// Helper function to track and prevent error loops
function trackError(userId, commandName) {
    const key = `${userId}-${commandName}`;
    const now = Date.now();
    
    if (!errorTracker.has(key)) {
        errorTracker.set(key, { count: 1, lastError: now });
        return false; // Not in error loop
    }
    
    const errorData = errorTracker.get(key);
    
    // Reset counter if enough time has passed
    if (now - errorData.lastError > ERROR_RESET_TIME) {
        errorTracker.set(key, { count: 1, lastError: now });
        return false;
    }
    
    // Increment error count
    errorData.count++;
    errorData.lastError = now;
    
    // Check if we're in an error loop
    if (errorData.count >= MAX_ERROR_COUNT) {
        console.warn(`Error loop detected for user ${userId} command ${commandName}`);
        return true; // In error loop
    }
    
    return false;
}

function clearErrorTracking(userId, commandName) {
    const key = `${userId}-${commandName}`;
    errorTracker.delete(key);
}

// Utility functions
function sanitizeFileName(name) {
    return name
        .replace(/\.\./g, '')
        .replace(/[\/\\]/g, '')
        .replace(/[^a-zA-Z0-9-_]/g, '-')
        .toLowerCase()
        .substring(0, 100);
}

function validateInput(input, maxLength = 500) {
    if (!input || typeof input !== 'string') {
        throw new Error('Invalid input');
    }
    if (input.length > maxLength) {
        throw new Error(`Input too long (max ${maxLength} characters)`);
    }
    return input.trim();
}

// cleanMarkdownCodeBlocks: using version from services/filesystem.js

function ensureHomeLinkInHTML(htmlContent) {
    if (!htmlContent.includes('index.html') && !htmlContent.includes('Home</a>')) {
        const homeLink = SITE_CONFIG.getHomeLinkHTML(true); // true for subdirectory
        return htmlContent.replace(/<body([^>]*)>/, `<body$1>\n    ${homeLink}`);
    }
    return htmlContent;
}

function ensureStylesheetInHTML(htmlContent) {
    // Check if page-theme.css is already linked
    if (!htmlContent.includes('page-theme.css')) {
        const stylesheetLinks = `
    <link href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
    ${SITE_CONFIG.getThemeCSSHTML(true)}
    ${SITE_CONFIG.getFaviconHTML(true)}`;

        // Insert before closing </head> tag
        if (htmlContent.includes('</head>')) {
            return htmlContent.replace('</head>', `${stylesheetLinks}\n</head>`);
        }
    }
    return htmlContent;
}

// Content Quality Validation System
function validateHTMLContent(htmlContent, context = {}) {
    const issues = [];
    const warnings = [];

    // Critical checks - these fail validation
    if (!htmlContent.includes('</html>')) {
        issues.push('HTML appears incomplete - missing closing </html> tag');
    }

    if (!htmlContent.includes('<!DOCTYPE html>') && !htmlContent.includes('<!doctype html>')) {
        warnings.push('Missing DOCTYPE declaration');
    }

    if (!htmlContent.includes('<html')) {
        issues.push('Missing <html> opening tag');
    }

    if (!htmlContent.includes('<head>')) {
        issues.push('Missing <head> section');
    }

    if (!htmlContent.includes('<body')) {
        issues.push('Missing <body> tag');
    }

    // Required elements check
    if (!htmlContent.includes('viewport')) {
        issues.push('Missing viewport meta tag - required for mobile responsiveness');
    }

    if (!htmlContent.includes('page-theme.css') && !htmlContent.includes('stylesheet')) {
        warnings.push('No stylesheet link found');
    }

    if (!htmlContent.includes('index.html') && !htmlContent.includes('HOME')) {
        warnings.push('No home link found');
    }

    // Mobile-specific checks for games
    if (context.isGame) {
        if (!htmlContent.includes('mobile-controls') && !htmlContent.includes('touch')) {
            issues.push('Game missing mobile controls - required for Discord mobile users');
        }

        if (!htmlContent.includes('touch-action')) {
            warnings.push('Missing touch-action CSS to prevent zoom on button tap');
        }

        if (!htmlContent.includes('@media') && !htmlContent.includes('max-width')) {
            issues.push('No responsive breakpoints found - mobile users will have poor experience');
        }
    }

    // Check for common syntax errors
    const openScriptTags = (htmlContent.match(/<script/g) || []).length;
    const closeScriptTags = (htmlContent.match(/<\/script>/g) || []).length;
    if (openScriptTags !== closeScriptTags) {
        issues.push(`Mismatched script tags - ${openScriptTags} open, ${closeScriptTags} close`);
    }

    const openDivTags = (htmlContent.match(/<div/g) || []).length;
    const closeDivTags = (htmlContent.match(/<\/div>/g) || []).length;
    if (Math.abs(openDivTags - closeDivTags) > 2) {
        warnings.push(`Possibly mismatched div tags - ${openDivTags} open, ${closeDivTags} close`);
    }

    return {
        isValid: issues.length === 0,
        issues: issues,
        warnings: warnings,
        score: calculateQualityScore(htmlContent, issues, warnings, context)
    };
}

function validateJSContent(jsContent) {
    const issues = [];
    const warnings = [];

    // Check for basic JS syntax issues
    if (jsContent.includes('```')) {
        issues.push('JavaScript contains markdown code blocks - needs cleaning');
    }

    // Check for common patterns indicating incomplete code
    if (jsContent.includes('// TODO') || jsContent.includes('// FIXME')) {
        warnings.push('Code contains TODO/FIXME comments');
    }

    // Check if file is suspiciously short (likely incomplete)
    if (jsContent.trim().length < 100) {
        issues.push('JavaScript file appears too short to be functional');
    }

    // Basic bracket matching
    const openBraces = (jsContent.match(/\{/g) || []).length;
    const closeBraces = (jsContent.match(/\}/g) || []).length;
    if (Math.abs(openBraces - closeBraces) > 0) {
        issues.push(`Mismatched braces - ${openBraces} open, ${closeBraces} close`);
    }

    const openParens = (jsContent.match(/\(/g) || []).length;
    const closeParens = (jsContent.match(/\)/g) || []).length;
    if (Math.abs(openParens - closeParens) > 0) {
        issues.push(`Mismatched parentheses - ${openParens} open, ${closeParens} close`);
    }

    return {
        isValid: issues.length === 0,
        issues: issues,
        warnings: warnings
    };
}

function calculateQualityScore(htmlContent, issues, warnings, context) {
    let score = 100;

    // Deduct for issues
    score -= issues.length * 15;
    score -= warnings.length * 5;

    // Bonus for best practices
    if (htmlContent.includes('viewport')) score += 5;
    if (htmlContent.includes('@media')) score += 5;
    if (htmlContent.includes('page-theme.css')) score += 5;
    if (htmlContent.includes('index.html')) score += 3;

    // Game-specific bonuses
    if (context.isGame) {
        if (htmlContent.includes('mobile-controls')) score += 10;
        if (htmlContent.includes('touch-action')) score += 5;
        if (htmlContent.includes('touchstart')) score += 5;
    }

    return Math.max(0, Math.min(100, score));
}

function buildValidationFeedback(validation, contentType = 'HTML') {
    const parts = [];

    if (validation.issues.length > 0) {
        parts.push(`CRITICAL ISSUES in ${contentType}:`);
        validation.issues.forEach(issue => parts.push(`- ${issue}`));
    }

    if (validation.warnings.length > 0) {
        parts.push(`\nWARNINGS:`);
        validation.warnings.forEach(warning => parts.push(`- ${warning}`));
    }

    if (validation.score !== undefined) {
        parts.push(`\nQuality Score: ${validation.score}/100`);
    }

    return parts.join('\n');
}


function addToHistory(username, message, isBot = false) {
    // Truncate overly long messages to prevent memory bloat
    const maxMessageLength = 2000;
    const truncatedMessage = message.length > maxMessageLength 
        ? message.substring(0, maxMessageLength) + '...[truncated]'
        : message;

    const entry = {
        timestamp: Date.now(), // Use timestamp for faster processing
        username: username,
        message: truncatedMessage,
        isBot: isBot,
        role: isBot ? 'assistant' : 'user'
    };

    messageHistory.push(entry);

    // More aggressive pruning when approaching limit
    if (messageHistory.length >= MAX_HISTORY) {
        // Remove oldest 20 messages at once to reduce frequent array operations
        messageHistory.splice(0, 20);
    }

    // Note: agents.md file persistence removed - now using Discord API for context
    // The in-memory messageHistory is kept for debugging/fallback purposes only
}

// Build proper messages array from conversation history
function buildMessagesFromHistory(maxMessages = 50) {
    // Get last N messages (increased from 10 to 50 for better context)
    const recentMessages = messageHistory.slice(-maxMessages);

    // Convert to OpenRouter message format
    const messages = recentMessages.map(entry => ({
        role: entry.role,
        content: `${entry.username}: ${entry.message}`
    }));

    return messages;
}

// Build context from Discord channel using the context manager
// Replaces buildMessagesFromHistory for channel-based context
async function buildContextForChannel(channel, maxMessages = CONFIG.DISCORD_CONTEXT_LIMIT) {
    // Use Discord context manager if available and channel is provided
    console.log(`[CONTEXT_DEBUG] channel=${!!channel}, contextManager=${!!contextManager}`);
    if (channel && contextManager) {
        try {
            const discordContext = await contextManager.buildContextFromChannel(channel, maxMessages);
            console.log(`[CONTEXT_DEBUG] Got ${discordContext?.length || 0} messages from Discord`);
            if (discordContext && discordContext.length > 0) {
                return discordContext;
            }
        } catch (error) {
            console.warn(`[CONTEXT] Discord fetch failed:`, error.message);
        }
    }

    // No fallback - return empty array if Discord context unavailable
    console.log(`[CONTEXT] No Discord context available, returning empty array`);
    return [];
}



// Filesystem tools for the AI
async function listFiles(dirPath = './src') {
    try {
        // Handle multiple directories (array input)
        if (Array.isArray(dirPath)) {
            const allResults = [];
            
            for (const singleDir of dirPath) {
                const result = await listFiles(singleDir);
                if (!result.startsWith('Error')) {
                    allResults.push(`**${singleDir}:** ${result}`);
                } else {
                    allResults.push(`**${singleDir}:** ${result}`);
                }
            }
            
            return allResults.join('\n');
        }

        const files = await fs.readdir(dirPath);

        // Return structured, searchable format instead of flat comma-separated list
        // Group by extension for easier navigation
        const byExtension = {};
        files.forEach(file => {
            const ext = path.extname(file).toLowerCase() || '.other';
            if (!byExtension[ext]) byExtension[ext] = [];
            byExtension[ext].push(file);
        });

        // Build searchable output with file count
        let output = `📁 ${dirPath} (${files.length} files)\n`;

        // Sort extensions by frequency (most common first)
        const sortedExts = Object.entries(byExtension)
            .sort((a, b) => b[1].length - a[1].length);

        for (const [ext, extFiles] of sortedExts) {
            output += `\n${ext} (${extFiles.length}):\n`;
            // Sort files alphabetically for easy scanning
            extFiles.sort().forEach(file => {
                output += `  - ${file}\n`;
            });
        }

        return output.trim();
    } catch (error) {
        return `Error listing files: ${error.message}`;
    }
}

/**
 * Check if a file exists at the given path
 * Fast existence check without reading content
 * Supports: URLs, informal names ("Peanut city" → src/peanut-city.html), and exact paths
 */
async function fileExists(filePath) {
    try {
        // Handle multiple files (array input)
        if (Array.isArray(filePath)) {
            const results = [];
            for (const singlePath of filePath) {
                const exists = await fileExists(singlePath);
                results.push(`${singlePath}: ${exists}`);
            }
            return results.join('\n');
        }

        // Normalize path - handle URLs from bot.inference-arcade.com
        let normalizedPath = filePath;
        const urlMatch = filePath.match(/bot\.inference-arcade\.com\/(.+)/);
        if (urlMatch) {
            normalizedPath = urlMatch[1];
            console.log(`[FILE_EXISTS] Extracted path from URL: ${normalizedPath}`);
        }

        // Try exact path first
        try {
            await fs.access(normalizedPath);
            const stats = await fs.stat(normalizedPath);
            return `✅ EXISTS: ${normalizedPath} (${stats.size} bytes)`;
        } catch {
            // Exact path not found - try fuzzy variations
        }

        // Generate fuzzy variations for informal names
        const variations = [];
        const baseName = normalizedPath
            .toLowerCase()
            .replace(/\s+/g, '-')           // "Peanut City" → "peanut-city"
            .replace(/[^a-z0-9\-\.\/]/g, '') // Remove special chars
            .replace(/\.html$/, '');         // Remove .html if present

        // Try common patterns
        variations.push(`src/${baseName}.html`);
        variations.push(`src/${baseName}`);
        variations.push(`${baseName}.html`);

        // Also try with underscores instead of hyphens
        const underscoreVersion = baseName.replace(/-/g, '_');
        if (underscoreVersion !== baseName) {
            variations.push(`src/${underscoreVersion}.html`);
        }

        for (const variation of variations) {
            try {
                await fs.access(variation);
                const stats = await fs.stat(variation);
                return `✅ EXISTS: ${variation} (${stats.size} bytes) [matched from "${filePath}"]`;
            } catch {
                // Try next variation
            }
        }

        // If still not found, suggest similar files
        try {
            const srcFiles = await fs.readdir('./src');
            const searchTerm = baseName.replace(/-/g, '').replace(/_/g, '');
            const similar = srcFiles.filter(f => {
                const normalized = f.toLowerCase().replace(/-/g, '').replace(/_/g, '').replace('.html', '').replace('.js', '');
                return normalized.includes(searchTerm) || searchTerm.includes(normalized);
            }).slice(0, 5);

            if (similar.length > 0) {
                return `❌ NOT FOUND: ${filePath}\n💡 Similar files in src/: ${similar.join(', ')}`;
            }
        } catch {
            // Can't read src dir
        }

        return `❌ NOT FOUND: ${filePath}`;
    } catch (error) {
        return `❌ NOT FOUND: ${filePath} (error: ${error.message})`;
    }
}

async function readFile(filePath) {
    try {
        // Handle multiple files (array input)
        if (Array.isArray(filePath)) {
            const allResults = [];
            let totalChars = 0;
            
            for (const singleFile of filePath) {
                if (totalChars >= CONFIG.FILE_READ_LIMIT) {
                    allResults.push(`**[Truncated]** - File limit reached`);
                    break;
                }
                
                const result = await readFile(singleFile);
                const remaining = CONFIG.FILE_READ_LIMIT - totalChars;
                
                if (!result.startsWith('Error')) {
                    const truncated = result.length > remaining ? result.substring(0, remaining) : result;
                    allResults.push(`**${singleFile}:**\n${truncated}`);
                    totalChars += truncated.length;
                } else {
                    allResults.push(`**${singleFile}:** ${result}`);
                }
            }
            
            return allResults.join('\n\n---\n\n');
        }

        // Normalize path - handle URLs from bot.inference-arcade.com
        let normalizedPath = filePath;
        const urlMatch = filePath.match(/bot\.inference-arcade\.com\/(.+)/);
        if (urlMatch) {
            normalizedPath = urlMatch[1];
            console.log(`[READ_FILE] Extracted path from URL: ${normalizedPath}`);
        }

        // Try reading the file with automatic src/ path resolution
        let content;
        const pathsToTry = [normalizedPath];

        // If path doesn't start with src/ and looks like a page name, try src/ variants
        if (!normalizedPath.startsWith('src/') && !normalizedPath.startsWith('./src/')) {
            pathsToTry.push(`src/${normalizedPath}`);
            // If no extension, try .html
            if (!normalizedPath.includes('.')) {
                pathsToTry.push(`src/${normalizedPath}.html`);
            }
        }

        let lastError;
        for (const tryPath of pathsToTry) {
            try {
                content = await fs.readFile(tryPath, 'utf8');
                if (tryPath !== normalizedPath) {
                    console.log(`[READ_FILE] Resolved ${normalizedPath} -> ${tryPath}`);
                }
                normalizedPath = tryPath;
                break;
            } catch (e) {
                lastError = e;
            }
        }

        if (!content) {
            return `Error reading file: ${lastError.message}. Tried: ${pathsToTry.join(', ')}`;
        }

        const truncatedContent = content.substring(0, CONFIG.FILE_READ_LIMIT);

        // Log file read to GUI dashboard
        logFileChange('read', normalizedPath, truncatedContent);

        return truncatedContent;
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

async function writeFile(filePath, content) {
    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // Write the file locally
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`[WRITE_FILE] Written: ${filePath} (${content.length} bytes)`);

        // Log file creation to GUI dashboard
        logFileChange('create', filePath, content);

        // Auto-push via GitHub API (no git CLI needed - Railway compatible)
        console.log(`[WRITE_FILE] Auto-pushing to remote via GitHub API...`);
        const fileName = path.basename(filePath);
        const commitMessage = `add ${fileName}`;

        try {
            const sha = await pushFileViaAPI(filePath, content, commitMessage, 'main');
            console.log(`[WRITE_FILE] Pushed: ${commitMessage} (${sha?.slice(0,7) || 'no-sha'})`);
        } catch (pushError) {
            errorLogger.log('WRITE_FILE_PUSH', pushError, { filePath });
            throw pushError;
        }

        return `File written and pushed: ${filePath} (${content.length} bytes) - now live at https://bot.inference-arcade.com/${filePath}`;
    } catch (error) {
        console.error(`[WRITE_FILE] Error:`, error.message);
        return `Error writing file: ${error.message}`;
    }
}

// editFile: Using editFileService from services/filesystem.js (supports path resolution, batch mode, and options)

// Tool: Search files for text patterns (like grep)
// Helper function to search within a single file
async function searchSingleFile(pattern, filePath, options = {}) {
    const {
        caseInsensitive = false,
        wholeWord = false,
        maxResults = 50
    } = options;

    const results = [];
    const flags = caseInsensitive ? 'gi' : 'g';
    let searchRegex;

    try {
        const regexPattern = wholeWord ? `\\b${pattern}\\b` : pattern;
        searchRegex = new RegExp(regexPattern, flags);
    } catch (error) {
        return `Error: Invalid regex pattern "${pattern}": ${error.message}`;
    }

    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const relativePath = path.relative(process.cwd(), filePath);

        lines.forEach((line, index) => {
            if (searchRegex.test(line)) {
                results.push({
                    file: relativePath,
                    line: index + 1,
                    content: line.trim()
                });

                // Stop if we hit max results
                if (results.length >= maxResults) {
                    return;
                }
            }
        });

        if (results.length === 0) {
            return `No matches found for "${pattern}" in ${relativePath}`;
        }

        // Format results
        let output = `**Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}" in ${relativePath}**\n\n`;
        
        results.forEach(result => {
            output += `**Line ${result.line}:** ${result.content}\n`;
        });

        return output.trim();
    } catch (error) {
        return `Error reading file ${filePath}: ${error.message}`;
    }
}

async function searchFiles(pattern, searchPath = './src', options = {}) {
    try {
        const {
            caseInsensitive = false,
            wholeWord = false,
            filePattern = null,
            maxResults = 50
        } = options;

        // Handle multiple paths (array input)
        if (Array.isArray(searchPath)) {
            const allResults = [];
            let totalMatches = 0;
            
            for (const singlePath of searchPath) {
                if (totalMatches >= maxResults) break;
                
                const result = await searchFiles(pattern, singlePath, {
                    ...options,
                    maxResults: maxResults - totalMatches
                });
                
                if (!result.startsWith('Error:') && !result.startsWith('No matches')) {
                    allResults.push(result);
                    // Count matches from this result
                    const matches = (result.match(/\*\*Line \d+:\*\*/g) || []).length;
                    totalMatches += matches;
                }
            }
            
            if (allResults.length === 0) {
                return `No matches found for "${pattern}" in ${searchPath.length} files`;
            }
            
            return allResults.join('\n\n');
        }

        const basePath = path.resolve(searchPath);

        // Check if path exists
        try {
            await fs.access(basePath);
        } catch {
            return `Error: Path "${searchPath}" does not exist`;
        }

        // Check if the path is a file instead of directory
        const stats = await fs.stat(basePath);
        if (stats.isFile()) {
            // If it's a file, search within that specific file
            return await searchSingleFile(pattern, basePath, options);
        }

        const results = [];
        const flags = caseInsensitive ? 'gi' : 'g';
        let searchRegex;

        try {
            // If wholeWord, add word boundaries
            const regexPattern = wholeWord ? `\\b${pattern}\\b` : pattern;
            searchRegex = new RegExp(regexPattern, flags);
        } catch (error) {
            return `Error: Invalid regex pattern "${pattern}": ${error.message}`;
        }

        // Recursive file search
        async function searchDirectory(dirPath) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                // Skip node_modules, .git, etc.
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'responses' || entry.name === 'build-logs') {
                    continue;
                }

                if (entry.isDirectory()) {
                    await searchDirectory(fullPath);
                } else if (entry.isFile()) {
                    // Filter by file pattern if provided
                    if (filePattern && !entry.name.includes(filePattern)) {
                        continue;
                    }

                    // Only search text files
                    const ext = path.extname(entry.name).toLowerCase();
                    const textExtensions = ['.html', '.js', '.css', '.txt', '.md', '.json', '.xml', '.svg'];
                    if (!textExtensions.includes(ext)) {
                        continue;
                    }

                    try {
                        const content = await fs.readFile(fullPath, 'utf8');
                        const lines = content.split('\n');

                        lines.forEach((line, index) => {
                            if (searchRegex.test(line)) {
                                const relativePath = path.relative(process.cwd(), fullPath);
                                results.push({
                                    file: relativePath,
                                    line: index + 1,
                                    content: line.trim()
                                });
                            }
                        });

                        // Stop if we hit max results
                        if (results.length >= maxResults) {
                            return;
                        }
                    } catch (readError) {
                        // Skip files that can't be read as text
                        continue;
                    }
                }
            }
        }

        await searchDirectory(basePath);

        if (results.length === 0) {
            return `No matches found for "${pattern}" in ${searchPath}`;
        }

        // Format results with better markdown
        let output = `**Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}"**\n\n`;

        // Group by file
        const byFile = {};
        results.forEach(result => {
            if (!byFile[result.file]) {
                byFile[result.file] = [];
            }
            byFile[result.file].push(result);
        });

        Object.keys(byFile).forEach(file => {
            output += `### ${file}\n\n`;
            byFile[file].forEach(match => {
                output += `**Line ${match.line}:** \`${match.content}\`\n\n`;
            });
        });

        return output.trim();
    } catch (error) {
        console.error('Search files error:', error);
        return `Error searching files: ${error.message}`;
    }
}

// Helper function to pick emoji based on description
function getIconForDescription(description = '') {
    const lowerDesc = description.toLowerCase();

    if (lowerDesc.includes('game')) return '🎮';
    if (lowerDesc.includes('snake')) return '🐍';
    if (lowerDesc.includes('todo') || lowerDesc.includes('task') || lowerDesc.includes('list')) return '✅';
    if (lowerDesc.includes('calculator')) return '🔢';
    if (lowerDesc.includes('timer') || lowerDesc.includes('clock')) return '⏰';
    if (lowerDesc.includes('music') || lowerDesc.includes('audio')) return '🎵';
    if (lowerDesc.includes('photo') || lowerDesc.includes('image')) return '📸';
    if (lowerDesc.includes('chat') || lowerDesc.includes('message')) return '💬';
    if (lowerDesc.includes('weather')) return '🌤️';
    if (lowerDesc.includes('draw') || lowerDesc.includes('paint')) return '🎨';
    if (lowerDesc.includes('plan')) return '📋';

    return '🌐'; // Default
}

function formatProjectTitle(pageName = '') {
    return pageName
        .replace(/[_-]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') || 'Untitled Project';
}

// Helper function to condense long descriptions into one-liner captions (3-6 words)
function condenseDescription(description = '', pageName = '') {
    const fallback = `${formatProjectTitle(pageName)} project`;

    let condensed = description
        .replace(/^(Create|Build|Make|Design|Generate|Implement)\s+(a\s+)?/i, '')
        .replace(/\s+with\s+(the\s+)?message[:\s].*/i, '')
        .replace(/\s+(using|with|featuring|including)\s+.*/i, '')
        .replace(/\.\s+.*/g, '')
        .replace(/[.!?]+$/, '')
        .trim();

    if (!condensed) {
        condensed = fallback;
    }

    let words = condensed.split(/\s+/).filter(Boolean);

    if (words.length > 6) {
        words = words.slice(0, 6);
    } else if (words.length < 3) {
        const filler = fallback.split(/\s+/).filter(Boolean);
        while (words.length < 3 && filler.length) {
            words.push(filler.shift());
        }
    }

    condensed = words.join(' ');
    condensed = condensed.charAt(0).toUpperCase() + condensed.slice(1);

    return condensed || fallback;
}

function normalizeMetadata(rawMetadata = {}) {
    const normalized = {
        collections: { ...(rawMetadata.collections || {}) },
        projects: rawMetadata.projects || {}
    };

    let collectionsChanged = false;

    for (const [key, defaults] of Object.entries(DEFAULT_COLLECTIONS)) {
        const existing = normalized.collections[key] || {};
        const next = {
            title: existing.title || defaults.title,
            description: existing.description || defaults.description,
            order: typeof existing.order === 'number' ? existing.order : defaults.order
        };

        if (!normalized.collections[key] ||
            existing.title !== next.title ||
            existing.description !== next.description ||
            existing.order !== next.order) {
            normalized.collections[key] = next;
            collectionsChanged = true;
        }
    }

    return { metadata: normalized, collectionsChanged };
}

// Helper function to update projectmetadata.json with new page
async function updateIndexWithPage(pageName, description) {
    try {
        const metadataPath = './projectmetadata.json';
        const condensedDesc = condenseDescription(description, pageName);
        const icon = getIconForDescription(description);

        let rawMetadata = {};
        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            rawMetadata = JSON.parse(content);
        } catch (error) {
            console.log('Creating new projectmetadata.json file');
        }

        const { metadata, collectionsChanged } = normalizeMetadata(rawMetadata);
        const projects = metadata.projects;

        const defaultEntry = {
            title: formatProjectTitle(pageName),
            description: condensedDesc,
            icon,
            collection: 'unsorted'
        };

        let updated = false;

        if (!projects[pageName]) {
            projects[pageName] = defaultEntry;
            updated = true;
        } else {
            const projectEntry = projects[pageName];
            if (!projectEntry.title) {
                projectEntry.title = defaultEntry.title;
                updated = true;
            }
            if (!projectEntry.description) {
                projectEntry.description = defaultEntry.description;
                updated = true;
            }
            if (!projectEntry.icon) {
                projectEntry.icon = defaultEntry.icon;
                updated = true;
            }
            if (!projectEntry.collection) {
                projectEntry.collection = 'unsorted';
                updated = true;
            }
        }

        if (!updated && !collectionsChanged) {
            console.log(`Page ${pageName} already exists in metadata`);
            return `Page ${pageName} already in metadata`;
        }

        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        console.log(`✅ Updated projectmetadata.json with ${pageName}`);
        return `Updated projectmetadata.json with ${pageName}`;
    } catch (error) {
        console.error(`Error updating projectmetadata.json:`, error.message);
        return `Error updating projectmetadata.json: ${error.message}`;
    }
}

// Sync all HTML files in /src to projectmetadata.json
async function syncIndexWithSrcFiles() {
    try {
        console.log('🔄 Syncing projectmetadata.json with /src directory...');

        const srcFiles = await fs.readdir('./src');
        const htmlFiles = srcFiles.filter(file => file.endsWith('.html'));
        console.log(`Found ${htmlFiles.length} HTML files in /src`);

        const metadataPath = './projectmetadata.json';
        let rawMetadata = {};
        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            rawMetadata = JSON.parse(content);
        } catch (error) {
            console.log('No existing metadata file, creating new one');
        }

        const { metadata, collectionsChanged } = normalizeMetadata(rawMetadata);
        const projects = metadata.projects;
        const existingPages = new Set(Object.keys(projects));

        const missingPages = htmlFiles
            .map(file => file.replace('.html', ''))
            .filter(pageName => !existingPages.has(pageName));

        let addedCount = 0;

        for (const pageName of missingPages) {
            const title = formatProjectTitle(pageName);
            const description = condenseDescription(`${title} noir project`, pageName);

            projects[pageName] = {
                title,
                description,
                icon: getIconForDescription(description),
                collection: 'unsorted'
            };
            addedCount++;
        }

        if (!addedCount && !collectionsChanged) {
            console.log('✅ All pages are already in projectmetadata.json');
            return;
        }

        await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        console.log(`✅ Metadata sync complete! Added ${addedCount} new pages.`);
    } catch (error) {
        console.error('Error syncing projectmetadata.json:', error);
    }
}

async function commitChanges(message, files = '.') {
    console.log(`[COMMIT] Starting: "${message}"`);
    const metadata = { files, messageLength: message.length };
    
    try {
        // Import GitHub API helpers
        const { pushMultipleFiles, getRepoStatus } = require('./services/gitHelper');
        
        // Validate environment before starting
        const envValidation = pipelineValidator.validateEnvironment();
        if (!envValidation.valid) {
            throw new Error(`Environment validation failed: ${envValidation.missing.join(', ')} missing`);
        }
        
        // Get status via GitHub API instead of git CLI
        console.log('[COMMIT] Getting repository status via GitHub API...');
        const status = await getRepoStatus('main');
        const currentBranch = status.current || 'main';
        
        console.log(`[COMMIT] Status:`, {
            branch: currentBranch,
            lastCommit: status.lastCommit?.message || 'N/A'
        });

        // Collect files to commit
        console.log('[COMMIT] Collecting files to commit...');
        let filesToCommit = [];
        
        if (files === '.') {
            // Read all files in src/ directory for common changes
            const srcFiles = await fs.readdir('./src').catch(() => []);
            const rootFiles = ['index.html', 'projectmetadata.json', 'page-theme.css', 'style.css'];
            
            // Check each file for changes (by reading and comparing)
            for (const file of [...srcFiles.map(f => `src/${f}`), ...rootFiles]) {
                try {
                    const content = await fs.readFile(file, 'utf8');
                    filesToCommit.push({ path: file, content });
                } catch (e) {
                    // File might not exist or be inaccessible
                }
            }
        } else {
            // Specific files requested
            const fileList = files.split(',').map(f => f.trim());
            for (const file of fileList) {
                try {
                    const content = await fs.readFile(file, 'utf8');
                    filesToCommit.push({ path: file, content });
                } catch (e) {
                    console.warn(`[COMMIT] Could not read file: ${file}`);
                }
            }
        }

        if (filesToCommit.length === 0) {
            console.log('[COMMIT] No files to commit');
            return 'Nothing to commit - no files found';
        }

        // Validate files before committing if specific files were requested
        if (files !== '.') {
            const fileList = files.split(',').map(f => f.trim());
            const fileValidation = await pipelineValidator.validateFileOperations(fileList);
            if (!fileValidation.valid) {
                console.warn('⚠️ File validation issues:', fileValidation.issues);
                metadata.fileIssues = fileValidation.issues;
            }
        }
        
        // Push all files in a single commit via GitHub API
        console.log(`[COMMIT] Committing ${filesToCommit.length} files via GitHub API...`);
        const commitSha = await pushMultipleFiles(filesToCommit, message, currentBranch);
        
        if (!commitSha) {
            throw new Error('Commit failed - no SHA returned');
        }

        console.log(`[COMMIT] Success: ${commitSha.substring(0, 7)}`);
        return `Committed and pushed: ${commitSha.substring(0, 7)} - ${message}`;
        
    } catch (error) {
        const errorEntry = errorLogger.log('COMMIT', error, metadata);
        errorLogger.track(errorEntry);
        
        // Return user-friendly error message
        if (error.message.includes('authentication')) {
            return `Error: GitHub authentication failed. Check token permissions.`;
        } else if (error.message.includes('timeout')) {
            return `Error: Git operation timed out. Repository may be busy.`;
        } else if (error.message.includes('nothing to commit')) {
            return 'Nothing to commit - no changes detected.';
        } else {
            return `Error committing: ${error.message}`;
        }
    }
}

async function getRepoStatus() {
    try {
        // Use GitHub API - works on Railway without local git
        const { data: repo } = await octokit.repos.get({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME
        });
        const { data: commits } = await octokit.repos.listCommits({
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            per_page: 1
        });
        const latestCommit = commits[0];
        let result = `Branch: ${repo.default_branch}\n`;
        result += `Latest: ${latestCommit.sha.substring(0, 7)} - ${latestCommit.commit.message.split('\n')[0]}\n`;
        result += `Live site: https://bot.inference-arcade.com/\n`;
        result += `Commits: https://github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}/commits/main/`;
        return result;
    } catch (error) {
        return `Error getting status: ${error.message}`;
    }
}

// Helper: Convert ISO date to relative time (e.g., "2 hours ago")
function getRelativeTime(isoDate) {
    const now = new Date();
    const date = new Date(isoDate);
    const seconds = Math.floor((now - date) / 1000);

    const intervals = [
        { label: 'year', seconds: 31536000 },
        { label: 'month', seconds: 2592000 },
        { label: 'week', seconds: 604800 },
        { label: 'day', seconds: 86400 },
        { label: 'hour', seconds: 3600 },
        { label: 'minute', seconds: 60 }
    ];

    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) {
            return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
        }
    }
    return 'just now';
}

// Git log - view commit history via GitHub API (works on Railway)
async function getGitLog(count = 10, file = null, oneline = false) {
    try {
        const maxCount = Math.min(count || 10, 50);

        // Use GitHub API - no local git needed
        const params = {
            owner: process.env.GITHUB_REPO_OWNER,
            repo: process.env.GITHUB_REPO_NAME,
            per_page: maxCount,
            ...(file && { path: file })
        };

        const { data: commits } = await octokit.repos.listCommits(params);

        if (!commits || commits.length === 0) {
            return 'No commits found.';
        }

        // Format output based on oneline preference
        if (oneline) {
            return commits
                .map(c => `${c.sha.substring(0, 7)} ${c.commit.message.split('\n')[0]}`)
                .join('\n');
        } else {
            return commits
                .map(c => `${c.sha.substring(0, 7)} | ${c.commit.author.name} | ${getRelativeTime(c.commit.author.date)} | ${c.commit.message.split('\n')[0]}`)
                .join('\n');
        }
    } catch (error) {
        return `Error getting git log: ${error.message}`;
    }
}

// Web search via OpenRouter
async function webSearch(query) {
    try {
        // Perplexity Sonar has built-in web search
        const searchModel = 'perplexity/sonar';
        logEvent('WEB_SEARCH', `Searching with ${searchModel}: "${query}"`);

        const response = await axios.post(OPENROUTER_URL, {
            model: searchModel,
            messages: [
                {
                    role: 'user',
                    content: `Search the web for: ${query}\n\nReturn the search results with sources and key facts. Be concise but comprehensive.`
                }
            ],
            max_tokens: 2000,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${getOpenRouterKey()}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        const searchResults = response.data.choices[0].message.content;
        logEvent('WEB_SEARCH', `Got results (${searchResults.length} chars)`);
        return searchResults;
    } catch (error) {
        console.error('Web search error:', error.response?.data || error.message);
        return 'Search unavailable right now, man.';
    }
}

// Tool: Set AI model
async function setModel(modelChoice) {
    try {
        if (!MODEL_PRESETS[modelChoice]) {
            return `Unknown model "${modelChoice}". Available: ${Object.keys(MODEL_PRESETS).join(', ')}`;
        }
        MODEL = MODEL_PRESETS[modelChoice];
        logEvent('SET_MODEL', `Switched to ${modelChoice}: ${MODEL}`);
        return `Switched to ${modelChoice} model (${MODEL}). This will apply to subsequent messages.`;
    } catch (error) {
        console.error('Set model error:', error);
        return `Error switching model: ${error.message}`;
    }
}

// Lightweight edit-only LLM response (delegated to editService)
async function getEditResponse(userMessage, conversationMessages = []) {
    return getEditResponseService(userMessage, conversationMessages, {
        systemPrompt: SYSTEM_PROMPT,
        model: MODEL,
        getApiKey: getOpenRouterKey,
        logEvent,
        logToolCall,
        logFileChange,
        getFinalTextResponse,
        getBotResponse
    });
}

// Enhanced LLM response with tool calling
async function getLLMResponse(userMessage, conversationMessages = [], discordContext = {}, onStatusUpdate = null) {
    try {
        // Start agent loop tracking for GUI
        startAgentLoop(
            userMessage.substring(0, 100),
            discordContext.user || 'AI',
            discordContext.channel || 'Direct'
        );
        
        // Build the full messages array for the API
        const messages = [
            {
                role: 'system',
                content: SYSTEM_PROMPT
            },
            ...conversationMessages,
        ];

        // Inject action context for follow-up requests (e.g., "add more margin to the cards")
        // This helps the LLM understand what files were recently modified
        if (discordContext.channelId) {
            const actionSummary = buildActionContextSummary(discordContext.channelId);
            if (actionSummary) {
                messages.push({
                    role: 'system',
                    content: actionSummary
                });
                console.log(`[ACTION_CACHE] Injected action context for channel ${discordContext.channelId}`);
            }
        }

        messages.push({
            role: 'user',
            content: userMessage
        });

        // Define available tools for the model
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'list_files',
                    description: 'List files in a directory in the repository. Returns files grouped by extension for easy scanning.',
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
            },
            {
                type: 'function',
                function: {
                    name: 'file_exists',
                    description: 'FAST check if a file exists. Use this FIRST when a user provides a URL like bot.inference-arcade.com/src/file.html - pass the URL or path directly and it will check existence. Returns EXISTS with size or NOT FOUND.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                oneOf: [
                                    { type: 'string', description: 'File path or URL to check (e.g., "src/game.html" or "https://bot.inference-arcade.com/src/game.html")' },
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
                    description: 'Search for text patterns across files (like grep). Supports regex patterns. Use this to find specific content, keywords, or code across multiple files.',
                    parameters: {
                        type: 'object',
                        properties: {
                            pattern: { type: 'string', description: 'Text or regex pattern to search for (e.g., "clue", "answer.*:", "const \\w+")' },
                            path: { 
                                oneOf: [
                                    { type: 'string', description: 'Directory or file to search in (default: ./src)' },
                                    { type: 'array', items: { type: 'string' }, description: 'Array of files/directories to search' }
                                ]
                            },
                            case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
                            file_pattern: { type: 'string', description: 'Filter by filename pattern (e.g., ".html", "crossword")' }
                        },
                        required: ['pattern']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read contents of a file from the repository',
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
                    name: 'write_file',
                    description: 'Create or update a file in the repository',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to write' },
                            content: { type: 'string', description: 'Content to write to the file' }
                        },
                        required: ['path', 'content']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'edit_file',
                    description: 'Edit a file via exact replace (preferred), batch, anchor-range (markers/line range), or instructions (last resort).',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit (e.g., "src/example.html", "index.html", "style.css")' },
                            old_string: { type: 'string', description: 'EXACT string to replace (including all whitespace). Must be unique.' },
                            new_string: { type: 'string', description: 'New string to replace old_string with.' },
                            instructions: { type: 'string', description: 'FALLBACK: Natural language instructions (slow); avoid unless necessary.' },
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
                                description: 'BATCH MODE: Array of replacements for multiple edits in one call.'
                            },
                            // Anchor-range mode
                            start_marker: { type: 'string', description: 'Unique start marker text' },
                            end_marker: { type: 'string', description: 'Unique end marker text (after start)' },
                            new_block: { type: 'string', description: 'Replacement block for marker/line modes' },
                            include_markers: { type: 'boolean', description: 'If true, replace including markers (default false)' },
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
                    name: 'commit_changes',
                    description: 'Git add, commit, and push changes to the repository',
                    parameters: {
                        type: 'object',
                        properties: {
                            message: { type: 'string', description: 'Commit message' },
                            files: { type: 'string', description: 'Files to commit (default: "." for all)' }
                        },
                        required: ['message']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'get_repo_status',
                    description: 'Get repository status via GitHub API (https://github.com/milwrite/javabot/commits/main/)',
                    parameters: {
                        type: 'object',
                        properties: {}
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'git_log',
                    description: 'Get commit history via GitHub API. Shows recent commits with hash, author, date, and message.',
                    parameters: {
                        type: 'object',
                        properties: {
                            count: { type: 'number', description: 'Number of commits to show (default: 10, max: 50)' },
                            file: { type: 'string', description: 'Optional: show commits for a specific file only' },
                            oneline: { type: 'boolean', description: 'Compact one-line format (default: false)' }
                        }
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'web_search',
                    description: 'Search the web for current information, news, documentation, or recent updates',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Search query' }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'deep_research',
                    description: 'Comprehensive multi-step research with citations and sources. ONLY use when user explicitly says the words "deep research" in their message. Do NOT use for general research questions. Takes 1-3 minutes.',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: { type: 'string', description: 'Detailed research question or topic' }
                        },
                        required: ['query']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'set_model',
                    description: 'Switch the AI model used for responses. ZDR-compliant models: glm (default), kimi, kimi-fast, deepseek, qwen, minimax, mimo',
                    parameters: {
                        type: 'object',
                        properties: {
                            model: {
                                type: 'string',
                                description: 'Model preset name. glm = GLM-4.7 (default), kimi = with reasoning, kimi-fast = without.',
                                enum: ['glm', 'kimi', 'kimi-fast', 'deepseek', 'qwen', 'minimax', 'mimo']
                            }
                        },
                        required: ['model']
                    }
                }
            }
        ];

        // Agentic loop - allow multiple rounds of tool calling
        const MAX_ITERATIONS = 6; // Reasonable limit to prevent infinite loops
        const MAX_READONLY_ITERATIONS = 3; // Cap read-only tool loops to prevent over-searching
        let iteration = 0;
        let readOnlyIterations = 0; // Track consecutive read-only iterations
        let lastResponse;
        const editedFiles = new Set(); // Track files already edited to prevent redundant edits
        const searchResults = []; // Track web search results for context persistence
        let completedActions = 0; // Count primary actions (edits, creates, commits)

        // Read-only tools that don't modify state
        const READ_ONLY_TOOLS = new Set(['list_files', 'file_exists', 'search_files', 'read_file', 'get_repo_status', 'git_log', 'web_search', 'deep_research']);

        while (iteration < MAX_ITERATIONS) {
            iteration++;

            let response;
            let retryCount = 0;
            const maxRetries = 3;
            let currentModel = MODEL;
            
            // Check API health and use fallback model if API has been failing
            if (apiHealthStatus.consecutiveFailures >= 2 && currentModel !== apiHealthStatus.lastSuccessfulModel) {
                currentModel = apiHealthStatus.lastSuccessfulModel || MODEL_PRESETS[DEFAULT_MODEL];
                logEvent('LLM', `API unhealthy, using fallback model: ${currentModel}`);
            }
            
            // Get reasoning config for this model (null if not supported)
            const reasoningConfig = getReasoningConfig(currentModel);

            // Try request with retries and model fallback
            while (retryCount < maxRetries) {
                try {
                    response = await axios.post(OPENROUTER_URL, {
                        model: currentModel,
                        messages: messages,
                        max_tokens: 10000,
                        temperature: 0.7,
                        tools: tools,
                        tool_choice: 'auto',
                        provider: { data_collection: 'deny' }, // ZDR enforcement
                        // Add reasoning if model supports it (interleaved thinking)
                        ...(reasoningConfig && { reasoning: reasoningConfig })
                    }, {
                        headers: {
                            'Authorization': `Bearer ${getOpenRouterKey()}`,
                            'Content-Type': 'application/json',
                            'X-Request-ID': `${Date.now()}-${iteration}-${retryCount}` // Add unique request ID
                        },
                        timeout: 45000 + (retryCount * 15000), // Increase timeout on retries
                        validateStatus: function (status) {
                            return status < 500; // Don't throw on client errors, only server errors
                        }
                    });

                    // Handle 4xx errors BEFORE checking response structure
                    // (4xx responses have { error: {...} } not { choices: [...] })
                    if (response.status >= 400 && response.status < 500) {
                        const errorMsg = response.data?.error?.message || `HTTP ${response.status}`;
                        logEvent('LLM', `Client error ${response.status}: ${errorMsg}`);

                        // 429 rate limit - retry with backoff
                        if (response.status === 429) {
                            throw new Error(`Rate limited: ${errorMsg}`);
                        }
                        // 402 payment required - try fallback key first
                        if (response.status === 402) {
                            if (switchToFallbackKey()) {
                                logEvent('LLM', 'Switched to fallback API key due to 402');
                                throw new Error(`Payment required, retrying with fallback key`);
                            }
                            throw new Error(`Payment required: ${errorMsg}`);
                        }
                        // Other 4xx - don't retry, exit with graceful message
                        lastResponse = {
                            content: "I encountered an issue processing that request. Let me try a simpler approach.",
                            tool_calls: null
                        };
                        break;
                    }

                    // Check if response has expected structure
                    if (!response.data || !response.data.choices || !response.data.choices[0]) {
                        // Log the actual response for debugging
                        logEvent('LLM', `Unexpected response structure: ${JSON.stringify(response.data).slice(0, 200)}`);
                        throw new Error('Invalid response structure from OpenRouter');
                    }

                    break; // Success, exit retry loop
                    
                } catch (error) {
                    retryCount++;
                    logEvent('LLM', `API request failed (attempt ${retryCount}/${maxRetries}): ${error.message}`);
                    
                    if (retryCount < maxRetries) {
                        // Exponential backoff with jitter
                        const delay = Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, 10000);
                        logEvent('LLM', `Waiting ${Math.round(delay/1000)}s before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        
                        // On second retry, fall back to default model
                        if (retryCount === 2 && currentModel !== MODEL_PRESETS[DEFAULT_MODEL]) {
                            currentModel = MODEL_PRESETS[DEFAULT_MODEL];
                            logEvent('LLM', `Switching to ${DEFAULT_MODEL} model for retry`);
                        }
                    } else {
                        // All retries exhausted
                        throw new Error(`OpenRouter API failed after ${maxRetries} attempts: ${error.message}`);
                    }
                }
            }

            lastResponse = response.data.choices[0].message;

            // Extract reasoning/thinking from response (if model supports it)
            const reasoning = response.data.choices[0].message.reasoning_details ||
                              response.data.choices[0].message.reasoning;

            // If no tool calls, we're done
            if (!lastResponse.tool_calls || lastResponse.tool_calls.length === 0) {
                break;
            }

            logEvent('LLM', `Iteration ${iteration}: Processing ${lastResponse.tool_calls.length} tool calls`);

            // Update Discord status with thinking if available
            if (onStatusUpdate) {
                const thinkingStatus = formatThinkingForDiscord(reasoning);
                if (thinkingStatus) {
                    await onStatusUpdate(thinkingStatus);
                }
                const toolNames = lastResponse.tool_calls.map(tc => tc.function.name).join(', ');
                await onStatusUpdate(`executing: ${toolNames}...`);
            }

            // Execute all tool calls
            const toolResults = [];
            let actionCompletedThisIteration = false;

            for (const toolCall of lastResponse.tool_calls) {
                const functionName = toolCall.function.name;
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments || '{}');
                } catch (parseError) {
                    logEvent('LLM', `JSON parse error for ${functionName}: ${parseError.message}`);
                    toolResults.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: Invalid JSON in tool arguments. Please try again with valid JSON.`
                    });
                    continue;
                }

                let result;
                const toolStartTime = Date.now();
                if (functionName === 'list_files') {
                    result = await listFiles(args.path || './src');
                } else if (functionName === 'file_exists') {
                    result = await fileExists(args.path);
                } else if (functionName === 'search_files') {
                    result = await searchFiles(args.pattern, args.path || './src', {
                        caseInsensitive: args.case_insensitive || false,
                        filePattern: args.file_pattern || null
                    });
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'write_file') {
                    result = await writeFile(args.path, args.content);
                    if (!result.startsWith('Error')) {
                        completedActions++;
                        actionCompletedThisIteration = true;
                        logEvent('LLM', `Primary action: write_file (${completedActions} total)`);
                        // Record for conversational context
                        if (discordContext.channelId) {
                            recordAction(discordContext.channelId, {
                                type: 'write',
                                file: args.path,
                                summary: `created/updated ${args.path.split('/').pop()}`
                            });
                        }
                    }
                } else if (functionName === 'edit_file') {
                    // Prevent editing the same file multiple times
                    if (editedFiles.has(args.path)) {
                        result = `File ${args.path} was already edited in this conversation. Skipping redundant edit to save time.`;
                        logEvent('LLM', `Skipped redundant edit of ${args.path}`);
                    } else {
                        // Support both exact replacement (preferred) and AI-based instructions (fallback)
                        result = await editFileService(
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
                        editedFiles.add(args.path);
                        if (!result.startsWith('Error')) {
                            completedActions++;
                            actionCompletedThisIteration = true;
                            logEvent('LLM', `Primary action: edit_file pushed (${completedActions} total)`);
                            // Record for conversational context
                            if (discordContext.channelId) {
                                recordAction(discordContext.channelId, {
                                    type: 'edit',
                                    file: args.path,
                                    summary: args.instructions ? args.instructions.substring(0, 50) : 'exact replacement'
                                });
                            }
                        }
                    }
                } else if (functionName === 'commit_changes') {
                    result = await commitChanges(args.message, args.files);
                    if (!result.startsWith('Error')) {
                        completedActions++;
                        actionCompletedThisIteration = true;
                        logEvent('LLM', `Primary action: commit_changes (${completedActions} total)`);
                        // Record for conversational context
                        if (discordContext.channelId) {
                            recordAction(discordContext.channelId, {
                                type: 'commit',
                                file: args.files || '.',
                                summary: args.message?.substring(0, 50) || 'committed changes'
                            });
                        }
                    }
                } else if (functionName === 'get_repo_status') {
                    result = await getRepoStatus();
                } else if (functionName === 'git_log') {
                    result = await getGitLog(args.count, args.file, args.oneline);
                } else if (functionName === 'web_search') {
                    result = await webSearch(args.query);
                    // Store search results for context persistence
                    searchResults.push({ query: args.query, results: result });
                } else if (functionName === 'deep_research') {
                    const researchResult = await deepResearch(args.query);
                    result = `## Deep Research Results\n\n${researchResult.content}\n\n### Sources\n${researchResult.citations.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
                    searchResults.push({ query: args.query, results: result, type: 'deep' });
                } else if (functionName === 'set_model') {
                    result = await setModel(args.model);
                }

                // Log tool call to GUI dashboard and PostgreSQL (mark errors when result indicates failure)
                try {
                    const isError = typeof result === 'string' && /^Error\b/.test(result);
                    logToolCall(functionName, args, result, isError ? result : null, {
                        durationMs: Date.now() - toolStartTime,
                        iteration,
                        channelId: discordContext.channelId,
                        userId: discordContext.userId
                    });
                } catch (_) { /* ignore logging failure */ }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result
                });
            }

            // Add assistant message and tool results to conversation
            messages.push(lastResponse);
            messages.push(...toolResults);
            
            // Update agent loop with tools used and thinking (for GUI dashboard)
            if (guiServer && lastResponse.tool_calls) {
                const toolsUsed = lastResponse.tool_calls.map(tc => tc.function.name);
                const thinkingForGUI = formatThinkingForGUI(reasoning);
                updateAgentLoop(iteration, toolsUsed, thinkingForGUI);
            }

            // Track read-only iterations to prevent over-searching on info requests
            const allToolsReadOnly = lastResponse.tool_calls.every(tc => READ_ONLY_TOOLS.has(tc.function.name));
            if (allToolsReadOnly && !actionCompletedThisIteration) {
                readOnlyIterations++;
                if (readOnlyIterations >= MAX_READONLY_ITERATIONS) {
                    logEvent('LLM', `Read-only cap reached (${readOnlyIterations} iterations) - forcing final response`);

                    // Get final text-only response
                    const result = await getFinalTextResponse(messages, tools);
                    if (result) lastResponse = result;

                    break; // Exit loop - we have enough info
                }
            } else {
                readOnlyIterations = 0; // Reset if we did a write action
            }

            // After completing a primary action, give AI one more iteration to naturally respond
            if (actionCompletedThisIteration && iteration < MAX_ITERATIONS) {
                logEvent('LLM', 'Primary action completed - getting final response');

                // Notify user that action completed
                if (onStatusUpdate) {
                    const completedTools = lastResponse.tool_calls.map(tc => tc.function.name).join(', ');
                    await onStatusUpdate(`✓ done: ${completedTools}`);
                }

                // Get final text-only response (consolidated API call)
                const result = await getFinalTextResponse(messages, tools);
                if (result) lastResponse = result;

                break; // Exit loop after primary action + final response
            }
        }

        // If we hit max iterations and still have no text content, force a final response
        if (iteration >= MAX_ITERATIONS && (!lastResponse?.content || lastResponse.content.trim() === '')) {
            logEvent('LLM', `Reached max iterations (${MAX_ITERATIONS}) - forcing final text response`);

            // Get final text-only response (consolidated API call)
            const result = await getFinalTextResponse(messages, tools, { completedActions });
            if (result) lastResponse = result;
        }

        const content = lastResponse?.content;
        if (!content || content.trim() === '') {
            logEvent('LLM', 'Empty response from AI - using fallback');
            console.error('Last response:', JSON.stringify(lastResponse, null, 2));

            // Fallback based on what actions were completed - use in-character response
            let fallbackText = getBotResponse('success');

            // Extract file URLs from tool results for context
            const fileUrls = toolResults
                .map(tr => tr.content)
                .filter(c => c && c.includes('bot.inference-arcade.com'))
                .map(c => {
                    const match = c.match(/https:\/\/bot\.inference-arcade\.com\/[^\s)]+/);
                    return match ? match[0] : null;
                })
                .filter(Boolean);

            if (completedActions > 0 && fileUrls.length > 0) {
                fallbackText += ` check it out: ${fileUrls[0]}`;
            } else if (completedActions > 0) {
                fallbackText += ` changes are live at https://bot.inference-arcade.com/`;
            }

            return {
                text: fallbackText,
                searchContext: searchResults.length > 0 ? searchResults : null
            };
        }

        // End agent loop tracking with success
        endAgentLoop(content, null);
        
        // Return response with search context for history persistence
        return {
            text: content,
            searchContext: searchResults.length > 0 ? searchResults : null
        };
    } catch (error) {
        const errorEntry = errorLogger.log('LLM', error, {
            model: MODEL,
            messageLength: userMessage.length,
            conversationLength: conversationMessages.length,
            context: discordContext
        });
        errorLogger.track(errorEntry);
        
        // End agent loop tracking with error
        endAgentLoop(null, error.message);
        
        // Provide specific error messages based on error type
        let errorMessage = getBotResponse('errors');
        if (error.message?.includes('timeout')) {
            errorMessage += ' Request timed out - try again with a shorter message.';
        } else if (error.message?.includes('rate limit')) {
            errorMessage += ' API rate limit reached - wait a moment and try again.';
        } else if (error.response?.status === 401) {
            errorMessage += ' API authentication failed - check OpenRouter key.';
        } else if (error.response?.status >= 500) {
            errorMessage += ' Server error - the AI service might be down.';
        }
        
        return { text: errorMessage, searchContext: null };
    }
}

const commands = [
    new SlashCommandBuilder()
        .setName('commit')
        .setDescription('Commit and push changes to the game repository')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Commit message')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('files')
                .setDescription('Files to commit (comma separated, or "." for all)')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check repository status'),
        
        
    new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search the web for information')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('What do you want to search for?')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('set-model')
        .setDescription('Change the AI model used by the bot')
        .addStringOption(option =>
            option.setName('model')
                .setDescription('Model to use (or enter custom model name)')
                .setRequired(true)
                .addChoices(
                    ...getModelChoices(),
                    { name: 'Custom Model (enter name)', value: 'custom' }
                ))
        .addStringOption(option =>
            option.setName('custom_model')
                .setDescription('Custom model name (e.g. deepseek/deepseek-v3.1-terminus:exacto)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Quick yes/no poll with thumbs up/down')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Question to ask')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('deep-research')
        .setDescription('Comprehensive research with citations (takes 1-3 min)')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('What do you want to research in depth?')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Query bot activity logs and statistics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('recent')
                .setDescription('Show recent events')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Event type to filter')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Mentions', value: 'mention' },
                            { name: 'Tool Calls', value: 'tool_call' },
                            { name: 'File Changes', value: 'file_change' },
                            { name: 'Errors', value: 'error' },
                            { name: 'All', value: 'all' }
                        ))
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of results (default: 10, max: 25)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('errors')
                .setDescription('Show error summary')
                .addStringOption(option =>
                    option.setName('period')
                        .setDescription('Time period')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Last hour', value: '1h' },
                            { name: 'Last 24 hours', value: '24h' },
                            { name: 'Last 7 days', value: '7d' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('Show activity statistics')
                .addIntegerOption(option =>
                    option.setName('days')
                        .setDescription('Number of days (default: 7)')
                        .setRequired(false))),

];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// Validate commands are properly constructed
console.log(`Loaded ${commands.length} slash commands`);
commands.forEach((cmd, idx) => {
    const json = cmd.toJSON();
    if (!json.name || !json.description) {
        console.error(`Command ${idx} is invalid:`, json);
    }
});

// Helper to get guild ID from channel ID
async function getGuildIdFromChannel(channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        return channel.guildId;
    } catch (error) {
        console.warn(`Could not fetch guild for channel ${channelId}:`, error.message);
        return null;
    }
}

client.once('clientReady', async () => {
    console.log(`Bot is ready as ${client.user.tag}`);
    console.log(`Monitoring channels: ${CHANNEL_IDS.length > 0 ? CHANNEL_IDS.join(', ') : 'ALL CHANNELS'}`);
    console.log(`Message Content Intent enabled: ${client.options.intents.has(GatewayIntentBits.MessageContent)}`);

    try {
        console.log('Refreshing slash commands...');
        const commandsJSON = commands.map(command => command.toJSON());
        console.log(`Registering ${commandsJSON.length} commands`);
        console.log('First command sample:', JSON.stringify(commandsJSON[0], null, 2));

        // Filter out any commands with invalid data
        const validCommands = commandsJSON.filter(cmd => {
            if (!cmd.name || !cmd.description) {
                console.warn(`⚠️ Skipping invalid command:`, cmd.name || '(unnamed)');
                return false;
            }
            return true;
        });

        console.log(`Sending ${validCommands.length} valid commands to Discord`);

        // Try guild-specific registration first (more reliable)
        if (CHANNEL_IDS.length > 0) {
            const guildId = await getGuildIdFromChannel(CHANNEL_IDS[0]);
            if (guildId) {
                console.log(`Registering commands to guild: ${guildId}`);
                await rest.put(
                    Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, guildId),
                    { body: validCommands }
                );
                console.log('✅ Slash commands registered to guild successfully.');
            } else {
                // Fall back to global registration
                console.log('Attempting global command registration...');
                await rest.put(
                    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                    { body: validCommands }
                );
                console.log('✅ Slash commands registered globally successfully.');
            }
        } else {
            // Fall back to global registration
            console.log('Attempting global command registration...');
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
                { body: validCommands }
            );
            console.log('✅ Slash commands registered globally successfully.');
        }
    } catch (error) {
        console.error('❌ Error registering slash commands:', error.message);
        if (error.rawError) {
            console.error('Full error details:', JSON.stringify(error.rawError, null, 2));
        }
        if (error.statusCode === 401 || error.statusCode === 403) {
            console.error('⚠️ Authentication error - check DISCORD_CLIENT_ID and DISCORD_TOKEN in .env');
        }
        // Don't exit - commands might still work despite registration error
        console.log('⚠️ Continuing without registered commands (will attempt to use cached commands)');
    }

    // Initialize Discord context manager (replaces agents.md)
    contextManager = new DiscordContextManager(client);
    console.log('✅ Discord context manager initialized');

    // Context fetched on-demand when Bot Sportello receives input (no startup prefetch)

    // Sync index.html with all HTML files in /src
    try {
        await syncIndexWithSrcFiles();
    } catch (error) {
        console.error('Error syncing index.html on startup:', error);
    }
});

client.on('interactionCreate', async interaction => {
    // Handle button interactions
    if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
        return;
    }
    
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;
    const userId = interaction.user.id;

    try {
        // Only defer reply for commands that need it (not poll)
        if (!['poll'].includes(commandName)) {
            await interaction.deferReply();
        }

        switch (commandName) {
            case 'commit':
                await handleCommit(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
            case 'search':
                await handleSearch(interaction);
                break;
            case 'set-model':
                await handleSetModel(interaction);
                break;
            case 'poll':
                await handlePoll(interaction);
                break;
            case 'deep-research':
                await handleDeepResearch(interaction);
                break;
            case 'logs':
                await handleLogs(interaction);
                break;
            default:
                const unknownMsg = "Unknown command. Try /status to see available commands.";
                if (interaction.deferred) {
                    await interaction.editReply(unknownMsg);
                } else {
                    await interaction.reply({ content: unknownMsg, flags: 64 }); // MessageFlags.Ephemeral
                }
        }

        // Clear error tracking on successful completion
        clearErrorTracking(userId, commandName);

    } catch (error) {
        console.error('Command error:', error);

        // Track error and check for loops
        const isInLoop = trackError(userId, commandName);
        const errorMsg = isInLoop
            ? "yeah so... we keep hitting the same issue man. gonna need a few minutes before trying again"
            : getBotResponse('errors');

        try {
            if (interaction.deferred && !interaction.replied) {
                await interaction.editReply(errorMsg);
            } else if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errorMsg, flags: 64 }); // MessageFlags.Ephemeral
            }
            // If already replied or deferred but replied, silently fail
        } catch (replyError) {
            // Silently handle reply errors - interaction may have expired
            if (replyError.code !== 40060 && replyError.code !== 10062) {
                console.error('Unexpected error reply failure:', replyError.code, replyError.message);
            }
        }
    }
});

// Message tracking for conversation context
client.on('messageCreate', async message => {
    // Debug: Log all incoming messages (uncomment for troubleshooting)
    // console.log(`[DEBUG] Message from ${message.author.username} in channel ${message.channel.id}: ${message.content.substring(0, 50)}`);

    // Ignore bot messages (including our own)
    if (message.author.bot) {
        return;
    }

    // Only track messages from designated channels (if CHANNEL_IDS is configured)
    if (CHANNEL_IDS.length > 0 && !CHANNEL_IDS.includes(message.channel.id)) {
        // Log when messages are filtered out (helps debug channel ID issues)
        if (message.mentions.has(client.user)) {
            console.log(`⚠️ [CHANNEL_FILTER] Mention ignored from ${message.author.username} in channel ${message.channel.id} (not in CHANNEL_IDS: ${CHANNEL_IDS.join(',')})`);
        }
        return;
    }

    // Add message to conversation history
    console.log(`[TRACKING] ${message.author.username} in #${message.channel.name || message.channel.id}: ${message.content.substring(0, 100)}`);
    addToHistory(message.author.username, message.content, false);
    if (contextManager) {
        contextManager.upsertMessage(message);
    }

    // Handle @ mentions with full AI capabilities
    if (message.mentions.has(client.user)) {
        console.log(`🔔 [MENTION DETECTED] ${message.author.username} mentioned the bot in #${message.channel.name || message.channel.id}`);
        // Don't block - handle async
        handleMentionAsync(message).catch(error => {
            console.error('❌ Async mention handler error:', error);
        });
    }
});

// Track processed mentions to prevent duplicates
const processedMentions = new Set();

// Async mention handler to prevent blocking
async function handleMentionAsync(message) {
    let thinkingMsg = null;
    try {
        // Prevent duplicate processing of the same message
        if (processedMentions.has(message.id)) {
            console.log(`[MENTION] Skipping duplicate message ${message.id}`);
            return;
        }
        processedMentions.add(message.id);
        console.log(`✅ [MENTION] Accepted message ${message.id} from ${message.author.username}`);

        // Clean up old message IDs (keep last 100)
        if (processedMentions.size > 100) {
            const toDelete = Array.from(processedMentions).slice(0, 50);
            toDelete.forEach(id => processedMentions.delete(id));
        }

        const content = message.content.replace(/<@!?\d+>/g, '').trim();
        const username = message.author.username;

        logEvent('MENTION', `${username}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

        // Log mention to PostgreSQL
        postgres.logMention({
            userId: message.author.id,
            username,
            channelId: message.channel.id,
            content
        });

        // Send context-aware thinking message
        console.log(`[MENTION] Sending thinking response to ${username}...`);

        // Determine what kind of request this is and send appropriate message
        const lowerContent = content.toLowerCase();
        let thinkingMessage = getBotResponse('thinking'); // default

        if (lowerContent.startsWith('list') || lowerContent.startsWith('show') || lowerContent.startsWith('find') || lowerContent.startsWith('search')) {
            thinkingMessage = '🔍 searching files...';
        } else if (lowerContent.includes('what are') || lowerContent.includes('what is') || lowerContent.includes('tell me')) {
            thinkingMessage = '🔍 looking that up...';
        }

        thinkingMsg = await message.reply(thinkingMessage);
        console.log(`[MENTION] Thinking message sent successfully`);

        // Build conversation context for all processing loops
        const conversationMessages = await buildContextForChannel(message.channel, CONFIG.DISCORD_CONTEXT_LIMIT);
        let processingAttempt = 1;
        const maxProcessingAttempts = 6; // Increased to support multiple model fallbacks
        let lastFailureReason = '';

        // Multi-loop processing with resilient reassessment
        while (processingAttempt <= maxProcessingAttempts) {
            logEvent('MENTION', `Processing attempt ${processingAttempt}/${maxProcessingAttempts}${lastFailureReason ? ` (prev: ${lastFailureReason})` : ''}`);
            
            try {
                // Loop 1: Edit request detection (DISABLED - now using LLM classifier)
                if (false && processingAttempt <= 2 && isEditRequest(content, conversationMessages)) {
                    logEvent('MENTION', `Attempt ${processingAttempt}: Detected edit request - using streamlined edit loop`);

                    let llmResult = await getEditResponse(content, conversationMessages);
                    let response = cleanBotResponse(llmResult.text);

                    // Check if edit loop suggests using normal flow instead
                    if (llmResult.suggestNormalFlow) {
                        lastFailureReason = 'edit-loop-suggests-normal';
                        logEvent('MENTION', 'Edit loop suggests normal flow - reassessing');
                        processingAttempt++;
                        continue; // Try next approach
                    } else if (!response || response.trim().length === 0) {
                        lastFailureReason = 'empty-edit-response';
                        logEvent('MENTION', 'Empty edit response - reassessing');
                        processingAttempt++;
                        continue; // Try next approach
                    } else {
                        await safeEditReply(thinkingMsg, response);
                        addToHistory(username, content, false);
                        addToHistory('Bot Sportello', response, true);
                        return; // Success - exit
                    }
                }

                // Break out to continue with other processing loops below
                break;

            } catch (error) {
                lastFailureReason = `error-${error.message.slice(0, 20)}`;
                logEvent('MENTION', `Attempt ${processingAttempt} failed: ${error.message}`);
                processingAttempt++;
                if (processingAttempt <= maxProcessingAttempts) {
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (trying different approach...)`);
                    continue;
                }
                throw error; // Re-throw if all attempts failed
            }
        }

        // Continue with additional processing loops
        processingAttempt = Math.max(processingAttempt, 1); // Reset if needed
        
        // Cache classification so we only do it once per mention
        let classificationResult = null;
        let classificationTried = false;

        while (processingAttempt <= maxProcessingAttempts) {
            try {
                // Use LLM classifier to determine request type (replaces keyword-based detection)
                if (processingAttempt <= 3) {
                    if (!classificationTried) {
                        classificationResult = await classifyRequest(content);
                        classificationTried = true;
                    }
                    const classification = classificationResult;
                    logEvent('MENTION', `Attempt ${processingAttempt}: LLM classified as ${classification.type}${classification?.method ? ` (${classification.method})` : ''}`);
                    
                    // Handle READ_ONLY requests immediately (like "print the site inventory")
                    if (classification.isReadOnly) {
                        // If the read-only request clearly involves repository browsing (files, src/, commits),
                        // route to normal LLM flow with tools; otherwise use a fast no-tools reply.
                        const repoIntent = /(src\/|\.(html|js)\b|projectmetadata\.json|index\.html|repository|repo|git|commit|push)/i.test(content);
                        const listSearchFiles = /\b(list|show|find|search)\b[^\n]*\b(files?|pages?|commits?)\b/i.test(content);
                        if (repoIntent || listSearchFiles) {
                            logEvent('MENTION', `READ_ONLY repo request - routing to normal flow with tools`);
                            // Break out to proceed with normal LLM processing below
                        } else {
                            logEvent('MENTION', `READ_ONLY conversational info - fast no-tools response`);
                            await safeEditReply(thinkingMsg, '📖 processing your information request...');
                            const originalModel = MODEL;
                            try {
                                MODEL = MODEL_PRESETS.glm;
                                const simpleResponse = await axios.post(OPENROUTER_URL, {
                                    model: MODEL,
                                    messages: [
                                        { role: 'system', content: 'You are Bot Sportello, a helpful Discord bot. Answer briefly and directly. No code unless asked explicitly.' },
                                        { role: 'user', content: content }
                                    ],
                                    max_tokens: 500,
                                    temperature: 0.7
                                }, {
                                    headers: {
                                        'Authorization': `Bearer ${getOpenRouterKey()}`,
                                        'Content-Type': 'application/json'
                                    },
                                    timeout: 30000
                                });
                                let response = cleanBotResponse(simpleResponse.data.choices[0].message.content || '');
                                if (!response) response = 'Got it.';
                                await safeEditReply(thinkingMsg, response);
                                addToHistory(username, content, false);
                                addToHistory('Bot Sportello', response, true);
                                return; // Done
                            } finally {
                                MODEL = originalModel;
                            }
                        }
                    }

                    // Handle general conversation/greetings with a super fast path
                    if (classification.isConversation) {
                        logEvent('MENTION', `CONVERSATION request - fast small-talk response`);
                        const originalModel = MODEL;
                        try {
                            MODEL = MODEL_PRESETS.glm;
                            const simpleResponse = await axios.post(OPENROUTER_URL, {
                                model: MODEL,
                                messages: [
                                    { role: 'system', content: 'You are Bot Sportello. Reply in one or two short friendly sentences. No tools, no files, no code.' },
                                    { role: 'user', content: content }
                                ],
                                max_tokens: 120,
                                temperature: 0.8
                            }, {
                                headers: {
                                    'Authorization': `Bearer ${getOpenRouterKey()}`,
                                    'Content-Type': 'application/json'
                                },
                                timeout: 20000
                            });
                            let response = cleanBotResponse(simpleResponse.data.choices[0].message.content || '');
                            if (!response) response = getBotResponse('confirmations');
                            await safeEditReply(thinkingMsg, response);
                            addToHistory(username, content, false);
                            addToHistory('Bot Sportello', response, true);
                            return; // Done
                        } finally {
                            MODEL = originalModel;
                        }
                    }

                    // Handle COMMIT requests immediately
                    if (classification.isCommit) {
                        logEvent('MENTION', `COMMIT request - executing git commit`);
                        await safeEditReply(thinkingMsg, '💾 committing changes...');
                        
                        try {
                            // Extract commit message from the request, or use default
                            let commitMessage = 'commit changes';
                            const lowerContent = content.toLowerCase();
                            
                            // Extract the file reference if mentioned (e.g., "commit this game" -> look for recent files)
                            if (lowerContent.includes('this game') || lowerContent.includes('this file') || lowerContent.includes('this page')) {
                                // Check for recently modified files in src directory
                                const srcFiles = await fs.readdir('./src').catch(() => []);
                                if (srcFiles.length > 0) {
                                    // Use the most recent file name as hint
                                    const recentFile = srcFiles[srcFiles.length - 1];
                                    commitMessage = `commit src/${recentFile}`;
                                }
                            }
                            
                            // Try to extract explicit commit message (e.g., "commit with message 'fix bug'")
                            const messageMatch = content.match(/(?:commit.*?(?:with message|as|:)\s*['"]([^'"]+)['"])|(?:commit\s+['"]([^'"]+)['"])/i);
                            if (messageMatch) {
                                commitMessage = messageMatch[1] || messageMatch[2];
                            }

                            const result = await commitChanges(commitMessage);
                            await safeEditReply(thinkingMsg, `✅ ${result}`);
                            
                            // Success - break out of retry loop
                            return;
                            
                        } catch (error) {
                            lastFailureReason = `commit-failed`;
                            logEvent('MENTION', `Commit failed: ${error.message}`);
                            await safeEditReply(thinkingMsg, `❌ commit failed: ${error.message}`);
                            return;
                        }
                    }
                    
                    // Handle content creation requests with game pipeline
                    if (classification.isCreate) {
                        logEvent('MENTION', `CREATE_NEW request - routing to game pipeline`);
                        await safeEditReply(thinkingMsg, '📝 detected content creation request - firing up the content builder...');

                        const triggerSource = {
                        kind: 'mention',
                        userId: message.author.id,
                        username: message.author.username,
                        messageId: message.id
                    };

                    const result = await runGamePipeline({
                        userPrompt: content,
                        triggerSource,
                        onStatusUpdate: async (msg) => {
                            try {
                                await safeEditReply(thinkingMsg, msg);
                            } catch (err) {
                                console.error('Status update error:', err);
                            }
                        },
                        preferredType: 'auto'
                    });

                    if (!result.ok) {
                        lastFailureReason = `game-build-failed`;
                        logEvent('MENTION', `Game pipeline failed: ${result.error}`);
                        processingAttempt++;
                        if (processingAttempt <= maxProcessingAttempts) {
                            await safeEditReply(thinkingMsg, 'hmm the game builder hit a snag... lemme try a different approach...');
                            continue; // Try next approach
                        }
                        break;
                    }

                    // Commit and push
                    await safeEditReply(thinkingMsg, '💾 committing to repo...');
                    const commitSuccess = await commitGameFiles(result);

            if (commitSuccess) {
                await safeEditReply(thinkingMsg, '🚀 pushing to github pages...');

                // Push is already handled by runGamePipeline via GitHub API
                console.log('[MENTION_PIPELINE] Files already pushed via GitHub API');
            }

                    // Success message
                    const scoreEmoji = result.testResult.score >= 80 ? '✨' : result.testResult.score >= 60 ? '✓' : '⚠️';
                    const successMsg = `${scoreEmoji} **${result.plan.metadata.title}** built and deployed!\n\n${result.docs.releaseNotes}\n\n🎮 **Play now:** ${result.liveUrl}\n\n📊 Quality: ${result.testResult.score}/100 | ⏱️ Build time: ${result.duration}\n\n*Give it a minute or two to go live*`;

                    await safeEditReply(thinkingMsg, successMsg);

                    // Add to history
                    addToHistory(username, content, false);
                    addToHistory('Bot Sportello', successMsg, true);

                    // Record game creation for conversational context
                    if (message.channel.id && result.plan?.outputPath) {
                        recordAction(message.channel.id, {
                            type: 'create',
                            file: result.plan.outputPath,
                            summary: result.plan.metadata?.title || 'new game created'
                        });
                    }

                    return; // Success - exit
                    }
                    
                    // Handle functionality fixes with full tool access (skip limited edit loop)
                    if (classification.isFunctionalityFix) {
                        logEvent('MENTION', `FUNCTIONALITY_FIX request - using normal chat flow for full tool access`);
                        await safeEditReply(thinkingMsg, '🔧 analyzing functionality issue...');
                        // Skip to normal LLM response with full tools
                        processingAttempt = 4;
                        break; // Exit classification loop to proceed to final LLM processing
                    }
                    
                    // Handle simple edits with streamlined edit loop
                    if (classification.isEdit) {
                        logEvent('MENTION', `SIMPLE_EDIT request - using streamlined edit loop`);
                        await safeEditReply(thinkingMsg, '✏️ making simple edit...');
                        
                        let llmResult = await getEditResponse(content, conversationMessages);
                        let response = cleanBotResponse(llmResult.text);
                        
                        if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
                            logEvent('EDIT_LOOP', `Iteration 1: ${llmResult.toolCalls.length} tools`);

                            // Process tool calls and iterate up to 10 times
                            for (let iteration = 1; iteration <= 10 && llmResult.toolCalls && llmResult.toolCalls.length > 0; iteration++) {
                                const results = [];

                                // Show user what tools are being executed
                                const toolNames = llmResult.toolCalls.map(tc => tc.function?.name || 'unknown').join(', ');
                                await safeEditReply(thinkingMsg, `✏️ step ${iteration}: ${toolNames}...`);

                                for (const toolCall of llmResult.toolCalls) {
                                    const result = await executeToolCall(toolCall);
                                    results.push(result);
                                }

                                if (iteration < 10) {
                                    llmResult = await getEditResponse(content, conversationMessages, results);
                                    response = cleanBotResponse(llmResult.text);
                                    if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
                                        logEvent('EDIT_LOOP', `Iteration ${iteration + 1}: ${llmResult.toolCalls.length} tools`);
                                    }
                                }
                            }

                            // If we have a response from the AI, send it
                            if (response) {
                                await safeEditReply(thinkingMsg, response);
                                addToHistory(username, content, false);
                                addToHistory('Bot Sportello', response, true);
                                return; // Success - exit
                            }

                            // Tools executed but AI didn't provide text - use in-character completion message
                            const fallbackMsg = `${getBotResponse('success')} changes are live at https://bot.inference-arcade.com/`;
                            await safeEditReply(thinkingMsg, fallbackMsg);
                            addToHistory(username, content, false);
                            addToHistory('Bot Sportello', fallbackMsg, true);
                            return; // Success - exit with fallback message
                        } else {
                            logEvent('EDIT_LOOP', 'No tool calls in response - AI may need more context');
                        }

                        // If edit loop didn't work, continue to fallback loops below
                        processingAttempt++;
                        if (processingAttempt <= maxProcessingAttempts) {
                            await safeEditReply(thinkingMsg, 'hmm that didn\'t quite work... lemme try a different approach...');
                            continue;
                        }
                        break;
                    }

                    // Break out to continue with remaining loops below
                    break;
                }

            } catch (gameError) {
                lastFailureReason = `game-error-${gameError.message.slice(0, 20)}`;
                logEvent('MENTION', `Game pipeline attempt ${processingAttempt} failed: ${gameError.message}`);
                processingAttempt++;
                if (processingAttempt <= maxProcessingAttempts) {
                    await safeEditReply(thinkingMsg, 'hmm that approach hit a snag... lemme try something else...');
                    continue;
                }
                console.error('All game pipeline attempts failed:', gameError);
                break; // Fall through to normal LLM processing
            }
        }

        // Final processing loops: Normal LLM flow with multiple fallbacks
        // Reset to 1 for normal LLM processing (especially for READ_ONLY requests)
        if (processingAttempt > maxProcessingAttempts) {
            processingAttempt = 1; // READ_ONLY or other requests that broke out early
        } else {
            processingAttempt = Math.max(processingAttempt, 1); // Ensure we start from 1
        }
        let finalResponse = '';
        let finalSearchContext = null;
        
        while (processingAttempt <= maxProcessingAttempts && !finalResponse) {
            try {
                logEvent('MENTION', `Final LLM attempt ${processingAttempt}/${maxProcessingAttempts}${lastFailureReason ? ` (prev: ${lastFailureReason})` : ''}`);

                // Progressive fallback strategies for LLM processing
                let llmResult;
                const discordContext = {
                    user: message.author.username,
                    channel: message.channel.name || message.channel.id,
                    channelId: message.channel.id  // For action cache keying
                };
                
                if (processingAttempt === 1) {
                    // Full LLM with all tools
                    await safeEditReply(thinkingMsg, '🤖 processing with AI tools...');
                    llmResult = await getLLMResponse(content, conversationMessages, discordContext, async (status) => {
                        try {
                            await safeEditReply(thinkingMsg, status);
                        } catch (err) {
                            console.error('Status update error:', err.message);
                        }
                    });
                } else if (processingAttempt === 2) {
                    // Retry with GLM model and reduced context
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (trying faster model...)`);
                    const originalModel = MODEL;
                    MODEL = MODEL_PRESETS.glm; // Switch to GLM for reliability
                    try {
                        llmResult = await getLLMResponse(content, conversationMessages.slice(-10), discordContext);
                    } finally {
                        MODEL = originalModel; // Restore original model
                    }
                } else if (processingAttempt === 3) {
                    // Try Kimi as alternative (ZDR-compliant)
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (trying alternative model...)`);
                    const originalModel = MODEL;
                    MODEL = MODEL_PRESETS.kimi;
                    try {
                        llmResult = await getLLMResponse(content, [], discordContext);
                    } finally {
                        MODEL = originalModel;
                    }
                } else if (processingAttempt === 4) {
                    // This is where FUNCTIONALITY_FIX routes to - provide clear feedback
                    await safeEditReply(thinkingMsg, '🛠️ analyzing issue with full tool access...');
                    llmResult = await getLLMResponse(content, conversationMessages, discordContext, async (status) => {
                        try {
                            await safeEditReply(thinkingMsg, status);
                        } catch (err) {
                            console.error('Status update error:', err.message);
                        }
                    });
                } else {
                    // Final attempt: GLM with absolute minimal constraints and no tools
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (final simplified attempt...)`);
                    const originalModel = MODEL;
                    MODEL = MODEL_PRESETS.glm;
                    try {
                        // Make a direct API call without tools for maximum reliability
                        const simpleResponse = await axios.post(OPENROUTER_URL, {
                            model: MODEL,
                            messages: [
                                { role: 'system', content: 'You are Bot Sportello, a helpful Discord bot. Give a brief, friendly response.' },
                                { role: 'user', content: content }
                            ],
                            max_tokens: 500,
                            temperature: 0.7
                        }, {
                            headers: {
                                'Authorization': `Bearer ${getOpenRouterKey()}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 30000
                        });
                        llmResult = { text: simpleResponse.data.choices[0].message.content };
                    } finally {
                        MODEL = originalModel;
                    }
                }

                let response = llmResult.text;

                // Clean duplicate Bot Sportello prefixes
                response = cleanBotResponse(response);

                // Validate response quality
                if (!response || response.trim().length === 0) {
                    lastFailureReason = 'empty-response';
                    logEvent('MENTION', `Attempt ${processingAttempt}: Empty response`);
                    processingAttempt++;
                    continue;
                } else if (response.length < 10) {
                    lastFailureReason = 'too-short';
                    logEvent('MENTION', `Attempt ${processingAttempt}: Response too short`);
                    processingAttempt++;
                    continue;
                } else if (response.includes('Error:') && processingAttempt <= 3) {
                    lastFailureReason = 'error-response';
                    logEvent('MENTION', `Attempt ${processingAttempt}: Error in response`);
                    processingAttempt++;
                    continue;
                }

                finalResponse = response;
                finalSearchContext = llmResult.searchContext;
                break;

            } catch (llmError) {
                lastFailureReason = `llm-error-${llmError.message.slice(0, 20)}`;
                logEvent('MENTION', `LLM attempt ${processingAttempt} failed: ${llmError.message}`);
                processingAttempt++;
                if (processingAttempt <= maxProcessingAttempts) {
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (adjusting approach...)`);
                    continue;
                }
                // Re-throw the error to be handled by outer catch block
                throw llmError;
            }
        }

        // If no response after all attempts, throw error
        if (!finalResponse) {
            throw new Error(`All ${maxProcessingAttempts} processing attempts failed. Last failure: ${lastFailureReason}`);
        }

        // Add to history - include search context if any
        addToHistory(username, content, false);
        if (finalSearchContext) {
            const searchSummary = finalSearchContext.map(s =>
                `[Search: "${s.query}"]\n${s.results}`
            ).join('\n\n');
            addToHistory('Bot Sportello', `${searchSummary}\n\n${finalResponse}`, true);
        } else {
            addToHistory('Bot Sportello', finalResponse, true);
        }

        // Send response directly (no commit prompts in mentions)
        if (finalResponse.length > 2000) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `logs/responses/mention-${timestamp}.txt`;

            await fs.mkdir('logs/responses', { recursive: true });
            const fileContent = `User: ${username}\nMessage: ${content}\nTimestamp: ${new Date().toISOString()}\n\n---\n\n${finalResponse}`;
            await fs.writeFile(fileName, fileContent);

            const truncated = finalResponse.substring(0, 1800);
            await safeEditReply(thinkingMsg, `${truncated}...\n\n*[Full response saved to \`${fileName}\`]*`);
        } else {
            await safeEditReply(thinkingMsg, finalResponse);
        }

    } catch (error) {
        console.error('❌ Mention handler error:', error);
        const errorDetails = error.response?.data || error.message || 'Unknown error';
        console.error('Error details:', errorDetails);

        // Provide user-friendly fallback messages based on error type
        let userMessage;
        if (error.message?.includes('500') || error.message?.includes('OpenRouter')) {
            userMessage = `${getBotResponse('thinking')} the AI service is having issues right now. give me a sec to reconnect...`;
        } else if (error.message?.includes('timeout')) {
            userMessage = `${getBotResponse('errors')} that took too long, my connection timed out. try again in a moment?`;
        } else if (error.message?.includes('429') || error.message?.includes('rate limit')) {
            userMessage = `whoa, slow down there... the AI needs a breather. try again in like 30 seconds`;
        } else if (error.message?.includes('401') || error.message?.includes('authentication')) {
            userMessage = `${getBotResponse('errors')} looks like my API credentials expired. someone needs to update my config...`;
        } else if (error.message?.includes('All') && error.message?.includes('attempts failed')) {
            userMessage = `man, i tried like ${maxProcessingAttempts} different ways but couldn't get through. the AI servers might be overloaded. maybe try again in a minute?`;
        } else {
            userMessage = `${getBotResponse('errors')}\n\n*couldn't process that one: ${error.message?.substring(0, 100) || 'technical difficulties'}*`;
        }

        try {
            // Try to edit thinking message with error, or send new error message
            if (thinkingMsg && !thinkingMsg.deleted) {
                try {
                    await safeEditReply(thinkingMsg, userMessage);
                    console.log(`[MENTION] Error message edited into thinking message`);
                } catch (editErr) {
                    console.warn(`[MENTION] Could not edit thinking message:`, editErr.message);
                    await message.reply(userMessage);
                }
            } else {
                console.log(`[MENTION] Sending error as new reply (no thinking message)`);
                await message.reply(userMessage);
            }
        } catch (replyError) {
            console.error('❌ Failed to send error reply:', replyError.message);
            // Last resort - try one more time with a simple message
            try {
                console.log(`[MENTION] Attempting final error fallback...`);
                await message.reply(getBotResponse('errors'));
            } catch (finalError) {
                console.error('❌ All error reply attempts failed:', finalError.message);
            }
        }
    }
}

async function handleCommit(interaction) {
    try {
        const message = validateInput(interaction.options.getString('message'), 500);
        const files = interaction.options.getString('files') || '.';
        
        // Use GitHub API to get repo status (no git CLI needed)
        const { getRepoStatus } = require('./services/gitHelper');
        const status = await getRepoStatus('main');
        
        // For GitHub API approach, we'll check for actual files to commit
        let filesToCheck = [];
        if (files === '.') {
            // Check common files
            const srcFiles = await fs.readdir('./src').catch(() => []);
            filesToCheck = [...srcFiles.map(f => `src/${f}`), 'index.html', 'projectmetadata.json'];
        } else {
            filesToCheck = files.split(',').map(f => f.trim());
        }
        
        // Filter for existing files
        const existingFiles = [];
        for (const file of filesToCheck) {
            try {
                await fs.access(file);
                existingFiles.push(file);
            } catch (e) {
                // File doesn't exist
            }
        }
        
        if (existingFiles.length === 0) {
            await interaction.editReply("No files found to commit.");
            return;
        }

        // Show confirmation dialog with file details
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Commit & Push')
            .setDescription(`Ready to commit and push **${existingFiles.length} file(s)** to the live repository?`)
            .addFields(
                { name: 'Commit Message', value: message, inline: false },
                { name: 'Files to Commit', value: files === '.' ? 'All changed files' : files, inline: false },
                { name: 'Files Found', value: existingFiles.slice(0, 10).map(f => `• ${f}`).join('\n') + (existingFiles.length > 10 ? `\n... and ${existingFiles.length - 10} more` : ''), inline: false }
            )
            .setColor(0xFF6B35) // Orange warning color
            .setTimestamp();

        // Create confirmation buttons
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`commit_confirm_${interaction.user.id}`)
                    .setLabel('✅ Commit & Push')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`commit_cancel_${interaction.user.id}`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({ 
            content: '', 
            embeds: [confirmEmbed], 
            components: [confirmRow] 
        });

        // Store commit data for button handler
        if (!global.commitPendingData) global.commitPendingData = new Map();
        global.commitPendingData.set(interaction.user.id, {
            message,
            files,
            existingFiles, // Use existingFiles instead of git status
            interactionId: interaction.id
        });

        // Set timeout to clean up pending data
        setTimeout(() => {
            global.commitPendingData?.delete(interaction.user.id);
        }, 300000); // 5 minutes

    } catch (error) {
        console.error('Commit preparation error:', error);
        await interaction.editReply(getBotResponse('errors') + ` ${error.message}`);
    }
}

// New function to handle the actual commit process
async function executeCommit(interaction, commitData) {
    try {
        // Import GitHub API helpers
        const { pushMultipleFiles } = require('./services/gitHelper');
        
        // Update status with progress
        await interaction.editReply({ content: 'Collecting files...', embeds: [], components: [] });
        
        // Collect file contents for GitHub API
        const filesToCommit = [];
        const filesToProcess = commitData.existingFiles || [];
        
        for (const file of filesToProcess) {
            try {
                const content = await fs.readFile(file, 'utf8');
                filesToCommit.push({ path: file, content });
            } catch (e) {
                console.warn(`Could not read file: ${file}`);
            }
        }
        
        if (filesToCommit.length === 0) {
            await interaction.editReply('No valid files to commit.');
            return;
        }
        
        // Update progress
        await interaction.editReply('Creating commit via GitHub API...');
        
        // Push all files in a single commit via GitHub API
        const commitSha = await pushMultipleFiles(filesToCommit, commitData.message, 'main');
        
        if (!commitSha) {
            throw new Error('Commit failed - no SHA returned');
        }
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes pushed! Site will update in 1-2 minutes.')
            .addFields(
                { name: 'Commit Message', value: commitData.message, inline: false },
                { name: 'Commit Hash', value: commitSha.substring(0, 7), inline: true },
                { name: 'Files Changed', value: filesToCommit.length.toString(), inline: true },
                { name: 'Deployment', value: '⏳ Deploying... (1-2 min)', inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp();
        
        // Add repository link if URL is available
        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Changes](${process.env.GITHUB_REPO_URL}/commit/${commitSha})`,
                inline: false
            });
        }
        
        await safeEditReply(interaction, { content: '', embeds: [embed] });
        
    } catch (error) {
        console.error('Commit execution error:', error);
        
        // Provide more specific error messages
        let errorMessage = getBotResponse('errors');
        
        if (error.message.includes('authentication')) {
            errorMessage += ' Authentication issue with GitHub.';
        } else if (error.message.includes('nothing to commit')) {
            errorMessage += ' Nothing new to commit.';
        } else if (error.message.includes('remote')) {
            errorMessage += ' Trouble reaching the remote repository.';
        } else {
            errorMessage += ` ${error.message}`;
        }
        
        await interaction.editReply(errorMessage);
    }
}

// Handle button interactions
async function handleButtonInteraction(interaction) {
    const [action, type, userId] = interaction.customId.split('_');
    
    // Ensure only the original user can interact with their buttons
    if (userId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only interact with your own buttons.', flags: 64 }); // MessageFlags.Ephemeral
        return;
    }
    
    try {
        if (action === 'commit') {
            if (type === 'confirm') {
                // Get stored commit data
                const commitData = global.commitPendingData?.get(interaction.user.id);
                if (!commitData) {
                    await interaction.reply({ content: 'Commit data expired. Please run the command again.', flags: 64 }); // MessageFlags.Ephemeral
                    return;
                }
                
                // Acknowledge the button click
                await interaction.deferUpdate();
                
                // Execute the commit
                await executeCommit(interaction, commitData);
                
                // Clean up
                global.commitPendingData?.delete(interaction.user.id);
                
            } else if (type === 'cancel') {
                // Clean up and show cancellation
                global.commitPendingData?.delete(interaction.user.id);
                
                const cancelEmbed = new EmbedBuilder()
                    .setTitle('❌ Commit Cancelled')
                    .setDescription('No changes were made to the repository.')
                    .setColor(0xFF6B6B)
                    .setTimestamp();
                    
                await interaction.update({ 
                    content: '', 
                    embeds: [cancelEmbed], 
                    components: [] 
                });
            }
        } else if (action === 'mention') {
            if (type === 'commit') {
                // Get stored mention commit data
                const commitData = global.mentionCommitData?.get(interaction.user.id);
                if (!commitData) {
                    await interaction.reply({ content: 'Commit data expired. Please run the command again.', flags: 64 }); // MessageFlags.Ephemeral
                    return;
                }
                
                // Acknowledge the button click
                await interaction.deferUpdate();
                
                // Execute the commit using the stored git status
                await executeMentionCommit(interaction, commitData);
                
                // Clean up
                global.mentionCommitData?.delete(interaction.user.id);
                
            } else if (type === 'discard') {
                // Get stored mention commit data for response
                const commitData = global.mentionCommitData?.get(interaction.user.id);
                
                // Clean up pending data
                global.mentionCommitData?.delete(interaction.user.id);
                
                // GitHub API doesn't need local reset - changes are not staged locally
                console.log('[DISCARD] No local changes to reset (GitHub API mode)');
                
                const discardEmbed = new EmbedBuilder()
                    .setTitle('🗑️ Changes Discarded')
                    .setDescription('Local changes have been discarded. Here was the AI response:')
                    .addFields(
                        { name: 'Original Response', value: commitData?.response?.substring(0, 1000) + (commitData?.response?.length > 1000 ? '...' : '') || 'No response available', inline: false }
                    )
                    .setColor(0xFF6B6B) // Red
                    .setTimestamp();
                    
                await interaction.editReply({ 
                    content: '', 
                    embeds: [discardEmbed], 
                    components: [] 
                });
            }
        }
        
    } catch (error) {
        console.error('Button interaction error:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({ content: 'An error occurred processing your request.', embeds: [], components: [] });
            } else {
                await interaction.reply({ content: 'An error occurred processing your request.', flags: 64 }); // MessageFlags.Ephemeral
            }
        } catch (replyError) {
            console.error('Failed to send button error reply:', replyError);
        }
    }
}


async function handleSearch(interaction) {
    const query = interaction.options.getString('query');

    try {
        await safeEditReply(interaction, getBotResponse('thinking'));

        // Perform web search
        const searchResult = await webSearch(query);

        // If response is longer than 2000 characters, save to file and truncate
        if (searchResult.length > 2000) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `logs/responses/search-${timestamp}.txt`;

            // Create responses directory if it doesn't exist
            await fs.mkdir('logs/responses', { recursive: true });

            // Save full response to file
            const fileContent = `Search Query: ${query}\nTimestamp: ${new Date().toISOString()}\n\n---\n\n${searchResult}`;
            await fs.writeFile(fileName, fileContent);

            // Truncate response and add link
            const truncated = searchResult.substring(0, 1800);
            const replyMessage = `**Search: "${query}"**\n\n${truncated}...\n\n*[Full results saved to \`${fileName}\`]*`;

            await interaction.editReply(replyMessage);
        } else {
            // Response is short enough, send normally
            await interaction.editReply(`**Search: "${query}"**\n\n${searchResult}`);
        }

    } catch (error) {
        console.error('Search command error:', error);
        const errorMsg = getBotResponse('errors') + " Search failed.";
        await interaction.editReply(errorMsg);
    }
}

async function handleSetModel(interaction) {
    const modelChoice = interaction.options.getString('model');
    const customModel = interaction.options.getString('custom_model');

    try {
        const previousModel = MODEL;
        
        // Handle custom model input
        if (modelChoice === 'custom') {
            if (!customModel || customModel.trim() === '') {
                await interaction.editReply('❌ Custom model name is required when selecting "Custom Model"');
                return;
            }
            MODEL = customModel.trim();
        } else {
            MODEL = MODEL_PRESETS[modelChoice];
        }

        const displayName = modelChoice === 'custom'
            ? (customModel || 'Custom Model')
            : getModelDisplayName(modelChoice);

        const embed = new EmbedBuilder()
            .setTitle('🤖 Model Changed')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'New Model', value: displayName, inline: true },
                { name: 'Model ID', value: MODEL, inline: false }
            )
            .setColor(0xe74c3c)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        console.log(`Model changed from ${previousModel} to ${MODEL}`);

    } catch (error) {
        console.error('Set model error:', error);
        const errorMsg = getBotResponse('errors') + " Failed to change model.";
        await interaction.editReply(errorMsg);
    }
}

async function handleStatus(interaction) {
    try {
        // Use GitHub API to get repo status (no git CLI needed)
        const { getRepoStatus } = require('./services/gitHelper');
        const status = await getRepoStatus('main');
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Repository Status')
            .setDescription('Current repository status')
            .addFields(
                { name: 'Branch', value: status.current || 'main', inline: true },
                { name: 'Latest Commit', value: status.lastCommit ? `${status.lastCommit.sha.substring(0, 7)}` : 'N/A', inline: true },
                { name: 'Commit Message', value: status.lastCommit ? status.lastCommit.message.substring(0, 100) : 'N/A', inline: false },
                { name: 'Live Site', value: 'https://bot.inference-arcade.com/', inline: false }
            )
            .setColor(0x3498db);

        // Add repository link
        if (process.env.GITHUB_REPO_OWNER && process.env.GITHUB_REPO_NAME) {
            embed.addFields({
                name: 'Repository',
                value: `https://github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}`,
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Status error:', error);
        await interaction.editReply(getBotResponse('errors') + " Couldn't check status.");
    }
}


async function handlePoll(interaction) {
    const question = interaction.options.getString('question');
    
    try {
        const pollMessage = `**${question}**\n\n👍 Yes  •  👎 No\n\n*React to vote*`;
        
        const reply = await interaction.reply({ 
            content: pollMessage,
            fetchReply: true
        });
        
        // Add reaction options
        await reply.react('👍');
        await reply.react('👎');
        
        // Collect reactions for 60 seconds
        const filter = (reaction, user) => {
            return ['👍', '👎'].includes(reaction.emoji.name) && !user.bot;
        };
        
        const collector = reply.createReactionCollector({
            filter,
            time: CONFIG.POLL_DURATION,
            dispose: true // Clean up removed reactions
        });

        collector.on('error', (error) => {
            console.error('Reaction collector error:', error);
            collector.stop();
        });

        collector.on('end', async (collected) => {
            try {
                // Remove bot's own reactions to clean up
                await reply.reactions.removeAll().catch(() => {});

                const yesCount = collected.get('👍')?.count - 1 || 0;
                const noCount = collected.get('👎')?.count - 1 || 0;
                const total = yesCount + noCount;

                if (total === 0) {
                    await reply.edit(`**${question}**\n\n*No votes received.*`);
                    return;
                }

                const result = yesCount > noCount ? 'Yes wins!' :
                              noCount > yesCount ? 'No wins!' :
                              "It's a tie!";

                const resultMsg = `**${question}**\n\n👍 ${yesCount}  •  👎 ${noCount}\n\n**${result}** *(${total} votes)*`;
                await reply.edit(resultMsg);
            } catch (editError) {
                console.error('Failed to edit poll results:', editError);
            }
        });
        
    } catch (error) {
        console.error('Poll error:', error);
        try {
            if (!interaction.replied) {
                await interaction.reply({ content: getBotResponse('errors') + " Poll failed.", ephemeral: true });
            }
        } catch (replyError) {
            console.error('Failed to send poll error reply:', replyError);
        }
    }
}

// Logs command handler - query PostgreSQL logs
async function handleLogs(interaction) {
    if (!postgres.enabled()) {
        await interaction.editReply('database logging is not configured, man. need DATABASE_URL in environment.');
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
        switch (subcommand) {
            case 'recent': {
                const eventType = interaction.options.getString('type') || 'all';
                const limit = Math.min(interaction.options.getInteger('limit') || 10, 25);

                const events = await postgres.getRecentEvents(eventType, limit);

                if (events.length === 0) {
                    await interaction.editReply(`no ${eventType === 'all' ? '' : eventType + ' '}events found, man.`);
                    return;
                }

                const embed = new EmbedBuilder()
                    .setColor('#00ff41')
                    .setTitle(`Recent ${eventType === 'all' ? 'Events' : eventType.replace('_', ' ')}`)
                    .setDescription(events.map((e) => {
                        const time = new Date(e.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit' });
                        const user = e.username ? `@${e.username}` : '';
                        const preview = e.payload?.content?.slice(0, 50) || e.payload?.tool || e.payload?.message?.slice(0, 50) || '';
                        return `\`${time}\` ${e.event_type} ${user} ${preview}`;
                    }).join('\n').slice(0, 4000))
                    .setFooter({ text: `showing ${events.length} events` })
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }

            case 'errors': {
                const period = interaction.options.getString('period') || '24h';
                const stats = await postgres.getErrorStats(period);

                const periodLabels = { '1h': 'Last Hour', '24h': 'Last 24 Hours', '7d': 'Last 7 Days' };

                const embed = new EmbedBuilder()
                    .setColor(stats.total > 0 ? '#ff0000' : '#00ff41')
                    .setTitle(`Error Summary (${periodLabels[period]})`)
                    .addFields(
                        { name: 'Total Errors', value: `${stats.total}`, inline: true },
                        { name: 'Critical', value: `${stats.critical}`, inline: true },
                        { name: 'Auth', value: `${stats.auth}`, inline: true },
                        { name: 'Network', value: `${stats.network}`, inline: true },
                        { name: 'Git', value: `${stats.git}`, inline: true },
                        { name: 'Discord', value: `${stats.discord}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }

            case 'stats': {
                const days = interaction.options.getInteger('days') || 7;
                const stats = await postgres.getDailyStats(days);

                const embed = new EmbedBuilder()
                    .setColor('#00ffff')
                    .setTitle(`Activity Statistics (${days} days)`)
                    .addFields(
                        { name: 'Total Events', value: `${stats.total}`, inline: true },
                        { name: 'Mentions', value: `${stats.mentions}`, inline: true },
                        { name: 'Tool Calls', value: `${stats.toolCalls}`, inline: true },
                        { name: 'File Changes', value: `${stats.fileChanges}`, inline: true },
                        { name: 'Agent Loops', value: `${stats.agentLoops}`, inline: true },
                        { name: 'Errors', value: `${stats.errors}`, inline: true },
                        { name: 'Unique Users', value: `${stats.uniqueUsers}`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                break;
            }
        }
    } catch (error) {
        console.error('[LOGS] Error:', error);
        await interaction.editReply(getBotResponse('errors') + ' Failed to query logs.');
    }
}

// Deep Research handler - comprehensive research with citations
async function handleDeepResearch(interaction) {
    const query = interaction.options.getString('query');

    try {
        // Initial thinking message
        await safeEditReply(interaction, `${getBotResponse('thinking')} diving deep into "${query.substring(0, 50)}${query.length > 50 ? '...' : ''}"...`);

        // Progress callback for long research
        const onProgress = async (message) => {
            try {
                await interaction.editReply(`${getBotResponse('thinking')} ${message}`);
            } catch (e) {
                // Ignore if interaction expired
            }
        };

        // Execute deep research
        const result = await deepResearch(query, { onProgress });

        // Generate HTML report and push to GitHub
        const { html, slug } = generateReportHTML(result, query);
        const reportPath = `src/search/${slug}.html`;
        const liveUrl = `https://bot.inference-arcade.com/${reportPath}`;

        try {
            await pushFileViaAPI(reportPath, html, `add deep research: ${query.substring(0, 50)}`, 'main');
            console.log(`[DEEP_RESEARCH] Pushed report: ${reportPath}`);
        } catch (pushError) {
            console.error('[DEEP_RESEARCH] Push failed:', pushError.message);
        }

        // Format for Discord
        const { embed } = formatDeepResearchForDiscord(result, query);

        // Add link to full report
        embed.setURL(liveUrl);
        embed.setFooter({ text: `full report → ${liveUrl}` });

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Deep research error:', error);

        let errorMsg = getBotResponse('errors');
        if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            errorMsg += ' Research timed out - try a more specific query.';
        } else if (error.response?.status === 402) {
            errorMsg += ' Insufficient API credits for deep research.';
        }

        await interaction.editReply(errorMsg);
    }
}

// New function to handle mention-triggered commits
async function executeMentionCommit(interaction, commitData) {
    try {
        // Import GitHub API helpers
        const { pushMultipleFiles } = require('./services/gitHelper');
        
        // Update status with progress
        await interaction.editReply({ content: 'Collecting files...', embeds: [], components: [] });
        
        // Collect changed files
        const srcFiles = await fs.readdir('./src').catch(() => []);
        const filesToCommit = [];
        
        for (const file of [...srcFiles.map(f => `src/${f}`), 'index.html', 'projectmetadata.json']) {
            try {
                const content = await fs.readFile(file, 'utf8');
                filesToCommit.push({ path: file, content });
            } catch (e) {
                // File might not exist
            }
        }
        
        // Update progress
        await interaction.editReply('Committing changes via GitHub API...');
        
        // Create commit with AI response as commit message (truncated)
        const commitMessage = `ai changes: ${commitData.originalContent.substring(0, 50)}${commitData.originalContent.length > 50 ? '...' : ''}`;
        const commitSha = await pushMultipleFiles(filesToCommit, commitMessage, 'main');
        
        if (!commitSha) {
            throw new Error('Commit failed - no SHA returned');
        }
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 AI Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** AI-generated changes are now live!')
            .addFields(
                { name: 'Commit Message', value: commitMessage, inline: false },
                { name: 'Commit Hash', value: commitSha.substring(0, 7), inline: true },
                { name: 'Files Changed', value: filesToCommit.length.toString(), inline: true },
                { name: 'Live Site', value: '[View Changes](https://bot.inference-arcade.com/)', inline: false }
            )
            .setColor(0x7dd3a0) // Mint green
            .setTimestamp();
        
        // Add repository link if URL is available
        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Commit](${process.env.GITHUB_REPO_URL}/commit/${commitSha})`,
                inline: false
            });
        }
        
        await safeEditReply(interaction, { content: '', embeds: [embed] });
        
    } catch (error) {
        console.error('Mention commit execution error:', error);
        
        // Provide more specific error messages
        let errorMessage = getBotResponse('errors');
        
        if (error.message.includes('authentication')) {
            errorMessage += ' Authentication issue with GitHub.';
        } else if (error.message.includes('nothing to commit')) {
            errorMessage += ' Nothing to commit.';
        } else if (error.message.includes('remote')) {
            errorMessage += ' Trouble reaching the remote repository.';
        } else {
            errorMessage += ` ${error.message}`;
        }
        
        await interaction.editReply(errorMessage);
    }
}

// File watcher for DEVLOG.md to trigger site inventory updates
if (fsSync.existsSync('docs/DEVLOG.md')) {
    fsSync.watchFile('docs/DEVLOG.md', { interval: 5000 }, async (curr, prev) => {
        if (curr.mtime !== prev.mtime) {
            console.log('[WATCHER] DEVLOG.md modified, updating site inventory...');
            try {
                await generateSiteInventory();
                console.log('[WATCHER] Site inventory updated successfully');
            } catch (error) {
                console.error('[WATCHER] Error updating site inventory:', error);
            }
        }
    });
    console.log('[WATCHER] File watcher started for DEVLOG.md');
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('❌ Failed to connect to Discord:', error.message);
    if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        console.error('⚠️  Network connectivity issue - check your internet connection or VPN settings');
        console.error('   Try: curl https://discord.com in terminal to verify connectivity');
    } else if (error.code === 'TOKEN_INVALID') {
        console.error('⚠️  Invalid Discord token - check DISCORD_TOKEN in .env file');
    }
    process.exit(1);
});
