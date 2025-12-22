require('dotenv').config({ override: true });
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Octokit } = require('@octokit/rest');
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

// Modular imports (Phase 1 extraction)
const { MODEL_PRESETS, DEFAULT_MODEL, REASONING_CONFIG, OPENROUTER_URL, getReasoningConfig, formatThinkingForDiscord, formatThinkingForGUI } = require('./config/models');
const { getBotResponse, botResponses } = require('./personality/botResponses');
const { stylePresets, getStylePreset } = require('./styles/presets');

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
    DISCORD_FETCH_LIMIT: 5,       // Max messages to fetch per Discord API request
    DISCORD_CONTEXT_LIMIT: 5,     // Messages to include in LLM context
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

// --- GitHub API Git Operations (Railway-compatible, no local git needed) ---

async function getExistingFileSha(repoPath, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: repoPath, ref: branch });
        if (Array.isArray(data)) {
            throw new Error(`Path refers to a directory: ${repoPath}`);
        }
        return data.sha;
    } catch (e) {
        if (e.status === 404) return undefined; // New file
        throw e;
    }
}

async function pushFileViaAPI(filePath, content, commitMessage, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;

    // Normalize to posix path for GitHub API
    const posixPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

    const sha = await getExistingFileSha(posixPath, branch);
    const base64Content = Buffer.from(content, 'utf8').toString('base64');

    const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: posixPath,
        message: commitMessage,
        content: base64Content,
        branch,
        sha
    });

    return res.data.commit?.sha || null;
}

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

// Commit multiple files to GitHub in a single commit via the Git Trees API
// More efficient than multiple single-file commits for batch operations
async function commitFilesViaAPI(files, commitMessage, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;

    if (!files || files.length === 0) {
        return { success: false, error: 'No files to commit' };
    }

    console.log(`[GITHUB_API] Committing ${files.length} file(s): "${commitMessage}"`);

    try {
        // Get the current commit SHA for the branch
        const { data: refData } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${branch}`
        });
        const currentCommitSha = refData.object.sha;

        // Get the tree SHA from the current commit
        const { data: commitData } = await octokit.git.getCommit({
            owner,
            repo,
            commit_sha: currentCommitSha
        });
        const baseTreeSha = commitData.tree.sha;

        // Create blobs for each file and build tree entries
        const treeEntries = [];
        for (const file of files) {
            const posixPath = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
            const base64Content = Buffer.from(file.content, 'utf8').toString('base64');

            // Create blob for the file
            const { data: blobData } = await octokit.git.createBlob({
                owner,
                repo,
                content: base64Content,
                encoding: 'base64'
            });

            treeEntries.push({
                path: posixPath,
                mode: '100644', // Regular file
                type: 'blob',
                sha: blobData.sha
            });
        }

        // Create new tree with our changes
        const { data: newTree } = await octokit.git.createTree({
            owner,
            repo,
            base_tree: baseTreeSha,
            tree: treeEntries
        });

        // Create the commit
        const { data: newCommit } = await octokit.git.createCommit({
            owner,
            repo,
            message: commitMessage,
            tree: newTree.sha,
            parents: [currentCommitSha]
        });

        // Update the branch reference to point to new commit
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: newCommit.sha
        });

        console.log(`[GITHUB_API] Commit successful: ${newCommit.sha.substring(0, 7)}`);
        return {
            success: true,
            sha: newCommit.sha,
            shortSha: newCommit.sha.substring(0, 7),
            filesCommitted: files.length
        };

    } catch (error) {
        console.error(`[GITHUB_API] Commit failed:`, error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Get list of changed local files that differ from GitHub (for commit preview)
async function getLocalChanges(filePaths) {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    const changes = [];

    for (const filePath of filePaths) {
        try {
            const localContent = await fs.readFile(filePath, 'utf8');
            const posixPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

            // Try to get existing file from GitHub
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: posixPath,
                    ref: 'main'
                });

                // File exists on GitHub - check if content differs
                const remoteContent = Buffer.from(data.content, 'base64').toString('utf8');
                if (localContent !== remoteContent) {
                    changes.push({ path: filePath, content: localContent, status: 'modified' });
                }
            } catch (e) {
                if (e.status === 404) {
                    // File doesn't exist on GitHub - it's new
                    changes.push({ path: filePath, content: localContent, status: 'new' });
                } else {
                    throw e;
                }
            }
        } catch (error) {
            console.warn(`[GITHUB_API] Could not check ${filePath}: ${error.message}`);
        }
    }

    return changes;
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
    // Validate GitHub repository access before operations
    async validateGitState() {
        try {
            // Use GitHub API to validate repository access
            const { data: repo } = await octokit.repos.get({
                owner: process.env.GITHUB_REPO_OWNER,
                repo: process.env.GITHUB_REPO_NAME
            });

            return {
                valid: true,
                branch: repo.default_branch || 'main',
                hasChanges: true, // Always allow commits via API
                repoName: repo.full_name
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

// Mutable model state - uses imported MODEL_PRESETS and DEFAULT_MODEL
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

// Bot system prompt with enhanced capabilities
// Default system prompt - can be modified at runtime
const DEFAULT_SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with web development projects. You're helpful but a little spacey, like Doc Sportello - generally competent but sometimes distracted, speaking in a relaxed, slightly rambling way.

REPOSITORY CONTEXT:
Repository: https://github.com/milwrite/javabot/
Commits: https://github.com/milwrite/javabot/commits/main/
Live Site: https://bot.inference-arcade.com/
Dashboard: https://bot.inference-arcade.com/dashboard (GUI for logs, tool calls, file changes)
- You can commit, push, and manage files
- ALL web pages and JS libraries are in the /src directory
- When reading files, paths auto-resolve: "game.html" → "src/game.html"
- You help create, edit, and deploy web projects via Discord commands

SITE INVENTORY (CRITICAL - Updated automatically):
- The file src/site-inventory.html contains current diagrams of all webpages and JavaScript files
- This inventory includes file structures, collections, links, and metadata
- When searching for games/pages, refer to this inventory for accurate current content
- Inventory automatically updates when DEVLOG.md changes
- Use read_file("src/site-inventory.html") to see current site structure when needed

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
3. Use the unified page chrome: wrap the back arrow + titles in a .page-header, with .home-link for the arrow, .page-title for the main heading, and .page-subtitle (or .page-title-group .subtitle) for subheadings; do not override title/subtitle sizes inline (use the CSS tokens)
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

URL FORMATTING:
- ALWAYS put SPACE after URLs before any punctuation (breaks links otherwise)
- BAD: https://example.com—text  GOOD: https://example.com - text
- Use hyphens (-) not em dashes (—) in page names

TOOLS:
- file_exists(path|url): Check existence - use FIRST for URLs or informal names
- list_files(path): List directory
- search_files(pattern, path): Search text patterns
- read_file(path): Read file (use src/site-inventory.html for site overview)
- write_file(path, content): Create/update files
- edit_file(path, old_string, new_string): Exact string replacement (fast)
- edit_file(path, instructions): AI-based edit (slow fallback)
- commit_changes(message, files): Git add, commit, push
- git_log(): Commit history - YOUR MEMORY of past work
- web_search(query): Current info (sports, news, weather, "latest/today")
- set_model(model): Switch AI (kimi/sonnet/gemini/glm)

TOOL USAGE:
- URL given → file_exists first
- Informal name ("peanut city") → peanut-city.html, file_exists
- "list/show/what are X" → search_files
- "what did you make?" → git_log()
- Search before reading random files

PERSONALITY: Casual, chill, SHORT (1-2 sentences). "yeah man", "right on". Call people "man/dude".

FORMATTING: Markdown headers, bold labels, blank lines between sections. No "Bot Sportello:" prefix.

Live site: https://bot.inference-arcade.com/`;

// Mutable system prompt - can be changed at runtime
let SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;

// botResponses and getBotResponse imported from ./personality/botResponses

// Clean and format bot responses for better markdown rendering
function cleanBotResponse(response) {
    if (!response) return '';

    // Remove "Bot Sportello:" prefix patterns
    let cleaned = response.replace(/^Bot Sportello:\s*/i, '').replace(/Bot Sportello:\s*Bot Sportello:\s*/gi, '');

    // Strip any tool-call markup that some models emit in plain text
    cleaned = cleaned
        .replace(/<[^>]*tool_call[^>]*>[\s\S]*?<\/[^>]*tool_call>/gi, '')
        .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
        .replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, '')
        .replace(/<[^>]*tool_call[^>]*>/gi, '')
        .replace(/<\/?(invoke|parameter)\b[^>]*>/gi, '')
        .replace(/^<[^>\n]*(tool_call|invoke|parameter)[^>\n]*>\s*$/gmi, '');

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

        // Write the file
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`[WRITE_FILE] Written: ${filePath} (${content.length} bytes)`);

        // Log file creation to GUI dashboard
        logFileChange('create', filePath, content);

        // Auto-commit and push via GitHub API so file is live before link is shared
        console.log(`[WRITE_FILE] Auto-pushing to remote via GitHub API...`);
        const fileName = path.basename(filePath);
        const commitMessage = `add ${fileName}`;

        try {
            const sha = await pushFileViaAPI(filePath, content, commitMessage, 'main');
            console.log(`[WRITE_FILE] Pushed: ${commitMessage} (${sha?.slice(0,7) || 'no-sha'})`);
            return `File written and pushed: ${filePath} (${content.length} bytes) - now live at https://bot.inference-arcade.com/${filePath}`;
        } catch (pushErr) {
            errorLogger.log('WRITE_FILE_PUSH', pushErr, { filePath, commitMessage });
            throw pushErr;
        }
    } catch (error) {
        console.error(`[WRITE_FILE] Error:`, error.message);
        return `Error writing file: ${error.message}`;
    }
}

async function editFile(filePath, oldString = null, newString = null, instructions = null, replacements = null) {
    const startTime = Date.now();
    console.log(`[EDIT_FILE] Starting edit for: ${filePath}`);

    try {
        // Read the current file content
        const currentContent = await fs.readFile(filePath, 'utf-8');
        const fileSize = (currentContent.length / 1024).toFixed(1);
        console.log(`[EDIT_FILE] File size: ${fileSize}KB`);

        let updatedContent;
        let changeDescription;

        // Mode 0: Batch replacement (FASTEST - multiple edits in one call)
        if (replacements !== null && Array.isArray(replacements) && replacements.length > 0) {
            console.log(`[EDIT_FILE] Using batch replacement mode (${replacements.length} replacements)`);

            updatedContent = currentContent;
            const results = [];

            for (let i = 0; i < replacements.length; i++) {
                const { old: oldStr, new: newStr, replace_all: replaceAll } = replacements[i];

                if (!oldStr || newStr === undefined) {
                    throw new Error(`Batch edit ${i + 1}: missing 'old' or 'new' property`);
                }

                const occurrences = updatedContent.split(oldStr).length - 1;

                if (occurrences === 0) {
                    throw new Error(`Batch edit ${i + 1}/${replacements.length} failed: string not found: "${oldStr.slice(0, 50)}..."`);
                }

                if (occurrences > 1 && !replaceAll) {
                    throw new Error(`Batch edit ${i + 1}/${replacements.length} failed: string appears ${occurrences} times. Use replace_all: true or provide more context.`);
                }

                updatedContent = replaceAll ? updatedContent.split(oldStr).join(newStr) : updatedContent.replace(oldStr, newStr);
                results.push(`${i + 1}. ${oldStr.length}→${newStr.length}${replaceAll ? ` (×${occurrences})` : ''}`);
            }

            changeDescription = `Batch replaced ${replacements.length} strings: ${results.join(', ')}`;
            const batchTime = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[EDIT_FILE] Batch replacement completed in ${batchTime}s`);

        // Mode 1: Exact string replacement (FAST - preferred method)
        } else if (oldString !== null && newString !== null) {
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

            // Use Kimi-fast for edits - faster than thinking model
            const editModel = MODEL_PRESETS['kimi-fast'];
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

        // Push via GitHub API
        try {
            const sha = await pushFileViaAPI(filePath, updatedContent, commitMessage, 'main');
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[EDIT_FILE] Pushed: ${filePath} (${sha?.slice(0,7) || 'no-sha'}) in ${totalTime}s`);
            return `File edited and pushed: ${filePath}. ${changeDescription} - now live`;
        } catch (apiErr) {
            console.error(`[EDIT_FILE] Push failed: ${apiErr.message}`);
            return `Error editing file: ${apiErr.message}`;
        }
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

        // Validate GitHub access
        const gitValidation = await pipelineValidator.validateGitState();
        if (!gitValidation.valid) {
            throw new Error(`GitHub validation failed: ${gitValidation.error}`);
        }

        // Require explicit file list for API commits
        if (!files || files === '.') {
            return 'Provide specific files to commit (comma-separated). Use write/edit actions which push automatically.';
        }

        const fileList = files.split(',').map(f => f.trim()).filter(Boolean);
        if (fileList.length === 0) return 'Nothing to commit';

        // Validate files before committing
        const fileValidation = await pipelineValidator.validateFileOperations(fileList);
        if (!fileValidation.valid) {
            console.warn('⚠️ File validation issues:', fileValidation.issues);
            metadata.fileIssues = fileValidation.issues;
        }

        // Read all files and prepare for batch commit
        const filesToCommit = [];
        for (const f of fileList) {
            try {
                const content = await fs.readFile(f, 'utf8');
                filesToCommit.push({ path: f, content });
            } catch (e) {
                errorLogger.log('COMMIT_READ', e, { file: f });
                return `Error reading ${f}: ${e.message}`;
            }
        }

        console.log(`[COMMIT] Committing ${filesToCommit.length} file(s) via GitHub API...`);

        // Commit all files in a single commit via GitHub API
        const result = await commitFilesViaAPI(filesToCommit, message, 'main');

        if (!result.success) {
            throw new Error(result.error);
        }

        console.log(`[COMMIT] Success: ${result.shortSha}`);
        return `Committed: ${result.shortSha} - ${message} (${result.filesCommitted} files)`;

    } catch (error) {
        const errorEntry = errorLogger.log('COMMIT', error, metadata);
        errorLogger.track(errorEntry);

        // Return user-friendly error message
        if (error.message.includes('authentication') || error.message.includes('401')) {
            return `Error: GitHub authentication failed. Check token permissions.`;
        } else if (error.message.includes('timeout')) {
            return `Error: GitHub API timed out. Try again.`;
        } else if (error.message.includes('nothing to commit') || error.message.includes('No files')) {
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
                    name: 'file_exists',
                    description: 'FAST check if a file exists. Use this FIRST when given a URL like bot.inference-arcade.com/src/file.html - pass the URL or path directly.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: {
                                oneOf: [
                                    { type: 'string', description: 'File path or URL to check' },
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
                    description: 'Edit an existing file using EXACT string replacement. For multiple edits, use batch mode with replacements array.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit' },
                            old_string: { type: 'string', description: 'EXACT string to replace (must be unique in file)' },
                            new_string: { type: 'string', description: 'New string to replace old_string with' },
                            replacements: {
                                type: 'array',
                                description: 'BATCH MODE: Array of {old, new, replace_all?} objects for multiple edits in one call',
                                items: {
                                    type: 'object',
                                    properties: {
                                        old: { type: 'string' },
                                        new: { type: 'string' },
                                        replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
                                    },
                                    required: ['old', 'new']
                                }
                            }
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
                if (functionName === 'file_exists') {
                    result = await fileExists(args.path);
                } else if (functionName === 'search_files') {
                    result = await searchFiles(args.pattern, args.path || './src', {
                        caseInsensitive: args.case_insensitive || false
                    });
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'edit_file') {
                    result = await editFile(args.path, args.old_string, args.new_string, args.instructions, args.replacements);
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
                    description: 'Edit an existing file using EXACT string replacement. For multiple edits, use batch mode with replacements array - this is MUCH faster than multiple edit_file calls. ALWAYS prefer exact replacement for speed and accuracy.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit (e.g., "src/example.html", "index.html", "style.css")' },
                            old_string: { type: 'string', description: 'EXACT string to replace (including all whitespace, indentation, newlines). Must be unique in the file. Use for single edits.' },
                            new_string: { type: 'string', description: 'New string to replace old_string with. Use with old_string parameter.' },
                            replacements: {
                                type: 'array',
                                description: 'BATCH MODE (preferred for multiple edits): Array of {old, new, replace_all?} objects. Each edit is applied in sequence. Uses single file read/write - much faster than multiple edit_file calls.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        old: { type: 'string', description: 'Exact string to find' },
                                        new: { type: 'string', description: 'Replacement string' },
                                        replace_all: { type: 'boolean', description: 'If true, replace ALL occurrences of old string (default: false, requires unique match)' }
                                    },
                                    required: ['old', 'new']
                                }
                            },
                            instructions: { type: 'string', description: 'FALLBACK: Natural language instructions for complex edits. Only use when exact replacement is not feasible. This mode is SLOW (requires AI processing).' }
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
                    name: 'set_model',
                    description: 'Switch the AI model used for responses. ZDR-compliant models: glm (default), kimi, kimi-fast, sonnet, gemini, qwen',
                    parameters: {
                        type: 'object',
                        properties: {
                            model: {
                                type: 'string',
                                description: 'Model preset name. glm = GLM-4.6 (default), kimi = with reasoning, kimi-fast = without.',
                                enum: ['glm', 'kimi', 'kimi-fast', 'sonnet', 'gemini', 'qwen', 'minimax']
                            }
                        },
                        required: ['model']
                    }
                }
            }
        ];

        // Agentic loop - allow multiple rounds of tool calling
        const MAX_ITERATIONS = 6; // Reasonable limit to prevent infinite loops
        const MAX_READONLY_ITERATIONS = 5; // Cap read-only tool loops to prevent over-searching
        let iteration = 0;
        let readOnlyIterations = 0; // Track consecutive read-only iterations
        let lastResponse;
        const editedFiles = new Set(); // Track files already edited to prevent redundant edits
        const searchResults = []; // Track web search results for context persistence
        let completedActions = 0; // Count primary actions (edits, creates, commits)

        // Read-only tools that don't modify state
        const READ_ONLY_TOOLS = new Set(['list_files', 'file_exists', 'search_files', 'read_file', 'get_repo_status', 'git_log', 'web_search']);

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
                        // Support exact replacement (preferred), batch mode (for multiple edits), and AI-based instructions (fallback)
                        result = await editFile(args.path, args.old_string, args.new_string, args.instructions, args.replacements);
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
                    { name: 'GLM-4.6 Exacto (Default)', value: 'glm' },
                    { name: 'Kimi K2 Thinking (Reasoning)', value: 'kimi' },
                    { name: 'Kimi K2 Fast (No Reasoning)', value: 'kimi-fast' },
                    { name: 'Qwen 3 Coder (Alibaba)', value: 'qwen' },
                    { name: 'Gemini 2.5 Pro (Google)', value: 'gemini' },
                    { name: 'Minimax M2 (MiniMax)', value: 'minimax' },
                    { name: 'Custom Model (enter name)', value: 'custom' }
                ))
        .addStringOption(option =>
            option.setName('custom_model')
                .setDescription('Custom model name (e.g. google/gemini-2.5-pro)')
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

                            // Try to extract explicit commit message (e.g., "commit with message 'fix bug'")
                            const messageMatch = content.match(/(?:commit.*?(?:with message|as|:)\s*['"]([^'"]+)['"])|(?:commit\s+['"]([^'"]+)['"])/i);
                            if (messageMatch) {
                                commitMessage = messageMatch[1] || messageMatch[2];
                            }

                            // Try to extract file list from request
                            const fileMatch = content.match(/(?:commit|push)\s+(?:files?\s+)?([^\s'"]+(?:\s*,\s*[^\s'"]+)*)/i);
                            const files = fileMatch ? fileMatch[1] : '';

                            if (!files) {
                                await safeEditReply(thinkingMsg, `ℹ️ specify files to commit, e.g. "commit src/game.html". files are auto-committed when created/edited.`);
                                return;
                            }

                            const result = await commitChanges(commitMessage, files);
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

                    // Commit and push via GitHub API
                    await safeEditReply(thinkingMsg, '💾 committing and pushing to github...');
                    const commitSuccess = await commitGameFiles(result);

                    if (!commitSuccess) {
                        await safeEditReply(thinkingMsg, `⚠️ Content built but commit failed. Check GitHub token permissions.`);
                        return;
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
            // Split long messages into multiple parts instead of truncating
            const maxLength = 1950; // Leave room for formatting
            const parts = [];
            let remaining = finalResponse;
            
            while (remaining.length > 0) {
                if (remaining.length <= maxLength) {
                    parts.push(remaining);
                    break;
                }
                
                // Try to split at a natural break point
                let splitIndex = remaining.lastIndexOf('\n', maxLength);
                if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
                    splitIndex = remaining.lastIndexOf(' ', maxLength);
                }
                if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
                    splitIndex = maxLength;
                }
                
                parts.push(remaining.substring(0, splitIndex));
                remaining = remaining.substring(splitIndex).trim();
            }
            
            // Send first part as edit to thinking message
            await safeEditReply(thinkingMsg, parts[0]);
            
            // Send remaining parts as follow-up messages
            for (let i = 1; i < parts.length; i++) {
                await message.channel.send(parts[i]);
            }
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
        const files = interaction.options.getString('files') || '';

        // Require explicit file list for GitHub API commits
        if (!files || files === '.') {
            await interaction.editReply("Please specify files to commit (comma-separated). Example: `src/game.html, src/utils.js`\n\nNote: Files are auto-committed when created/edited via bot commands.");
            return;
        }

        const fileList = files.split(',').map(f => f.trim()).filter(Boolean);
        if (fileList.length === 0) {
            await interaction.editReply("No valid files specified.");
            return;
        }

        // Show confirmation dialog with file details
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Commit & Push')
            .setDescription(`Ready to commit and push **${fileList.length} file(s)** to GitHub?`)
            .addFields(
                { name: 'Commit Message', value: message, inline: false },
                { name: 'Files to Commit', value: fileList.slice(0, 10).map(f => `• ${f}`).join('\n') + (fileList.length > 10 ? `\n... and ${fileList.length - 10} more` : ''), inline: false }
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
            fileList,
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

// Execute commit via GitHub API
async function executeCommit(interaction, commitData) {
    try {
        await interaction.editReply({ content: 'Reading files...', embeds: [], components: [] });

        // Read all files and prepare for batch commit
        const filesToCommit = [];
        for (const f of commitData.fileList) {
            try {
                const content = await fs.readFile(f, 'utf8');
                filesToCommit.push({ path: f, content });
            } catch (e) {
                await interaction.editReply(`Error reading ${f}: ${e.message}`);
                return;
            }
        }

        await interaction.editReply('Committing to GitHub...');

        // Commit all files via GitHub API
        const result = await commitFilesViaAPI(filesToCommit, commitData.message, 'main');

        if (!result.success) {
            throw new Error(result.error);
        }

        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes pushed! Site will update in 1-2 minutes.')
            .addFields(
                { name: 'Commit Message', value: commitData.message, inline: false },
                { name: 'Commit Hash', value: result.shortSha, inline: true },
                { name: 'Files Changed', value: result.filesCommitted.toString(), inline: true },
                { name: 'Deployment', value: '⏳ Deploying... (1-2 min)', inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        // Add repository link if URL is available
        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Changes](${process.env.GITHUB_REPO_URL}/commit/${result.sha})`,
                inline: false
            });
        }

        await safeEditReply(interaction, { content: '', embeds: [embed] });

    } catch (error) {
        console.error('Commit execution error:', error);

        let errorMessage = getBotResponse('errors');
        if (error.message.includes('authentication') || error.message.includes('401')) {
            errorMessage += ' Authentication issue with GitHub.';
        } else if (error.message.includes('404')) {
            errorMessage += ' File not found on GitHub.';
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

                // Note: With GitHub API commits, there's nothing local to discard
                const discardEmbed = new EmbedBuilder()
                    .setTitle('🗑️ Commit Cancelled')
                    .setDescription('Changes were not committed. Here was the AI response:')
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

        // Split long search results instead of truncating
        const header = `**Search: "${query}"**\n\n`;
        const fullMessage = header + searchResult;
        
        if (fullMessage.length > 2000) {
            const maxLength = 1950;
            const parts = [];
            let remaining = searchResult; // Don't include header in remaining
            
            // First part includes the header
            const firstPartMaxLength = maxLength - header.length;
            if (remaining.length <= firstPartMaxLength) {
                parts.push(header + remaining);
            } else {
                // Find natural break point for first part
                let splitIndex = remaining.lastIndexOf('\n', firstPartMaxLength);
                if (splitIndex === -1 || splitIndex < firstPartMaxLength * 0.5) {
                    splitIndex = remaining.lastIndexOf(' ', firstPartMaxLength);
                }
                if (splitIndex === -1 || splitIndex < firstPartMaxLength * 0.5) {
                    splitIndex = firstPartMaxLength;
                }
                
                parts.push(header + remaining.substring(0, splitIndex));
                remaining = remaining.substring(splitIndex).trim();
                
                // Split remaining parts
                while (remaining.length > 0) {
                    if (remaining.length <= maxLength) {
                        parts.push(remaining);
                        break;
                    }
                    
                    let splitIndex = remaining.lastIndexOf('\n', maxLength);
                    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
                        splitIndex = remaining.lastIndexOf(' ', maxLength);
                    }
                    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
                        splitIndex = maxLength;
                    }
                    
                    parts.push(remaining.substring(0, splitIndex));
                    remaining = remaining.substring(splitIndex).trim();
                }
            }
            
            // Send first part as reply
            await interaction.editReply(parts[0]);
            
            // Send remaining parts as follow-ups
            for (let i = 1; i < parts.length; i++) {
                await interaction.followUp(parts[i]);
            }
        } else {
            // Response is short enough, send normally
            await interaction.editReply(fullMessage);
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
            'glm': 'GLM-4.6 Exacto',
            'kimi': 'Kimi K2 Thinking',
            'kimi-fast': 'Kimi K2 Fast',
            'sonnet': 'Claude Sonnet 4.5',
            'qwen': 'Qwen 3 Coder',
            'gemini': 'Gemini 2.5 Pro',
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
        const owner = process.env.GITHUB_REPO_OWNER;
        const repo = process.env.GITHUB_REPO_NAME;

        // Fetch repo info and recent commits from GitHub API
        const [repoData, commitsData] = await Promise.all([
            octokit.repos.get({ owner, repo }),
            octokit.repos.listCommits({ owner, repo, per_page: 5 })
        ]);

        const repoInfo = repoData.data;
        const commits = commitsData.data;

        // Format recent commits
        const recentCommits = commits.slice(0, 5).map(c =>
            `\`${c.sha.substring(0, 7)}\` ${c.commit.message.split('\n')[0].substring(0, 50)}`
        ).join('\n');

        const embed = new EmbedBuilder()
            .setTitle('📊 Repository Status')
            .setDescription(`**${repoInfo.full_name}**`)
            .addFields(
                { name: 'Branch', value: repoInfo.default_branch || 'main', inline: true },
                { name: 'Total Commits', value: commits.length > 0 ? '✓' : '0', inline: true },
                { name: 'Visibility', value: repoInfo.private ? '🔒 Private' : '🌐 Public', inline: true },
                { name: 'Recent Commits', value: recentCommits || 'No commits yet', inline: false },
                { name: 'Live Site', value: 'https://bot.inference-arcade.com/', inline: false },
                { name: 'Repository', value: `[View on GitHub](${repoInfo.html_url})`, inline: false }
            )
            .setColor(0x3498db)
            .setTimestamp();

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

// Handle mention-triggered commits via GitHub API
async function executeMentionCommit(interaction, commitData) {
    try {
        await interaction.editReply({ content: 'Reading files...', embeds: [], components: [] });

        // Require explicit file list
        if (!commitData.files || commitData.files.length === 0) {
            await interaction.editReply('No files specified for commit.');
            return;
        }

        // Read file contents
        const filesToCommit = [];
        for (const filePath of commitData.files) {
            try {
                const content = await fs.readFile(filePath, 'utf8');
                filesToCommit.push({ path: filePath, content });
            } catch (e) {
                console.warn(`Could not read ${filePath}: ${e.message}`);
            }
        }

        if (filesToCommit.length === 0) {
            await interaction.editReply('Could not read any files to commit.');
            return;
        }

        await interaction.editReply('Committing to GitHub...');

        const commitMessage = `ai changes: ${commitData.originalContent.substring(0, 50)}${commitData.originalContent.length > 50 ? '...' : ''}`;
        const result = await commitFilesViaAPI(filesToCommit, commitMessage, 'main');

        if (!result.success) {
            throw new Error(result.error);
        }

        const embed = new EmbedBuilder()
            .setTitle('🚀 AI Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** AI-generated changes are now live!')
            .addFields(
                { name: 'Commit Message', value: commitMessage, inline: false },
                { name: 'Commit Hash', value: result.shortSha, inline: true },
                { name: 'Files Changed', value: result.filesCommitted.toString(), inline: true },
                { name: 'Live Site', value: '[View Changes](https://bot.inference-arcade.com/)', inline: false }
            )
            .setColor(0x7dd3a0)
            .setTimestamp();

        if (process.env.GITHUB_REPO_URL) {
            embed.addFields({
                name: 'Repository',
                value: `[View Commit](${process.env.GITHUB_REPO_URL}/commit/${result.sha})`,
                inline: false
            });
        }

        await safeEditReply(interaction, { content: '', embeds: [embed] });

    } catch (error) {
        console.error('Mention commit error:', error);
        let errorMessage = getBotResponse('errors');
        if (error.message.includes('401')) {
            errorMessage += ' Authentication issue with GitHub.';
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

        // stylePresets imported from ./styles/presets at top of file

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

        // Write the new CSS to style.css locally
        await fs.writeFile('./style.css', newCSS);

        // Commit and push via GitHub API
        const commitMessage = `update style to ${preset === 'custom' ? 'custom: ' + customDescription.substring(0, 50) : preset}`;
        const result = await pushFileViaAPI('./style.css', newCSS, commitMessage, 'main');

        const embed = new EmbedBuilder()
            .setTitle('🎨 Style Updated & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes pushed! Site will update in 1-2 minutes.')
            .addFields(
                { name: 'Style', value: preset === 'custom' ? 'Custom AI-generated' : preset, inline: true },
                { name: 'Commit', value: result ? result.substring(0, 7) : 'pushed', inline: true },
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
