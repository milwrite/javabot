require('dotenv').config({ override: true });
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

// Game pipeline modules (system-v1)
const { runGamePipeline, commitGameFiles, isGameRequest, isEditRequest } = require('./services/gamePipeline');
const { getRecentPatternsSummary } = require('./services/buildLogs');
const { classifyRequest } = require('./services/requestClassifier');

// Site inventory system
const { generateSiteInventory } = require('./scripts/generateSiteInventory.js');

// Site configuration - Single source of truth
const SITE_CONFIG = require('./site-config.js');

// GUI Server for verbose logging
const BotGUIServer = require('./scripts/gui-server.js');
let guiServer = null;

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
console.log(`🔐 GitHub token: ${githubToken.substring(0, 8)}...`);
console.log(`📂 Repository: ${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}`);

// Initialize GUI server
if (!process.env.NO_GUI) {
    guiServer = new BotGUIServer(process.env.GUI_PORT || 3001);
    guiServer.start().catch(err => {
        console.error('Failed to start GUI server:', err);
        guiServer = null;
    });
}

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
    // Discord Context Settings (replaces agents.md)
    DISCORD_FETCH_LIMIT: 20,      // Max messages to fetch per Discord API request
    DISCORD_CONTEXT_LIMIT: 20,    // Messages to include in LLM context
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

// GUI logging helper functions
function logToGUI(level, message, data = {}) {
    if (guiServer) {
        guiServer.log(level, message, data);
    }
}
// Make logToGUI available globally for other modules
global.logToGUI = logToGUI;

function logToolCall(toolName, args, result, error = null) {
    if (guiServer) {
        guiServer.logToolCall(toolName, args, result, error);
    }
}

function logFileChange(action, path, content = null, oldContent = null) {
    if (guiServer) {
        guiServer.logFileChange(action, path, content, oldContent);
    }
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

function endAgentLoop(result, error = null) {
    if (guiServer) {
        guiServer.endAgentLoop(result, error);
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

const git = simpleGit();

// Discord Context Manager - fetches message history directly from Discord API
// Replaces agents.md file-based memory with real-time Discord awareness
class DiscordContextManager {
    constructor(discordClient) {
        this.client = discordClient;
        this.cache = new Map(); // channelId -> { messages, timestamp }
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
        let formattedContent = `${author.username}: ${content}`;

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


// Helper: build an HTTPS URL with encoded token in userinfo (no permanent storage)
function getEncodedRemoteUrl() {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    
    // Validate token format (should start with ghp_ or github_pat_)
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        console.warn('⚠️ GitHub token format may be invalid - should start with ghp_ or github_pat_');
    }
    
    // Don't encode the token - GitHub tokens don't need URL encoding
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    
    if (!owner || !repo) {
        throw new Error('GITHUB_REPO_OWNER and GITHUB_REPO_NAME must be set');
    }
    
    // Use milwrite as the username with the GitHub token (no encoding needed)
    const url = `https://milwrite:${token}@github.com/${owner}/${repo}.git`;
    
    // Validate URL format without logging the actual token
    if (!url.includes('@github.com') || !url.includes('.git')) {
        throw new Error('Generated remote URL format is invalid');
    }
    
    return url;
}

// Helper: push using an ephemeral URL so we never persist tokens in remotes
async function pushWithAuth(branch = 'main') {
    const url = getEncodedRemoteUrl();
    let lastError = null;
    
    try {
        // Preferred: push directly to URL (no remote mutation)
        console.log('[PUSH] Attempting direct push to authenticated URL...');
        await gitWithTimeout(() => git.push(url, branch), CONFIG.PUSH_TIMEOUT);
        console.log('[PUSH] Direct push successful');
        return;
    } catch (directErr) {
        console.log('[PUSH] Direct push failed:', directErr.message);
        lastError = directErr;
        
        // Fallback 1: use raw git invocation
        try {
            console.log('[PUSH] Attempting raw git push...');
            await gitWithTimeout(() => git.raw(['push', url, branch]), CONFIG.PUSH_TIMEOUT);
            console.log('[PUSH] Raw git push successful');
            return;
        } catch (rawErr) {
            console.log('[PUSH] Raw git push failed:', rawErr.message);
            lastError = rawErr;
            
            // Fallback 2: add a temporary remote, push, then remove
            const tempRemote = `auth-${Date.now()}`;
            try {
                console.log('[PUSH] Attempting temporary remote push...');
                await git.remote(['add', tempRemote, url]);
                await gitWithTimeout(() => git.push(tempRemote, branch), CONFIG.PUSH_TIMEOUT);
                console.log('[PUSH] Temporary remote push successful');
                return;
            } catch (tempErr) {
                console.log('[PUSH] Temporary remote push failed:', tempErr.message);
                lastError = tempErr;
            } finally {
                try { await git.remote(['remove', tempRemote]); } catch (_) {}
            }
        }
    }
    
    // If we get here, all methods failed
    console.error('[PUSH] All push methods failed. Last error:', lastError.message);
    throw new Error(`Push failed: ${lastError.message}`);
}

// Initialize Git remote URL with validation and cleanup
async function initializeGitRemote() {
    try {
        // First ensure we have a clean remote URL
        await git.remote(['set-url', 'origin', 'https://github.com/milwrite/javabot.git']);
        console.log('✅ Git remote URL initialized (clean)');
        
        // Validate token without setting it permanently
        try {
            const testUrl = getEncodedRemoteUrl();
            console.log('✅ GitHub token validation passed');
        } catch (tokenError) {
            console.error('❌ GitHub token validation failed:', tokenError.message);
            console.error('⚠️ Git operations may fail due to authentication issues');
        }
    } catch (error) {
        const errorEntry = errorLogger.log('INIT_REMOTE', error);
        console.warn('⚠️ Git remote URL initialization warning:', error.message);
    }
}

// Git operation wrapper with timeout and authentication protection
async function gitWithTimeout(operation, timeoutMs = CONFIG.GIT_TIMEOUT) {
    return Promise.race([
        operation(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Git operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

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
    // Validate git repository state before operations
    async validateGitState() {
        try {
            const status = await gitWithTimeout(() => git.status(), 5000);
            const isRepo = await git.checkIsRepo();
            
            if (!isRepo) {
                throw new Error('Not a git repository');
            }
            
            return {
                valid: true,
                branch: status.current,
                hasChanges: status.files.length > 0,
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

// OpenRouter configuration
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
let MODEL = 'anthropic/claude-haiku-4.5'; // Default to Haiku 4.5

// Available models (2025 latest)
const MODEL_PRESETS = {
    'haiku': 'anthropic/claude-haiku-4.5',
    'sonnet': 'anthropic/claude-sonnet-4.5',
    'kimi': 'moonshotai/kimi-k2-0905:exacto',
    'kimi-thinking': 'moonshotai/kimi-k2-thinking',  // With interleaved reasoning
    'qwen': 'qwen/qwen3-coder',
    'gemini': 'google/gemini-2.5-pro',
    'glm': 'z-ai/glm-4.6:exacto',
    'minimax': 'minimax/minimax-m2'
};

// Reasoning configuration per model (interleaved thinking support)
// Models that support reasoning will expose thinking during tool-calling workflows
const REASONING_CONFIG = {
    // Claude models - native reasoning support via OpenRouter
    'anthropic/claude-haiku-4.5': { enabled: true, effort: 'low', max_tokens: 1024 },
    'anthropic/claude-sonnet-4.5': { enabled: true, effort: 'low', max_tokens: 1024 },
    // Gemini - supports reasoning
    'google/gemini-2.5-pro': { enabled: true, effort: 'low' },
    // Kimi K2 thinking - mandatory reasoning with <think> tokens
    'moonshotai/kimi-k2-thinking': { enabled: true, effort: 'low', max_tokens: 2048 },
    // Models without reasoning support - graceful skip
    'perplexity/sonar': null,
    'moonshotai/kimi-k2-0905:exacto': null,
    'qwen/qwen3-coder': null,
    'z-ai/glm-4.6:exacto': null,
    'default': null  // Fallback: no reasoning for unknown models
};

// Get reasoning config for a model (returns null if not supported)
function getReasoningConfig(model) {
    return REASONING_CONFIG[model] || REASONING_CONFIG['default'];
}

// Format reasoning for Discord (condensed 80 char summary)
function formatThinkingForDiscord(reasoning) {
    if (!reasoning) return null;
    // Handle various reasoning response formats
    let text = '';
    if (typeof reasoning === 'string') {
        text = reasoning;
    } else if (reasoning.summary) {
        text = reasoning.summary;
    } else if (reasoning.text) {
        text = reasoning.text;
    } else if (Array.isArray(reasoning) && reasoning[0]?.text) {
        text = reasoning[0].text;
    }
    // Truncate to 80 chars for clean Discord display
    const condensed = text.slice(0, 80).replace(/\n/g, ' ').trim();
    return condensed ? `thinking: ${condensed}...` : null;
}

// Format reasoning for GUI (fuller display)
function formatThinkingForGUI(reasoning) {
    if (!reasoning) return null;
    if (typeof reasoning === 'string') return reasoning;
    if (reasoning.text) return reasoning.text;
    if (reasoning.summary) return reasoning.summary;
    if (Array.isArray(reasoning)) {
        return reasoning.map(r => r.text || r.summary || '').filter(Boolean).join('\n');
    }
    return JSON.stringify(reasoning);
}

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
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        return response.data.choices[0].message;
    } catch (error) {
        logEvent('LLM', `Final response error: ${error.message}`);
        // Provide fallback response if we had completed actions
        if (completedActions > 0) {
            return {
                content: `completed the requested actions (${completedActions} operations). check the live site for changes.`
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
    lastSuccessfulModel: 'anthropic/claude-haiku-4.5'
};

// Check API health with quick test request
async function checkAPIHealth() {
    try {
        const testResponse = await axios.post(OPENROUTER_URL, {
            model: 'anthropic/claude-haiku-4.5',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 10,
            temperature: 0.1
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000,
            validateStatus: (status) => status < 500
        });
        
        if (testResponse.status === 200) {
            apiHealthStatus.isHealthy = true;
            apiHealthStatus.consecutiveFailures = 0;
            apiHealthStatus.lastError = null;
            apiHealthStatus.lastSuccessfulModel = 'anthropic/claude-haiku-4.5';
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

// Bot system prompt with enhanced capabilities
// Default system prompt - can be modified at runtime
const DEFAULT_SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with web development projects. You're helpful but a little spacey, like Doc Sportello - generally competent but sometimes distracted, speaking in a relaxed, slightly rambling way.

REPOSITORY CONTEXT:
Repository: https://github.com/milwrite/javabot/
Live Site: https://bot.inference-arcade.com/
- You can commit, push, and manage files
- /src directory contains web pages and JS libraries
- You help create, edit, and deploy web projects via Discord commands

SITE INVENTORY (CRITICAL - Updated automatically):
- The file SITE_INVENTORY.md contains current diagrams of all webpages and JavaScript files
- This inventory includes file structures, collections, links, and metadata
- When searching for games/pages, refer to this inventory for accurate current content
- Inventory automatically updates when DEVLOG.md changes
- Use search_files("content", "SITE_INVENTORY.md") to see current site structure when needed

URL STRUCTURE (CRITICAL):
- Main page: https://bot.inference-arcade.com/
- Pages in src/: https://bot.inference-arcade.com/src/PAGENAME.html
- ALWAYS include /src/ in URLs for pages in the src directory!
- Example: frogger.html → https://bot.inference-arcade.com/src/frogger.html
- WRONG: https://bot.inference-arcade.com/frogger.html (missing /src/)

NOIR TERMINAL DESIGN SYSTEM:

MOBILE-FIRST DESIGN (Discord is mobile-forward):
- ALWAYS design for mobile first - most users view on phones
- Touch targets minimum 44px height/width for accessibility
- All games MUST include mobile touch controls (arrows, buttons)
- Test on small screens (320px-480px width)
- Avoid hover-only interactions - provide tap alternatives
- Font sizes must be readable on mobile (min 14px body text)

Color Palette (Noir Terminal):
- Primary green: #7ec8e3 (sky blue) - main accent
- Accent red: #ff0000 - buttons, highlights, warnings
- Accent cyan: #00ffff - secondary text, headings
- Background: #0a0a0a (near-black)
- Card backgrounds: rgba(26, 0, 0, 0.4)
- Font: 'Courier Prime' monospace (terminal aesthetic)
- CRT scanlines and flicker effects included
- Starry sky background: add <script src="../stars.js"></script> to enable twinkling stars on any page

Available CSS Classes (page-theme.css):

LAYOUT: .container, .content, .main-content, .header, .footer, .sidebar, .section, .card, .panel

TYPOGRAPHY: h1, h2, h3, p, .subtitle, .message, .date-display (all styled for terminal look)

BUTTONS: .btn, .btn-primary (red bg), .btn-secondary, .btn-yes (green), .btn-no (red), .btn-reset (cyan), .filter-btn, .difficulty-btn, .control-btn, .mobile-btn, .number-btn

FORMS: input, textarea, select, .input-group, .form-group, .slider-group, .slider-value

LISTS: .todos-list, .task-list, .todo-item, .task-item, .task-content, .timeline-item

STATS: .stats, .stats-grid, .stat-box, .stat-number, .stat-value, .stat-label, .progress-bar, .progress-fill

BADGES: .priority-badge, .priority-low/medium/high, .category-badge, .time-badge

MODALS: .modal, .modal-content, .modal-header, .close-btn, .notification, .game-over-modal

GAMES: .game-wrapper, .game-container, .sudoku-grid, .cell, .number-pad, .mobile-controls (REQUIRED for games), canvas

MOBILE CONTROLS (REQUIRED FOR ALL GAMES):
- Position controls DIRECTLY below canvas (before other content)
- Display: none on desktop, display: grid on mobile (@media max-width: 768px)
- CSS: touch-action: manipulation; -webkit-tap-highlight-color: transparent;
- Size: min-height 50px, min-width 50px, font-size 20px for arrows
- JS: Use touchstart with preventDefault + {passive: false}, click as fallback
- Example: btn.addEventListener('touchstart', (e) => { e.preventDefault(); handler(); }, {passive: false});

RESPONSIVE BREAKPOINTS (MANDATORY):
@media (max-width: 768px) - Tablet/mobile landscape
@media (max-width: 480px) - Mobile portrait
@media (max-width: 360px) - Small mobile

WHEN CREATING PAGES:
1. Link to ../page-theme.css (REQUIRED)
2. Add viewport meta tag: <meta name="viewport" content="width=device-width, initial-scale=1.0">
3. Add .home-link navigation (styled by page-theme.css)
4. Body: padding-top 80px for home button, overflow-x/y: auto
5. For GAMES: Always include .mobile-controls with touch buttons
6. Canvas games: max-width 100%, height auto
7. Keep noir terminal colors (#7ec8e3, #ff0000, #00ffff, #0a0a0a)
8. Test scrollability on mobile - no overflow: hidden on body

PROJECT METADATA SYSTEM:
- projectmetadata.json has { collections: {}, projects: {} }
- Collections: featured, arcade-games, utilities-apps, stories-content, unsorted (fallback)
- index.html auto-loads this file to render each collection, so keep metadata accurate
- Every project entry needs: title, emoji icon, 3-6 word caption, collection ID, optional hidden flag
- Captions follow "[adjective] [noun] [type]" style, no long prompts or verb starts

AFTER CREATING A PAGE - EXPLAIN WHAT YOU BUILT:
When you finish creating a page, briefly tell the user what you made:
1. Summarize the key feature (1 sentence): "Built you a frogger game with mobile touch controls"
2. Mention any creative additions: "Added CRT scanlines and a high score tracker"
3. Note the live URL so they can check it out
4. ALWAYS remind users: "Give it a minute or two to go live"
Keep it casual and brief - don't list every HTML element or CSS class used.

URL FORMATTING (CRITICAL - FOLLOW EXACTLY):
- NEVER put em dash (—) or any punctuation directly after a URL - it breaks the link!
- BAD: "Check it out at https://example.com—cool right?" (BROKEN - em dash touching URL)
- GOOD: "Check it out at https://example.com - cool right?" (space before dash)
- GOOD: "Check it out: https://example.com" (URL on its own)
- Always put a SPACE after URLs before any punctuation
- Use plain hyphens (-) not em dashes (—) in page names

AVAILABLE CAPABILITIES (Enhanced Multi-File Support):
- list_files(path|[paths]): List files in directory or multiple directories
- search_files(pattern, path|[paths], options): Search text patterns across single file, multiple files, or directories (supports regex, case-insensitive)
- read_file(path|[paths]): Read single file or multiple files (respects file size limits)
- write_file(path, content): Create/update files completely
- edit_file(path, instructions): Edit files with natural language instructions
- commit_changes(message, files): Git add, commit, push to main branch
- get_repo_status(): Check current git status and branch info
- git_log(count, file, oneline): View commit history (default 10 commits, optional file filter)
- web_search(query): Search internet for current information via Perplexity
- set_model(model): Switch AI model runtime (haiku, sonnet, kimi, gemini, glm, qwen, minimax) - ZDR-compliant only

DISCORD INTEGRATION FEATURES:
- Slash Commands (5 available):
  * /commit <message> [files] - Git commit & push to main
  * /status - Show repo status + live site link
  * /search <query> - Web search via Perplexity API
  * /set-model <model> - Switch AI model (haiku/sonnet/kimi/gemini/glm/qwen/minimax) ZDR only
  * /poll <question> - Yes/no poll with reactions
- @ Mention Support: Full AI conversation with tool access (all capabilities available)
- Multi-Channel Monitoring: Responds in 7 configured channels, fetches context from Discord API
- Auto Error Handling: 3-error cooldown system prevents spam loops (5min timeout)
- Response Management: Long responses (>2000 chars) auto-saved to responses/ with Discord links
- Real-Time Updates: Progress tracking via editReply() for long operations
- Embed Styling: Color-coded embeds (purple=pages, orange=features, red=model, green=success)
- Message History: Fetches last 20 messages from Discord API with reactions

WHEN TO USE EACH TOOL:
- For multi-file operations: Use array syntax - search_files("pattern", ["file1.html", "file2.js"])
- To find content across files: ALWAYS use search_files FIRST before reading files
  * Examples: "list clues", "find answers", "show all X", "what are the Y"
  * Search for keywords like "clue", "answer", "const", function names, etc.
  * Use SITE_INVENTORY.md for current site structure: search_files("content", "SITE_INVENTORY.md")
  * Multi-file search: search_files("pattern", ["src/file1.html", "src/file2.html"])
- To recall past work/history: Use git_log() - this is your MEMORY of what you've built
  * When asked "what did you make?", "show me history", "what have you done?", "recent changes" → git_log()
  * To see changes to a specific file: git_log(10, "src/filename.html")
  * Your commit messages describe what you built - use them to remember past work
  * Don't guess filenames - search to find the right file
- For quick file edits: use edit_file with natural language instructions
- To deploy changes: use commit_changes (auto-pushes and deploys)
- To switch AI behavior: use set_model (affects all subsequent responses)
- For current events/news: use web_search (gets latest information)
- For batch operations: Use arrays - read_file(["file1", "file2"]), list_files(["dir1", "dir2"])

CRITICAL SEARCH RULES:
- User asks "list X" or "show X" or "what are X" → use search_files to find X across multiple files if needed
- User mentions game name + wants info → search_files with game keywords + check SITE_INVENTORY.md
- For site overview questions → search SITE_INVENTORY.md first for current structure
- Don't read random files hoping to find content - search strategically across relevant files
- Use multi-file search when looking for patterns across similar files

WHEN TO USE WEB SEARCH:
- Anything that changes: sports, news, prices, weather, standings, odds
- Questions with "latest", "current", "today", "now"
- When you don't have up-to-date info, just search

Personality: Casual, chill, slightly unfocused but helpful. SHORT responses (1-2 sentences). Use "yeah man", "right on". Call people "man", "dude".

RESPONSE FORMATTING (CRITICAL):
When listing information (clues, answers, items, data):
- Use markdown headers (## ACROSS, ## DOWN, etc.)
- Add blank lines between sections for readability
- Use bold (**text**) for labels and important terms
- Format lists with proper spacing:
  **Item 1:** Description

  **Item 2:** Description

- Use code blocks for code snippets with blank lines before/after
- Structure long responses with clear sections separated by blank lines

IMPORTANT: Do not prefix your responses with "Bot Sportello:" - just respond naturally as Bot Sportello. Always mention the live site URL (https://bot.inference-arcade.com/) before making changes to give users context.

Be concise and helpful. Context fetched directly from Discord channel history.`;

// Mutable system prompt - can be changed at runtime
let SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

const botResponses = {
    confirmations: [
        "yeah man, i got you...",
        "right on, let me handle that...",
        "cool cool, working on it...",
        "alright dude, give me a sec...",
    ],

    errors: [
        "oh... yeah something went sideways there",
        "hmm that's weird man, let me check what happened",
        "ah yeah... that didn't work out, my bad",
        "well that's not right... give me a minute",
    ],

    success: [
        "nice, that worked out pretty smooth",
        "right on, all done man",
        "yeah there we go, all set",
        "cool, got it all sorted for you",
    ],

    thinking: [
        "let me think about this for a sec...",
        "hmm yeah give me a moment...",
        "hold on, processing this...",
        "just a sec man, checking that out...",
    ]
};

function getBotResponse(category) {
    const responses = botResponses[category];
    return responses[Math.floor(Math.random() * responses.length)];
}

// Clean and format bot responses for better markdown rendering
function cleanBotResponse(response) {
    if (!response) return '';

    // Remove "Bot Sportello:" prefix patterns
    let cleaned = response.replace(/^Bot Sportello:\s*/i, '').replace(/Bot Sportello:\s*Bot Sportello:\s*/gi, '');

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

function cleanMarkdownCodeBlocks(content, type = 'html') {
    const patterns = {
        html: /```html\n?/g,
        javascript: /```javascript\n?/g,
        js: /```js\n?/g,
        css: /```css\n?/g
    };

    return content
        .replace(patterns[type] || /```\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
}

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
    if (channel && contextManager) {
        try {
            const discordContext = await contextManager.buildContextFromChannel(channel, maxMessages);
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
        return files.join(', ');
    } catch (error) {
        return `Error listing files: ${error.message}`;
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

        const content = await fs.readFile(filePath, 'utf8');
        const truncatedContent = content.substring(0, CONFIG.FILE_READ_LIMIT);

        // Log file read to GUI dashboard
        logFileChange('read', filePath, truncatedContent);

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

        // Write the file
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`[WRITE_FILE] Written: ${filePath} (${content.length} bytes)`);

        // Log file creation to GUI dashboard
        logFileChange('create', filePath, content);

        // Auto-commit and push so file is live before link is shared
        console.log(`[WRITE_FILE] Auto-pushing to remote...`);
        const fileName = path.basename(filePath);
        const commitMessage = `add ${fileName}`;

        await gitWithTimeout(() => git.add(filePath));
        await gitWithTimeout(() => git.commit(commitMessage));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        try {
            await pushWithAuth(currentBranch);
        } catch (pushError) {
            const error = errorLogger.log('WRITE_FILE_PUSH', pushError, { filePath, branch: currentBranch });
            
            // Surface push error
            throw pushError;
        }

        console.log(`[WRITE_FILE] Auto-pushed: ${commitMessage}`);
        return `File written and pushed: ${filePath} (${content.length} bytes) - now live at https://bot.inference-arcade.com/${filePath}`;
    } catch (error) {
        console.error(`[WRITE_FILE] Error:`, error.message);
        return `Error writing file: ${error.message}`;
    }
}

async function editFile(filePath, oldString = null, newString = null, instructions = null) {
    const startTime = Date.now();
    console.log(`[EDIT_FILE] Starting edit for: ${filePath}`);

    try {
        // Read the current file content
        const currentContent = await fs.readFile(filePath, 'utf-8');
        const fileSize = (currentContent.length / 1024).toFixed(1);
        console.log(`[EDIT_FILE] File size: ${fileSize}KB`);

        let updatedContent;
        let changeDescription;

        // Mode 1: Exact string replacement (FAST - preferred method)
        if (oldString !== null && newString !== null) {
            console.log(`[EDIT_FILE] Using exact string replacement mode`);

            // Count occurrences of old_string
            const occurrences = currentContent.split(oldString).length - 1;

            if (occurrences === 0) {
                throw new Error(`String not found in file. The exact string to replace was not found. Make sure to use the EXACT string from the file, including all whitespace and indentation.`);
            }

            if (occurrences > 1) {
                throw new Error(`String appears ${occurrences} times in file. The old_string must be unique. Provide more context (surrounding lines) to make it unique, or use replace_all mode.`);
            }

            // Perform the replacement
            updatedContent = currentContent.replace(oldString, newString);
            changeDescription = `Replaced exact string (${oldString.length} → ${newString.length} chars)`;

            const replacementTime = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[EDIT_FILE] Exact replacement completed in ${replacementTime}s`);

        // Mode 2: AI-based editing (SLOW - fallback for complex changes)
        } else if (instructions !== null) {
            console.log(`[EDIT_FILE] Using AI-based editing mode (slow fallback)`);

            // Use Haiku for edits - much faster than other models
            const editModel = MODEL_PRESETS['haiku'];
            console.log(`[EDIT_FILE] Using ${editModel} for AI processing`);

            // Use AI to make the edit based on instructions
            const editPrompt = `You are editing a file: ${filePath}

Current file content:
\`\`\`
${currentContent}
\`\`\`

User instructions: ${instructions}

Return ONLY the complete updated file content. No explanations, no markdown code blocks, just the raw file content.`;

            console.log(`[EDIT_FILE] Sending to AI for processing...`);
            const response = await axios.post(OPENROUTER_URL, {
                model: editModel,
                messages: [{ role: 'user', content: editPrompt }],
                max_tokens: 16000,
                temperature: CONFIG.AI_TEMPERATURE,
                provider: { data_collection: 'deny' } // ZDR enforcement
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 90000
            });

            const aiTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[EDIT_FILE] AI processing completed in ${aiTime}s`);

            updatedContent = response.data.choices[0].message.content;

            // Clean markdown code blocks if present
            const extension = path.extname(filePath).substring(1);
            updatedContent = cleanMarkdownCodeBlocks(updatedContent, extension);

            changeDescription = `AI edit: ${instructions}`;
        } else {
            throw new Error('Must provide either (old_string + new_string) OR instructions');
        }

        // Write the updated content
        await fs.writeFile(filePath, updatedContent, 'utf8');

        // Log file edit to GUI dashboard
        logFileChange('edit', filePath, updatedContent, currentContent);

        // Auto-commit and push so changes are live before link is shared
        console.log(`[EDIT_FILE] Auto-pushing to remote...`);
        const fileName = path.basename(filePath);
        const commitMessage = `update ${fileName}`;

        await gitWithTimeout(() => git.add(filePath));
        await gitWithTimeout(() => git.commit(commitMessage));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        await pushWithAuth(currentBranch);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[EDIT_FILE] Success + pushed: ${filePath} (${totalTime}s total)`);
        return `File edited and pushed: ${filePath}. ${changeDescription} - now live`;
    } catch (error) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[EDIT_FILE] Error after ${totalTime}s:`, error.message);
        return `Error editing file: ${error.message}`;
    }
}

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
        // Validate environment before starting
        const envValidation = pipelineValidator.validateEnvironment();
        if (!envValidation.valid) {
            throw new Error(`Environment validation failed: ${envValidation.missing.join(', ')} missing`);
        }
        
        // Validate git state
        const gitValidation = await pipelineValidator.validateGitState();
        if (!gitValidation.valid) {
            throw new Error(`Git validation failed: ${gitValidation.error}`);
        }
        
        // Enhanced status check with timeout protection
        const status = gitValidation.status || await gitWithTimeout(() => git.status(), 10000);

        console.log(`[COMMIT] Status:`, {
            branch: status.current,
            filesChanged: status.files.length,
            files: status.files.map(f => f.path).slice(0, 5) // Log first 5 files
        });

        if (status.files.length === 0) {
            console.log('[COMMIT] No changes to commit');
            return 'Nothing to commit';
        }

        // Stage files with enhanced error handling
        console.log('[COMMIT] Staging files...');
        try {
            if (files === '.') {
                await gitWithTimeout(() => git.add('.'), 15000);
            } else {
                const fileList = files.split(',').map(f => f.trim());
                await gitWithTimeout(() => git.add(fileList), 15000);
            }
        } catch (stageError) {
            const error = errorLogger.log('COMMIT_STAGE', stageError, metadata);
            throw new Error(`Staging failed: ${stageError.message}`);
        }

        // Validate files before committing if specific files were requested
        if (files !== '.') {
            const fileList = files.split(',').map(f => f.trim());
            const fileValidation = await pipelineValidator.validateFileOperations(fileList);
            if (!fileValidation.valid) {
                console.warn('⚠️ File validation issues:', fileValidation.issues);
                // Continue with commit but log the issues
                metadata.fileIssues = fileValidation.issues;
            }
        }
        
        // Create commit with protection against empty commits
        console.log('[COMMIT] Creating commit...');
        let commit;
        try {
            // Verify we still have staged changes
            const stagedStatus = await gitWithTimeout(() => git.status(), 5000);
            if (stagedStatus.staged.length === 0) {
                throw new Error('No staged changes found after add operation');
            }
            commit = await gitWithTimeout(() => git.commit(message), 15000);
        } catch (commitError) {
            const error = errorLogger.log('COMMIT_CREATE', commitError, metadata);
            throw new Error(`Commit failed: ${commitError.message}`);
        }

        console.log('[COMMIT] Pushing to remote...');
        const currentBranch = status.current || 'main';
        metadata.branch = currentBranch;

        // Push with ephemeral URL and error handling
        try {
            await pushWithAuth(currentBranch);
        } catch (pushError) {
            const error = errorLogger.log('COMMIT_PUSH', pushError, metadata);
            
            throw new Error(`Push failed: ${pushError.message}`);
        }

        console.log(`[COMMIT] Success: ${commit.commit.substring(0, 7)}`);
        return `Committed and pushed: ${commit.commit.substring(0, 7)} - ${message}`;
        
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
        const status = await git.status();
        let result = `Branch: ${status.current}\n`;
        result += `Modified: ${status.modified.length}, New: ${status.not_added.length}\n`;
        result += `Live site: https://bot.inference-arcade.com/\n`;
        if (status.files.length > 0) {
            result += `Changed files: ${status.files.slice(0, 5).map(f => f.path).join(', ')}`;
        }
        return result;
    } catch (error) {
        return `Error getting status: ${error.message}`;
    }
}

// Git log - view commit history
async function getGitLog(count = 10, file = null, oneline = false) {
    try {
        const maxCount = Math.min(count || 10, 50);
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        let cmd = `git log -${maxCount}`;
        if (oneline) {
            cmd += ' --oneline';
        } else {
            cmd += ' --format="%h | %an | %ar | %s"';
        }
        if (file) {
            cmd += ` -- "${file}"`;
        }

        const { stdout } = await execAsync(cmd, { cwd: __dirname });
        return stdout.trim() || 'No commits found.';
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
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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

// Lightweight edit-only LLM response (streamlined for file edits)
async function getEditResponse(userMessage, conversationMessages = []) {
    try {
        const messages = [
            {
                role: 'system',
                content: `${SYSTEM_PROMPT}\n\nYou are in EDIT MODE. Focus on making the requested edits quickly and efficiently. 

IMPORTANT URL-TO-FILE MAPPING:
- URLs like "https://bot.inference-arcade.com/src/filename.html" map to file path "src/filename.html"
- Remove the base URL and use the path directly: src/tarot-reading.html, src/frogger.html, etc.

EDIT WORKFLOW:
1. If user mentions a URL, extract the filename and look in src/ directory
2. ALWAYS use read_file to examine the current content first
3. ALWAYS use edit_file to make the specific changes requested
4. Respond with confirmation of what was changed

CRITICAL: You MUST use the available tools (read_file, edit_file, search_files). Do not just provide explanations - take action by calling the appropriate tools.

Do not use web search or create new content - only edit existing files.`
            },
            ...conversationMessages,
            {
                role: 'user',
                content: userMessage
            }
        ];

        // Limited toolset for edits only
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'search_files',
                    description: 'Search for text patterns across files to find what needs editing',
                    parameters: {
                        type: 'object',
                        properties: {
                            pattern: { type: 'string', description: 'Text or regex pattern to search for' },
                            path: { 
                                oneOf: [
                                    { type: 'string', description: 'Directory or file to search in (default: ./src)' },
                                    { type: 'array', items: { type: 'string' }, description: 'Array of files/directories to search' }
                                ]
                            },
                            case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' }
                        },
                        required: ['pattern']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'read_file',
                    description: 'Read contents of a file to understand what needs editing',
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
                    name: 'edit_file',
                    description: 'Edit an existing file using EXACT string replacement. Always use exact mode for speed.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit' },
                            old_string: { type: 'string', description: 'EXACT string to replace (must be unique in file)' },
                            new_string: { type: 'string', description: 'New string to replace old_string with' }
                        },
                        required: ['path']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'list_files',
                    description: 'List files to find the right file to edit',
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
            }
        ];

        const MAX_ITERATIONS = 3; // Prevent infinite loops
        let iteration = 0;
        let lastResponse;
        let editCompleted = false;

        while (iteration < MAX_ITERATIONS && !editCompleted) {
            iteration++;

            const response = await axios.post(OPENROUTER_URL, {
                model: MODEL,
                messages: messages,
                max_tokens: 10000,
                temperature: 0.7,
                tools: tools,
                tool_choice: 'auto'
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 45000
            });

            lastResponse = response.data.choices[0].message;

            if (!lastResponse.tool_calls || lastResponse.tool_calls.length === 0) {
                break;
            }

            logEvent('EDIT_LOOP', `Iteration ${iteration}: ${lastResponse.tool_calls.length} tools`);

            const toolResults = [];
            for (const toolCall of lastResponse.tool_calls) {
                const functionName = toolCall.function.name;
                let args;
                try {
                    args = JSON.parse(toolCall.function.arguments || '{}');
                } catch (parseError) {
                    toolResults.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: `Error: Invalid JSON in tool arguments`
                    });
                    continue;
                }

                let result;
                if (functionName === 'search_files') {
                    result = await searchFiles(args.pattern, args.path || './src', {
                        caseInsensitive: args.case_insensitive || false
                    });
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'edit_file') {
                    result = await editFile(args.path, args.old_string, args.new_string, args.instructions);
                    if (!result.startsWith('Error')) {
                        editCompleted = true;
                        logEvent('EDIT_LOOP', 'Edit completed successfully');
                    }
                } else if (functionName === 'list_files') {
                    result = await listFiles(args.path || './src');
                }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result
                });
            }

            messages.push(lastResponse);
            messages.push(...toolResults);

            // After edit completes, get final response
            if (editCompleted) {
                const result = await getFinalTextResponse(messages, tools, { maxTokens: 5000 });
                if (result) lastResponse = result;
                break;
            }
        }

        if (iteration >= MAX_ITERATIONS && !editCompleted) {
            logEvent('EDIT_LOOP', 'Max iterations reached without edit - this may not be an edit request');

            // Check if this looks like a non-edit request that got misrouted
            const isLikelyNotEdit = /\b(create|generate|make|build|produce|write)\s+(?!.*\b(edit|fix|change|update)\b)/i.test(userMessage);

            if (isLikelyNotEdit) {
                logEvent('EDIT_LOOP', 'Detected likely non-edit request - suggesting normal flow');
                return {
                    text: "hmm, this seems like it might be better suited for the full conversation flow rather than file editing. let me handle this differently...",
                    suggestNormalFlow: true
                };
            }

            // Force a final response for legitimate edit attempts
            const result = await getFinalTextResponse(messages, tools, { maxTokens: 5000 });
            if (result) lastResponse = result;
        }

        const content = lastResponse?.content || 'edit processed';
        return {
            text: content,
            searchContext: null
        };

    } catch (error) {
        console.error('Edit LLM Error:', error.response?.data || error.message);
        return { text: getBotResponse('errors'), searchContext: null };
    }
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
            {
                role: 'user',
                content: userMessage
            }
        ];

        // Define available tools for the model
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'list_files',
                    description: 'List files in a directory in the repository',
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
                    description: 'Edit an existing file using EXACT string replacement (preferred) or natural language instructions (fallback). ALWAYS prefer exact replacement for speed and accuracy. Use exact mode when you know the exact text to replace. Use instructions mode only for complex multi-location edits.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit (e.g., "src/example.html", "index.html", "style.css")' },
                            old_string: { type: 'string', description: 'EXACT string to replace (including all whitespace, indentation, newlines). Must be unique in the file. If not unique, provide more surrounding context to make it unique. PREFERRED METHOD - use this whenever possible for fast, deterministic edits.' },
                            new_string: { type: 'string', description: 'New string to replace old_string with. Use with old_string parameter.' },
                            instructions: { type: 'string', description: 'FALLBACK: Natural language instructions for complex edits (e.g., "change all background colors to blue"). Only use when exact replacement is not feasible. This mode is SLOW (requires AI processing).' }
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
                    description: 'Get current git repository status',
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
                    description: 'Get git commit history. Shows recent commits with hash, author, date, and message.',
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
                    name: 'set_model',
                    description: 'Switch the AI model used for responses. ZDR-compliant models: haiku (fast), sonnet (balanced), kimi, kimi-thinking (with reasoning), gemini, glm, qwen',
                    parameters: {
                        type: 'object',
                        properties: {
                            model: {
                                type: 'string',
                                description: 'Model preset name. Use kimi-thinking for interleaved reasoning support.',
                                enum: ['haiku', 'sonnet', 'kimi', 'kimi-thinking', 'gemini', 'glm', 'qwen']
                            }
                        },
                        required: ['model']
                    }
                }
            }
        ];

        // Agentic loop - allow multiple rounds of tool calling
        const MAX_ITERATIONS = 6; // Reasonable limit to prevent infinite loops
        let iteration = 0;
        let lastResponse;
        const editedFiles = new Set(); // Track files already edited to prevent redundant edits
        const searchResults = []; // Track web search results for context persistence
        let completedActions = 0; // Count primary actions (edits, creates, commits)

        while (iteration < MAX_ITERATIONS) {
            iteration++;

            let response;
            let retryCount = 0;
            const maxRetries = 3;
            let currentModel = MODEL;
            
            // Check API health and use fallback model if API has been failing
            if (apiHealthStatus.consecutiveFailures >= 2 && currentModel !== apiHealthStatus.lastSuccessfulModel) {
                currentModel = apiHealthStatus.lastSuccessfulModel || 'anthropic/claude-haiku-4.5';
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
                            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
                        // 402 payment required - reduce tokens and retry
                        if (response.status === 402) {
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
                        
                        // On second retry, try fallback model
                        if (retryCount === 2 && currentModel !== 'anthropic/claude-haiku-4.5') {
                            currentModel = 'anthropic/claude-haiku-4.5';
                            logEvent('LLM', 'Switching to Haiku model for retry');
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
                if (functionName === 'list_files') {
                    result = await listFiles(args.path || './src');
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
                    }
                } else if (functionName === 'edit_file') {
                    // Prevent editing the same file multiple times
                    if (editedFiles.has(args.path)) {
                        result = `File ${args.path} was already edited in this conversation. Skipping redundant edit to save time.`;
                        logEvent('LLM', `Skipped redundant edit of ${args.path}`);
                    } else {
                        // Support both exact replacement (preferred) and AI-based instructions (fallback)
                        result = await editFile(args.path, args.old_string, args.new_string, args.instructions);
                        editedFiles.add(args.path);
                        if (!result.startsWith('Error')) {
                            completedActions++;
                            actionCompletedThisIteration = true;
                            logEvent('LLM', `Primary action: edit_file pushed (${completedActions} total)`);
                        }
                    }
                } else if (functionName === 'commit_changes') {
                    result = await commitChanges(args.message, args.files);
                    if (!result.startsWith('Error')) {
                        completedActions++;
                        actionCompletedThisIteration = true;
                        logEvent('LLM', `Primary action: commit_changes (${completedActions} total)`);
                    }
                } else if (functionName === 'get_repo_status') {
                    result = await getRepoStatus();
                } else if (functionName === 'git_log') {
                    result = await getGitLog(args.count, args.file, args.oneline);
                } else if (functionName === 'web_search') {
                    result = await webSearch(args.query);
                    // Store search results for context persistence
                    searchResults.push({ query: args.query, results: result });
                } else if (functionName === 'set_model') {
                    result = await setModel(args.model);
                }

                // Log tool call to GUI dashboard
                logToolCall(functionName, args, result);

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

            // Fallback based on what actions were completed
            const fallbackText = completedActions > 0
                ? `done - completed ${completedActions} action${completedActions > 1 ? 's' : ''}`
                : 'processed your request';

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
                    { name: 'Claude Haiku 4.5 (Fast, Cheap)', value: 'haiku' },
                    { name: 'Claude Sonnet 4.5 (Balanced)', value: 'sonnet' },
                    { name: 'Kimi K2 Exacto (Moonshot AI)', value: 'kimi' },
                    { name: 'Qwen 3 Coder (Alibaba)', value: 'qwen' },
                    { name: 'Gemini 2.5 Pro (Google)', value: 'gemini' },
                    { name: 'GLM-4.6 Exacto (Z-AI)', value: 'glm' },
                    { name: 'Minimax M2 (MiniMax)', value: 'minimax' },
                    { name: 'Custom Model (enter name)', value: 'custom' }
                ))
        .addStringOption(option =>
            option.setName('custom_model')
                .setDescription('Custom model name (e.g. anthropic/claude-3-5-sonnet-20241022)')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Quick yes/no poll with thumbs up/down')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Question to ask')
                .setRequired(true)),

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
                return;
            }
        }

        // Fall back to global registration
        console.log('Attempting global command registration...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: validCommands }
        );
        console.log('✅ Slash commands registered globally successfully.');
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

    // Initialize Git remote URL with current token
    await initializeGitRemote();

    // Initialize Discord context manager (replaces agents.md)
    contextManager = new DiscordContextManager(client);
    console.log('✅ Discord context manager initialized');

    // Fetch initial message history for configured channels
    if (CHANNEL_IDS.length > 0) {
        console.log('📜 Fetching initial message history from Discord...');
        for (const channelId of CHANNEL_IDS) {
            try {
                const channel = await client.channels.fetch(channelId);
                if (channel) {
                    await contextManager.fetchChannelHistory(channel, CONFIG.DISCORD_FETCH_LIMIT);
                    console.log(`✅ Fetched history for #${channel.name || channelId}`);
                }
            } catch (error) {
                console.warn(`⚠️ Could not fetch history for ${channelId}:`, error.message);
            }
        }
    }


    // Sync index.html with all HTML files in /src
    try {
        await syncIndexWithSrcFiles();
    } catch (error) {
        console.error('Error syncing index.html on startup:', error);
    }
});

// Note: Message handling disabled until Message Content Intent is properly configured
// Uncomment this section once the intent is working

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
                        logEvent('MENTION', `READ_ONLY request - routing to normal LLM response`);
                        await safeEditReply(thinkingMsg, '📖 processing your information request...');
                        // Break out to proceed with normal LLM response
                        processingAttempt = maxProcessingAttempts + 1; // Exit the classification loop
                        break;
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
                                // Get git status to find modified files
                                const status = await git.status();
                                if (status.files.length > 0) {
                                    const recentFile = status.files[0].path;
                                    commitMessage = `commit ${recentFile}`;
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

                try {
                    await pushWithAuth('main');
                    console.log('[MENTION_PIPELINE] Push successful');
                } catch (pushError) {
                    const error = errorLogger.log('MENTION_PIPELINE_PUSH', pushError);
                    errorLogger.track(error);
                    console.error('🚨 Mention pipeline deployment failed:', pushError.message);
                    
                    // Report error to user instead of silently failing
                    await safeEditReply(thinkingMsg, `⚠️ Content built successfully but deployment failed: ${pushError.message}. Files are saved locally but not published. Check GitHub token permissions.`);
                    return; // Exit early to prevent success message
                }
            }

                    // Success message
                    const scoreEmoji = result.testResult.score >= 80 ? '✨' : result.testResult.score >= 60 ? '✓' : '⚠️';
                    const successMsg = `${scoreEmoji} **${result.plan.metadata.title}** built and deployed!\n\n${result.docs.releaseNotes}\n\n🎮 **Play now:** ${result.liveUrl}\n\n📊 Quality: ${result.testResult.score}/100 | ⏱️ Build time: ${result.duration}\n\n*Give it a minute or two to go live*`;

                    await safeEditReply(thinkingMsg, successMsg);

                    // Add to history
                    addToHistory(username, content, false);
                    addToHistory('Bot Sportello', successMsg, true);

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

                            // Tools executed but AI didn't provide text - generate completion message
                            const toolsExecuted = results.length > 0 ? results.map(r => r.tool_call_id || 'tool').join(', ') : 'edits';
                            const fallbackMsg = `✓ done - made the requested changes`;
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
                    channel: message.channel.name || message.channel.id
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
                    // Retry with Haiku model and reduced context
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (trying faster model...)`);
                    const originalModel = MODEL;
                    MODEL = MODEL_PRESETS.haiku; // Switch to Haiku for reliability
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
                    // Final attempt: Haiku with absolute minimal constraints and no tools
                    await safeEditReply(thinkingMsg, `${getBotResponse('thinking')} (final simplified attempt...)`);
                    const originalModel = MODEL;
                    MODEL = MODEL_PRESETS.haiku;
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
                                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
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
        
        // First, check if there's anything to commit
        const status = await gitWithTimeout(() => git.status());
        
        if (status.files.length === 0) {
            await interaction.editReply("Nothing to commit.");
            return;
        }

        // Show confirmation dialog with file details
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Commit & Push')
            .setDescription(`Ready to commit and push **${status.files.length} file(s)** to the live repository?`)
            .addFields(
                { name: 'Commit Message', value: message, inline: false },
                { name: 'Files to Commit', value: files === '.' ? 'All changed files' : files, inline: false },
                { name: 'Changed Files', value: status.files.slice(0, 10).map(f => `• ${f.path}`).join('\n') + (status.files.length > 10 ? `\n... and ${status.files.length - 10} more` : ''), inline: false }
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
            status,
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
        // Update status with progress
        await interaction.editReply({ content: 'Staging files...', embeds: [], components: [] });
        
        // Stage files
        if (commitData.files === '.') {
            await gitWithTimeout(() => git.add('.'));
        } else {
            const fileList = commitData.files.split(',').map(f => f.trim());
            await gitWithTimeout(() => git.add(fileList));
        }
        
        // Update progress
        await interaction.editReply('Creating commit...');
        
        // Create commit
        const commit = await gitWithTimeout(() => git.commit(commitData.message));
        
        // Update progress
        await interaction.editReply('Pushing to repository...');
        
        // Push changes - use current branch via ephemeral URL
        const currentBranch = commitData.status.current || 'main';
        await pushWithAuth(currentBranch);
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes pushed! Site will update in 1-2 minutes.')
            .addFields(
                { name: 'Commit Message', value: commitData.message, inline: false },
                { name: 'Commit Hash', value: commit.commit.substring(0, 7), inline: true },
                { name: 'Files Changed', value: commitData.status.files.length.toString(), inline: true },
                { name: 'Deployment', value: '⏳ Deploying... (1-2 min)', inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp();
        
        // Add repository link if URL is available
        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Changes](${process.env.GITHUB_REPO_URL}/commit/${commit.commit})`,
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
        } else if (action === 'style') {
            if (type === 'confirm') {
                // Get stored style data
                const styleData = global.stylePendingData?.get(interaction.user.id);
                if (!styleData) {
                    await interaction.reply({ content: 'Style data expired. Please run the command again.', flags: 64 }); // MessageFlags.Ephemeral
                    return;
                }
                
                // Acknowledge the button click
                await interaction.deferUpdate();
                
                // Execute the style update
                await executeStyleUpdate(interaction, styleData);
                
                // Clean up
                global.stylePendingData?.delete(interaction.user.id);
                
            } else if (type === 'cancel') {
                // Clean up and show cancellation
                global.stylePendingData?.delete(interaction.user.id);
                
                const cancelEmbed = new EmbedBuilder()
                    .setTitle('❌ Style Update Cancelled')
                    .setDescription('No changes were made to the website styling.')
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
                
                // Discard changes and show original response
                await gitWithTimeout(() => git.reset(['--hard', 'HEAD']));
                
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

        const modelNames = {
            'haiku': 'Claude Haiku 4.5',
            'sonnet': 'Claude Sonnet 4.5',
            'kimi': 'Kimi K2 Exacto',
            'qwen': 'Qwen 3 Coder',
            'gemini': 'Gemini 2.5 Pro',
            'glm': 'GLM-4.6 Exacto',
            'minimax': 'Minimax M2',
            'custom': customModel || 'Custom Model'
        };

        const embed = new EmbedBuilder()
            .setTitle('🤖 Model Changed')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'New Model', value: modelNames[modelChoice] || 'Custom Model', inline: true },
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
        const status = await git.status();
        
        const embed = new EmbedBuilder()
            .setTitle('📊 Repository Status')
            .setDescription('Current repository status')
            .addFields(
                { name: 'Branch', value: status.current || 'unknown', inline: true },
                { name: 'Modified Files', value: status.modified.length.toString(), inline: true },
                { name: 'New Files', value: status.not_added.length.toString(), inline: true },
                { name: 'Live Site', value: 'https://bot.inference-arcade.com/', inline: false }
            )
            .setColor(0x3498db);

        if (status.files.length > 0) {
            const fileList = status.files.slice(0, 10).map(file =>
                `${file.working_dir === 'M' ? '📝' : '🆕'} ${file.path}`
            ).join('\n');

            embed.addFields({
                name: 'Changed Files',
                value: fileList + (status.files.length > 10 ? '\n...and more' : ''),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        throw new Error(`Status check failed: ${error.message}`);
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

// New function to handle mention-triggered commits
async function executeMentionCommit(interaction, commitData) {
    try {
        // Update status with progress
        await interaction.editReply({ content: 'Staging files...', embeds: [], components: [] });
        
        // Stage all changed files
        await gitWithTimeout(() => git.add('.'));
        
        // Update progress
        await interaction.editReply('Creating commit...');
        
        // Create commit with AI response as commit message (truncated)
        const commitMessage = `ai changes: ${commitData.originalContent.substring(0, 50)}${commitData.originalContent.length > 50 ? '...' : ''}`;
        const commit = await gitWithTimeout(() => git.commit(commitMessage));
        
        // Update progress
        await interaction.editReply('Pushing to repository...');
        
        // Push changes - use current branch via ephemeral URL
        const currentBranch = commitData.status.current || 'main';
        await pushWithAuth(currentBranch);
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 AI Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** AI-generated changes are now live!')
            .addFields(
                { name: 'Commit Message', value: commitMessage, inline: false },
                { name: 'Commit Hash', value: commit.commit.substring(0, 7), inline: true },
                { name: 'Files Changed', value: commitData.status.files.length.toString(), inline: true },
                { name: 'Live Site', value: '[View Changes](https://bot.inference-arcade.com/)', inline: false }
            )
            .setColor(0x7dd3a0) // Mint green
            .setTimestamp();
        
        // Add repository link if URL is available
        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Commit](${process.env.GITHUB_REPO_URL}/commit/${commit.commit})`,
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

// New function to handle the actual style update process
async function executeStyleUpdate(interaction, styleData) {
    try {
        // Update status with progress
        await interaction.editReply({ content: 'Generating new styles...', embeds: [], components: [] });

        let newCSS = '';

        const preset = styleData.preset;
        const customDescription = styleData.customDescription;

        // Style presets
        const stylePresets = {
            'soft-arcade': `/* Bot Sportello Arcade - Softer Retro Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Press Start 2P', cursive, monospace;
    background: linear-gradient(to bottom, #1a1d23 0%, #0f1419 100%);
    background-image:
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 49px,
            rgba(100, 200, 150, 0.08) 49px,
            rgba(100, 200, 150, 0.08) 50px
        ),
        repeating-linear-gradient(
            90deg,
            transparent,
            transparent 49px,
            rgba(100, 200, 150, 0.08) 49px,
            rgba(100, 200, 150, 0.08) 50px
        );
    background-size: 50px 50px;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
    overflow-x: hidden;
}

@keyframes gridMove {
    0% { background-position: 0 0; }
    100% { background-position: 0 50px; }
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
}

header {
    text-align: center;
    color: #7dd3a0;
    margin-bottom: 50px;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
    line-height: 1.4;
}

.tagline {
    font-size: 0.6em;
    color: #95c9ad;
    margin-top: 10px;
    opacity: 0.85;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 25px;
    margin-top: 30px;
}

.project-card {
    background: linear-gradient(135deg, #252a32 0%, #1d2228 100%);
    border: 2px solid #5a9d7a;
    border-radius: 8px;
    padding: 25px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    transition: all 0.3s ease;
    cursor: pointer;
    text-decoration: none;
    color: #7dd3a0;
    display: block;
    position: relative;
    overflow: hidden;
}

.project-card::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -2px;
    right: -2px;
    bottom: -2px;
    background: linear-gradient(45deg, #5a9d7a, #7dd3a0, #5a9d7a);
    z-index: -1;
    opacity: 0;
    transition: opacity 0.3s ease;
}

.project-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 20px rgba(93, 157, 122, 0.3);
    border-color: #7dd3a0;
}

.project-card:hover::before {
    opacity: 0.15;
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
}

.project-title {
    font-size: 0.9em;
    margin-bottom: 15px;
    color: #a8e6c1;
    line-height: 1.4;
}

.project-description {
    color: #95c9ad;
    line-height: 1.6;
    font-size: 0.5em;
    opacity: 0.9;
}

.add-project {
    background: linear-gradient(135deg, #2a4035 0%, #1f3028 100%);
    border-color: #6bb88f;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}

.add-project:hover {
    background: linear-gradient(135deg, #325442 0%, #2a4035 100%);
    box-shadow: 0 8px 20px rgba(107, 184, 143, 0.25);
}

footer {
    text-align: center;
    color: #95c9ad;
    margin-top: 60px;
    font-size: 0.5em;
    line-height: 1.8;
    opacity: 0.8;
}

footer a {
    color: #7dd3a0;
    text-decoration: none;
    transition: all 0.3s ease;
}

footer a:hover {
    color: #a8e6c1;
}

footer code {
    background: #252a32;
    padding: 3px 8px;
    border: 1px solid #5a9d7a;
    border-radius: 3px;
    color: #7dd3a0;
}

.refresh-btn {
    background: #252a32;
    color: #7dd3a0;
    border: 2px solid #5a9d7a;
    padding: 10px 20px;
    cursor: pointer;
    font-size: 0.6em;
    font-family: 'Press Start 2P', cursive;
    margin-top: 20px;
    transition: all 0.3s ease;
}

.refresh-btn:hover {
    background: #5a9d7a;
    color: #1a1d23;
    border-color: #7dd3a0;
    transform: translateY(-2px);
}

.refresh-btn:active {
    transform: translateY(0);
}

body::after {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.05) 0px,
        transparent 1px,
        transparent 2px,
        rgba(0, 0, 0, 0.05) 3px
    );
    pointer-events: none;
    z-index: 999;
}
`,

            'neon-arcade': `/* Bot Sportello Arcade - Intense Neon Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Press Start 2P', cursive, monospace;
    background: #0a0e0f;
    background-image:
        repeating-linear-gradient(
            0deg,
            transparent,
            transparent 49px,
            rgba(0, 255, 100, 0.15) 49px,
            rgba(0, 255, 100, 0.15) 50px
        );
    background-size: 50px 50px;
    animation: gridMove 2s linear infinite;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
    overflow-x: hidden;
}

@keyframes gridMove {
    0% { background-position: 0 0; }
    100% { background-position: 0 50px; }
}

@keyframes glow {
    0%, 100% { text-shadow: 0 0 5px #00ff64, 0 0 10px #00ff64; }
    50% { text-shadow: 0 0 10px #00ff64, 0 0 20px #00ff64, 0 0 30px #00ff64; }
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
}

header {
    text-align: center;
    color: #00ff64;
    margin-bottom: 50px;
    animation: glow 2s ease-in-out infinite;
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
    line-height: 1.4;
}

.tagline {
    font-size: 0.6em;
    color: #00cc50;
    margin-top: 10px;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 25px;
    margin-top: 30px;
}

.project-card {
    background: linear-gradient(135deg, #1a1d23 0%, #0f1419 100%);
    border: 3px solid #00ff64;
    border-radius: 8px;
    padding: 25px;
    box-shadow: 0 4px 20px rgba(0, 255, 100, 0.3);
    transition: all 0.3s ease;
    cursor: pointer;
    text-decoration: none;
    color: #00ff64;
    display: block;
}

.project-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 30px rgba(0, 255, 100, 0.5);
    border-color: #00ff88;
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
    filter: drop-shadow(0 0 10px #00ff64);
}

.project-title {
    font-size: 0.9em;
    margin-bottom: 15px;
    color: #00ff88;
    line-height: 1.4;
}

.project-description {
    color: #00cc50;
    line-height: 1.6;
    font-size: 0.5em;
}

footer {
    text-align: center;
    color: #00cc50;
    margin-top: 60px;
    font-size: 0.5em;
    line-height: 1.8;
}

footer a {
    color: #00ff64;
    text-decoration: none;
}

.refresh-btn {
    background: transparent;
    color: #00ff64;
    border: 2px solid #00ff64;
    padding: 10px 20px;
    cursor: pointer;
    font-size: 0.6em;
    font-family: 'Press Start 2P', cursive;
    margin-top: 20px;
    transition: all 0.3s ease;
}

.refresh-btn:hover {
    background: #00ff64;
    color: #0a0e0f;
}

body::after {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 0, 0, 0.15) 0px,
        transparent 2px
    );
    pointer-events: none;
    z-index: 999;
}
`,

            'dark-minimal': `/* Dark Minimal Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: #0d0d0d;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 40px 20px;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

header {
    text-align: center;
    color: #ffffff;
    margin-bottom: 60px;
}

h1 {
    font-size: 2.5em;
    margin-bottom: 20px;
    font-weight: 700;
    letter-spacing: -1px;
}

.tagline {
    font-size: 1em;
    color: #888;
    font-weight: 400;
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    margin-top: 30px;
}

.project-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 12px;
    padding: 30px;
    transition: all 0.2s ease;
    cursor: pointer;
    text-decoration: none;
    color: #e0e0e0;
    display: block;
}

.project-card:hover {
    background: #222;
    border-color: #444;
    transform: translateY(-2px);
}

.project-icon {
    font-size: 2.5em;
    margin-bottom: 15px;
}

.project-title {
    font-size: 1.2em;
    margin-bottom: 10px;
    color: #fff;
    font-weight: 600;
}

.project-description {
    color: #999;
    line-height: 1.6;
    font-size: 0.9em;
}

footer {
    text-align: center;
    color: #666;
    margin-top: 80px;
    font-size: 0.9em;
}

footer a {
    color: #888;
    text-decoration: none;
}

footer a:hover {
    color: #aaa;
}

.refresh-btn {
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #2a2a2a;
    padding: 12px 24px;
    cursor: pointer;
    font-size: 0.9em;
    border-radius: 6px;
    margin-top: 20px;
    transition: all 0.2s ease;
}

.refresh-btn:hover {
    background: #222;
    border-color: #444;
}
`,

            'retro-terminal': `/* Retro Terminal Style */

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Courier New', monospace;
    background: #000;
    color: #0f0;
    min-height: 100vh;
    padding: 40px 20px;
    position: relative;
}

body::before {
    content: '';
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
        0deg,
        rgba(0, 255, 0, 0.03) 0px,
        transparent 2px
    );
    pointer-events: none;
    z-index: 999;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

header {
    text-align: center;
    color: #0f0;
    margin-bottom: 50px;
    text-shadow: 0 0 5px #0f0;
}

h1 {
    font-size: 2em;
    margin-bottom: 20px;
}

h1::before {
    content: '> ';
}

.tagline {
    font-size: 0.9em;
    opacity: 0.8;
}

.tagline::before {
    content: '$ ';
}

.projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 20px;
    margin-top: 30px;
}

.project-card {
    background: #001100;
    border: 1px solid #0f0;
    padding: 20px;
    transition: all 0.2s ease;
    cursor: pointer;
    text-decoration: none;
    color: #0f0;
    display: block;
}

.project-card:hover {
    background: #002200;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
}

.project-card::before {
    content: '[';
    margin-right: 5px;
}

.project-card::after {
    content: ']';
    margin-left: 5px;
}

.project-icon {
    font-size: 2em;
    margin-bottom: 10px;
}

.project-title {
    font-size: 1em;
    margin-bottom: 10px;
}

.project-title::before {
    content: '// ';
    opacity: 0.6;
}

.project-description {
    opacity: 0.8;
    line-height: 1.5;
    font-size: 0.85em;
}

footer {
    text-align: center;
    margin-top: 60px;
    font-size: 0.85em;
    opacity: 0.7;
}

footer a {
    color: #0f0;
    text-decoration: none;
}

.refresh-btn {
    background: transparent;
    color: #0f0;
    border: 1px solid #0f0;
    padding: 10px 20px;
    cursor: pointer;
    font-family: 'Courier New', monospace;
    margin-top: 20px;
    transition: all 0.2s ease;
}

.refresh-btn:hover {
    background: #0f0;
    color: #000;
}
`
        };

        if (preset === 'custom') {
            if (!customDescription) {
                await interaction.editReply("hey man, you gotta provide a description for custom styles...");
                return;
            }

            // Use AI to generate custom CSS
            const cssPrompt = `Generate a complete CSS stylesheet for a retro arcade-style website homepage based on this description: "${customDescription}"

The CSS must include styles for these elements:
- body (with background, font-family, colors)
- .container (max-width: 1200px)
- header, h1, .tagline
- .projects-grid (CSS grid layout)
- .project-card (card design with hover effects)
- .project-icon, .project-title, .project-description
- .add-project (variant of project-card)
- footer, footer a, footer code
- .refresh-btn (button styling)

Use Press Start 2P font from Google Fonts for retro feel, or another retro/monospace font if the description suggests different styling.
Output ONLY the CSS code, no explanations.`;

            const cssResult = await getLLMResponse(cssPrompt, []);
            newCSS = cssResult.text;

            // Clean up the response
            newCSS = newCSS.replace(/```css\n?/g, '').replace(/```\n?/g, '').trim();

        } else {
            newCSS = stylePresets[preset];
        }

        // Write the new CSS to style.css
        await fs.writeFile('./style.css', newCSS);

        // Commit and push
        await git.add('./style.css');
        const status = await git.status();
        const commitMessage = `update style to ${preset === 'custom' ? 'custom: ' + customDescription : preset}`;
        await git.commit(commitMessage);

        await pushWithAuth(status.current || 'main');

        const embed = new EmbedBuilder()
            .setTitle('🎨 Style Updated & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes pushed! Site will update in 1-2 minutes.')
            .addFields(
                { name: 'Style', value: preset === 'custom' ? 'Custom AI-generated' : preset, inline: true },
                { name: 'File', value: 'style.css', inline: true },
                { name: 'Deployment', value: '⏳ Deploying... Please be patient (1-2 min)', inline: false },
                { name: 'Live Site', value: '[View Changes](https://bot.inference-arcade.com/)', inline: false }
            )
            .setColor(0x9b59b6)
            .setTimestamp();

        if (preset === 'custom') {
            embed.addFields({ name: 'Description', value: customDescription, inline: false });
        }

        await interaction.editReply({ embeds: [embed] });

    } catch (error) {
        console.error('Style update execution error:', error);
        
        let errorMessage = getBotResponse('errors');
        
        if (error.message.includes('permission')) {
            errorMessage += ' Permission issue writing files.';
        } else if (error.message.includes('git')) {
            errorMessage += ' Git operation failed.';
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
