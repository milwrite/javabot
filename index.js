require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

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
console.log('✅ All required environment variables loaded');

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
    AGENTS_UPDATE_DELAY: 5000
};

// Error tracking to prevent loops
const errorTracker = new Map();
const MAX_ERROR_COUNT = 3;
const ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes

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
const AGENTS_FILE = './agents.md';

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

// Git operation wrapper with timeout
async function gitWithTimeout(operation, timeoutMs = CONFIG.GIT_TIMEOUT) {
    return Promise.race([
        operation(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Git operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
}

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
let MODEL = 'anthropic/claude-haiku-4.5'; // Default to latest Haiku

// Available models (2025 latest)
const MODEL_PRESETS = {
    'haiku': 'anthropic/claude-haiku-4.5',
    'sonnet': 'anthropic/claude-sonnet-4.5',
    'kimi': 'moonshotai/kimi-k2-thinking',
    'gpt5': 'openai/gpt-5-nano',
    'gemini': 'google/gemini-2.5-flash-lite-preview-09-2025'
};

// Bot system prompt with enhanced capabilities
// Default system prompt - can be modified at runtime
const DEFAULT_SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with web development projects. You're helpful but a little spacey, like Doc Sportello - generally competent but sometimes distracted, speaking in a relaxed, slightly rambling way.

REPOSITORY CONTEXT:
Repository: https://github.com/milwrite/javabot/
Live Site: https://milwrite.github.io/javabot/
- You can commit, push, and manage files
- /src directory contains web pages and JS libraries
- You help create, edit, and deploy web projects via Discord commands
- When sharing pages, always link to the live site at https://milwrite.github.io/javabot/

ARCADE THEME DESIGN SYSTEM:

Color Palette:
- Primary: #7dd3a0 (mint green) - main accent color
- Dark backgrounds: #1a1d23, #252a32, #1d2228
- Borders: #5a9d7a (darker green)
- Text: #95c9ad (lighter green for body text)
- Font: 'Press Start 2P' from Google Fonts (retro pixel aesthetic)

Available CSS Classes (page-theme.css):

LAYOUT: .container, .content, .main-content, .header, .footer, .sidebar, .sidebar-section, .input-section, .todos-section, .filter-section, .card, .panel

TYPOGRAPHY: h1 (2em), h2 (1.4em), h3 (1em), p (0.7em), .subtitle, .message, .date-display

BUTTONS: .btn, .btn-primary (mint green), .btn-secondary, .btn-yes (green), .btn-no (red), .btn-reset (orange), .btn-add (green), .btn-delete (red), .btn-clear-completed (orange), .filter-btn, .weekend-btn, .difficulty-btn, .control-btn, .mobile-btn, .number-btn

FORMS: input, textarea, select, .input-group, .form-group, .add-task-form, .priority-select, .slider-group, .slider-header, .slider-value, .servings-control

LISTS: .todos-list, .task-list, .todo-item, .task-item, .task-content, .task-title, .task-description, .task-checkbox, .task-actions, .ingredient-item, .step-item, .step-number, .step-content

STATS: .stats, .stats-grid, .stat-box, .stat-card, .stat-number, .stat-value, .stat-label, .progress-bar, .progress-fill, .nutrition-grid

BADGES: .priority-badge, .priority-low, .priority-medium, .priority-high, .category-badge, .time-badge, .conflict

MODALS: .modal, .modal-content, .modal-header, .close-btn, .notification, .empty-state, .game-over-modal

GAMES: .game-wrapper, .game-container, .sudoku-grid, .cell, .cell.selected, .cell.given, .number-pad, .mobile-controls, canvas

POETRY: .poem, .stanza, .radish-icon, .interactive-section, .radish-garden, .radish-item, .signature, .floating-radish

TIMELINE: .timeline, .timeline-section, .timeline-header, .hour-slot, .time-slot, .hour-label, .time-indicator, .empty-slot, .tasks-container

VISUALIZATION: .visualization, .sub-container, .sub, .bread, .meat, .veggie, .parlay-leg, .probability-bar, .summary-card

UTILITY: .text-center, .mt-1/2/3, .mb-1/2/3, .p-1/2/3, .fade-in, .pulse

MOBILE: All pages MUST be responsive. Breakpoints at 768px and 480px. Touch targets minimum 44px. Body must have overflow-x/y: auto.

FONT GUIDELINES: h1 (2em), h2 (1.4em), h3 (1em), body (0.7em min), buttons (0.7em), labels (0.6em), Press Start 2P font required.

WHEN CREATING PAGES:
1. Link to ../page-theme.css
2. Include Google Fonts for Press Start 2P
3. Add .home-link navigation
4. Use .container for main content
5. Apply existing CSS classes (avoid custom styles)
6. Ensure mobile viewport meta tag
7. Keep arcade color scheme (mint green #7dd3a0)

AVAILABLE CAPABILITIES:
- list_files(path): List files in directory
- read_file(path): Read file contents
- write_file(path, content): Create/update files
- edit_file(path, instructions): Edit files with natural language
- web_search(query): Search internet for current info

WHEN TO USE WEB SEARCH:
- Current events, news, recent information
- Latest documentation, library versions, API changes
- Questions about "latest", "recent", "current", "now"

Personality: Casual, chill, slightly unfocused but helpful. SHORT responses (1-2 sentences). Use "yeah man", "right on". Call people "man", "dude".

IMPORTANT: Do not prefix your responses with "Bot Sportello:" - just respond naturally as Bot Sportello. Always mention the live site URL (https://milwrite.github.io/javabot/) before making changes to give users context.

Be concise and helpful. Remember conversations from agents.md.`;

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

// Clean Bot Sportello name duplication from AI responses
function cleanBotResponse(response) {
    // Remove "Bot Sportello:" prefix patterns
    return response.replace(/^Bot Sportello:\s*/i, '').replace(/Bot Sportello:\s*Bot Sportello:\s*/gi, '');
}

// Efficient logging system - only log important events
function logEvent(type, message, details = null) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${type}: ${message}`);
    if (details && process.env.NODE_ENV === 'development') {
        console.log(details);
    }
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
        const homeLink = `<a href="../index.html" class="home-link">← HOME</a>`;
        return htmlContent.replace(/<body([^>]*)>/, `<body$1>\n    ${homeLink}`);
    }
    return htmlContent;
}

function ensureStylesheetInHTML(htmlContent) {
    // Check if page-theme.css is already linked
    if (!htmlContent.includes('page-theme.css')) {
        const stylesheetLinks = `
    <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="../page-theme.css">`;

        // Insert before closing </head> tag
        if (htmlContent.includes('</head>')) {
            return htmlContent.replace('</head>', `${stylesheetLinks}\n</head>`);
        }
    }
    return htmlContent;
}

// Message history and agents.md management
let agentsFileUpdateTimer = null;

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

    // Debounce file writes to prevent excessive I/O
    if (agentsFileUpdateTimer) {
        clearTimeout(agentsFileUpdateTimer);
    }
    agentsFileUpdateTimer = setTimeout(() => {
        updateAgentsFile().catch(err => logEvent('ERROR', 'Failed to update agents file', err));
    }, CONFIG.AGENTS_UPDATE_DELAY);
}

async function summarizeConversation(messages) {
    try {
        // Build conversation text
        const conversationText = messages.map(m => {
            const speaker = m.isBot ? 'Bot Sportello' : m.username;
            return `${speaker}: ${m.message}`;
        }).join('\n');

        const summaryPrompt = `Summarize this Discord conversation into concise bullet points. Focus on:
- Projects created or discussed
- User requests and preferences
- Technical questions asked
- Important context for future conversations

Conversation:
${conversationText}

Return 3-5 bullet points maximum.`;

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: summaryPrompt }],
            max_tokens: 500,
            temperature: 0.3
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Summarization failed:', error.message);
        return null;
    }
}

async function updateAgentsFile() {
    if (messageHistory.length === 0) return;

    try {
        let content = '# Bot Sportello Memory\n\n';
        content += `Last updated: ${new Date().toISOString()}\n\n`;

        // Keep last 15 messages verbatim for immediate context
        const recentCount = 15;
        const recentMessages = messageHistory.slice(-recentCount);
        const olderMessages = messageHistory.slice(0, -recentCount);

        // Summarize older messages if there are enough
        if (olderMessages.length > 10) {
            content += '## Conversation Summary\n\n';
            const summary = await summarizeConversation(olderMessages);
            if (summary) {
                content += summary + '\n\n';
            }
        }

        content += '## Recent Messages\n\n';
        recentMessages.forEach(entry => {
            const speaker = entry.isBot ? '**Bot Sportello**' : `**${entry.username}**`;
            // Handle both Date.now() timestamps and ISO strings
            const time = typeof entry.timestamp === 'number' 
                ? new Date(entry.timestamp).toISOString().split('T')[1].split('.')[0]
                : entry.timestamp.split('T')[1].split('.')[0];
            content += `${speaker} [${time}]: ${entry.message}\n\n`;
        });

        content += '## Active Context\n\n';
        const users = [...new Set(messageHistory.filter(e => !e.isBot).map(e => e.username))];
        content += `**Users**: ${users.join(', ')}\n`;
        content += `**Total messages tracked**: ${messageHistory.length}\n`;

        await fs.writeFile(AGENTS_FILE, content, 'utf8');
    } catch (error) {
        logEvent('ERROR', 'Failed to update agents.md', error);
    }
}

async function readAgentsFile() {
    try {
        const content = await fs.readFile(AGENTS_FILE, 'utf8');
        return content;
    } catch (error) {
        // File doesn't exist yet, return empty string
        return '';
    }
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

// Filesystem tools for the AI
async function listFiles(dirPath = './src') {
    try {
        const files = await fs.readdir(dirPath);
        return files.join(', ');
    } catch (error) {
        return `Error listing files: ${error.message}`;
    }
}

async function readFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return content.substring(0, CONFIG.FILE_READ_LIMIT);
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
        return `File written successfully: ${filePath} (${content.length} bytes)`;
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

async function editFile(filePath, instructions) {
    console.log(`[EDIT_FILE] Starting edit for: ${filePath}`);
    try {
        // Read the current file content
        const currentContent = await fs.readFile(filePath, 'utf-8');

        // Use AI to make the edit based on instructions
        const editPrompt = `You are editing a file: ${filePath}

Current file content:
\`\`\`
${currentContent}
\`\`\`

User instructions: ${instructions}

Return ONLY the complete updated file content. No explanations, no markdown code blocks, just the raw file content.`;

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: editPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let updatedContent = response.data.choices[0].message.content;

        // Clean markdown code blocks if present
        const extension = path.extname(filePath).substring(1);
        updatedContent = cleanMarkdownCodeBlocks(updatedContent, extension);

        // Write the updated content
        await fs.writeFile(filePath, updatedContent, 'utf8');

        console.log(`[EDIT_FILE] Success: ${filePath}`);
        return `File edited successfully: ${filePath}. Changes applied: ${instructions}`;
    } catch (error) {
        console.error(`[EDIT_FILE] Error:`, error.message);
        return `Error editing file: ${error.message}`;
    }
}

// Helper function to pick emoji based on description
function getIconForDescription(description) {
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

// Helper function to update projectmetadata.json with new page
async function updateIndexWithPage(pageName, description) {
    try {
        const metadataPath = './projectmetadata.json';
        const icon = getIconForDescription(description);

        // Read existing metadata
        let metadata = {};
        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(content);
        } catch (error) {
            // If file doesn't exist, start with empty object
            console.log('Creating new projectmetadata.json file');
        }

        // Check if page already exists
        if (metadata[pageName]) {
            console.log(`Page ${pageName} already exists in metadata`);
            return `Page ${pageName} already in metadata`;
        }

        // Add new page
        metadata[pageName] = {
            icon: icon,
            description: description
        };

        // Write updated metadata
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

        // Read all HTML files in src directory
        const srcFiles = await fs.readdir('./src');
        const htmlFiles = srcFiles.filter(file => file.endsWith('.html'));

        console.log(`Found ${htmlFiles.length} HTML files in /src`);

        // Read current metadata
        const metadataPath = './projectmetadata.json';
        let metadata = {};
        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            metadata = JSON.parse(content);
        } catch (error) {
            console.log('No existing metadata file, creating new one');
        }

        const existingPages = new Set(Object.keys(metadata));

        // Find missing pages
        const missingPages = [];
        for (const htmlFile of htmlFiles) {
            const pageName = htmlFile.replace('.html', '');
            if (!existingPages.has(pageName)) {
                missingPages.push(pageName);
            }
        }

        if (missingPages.length === 0) {
            console.log('✅ All pages are already in projectmetadata.json');
            return;
        }

        console.log(`📝 Adding ${missingPages.length} missing pages: ${missingPages.join(', ')}`);

        // Add missing pages with default metadata
        for (const pageName of missingPages) {
            const icon = getIconForDescription(pageName);
            const description = `${pageName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;

            await updateIndexWithPage(pageName, description);
        }

        console.log('✅ Metadata sync complete!');

    } catch (error) {
        console.error('Error syncing projectmetadata.json:', error);
    }
}

// Tool functions that AI can call via @ mentions
async function createPage(name, description) {
    console.log(`[CREATE_PAGE] Starting: ${name}`);
    try {
        const webPrompt = `Build "${name}": ${description}

Output a single HTML file with embedded CSS and JavaScript. Requirements:
- Fully functional and interactive
- Modern, attractive styling
- Vanilla JS (CDN libraries allowed)
- Creative implementation
- Include: <a href="../index.html" style="position:fixed;top:20px;left:20px;z-index:9999;text-decoration:none;background:rgba(102,126,234,0.9);color:white;padding:10px 20px;border-radius:25px;box-shadow:0 4px 10px rgba(0,0,0,0.2)">← Home</a> after <body>

Return only HTML, no markdown blocks or explanations.`;

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: webPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let htmlContent = response.data.choices[0].message.content;
        htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
        htmlContent = ensureStylesheetInHTML(htmlContent);
        htmlContent = ensureHomeLinkInHTML(htmlContent);

        const fileName = `src/${name}.html`;
        await fs.mkdir('src', { recursive: true });
        await fs.writeFile(fileName, htmlContent);

        // Update index.html
        await updateIndexWithPage(name, description);

        console.log(`[CREATE_PAGE] Success: ${fileName}`);
        return `Created ${fileName} and updated index.html. Live at: https://milwrite.github.io/javabot/src/${name}.html`;
    } catch (error) {
        console.error(`[CREATE_PAGE] Error:`, error.message);
        return `Error creating page: ${error.message}`;
    }
}

async function createFeature(name, description) {
    console.log(`[CREATE_FEATURE] Starting: ${name}`);
    try {
        // Generate JS feature/library/component
        const jsPrompt = `Create a JavaScript feature called "${name}".
Description: ${description}

Output clean, well-documented JavaScript with:
- Pure functions or component code (minimal dependencies)
- JSDoc comments for functions/methods
- Export as module or global object
- Practical, reusable implementation
- Handle edge cases and provide good defaults

Return only JavaScript code, no markdown blocks or explanations.`;

        const jsResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: jsPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let jsContent = jsResponse.data.choices[0].message.content;
        jsContent = cleanMarkdownCodeBlocks(jsContent, 'javascript');

        // Generate demo HTML
        const htmlPrompt = `Create an interactive demo page for "${name}" JavaScript feature.
Feature description: ${description}

Output a single HTML file that:
- Loads ${name}.js via <script src="${name}.js"></script>
- Provides interactive examples showing all capabilities
- Modern, polished UI with embedded CSS
- Clear documentation/instructions for users
- Include: <a href="../index.html" style="position:fixed;top:20px;left:20px;z-index:9999;text-decoration:none;background:rgba(102,126,234,0.9);color:white;padding:10px 20px;border-radius:25px;box-shadow:0 4px 10px rgba(0,0,0,0.2)">← Home</a> after <body>

Return only HTML code, no markdown blocks or explanations.`;

        const htmlResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: htmlPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let htmlContent = htmlResponse.data.choices[0].message.content;
        htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
        htmlContent = ensureStylesheetInHTML(htmlContent);
        htmlContent = ensureHomeLinkInHTML(htmlContent);

        await fs.mkdir('src', { recursive: true });
        const jsFileName = `src/${name}.js`;
        const htmlFileName = `src/${name}.html`;
        await fs.writeFile(jsFileName, jsContent);
        await fs.writeFile(htmlFileName, htmlContent);

        // Update index.html
        await updateIndexWithPage(name, description);

        console.log(`[CREATE_FEATURE] Success: ${jsFileName}, ${htmlFileName}`);
        return `Created ${jsFileName} and ${htmlFileName}, updated index.html. Live demo: https://milwrite.github.io/javabot/src/${name}.html`;
    } catch (error) {
        console.error(`[CREATE_FEATURE] Error:`, error.message);
        return `Error creating feature: ${error.message}`;
    }
}

async function commitChanges(message, files = '.') {
    console.log(`[COMMIT] Starting: "${message}"`);
    try {
        const status = await gitWithTimeout(() => git.status());

        console.log(`[COMMIT] Status:`, {
            branch: status.current,
            filesChanged: status.files.length
        });

        if (status.files.length === 0) {
            console.log('[COMMIT] No changes to commit');
            return 'Nothing to commit';
        }

        console.log('[COMMIT] Staging files...');
        if (files === '.') {
            await gitWithTimeout(() => git.add('.'));
        } else {
            const fileList = files.split(',').map(f => f.trim());
            await gitWithTimeout(() => git.add(fileList));
        }

        console.log('[COMMIT] Creating commit...');
        const commit = await gitWithTimeout(() => git.commit(message));

        console.log('[COMMIT] Pushing to remote...');
        const currentBranch = status.current || 'main';
        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);

        console.log(`[COMMIT] Success: ${commit.commit.substring(0, 7)}`);
        return `Committed and pushed: ${commit.commit.substring(0, 7)} - ${message}`;
    } catch (error) {
        console.error('[COMMIT] Error:', error.message);
        return `Error committing: ${error.message}`;
    }
}

async function getRepoStatus() {
    try {
        const status = await git.status();
        let result = `Branch: ${status.current}\n`;
        result += `Modified: ${status.modified.length}, New: ${status.not_added.length}\n`;
        result += `Live site: https://milwrite.github.io/javabot/\n`;
        if (status.files.length > 0) {
            result += `Changed files: ${status.files.slice(0, 5).map(f => f.path).join(', ')}`;
        }
        return result;
    } catch (error) {
        return `Error getting status: ${error.message}`;
    }
}

// Web search via OpenRouter
async function webSearch(query) {
    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [
                {
                    role: 'user',
                    content: `Search the web for: ${query}\n\nProvide a concise summary of current, relevant information.`
                }
            ],
            max_tokens: 2000,
            temperature: 0.5,
            // Enable web search if OpenRouter supports it
            tools: [{
                type: 'web_search',
                enabled: true
            }]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });

        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Web search error:', error.response?.data || error.message);
        return 'Search unavailable right now, man.';
    }
}

// Enhanced LLM response with tool calling
async function getLLMResponse(userMessage, conversationMessages = []) {
    try {
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
                            path: { type: 'string', description: 'Directory path (default: ./src)' }
                        }
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
                            path: { type: 'string', description: 'File path to read' }
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
                    description: 'Edit an existing file based on natural language instructions. Use this when you need to modify part of a file rather than rewriting it completely. The AI will read the file, apply your changes intelligently, and save it. Perfect for: changing colors, fixing bugs, adding features, updating text, modifying functions.',
                    parameters: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'File path to edit (e.g., "src/example.html", "index.html", "style.css")' },
                            instructions: { type: 'string', description: 'Natural language instructions for what to change (e.g., "change the background color to blue", "add a new function called calculateTotal that adds two numbers", "fix the syntax error", "make the buttons bigger")' }
                        },
                        required: ['path', 'instructions']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_page',
                    description: 'Create a new HTML page/app in /src directory with AI-generated code. Automatically updates index.html.',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Page name (filename without .html)' },
                            description: { type: 'string', description: 'What the page should do' }
                        },
                        required: ['name', 'description']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'create_feature',
                    description: 'Create a JavaScript feature (library, component, utility, interactive element) with demo page in /src directory. Automatically updates index.html.',
                    parameters: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Feature name (filename without extension)' },
                            description: { type: 'string', description: 'What the feature should do - functions, behavior, capabilities' }
                        },
                        required: ['name', 'description']
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
            }
        ];

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

        const assistantMessage = response.data.choices[0].message;

        // Check if the model wants to use tools
        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            const toolResults = [];

            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const args = JSON.parse(toolCall.function.arguments || '{}');

                let result;
                if (functionName === 'list_files') {
                    result = await listFiles(args.path || './src');
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'write_file') {
                    result = await writeFile(args.path, args.content);
                } else if (functionName === 'edit_file') {
                    result = await editFile(args.path, args.instructions);
                } else if (functionName === 'create_page') {
                    result = await createPage(args.name, args.description);
                } else if (functionName === 'create_feature') {
                    result = await createFeature(args.name, args.description);
                } else if (functionName === 'commit_changes') {
                    result = await commitChanges(args.message, args.files);
                } else if (functionName === 'get_repo_status') {
                    result = await getRepoStatus();
                } else if (functionName === 'web_search') {
                    result = await webSearch(args.query);
                }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result
                });
            }

            // Send tool results back to the model
            messages.push(assistantMessage);
            messages.push(...toolResults);

            const finalResponse = await axios.post(OPENROUTER_URL, {
                model: MODEL,
                messages: messages,
                max_tokens: 10000,
                temperature: 0.7
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 45000
            });

            return finalResponse.data.choices[0].message.content;
        }

        return assistantMessage.content;
    } catch (error) {
        console.error('LLM Error:', error.response?.data || error.message);
        return getBotResponse('errors');
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
        .setName('add-page')
        .setDescription('Create a new web page/app')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Page name (will be the filename)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('What should this page do?')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('add-feature')
        .setDescription('Create a feature: JS library, component, or interactive element with demo')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Feature name (e.g., slider, utils, carousel)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('What should this feature do? Describe functions, behavior, or capabilities')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check repository status'),
        
        
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Have a conversation with Bot Sportello')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('What would you like to talk about?')
                .setRequired(true)),

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
                .setDescription('Model to use')
                .setRequired(true)
                .addChoices(
                    { name: 'Claude Haiku 4.5 (Fast, Cheap)', value: 'haiku' },
                    { name: 'Claude Sonnet 4.5 (Balanced)', value: 'sonnet' },
                    { name: 'Kimi K2 Thinking (Reasoning)', value: 'kimi' },
                    { name: 'GPT-5 Nano (Latest OpenAI)', value: 'gpt5' },
                    { name: 'Gemini 2.5 Flash Lite (Google)', value: 'gemini' }
                )),

    new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Quick yes/no poll with thumbs up/down')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Question to ask')
                .setRequired(true)),

    new SlashCommandBuilder()
        .setName('update-style')
        .setDescription('Update the website styling/theme')
        .addStringOption(option =>
            option.setName('preset')
                .setDescription('Choose a style preset or describe a custom style')
                .setRequired(true)
                .addChoices(
                    { name: 'Soft Arcade (Current)', value: 'soft-arcade' },
                    { name: 'Neon Arcade (Intense)', value: 'neon-arcade' },
                    { name: 'Dark Minimal', value: 'dark-minimal' },
                    { name: 'Retro Terminal', value: 'retro-terminal' },
                    { name: 'Custom (AI-generated)', value: 'custom' }
                ))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('For custom style: describe what you want')
                .setRequired(false)),

    new SlashCommandBuilder()
        .setName('sync-index')
        .setDescription('Sync index.html with all HTML files in /src directory'),

    new SlashCommandBuilder()
        .setName('set-prompt')
        .setDescription('Modify Bot Sportello\'s system prompt/personality')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('What do you want to do?')
                .setRequired(true)
                .addChoices(
                    { name: 'View current prompt', value: 'view' },
                    { name: 'Reset to default', value: 'reset' },
                    { name: 'Add instruction', value: 'add' },
                    { name: 'Replace entire prompt', value: 'replace' }
                ))
        .addStringOption(option =>
            option.setName('content')
                .setDescription('New prompt content or instruction to add')
                .setRequired(false))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
    console.log(`Bot is ready as ${client.user.tag}`);
    console.log(`Monitoring channels: ${CHANNEL_IDS.length > 0 ? CHANNEL_IDS.join(', ') : 'ALL CHANNELS'}`);
    console.log(`Message Content Intent enabled: ${client.options.intents.has(GatewayIntentBits.MessageContent)}`);

    try {
        console.log('Refreshing slash commands...');
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );
        console.log('Slash commands registered successfully.');
    } catch (error) {
        console.error('Error registering slash commands:', error);
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
            case 'add-page':
                await handleAddPage(interaction);
                break;
            case 'add-feature':
                await handleAddFeature(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
            case 'chat':
                await handleChat(interaction);
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
            case 'update-style':
                await handleUpdateStyle(interaction);
                break;
            case 'sync-index':
                await handleSyncIndex(interaction);
                break;
            case 'set-prompt':
                await handleSetPrompt(interaction);
                break;
            default:
                const unknownMsg = "Unknown command. Try /status to see available commands.";
                if (interaction.deferred) {
                    await interaction.editReply(unknownMsg);
                } else {
                    await interaction.reply({ content: unknownMsg, ephemeral: true });
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
                await interaction.reply({ content: errorMsg, ephemeral: true });
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
    // Ignore bot messages (including our own)
    if (message.author.bot) {
        return;
    }

    // Only track messages from designated channels (if CHANNEL_IDS is configured)
    if (CHANNEL_IDS.length > 0 && !CHANNEL_IDS.includes(message.channel.id)) {
        return;
    }

    // Add message to conversation history
    console.log(`[TRACKING] ${message.author.username} in #${message.channel.name || message.channel.id}: ${message.content.substring(0, 100)}`);
    addToHistory(message.author.username, message.content, false);

    // Handle @ mentions with full AI capabilities
    if (message.mentions.has(client.user)) {
        // Don't block - handle async
        handleMentionAsync(message).catch(error => {
            console.error('Async mention handler error:', error);
        });
    }
});

// Track processed mentions to prevent duplicates
const processedMentions = new Set();

// Async mention handler to prevent blocking
async function handleMentionAsync(message) {
    try {
        // Prevent duplicate processing of the same message
        if (processedMentions.has(message.id)) {
            console.log(`[MENTION] Skipping duplicate message ${message.id}`);
            return;
        }
        processedMentions.add(message.id);

        // Clean up old message IDs (keep last 100)
        if (processedMentions.size > 100) {
            const toDelete = Array.from(processedMentions).slice(0, 50);
            toDelete.forEach(id => processedMentions.delete(id));
        }

        const content = message.content.replace(/<@!?\d+>/g, '').trim();
        const username = message.author.username;

        logEvent('MENTION', `${username}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

        // Send thinking message
        let thinkingMsg = await message.reply(getBotResponse('thinking'));

        // Build conversation context
        const conversationMessages = buildMessagesFromHistory(50);

        // Get AI response with full tool calling capabilities
        let response = await getLLMResponse(content, conversationMessages);
        
        // Clean duplicate Bot Sportello prefixes
        response = cleanBotResponse(response);

        // Add to history
        addToHistory(username, content, false);
        addToHistory('Bot Sportello', response, true);

        // Check for local git changes after AI response (with timeout protection)
        let gitStatus;
        try {
            gitStatus = await gitWithTimeout(() => git.status(), 5000);
        } catch (error) {
            logEvent('GIT', `Skipping git status check: ${error.message}`);
            gitStatus = { files: [] }; // Empty status to skip commit prompt
        }
        
        if (gitStatus.files.length > 0) {
            // AI made local changes - show commit confirmation
            const commitEmbed = new EmbedBuilder()
                .setTitle('🔧 Local Changes Made')
                .setDescription(`The AI made changes to **${gitStatus.files.length} file(s)**. Would you like to commit and push these changes?`)
                .addFields(
                    { name: 'Changed Files', value: gitStatus.files.slice(0, 10).map(f => `• ${f.path}`).join('\n') + (gitStatus.files.length > 10 ? `\n... and ${gitStatus.files.length - 10} more` : ''), inline: false },
                    { name: 'AI Response', value: response.length > 1000 ? response.substring(0, 1000) + '...' : response, inline: false }
                )
                .setColor(0x7dd3a0) // Mint green
                .setTimestamp();

            // Create commit buttons
            const commitRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`mention_commit_${message.author.id}`)
                        .setLabel('✅ Commit & Push Changes')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`mention_discard_${message.author.id}`)
                        .setLabel('❌ Discard Changes')
                        .setStyle(ButtonStyle.Danger)
                );

            await thinkingMsg.edit({ 
                content: '', 
                embeds: [commitEmbed], 
                components: [commitRow] 
            });

            // Store mention commit data
            if (!global.mentionCommitData) global.mentionCommitData = new Map();
            global.mentionCommitData.set(message.author.id, {
                status: gitStatus,
                response: response,
                messageId: thinkingMsg.id,
                originalContent: content,
                username: username
            });

            // Set timeout to clean up pending data
            setTimeout(() => {
                global.mentionCommitData?.delete(message.author.id);
            }, 300000); // 5 minutes

        } else {
            // No local changes - just send the response normally
            if (response.length > 2000) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const fileName = `responses/mention-${timestamp}.txt`;

                await fs.mkdir('responses', { recursive: true });
                const fileContent = `User: ${username}\nMessage: ${content}\nTimestamp: ${new Date().toISOString()}\n\n---\n\n${response}`;
                await fs.writeFile(fileName, fileContent);

                const truncated = response.substring(0, 1800);
                await thinkingMsg.edit(`${truncated}...\n\n*[Full response saved to \`${fileName}\`]*`);
            } else {
                await thinkingMsg.edit(response);
            }
        }

    } catch (error) {
        console.error('Mention handler error:', error);
        const errorDetails = error.response?.data || error.message || 'Unknown error';
        console.error('Error details:', errorDetails);

        try {
            // Try to send error message
            const errorMsg = `${getBotResponse('errors')}\n\n*Error: ${error.message?.substring(0, 100)}*`;
            await message.reply(errorMsg);
        } catch (replyError) {
            console.error('Failed to send error reply:', replyError);
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
        
        // Configure git remote with token authentication (only if needed)
        try {
            const remotes = await git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            if (!origin || !origin.refs.push.includes(process.env.GITHUB_TOKEN)) {
                const remoteUrl = `https://${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}.git`;
                await git.remote(['set-url', 'origin', remoteUrl]);
            }
        } catch (remoteError) {
            console.warn('Remote URL setup warning:', remoteError.message);
        }
        
        // Push changes - use current branch
        const currentBranch = commitData.status.current || 'main';
        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes are live on GitHub. If you modified HTML/CSS, GitHub Pages will deploy in 1-2 minutes.')
            .addFields(
                { name: 'Commit Message', value: commitData.message, inline: false },
                { name: 'Commit Hash', value: commit.commit.substring(0, 7), inline: true },
                { name: 'Files Changed', value: commitData.status.files.length.toString(), inline: true },
                { name: 'Deployment', value: '⏳ Deploying to GitHub Pages... (1-2 min)', inline: false }
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
        
        await interaction.editReply({ content: '', embeds: [embed] });
        
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
        await interaction.reply({ content: 'You can only interact with your own buttons.', ephemeral: true });
        return;
    }
    
    try {
        if (action === 'commit') {
            if (type === 'confirm') {
                // Get stored commit data
                const commitData = global.commitPendingData?.get(interaction.user.id);
                if (!commitData) {
                    await interaction.reply({ content: 'Commit data expired. Please run the command again.', ephemeral: true });
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
                    await interaction.reply({ content: 'Style data expired. Please run the command again.', ephemeral: true });
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
                    await interaction.reply({ content: 'Commit data expired. Please run the command again.', ephemeral: true });
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
                await interaction.reply({ content: 'An error occurred processing your request.', ephemeral: true });
            }
        } catch (replyError) {
            console.error('Failed to send button error reply:', replyError);
        }
    }
}

async function handleAddPage(interaction) {
    await interaction.editReply(getBotResponse('thinking'));

    try {
        const name = sanitizeFileName(interaction.options.getString('name'));
        const description = validateInput(interaction.options.getString('description'), 1000);
        // Use AI to generate pure web development project
        const webPrompt = `Build "${name}": ${description}

Output a single HTML file. Requirements:
- Link to shared arcade theme: <link rel="stylesheet" href="../page-theme.css"> in <head>
- Add Google Font for Press Start 2P: <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
- Include home link after <body>: <a href="../index.html" class="home-link">← HOME</a>
- Use arcade color palette: mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32)
- Fully functional and interactive JavaScript
- Vanilla JS (CDN libraries allowed for functionality)
- Creative implementation matching the retro arcade aesthetic
- Use CSS classes from page-theme.css: .container, .card, .btn, etc.

Return only HTML, no markdown blocks or explanations.`;

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [
                {
                    role: 'user',
                    content: webPrompt
                }
            ],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let htmlContent = response.data.choices[0].message.content;
        htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
        htmlContent = ensureStylesheetInHTML(htmlContent);
        htmlContent = ensureHomeLinkInHTML(htmlContent);

        const fileName = `src/${name}.html`;

        // Create src directory if it doesn't exist
        await fs.mkdir('src', { recursive: true });

        // Write the HTML file
        await fs.writeFile(fileName, htmlContent);

        // Update index.html to include the new page
        await updateIndexWithPage(name, description);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Page Added')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes have been pushed to GitHub. GitHub Pages will deploy in 1-2 minutes.')
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'File', value: fileName, inline: false },
                { name: 'Live URL', value: `https://milwrite.github.io/javabot/src/${name}.html`, inline: false },
                { name: 'Deployment', value: '⏳ Deploying... Please be patient (1-2 min)', inline: false }
            )
            .setColor(0x9b59b6)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Page creation failed: ${error.message}`);
    }
}

async function handleAddFeature(interaction) {
    await interaction.editReply(getBotResponse('thinking'));

    try {
        const name = sanitizeFileName(interaction.options.getString('name'));
        const description = validateInput(interaction.options.getString('description'), 1000);
        // Use AI to generate JavaScript feature/library/component
        const jsPrompt = `Create a JavaScript feature called "${name}".
Description: ${description}

Output clean, well-documented JavaScript with:
- Pure functions or component code (minimal dependencies)
- JSDoc comments for functions/methods
- Export as module or global object
- Practical, reusable implementation
- Handle edge cases and provide good defaults

Return only JavaScript code, no markdown blocks or explanations.`;

        const jsResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: jsPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let jsContent = jsResponse.data.choices[0].message.content;
        jsContent = cleanMarkdownCodeBlocks(jsContent, 'javascript');

        // Generate demo HTML page
        const htmlPrompt = `Create an interactive demo page for "${name}" JavaScript feature.
Feature description: ${description}

Output a single HTML file that:
- Links to shared arcade theme: <link rel="stylesheet" href="../page-theme.css"> in <head>
- Add Google Font: <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
- Loads ${name}.js via <script src="${name}.js"></script>
- Include home link after <body>: <a href="../index.html" class="home-link">← HOME</a>
- Use arcade colors: mint green (#7dd3a0), dark backgrounds (#1a1d23, #252a32)
- Provides interactive examples showing all capabilities
- Clear documentation/instructions for users
- Use CSS classes from page-theme.css: .container, .card, .btn, etc.
- Match retro arcade aesthetic

Return only HTML code, no markdown blocks or explanations.`;

        const htmlResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: htmlPrompt }],
            max_tokens: CONFIG.AI_MAX_TOKENS,
            temperature: CONFIG.AI_TEMPERATURE
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: CONFIG.API_TIMEOUT
        });

        let htmlContent = htmlResponse.data.choices[0].message.content;
        htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
        htmlContent = ensureStylesheetInHTML(htmlContent);
        htmlContent = ensureHomeLinkInHTML(htmlContent);

        // Create src directory if it doesn't exist
        await fs.mkdir('src', { recursive: true });

        // Write both files
        const jsFileName = `src/${name}.js`;
        const htmlFileName = `src/${name}.html`;

        await fs.writeFile(jsFileName, jsContent);
        await fs.writeFile(htmlFileName, htmlContent);

        // Update index.html to include the new page
        await updateIndexWithPage(name, description);

        const embed = new EmbedBuilder()
            .setTitle('⚡ Feature Added')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes have been pushed to GitHub. GitHub Pages will deploy in 1-2 minutes.')
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'Files', value: `${jsFileName}\n${htmlFileName}`, inline: false },
                { name: 'Live Demo', value: `https://milwrite.github.io/javabot/src/${name}.html`, inline: false },
                { name: 'Deployment', value: '⏳ Deploying... Please be patient (1-2 min)', inline: false }
            )
            .setColor(0xf39c12)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Feature creation failed: ${error.message}`);
    }
}

async function handleSearch(interaction) {
    const query = interaction.options.getString('query');

    try {
        await interaction.editReply(getBotResponse('thinking'));

        // Perform web search
        const searchResult = await webSearch(query);

        // If response is longer than 2000 characters, save to file and truncate
        if (searchResult.length > 2000) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `responses/search-${timestamp}.txt`;

            // Create responses directory if it doesn't exist
            await fs.mkdir('responses', { recursive: true });

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

    try {
        const previousModel = MODEL;
        MODEL = MODEL_PRESETS[modelChoice];

        const modelNames = {
            'haiku': 'Claude Haiku 4.5',
            'sonnet': 'Claude Sonnet 4.5',
            'kimi': 'Kimi K2 Thinking',
            'gpt5': 'GPT-5 Nano',
            'gemini': 'Gemini 2.5 Flash Lite'
        };

        const embed = new EmbedBuilder()
            .setTitle('🤖 Model Changed')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'New Model', value: modelNames[modelChoice], inline: true },
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

async function handleSetPrompt(interaction) {
    const action = interaction.options.getString('action');
    const content = interaction.options.getString('content');

    try {
        await interaction.editReply(getBotResponse('thinking'));

        let embed;

        switch (action) {
            case 'view':
                // Show current prompt (truncated for Discord)
                const truncatedPrompt = SYSTEM_PROMPT.length > 1500 
                    ? SYSTEM_PROMPT.substring(0, 1500) + '...'
                    : SYSTEM_PROMPT;
                    
                embed = new EmbedBuilder()
                    .setTitle('🤖 Current System Prompt')
                    .setDescription('```\n' + truncatedPrompt + '\n```')
                    .setColor(0x9b59b6)
                    .setTimestamp();
                break;

            case 'reset':
                SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT;
                embed = new EmbedBuilder()
                    .setTitle('🔄 Prompt Reset')
                    .setDescription(getBotResponse('success') + '\n\nBot Sportello has been reset to default personality.')
                    .setColor(0x27ae60)
                    .setTimestamp();
                break;

            case 'add':
                if (!content) {
                    throw new Error('Content is required when adding instructions');
                }
                
                SYSTEM_PROMPT += '\n\nADDITIONAL INSTRUCTION: ' + content;
                
                embed = new EmbedBuilder()
                    .setTitle('➕ Instruction Added')
                    .setDescription(getBotResponse('success') + '\n\nNew instruction added to Bot Sportello.')
                    .addFields(
                        { name: 'Added Instruction', value: content.substring(0, 1000), inline: false }
                    )
                    .setColor(0x3498db)
                    .setTimestamp();
                break;

            case 'replace':
                if (!content) {
                    throw new Error('Content is required when replacing the prompt');
                }
                
                SYSTEM_PROMPT = content;
                
                embed = new EmbedBuilder()
                    .setTitle('🔄 Prompt Replaced')
                    .setDescription(getBotResponse('success') + '\n\nBot Sportello\'s personality has been completely replaced.')
                    .addFields(
                        { name: 'New Prompt Length', value: content.length + ' characters', inline: true }
                    )
                    .setColor(0xe67e22)
                    .setTimestamp();
                break;

            default:
                throw new Error('Invalid action');
        }

        await interaction.editReply({ embeds: [embed] });
        logEvent('PROMPT', `Prompt ${action} by user`, { action, contentLength: content?.length || 0 });

    } catch (error) {
        console.error('Set prompt error:', error);
        const errorMsg = getBotResponse('errors') + ' ' + error.message;
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
                { name: 'Live Site', value: 'https://milwrite.github.io/javabot/', inline: false }
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


async function handleChat(interaction) {
    const userMessage = interaction.options.getString('message');
    const username = interaction.user.username;

    try {
        // Show thinking message first (interaction is already deferred)
        await interaction.editReply(getBotResponse('thinking'));

        // Build conversation messages array from history (last 50 messages for full context)
        const conversationMessages = buildMessagesFromHistory(50);

        // Get response with proper conversation context
        let response = await getLLMResponse(userMessage, conversationMessages);
        
        // Clean duplicate Bot Sportello prefixes
        response = cleanBotResponse(response);

        // Add user message and bot response to history after successful response
        addToHistory(username, userMessage, false);
        addToHistory('Bot Sportello', response, true);

        // Edit with actual response
        await interaction.editReply(response);

    } catch (error) {
        console.error('Chat error:', error);
        const errorMsg = error.code === 'ECONNABORTED' ?
            "Request timed out. Try again." :
            (getBotResponse('errors') + " Chat request failed.");

        try {
            if (interaction.replied) {
                await interaction.editReply(errorMsg);
            } else {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            }
        } catch (replyError) {
            console.error('Failed to send chat error reply:', replyError);
        }
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

async function handleSyncIndex(interaction) {
    try {
        await interaction.editReply(getBotResponse('thinking'));

        // Run the sync
        await syncIndexWithSrcFiles();

        // Check results
        const srcFiles = await fs.readdir('./src');
        const htmlFiles = srcFiles.filter(file => file.endsWith('.html'));

        const embed = new EmbedBuilder()
            .setTitle('🔄 Index Sync Complete')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'HTML Files Found', value: htmlFiles.length.toString(), inline: true },
                { name: 'Status', value: 'All files synced to index.html', inline: false },
                { name: 'Live Site', value: '[View Arcade](https://milwrite.github.io/javabot/)', inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        console.error('Sync index error:', error);
        const errorMsg = getBotResponse('errors') + " Failed to sync index.";
        await interaction.editReply(errorMsg);
    }
}

async function handleUpdateStyle(interaction) {
    const preset = interaction.options.getString('preset');
    const customDescription = interaction.options.getString('description');

    try {
        // Show confirmation dialog for style changes
        const confirmEmbed = new EmbedBuilder()
            .setTitle('⚠️ Confirm Style Update')
            .setDescription(`Ready to update the website style? This will overwrite \`style.css\` and push changes to the live site.`)
            .addFields(
                { name: 'Style Preset', value: preset === 'custom' ? 'Custom AI-generated' : preset, inline: true },
                { name: 'Target File', value: 'style.css', inline: true },
                { name: 'Impact', value: '🌐 Live website styling will change immediately', inline: false }
            )
            .setColor(0xFF6B35) // Orange warning color
            .setTimestamp();

        if (preset === 'custom' && customDescription) {
            confirmEmbed.addFields({ name: 'Custom Description', value: customDescription, inline: false });
        }

        // Create confirmation buttons
        const confirmRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`style_confirm_${interaction.user.id}`)
                    .setLabel('🎨 Update Style')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`style_cancel_${interaction.user.id}`)
                    .setLabel('❌ Cancel')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.editReply({ 
            content: '', 
            embeds: [confirmEmbed], 
            components: [confirmRow] 
        });

        // Store style update data for button handler
        if (!global.stylePendingData) global.stylePendingData = new Map();
        global.stylePendingData.set(interaction.user.id, {
            preset,
            customDescription,
            interactionId: interaction.id
        });

        // Set timeout to clean up pending data
        setTimeout(() => {
            global.stylePendingData?.delete(interaction.user.id);
        }, 300000); // 5 minutes

    } catch (error) {
        console.error('Style update preparation error:', error);
        await interaction.editReply(getBotResponse('errors') + ` ${error.message}`);
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
        
        // Configure git remote with token authentication (only if needed)
        try {
            const remotes = await git.getRemotes(true);
            const origin = remotes.find(r => r.name === 'origin');
            if (!origin || !origin.refs.push.includes(process.env.GITHUB_TOKEN)) {
                const remoteUrl = `https://${process.env.GITHUB_TOKEN}@github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}.git`;
                await git.remote(['set-url', 'origin', remoteUrl]);
            }
        } catch (remoteError) {
            console.warn('Remote URL setup warning:', remoteError.message);
        }
        
        // Push changes - use current branch
        const currentBranch = commitData.status.current || 'main';
        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);
        
        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 AI Changes Committed & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** AI-generated changes are now live!')
            .addFields(
                { name: 'Commit Message', value: commitMessage, inline: false },
                { name: 'Commit Hash', value: commit.commit.substring(0, 7), inline: true },
                { name: 'Files Changed', value: commitData.status.files.length.toString(), inline: true },
                { name: 'Live Site', value: '[View Changes](https://milwrite.github.io/javabot/)', inline: false }
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
        
        await interaction.editReply({ content: '', embeds: [embed] });
        
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

            newCSS = await getLLMResponse(cssPrompt, 'system');

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
        await git.push('origin', status.current);

        const embed = new EmbedBuilder()
            .setTitle('🎨 Style Updated & Pushed')
            .setDescription(getBotResponse('success') + '\n\n**Note:** Changes have been pushed to GitHub. GitHub Pages will deploy in 1-2 minutes.')
            .addFields(
                { name: 'Style', value: preset === 'custom' ? 'Custom AI-generated' : preset, inline: true },
                { name: 'File', value: 'style.css', inline: true },
                { name: 'Deployment', value: '⏳ Deploying... Please be patient (1-2 min)', inline: false },
                { name: 'Live Site', value: '[View Changes](https://milwrite.github.io/javabot/)', inline: false }
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

client.login(process.env.DISCORD_TOKEN);