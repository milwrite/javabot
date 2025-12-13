require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;

// Game pipeline modules (system-v1)
const { runGamePipeline, commitGameFiles, isGameRequest } = require('./services/gamePipeline');
const { getRecentPatternsSummary } = require('./services/buildLogs');

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
let MODEL = 'anthropic/claude-haiku-4.5'; // Default to Haiku 4.5

// Available models (2025 latest)
const MODEL_PRESETS = {
    'haiku': 'anthropic/claude-haiku-4.5',
    'sonnet': 'anthropic/claude-sonnet-4.5',
    'kimi': 'moonshotai/kimi-k2-0905:exacto',
    'gpt5': 'openai/gpt-5.1-codex',
    'gemini': 'google/gemini-2.5-pro',
    'glm': 'z-ai/glm-4.6:exacto'
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

URL STRUCTURE (CRITICAL):
- Main page: https://milwrite.github.io/javabot/
- Pages in src/: https://milwrite.github.io/javabot/src/PAGENAME.html
- ALWAYS include /src/ in URLs for pages in the src directory!
- Example: frogger.html → https://milwrite.github.io/javabot/src/frogger.html
- WRONG: https://milwrite.github.io/javabot/frogger.html (missing /src/)

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
- Run /sync-index after adding/editing pages so metadata and index stay aligned

AFTER CREATING A PAGE - EXPLAIN WHAT YOU BUILT:
When you finish creating a page, briefly tell the user what you made:
1. Summarize the key feature (1 sentence): "Built you a frogger game with mobile touch controls"
2. Mention any creative additions: "Added CRT scanlines and a high score tracker"
3. Note the live URL so they can check it out
4. ALWAYS remind users: "Give it a minute or two to deploy to GitHub Pages"
Keep it casual and brief - don't list every HTML element or CSS class used.

URL FORMATTING (CRITICAL - FOLLOW EXACTLY):
- NEVER put em dash (—) or any punctuation directly after a URL - it breaks the link!
- BAD: "Check it out at https://example.com—cool right?" (BROKEN - em dash touching URL)
- GOOD: "Check it out at https://example.com - cool right?" (space before dash)
- GOOD: "Check it out: https://example.com" (URL on its own)
- Always put a SPACE after URLs before any punctuation
- Use plain hyphens (-) not em dashes (—) in page names

AVAILABLE CAPABILITIES:
- list_files(path): List files in directory
- read_file(path): Read file contents
- write_file(path, content): Create/update files
- edit_file(path, instructions): Edit files with natural language
- create_page(name, description): Generate and deploy a new HTML page
- create_feature(name, description): Generate JS library + demo page
- commit_changes(message, files): Git add, commit, push to main
- get_repo_status(): Check current git status
- web_search(query): Search internet for current info
- set_model(model): Switch AI model (haiku, sonnet, kimi, gpt5, gemini)
- update_style(preset, description): Change website theme
- build_game(title, prompt, type): Build complete game/content via AI pipeline

WHEN TO USE EACH TOOL:
- For quick file edits: use edit_file with natural language
- For new pages/apps: use create_page or build_game (for games with mobile controls)
- For JS libraries/features: use create_feature
- To deploy changes: use commit_changes
- To switch AI behavior: use set_model
- For current events/news: use web_search

WHEN TO USE WEB SEARCH:
- Anything that changes: sports, news, prices, weather, standings, odds
- Questions with "latest", "current", "today", "now"
- When you don't have up-to-date info, just search

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
        console.log(`[WRITE_FILE] Written: ${filePath} (${content.length} bytes)`);

        // Auto-commit and push so file is live before link is shared
        console.log(`[WRITE_FILE] Auto-pushing to remote...`);
        const fileName = path.basename(filePath);
        const commitMessage = `add ${fileName}`;

        await gitWithTimeout(() => git.add(filePath));
        await gitWithTimeout(() => git.commit(commitMessage));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        // Configure git remote with token authentication
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

        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);

        console.log(`[WRITE_FILE] Auto-pushed: ${commitMessage}`);
        return `File written and pushed: ${filePath} (${content.length} bytes) - now live at https://milwrite.github.io/javabot/${filePath}`;
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
                temperature: CONFIG.AI_TEMPERATURE
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

        // Auto-commit and push so changes are live before link is shared
        console.log(`[EDIT_FILE] Auto-pushing to remote...`);
        const fileName = path.basename(filePath);
        const commitMessage = `update ${fileName}`;

        await gitWithTimeout(() => git.add(filePath));
        await gitWithTimeout(() => git.commit(commitMessage));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        // Configure git remote with token authentication
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

        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[EDIT_FILE] Success + pushed: ${filePath} (${totalTime}s total)`);
        return `File edited and pushed: ${filePath}. ${changeDescription} - now live`;
    } catch (error) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[EDIT_FILE] Error after ${totalTime}s:`, error.message);
        return `Error editing file: ${error.message}`;
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

// Tool functions that AI can call via @ mentions
async function createPage(name, description) {
    console.log(`[CREATE_PAGE] Starting: ${name}`);

    // Detect if this is a game for enhanced validation
    const isGame = /game|play|arcade|puzzle|snake|tetris|pong|match|guess|quiz|battle|shooter/i.test(description);
    const context = { isGame };

    const MAX_RETRIES = 2;
    let attempt = 0;
    let htmlContent = null;
    let validation = null;

    try {
        while (attempt <= MAX_RETRIES) {
            attempt++;

            const webPrompt = `Build "${name}": ${description}

Output a single HTML file with embedded CSS and JavaScript. Requirements:
- Fully functional and interactive
- Modern, attractive styling
- Vanilla JS (CDN libraries allowed)
- Creative implementation
- Include: <a href="../index.html" style="position:fixed;top:20px;left:20px;z-index:9999;text-decoration:none;background:rgba(102,126,234,0.9);color:white;padding:10px 20px;border-radius:25px;box-shadow:0 4px 10px rgba(0,0,0,0.2)">← Home</a> after <body>
${isGame ? '- CRITICAL FOR GAMES: Include mobile touch controls with class="mobile-controls" and CSS touch-action: manipulation\n- Add responsive breakpoints @media (max-width: 768px) and (max-width: 480px)\n- Use touchstart events with preventDefault for buttons' : ''}
${validation && !validation.isValid ? '\nPREVIOUS ATTEMPT HAD ISSUES - FIX THESE:\n' + buildValidationFeedback(validation) : ''}

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

            htmlContent = response.data.choices[0].message.content;
            htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
            htmlContent = ensureStylesheetInHTML(htmlContent);
            htmlContent = ensureHomeLinkInHTML(htmlContent);

            // Validate the generated content
            validation = validateHTMLContent(htmlContent, context);

            logEvent('CREATE_PAGE', `Attempt ${attempt}/${MAX_RETRIES + 1} - Quality Score: ${validation.score}/100`);

            if (validation.isValid || attempt > MAX_RETRIES) {
                if (!validation.isValid) {
                    logEvent('CREATE_PAGE', `Proceeding despite validation issues after ${MAX_RETRIES} retries`);
                    console.log(buildValidationFeedback(validation));
                }
                break;
            }

            logEvent('CREATE_PAGE', `Validation failed, retrying... Issues: ${validation.issues.length}`);
        }

        const fileName = `src/${name}.html`;
        await fs.mkdir('src', { recursive: true });
        await fs.writeFile(fileName, htmlContent);

        // Update index.html
        await updateIndexWithPage(name, description);

        // Auto-commit and push so page is live before link is shared
        console.log(`[CREATE_PAGE] Auto-pushing to remote...`);
        await gitWithTimeout(() => git.add([fileName, 'projectmetadata.json']));
        await gitWithTimeout(() => git.commit(`add ${name} page`));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        // Configure git remote with token authentication
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

        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);

        const qualityNote = validation.score >= 80 ? '✨ High quality' : validation.score >= 60 ? '✓ Good quality' : '⚠️ May need refinement';
        console.log(`[CREATE_PAGE] Success + pushed: ${fileName} (Score: ${validation.score}/100)`);
        return `Created ${fileName} and pushed. ${qualityNote} (${validation.score}/100). Live at: https://milwrite.github.io/javabot/src/${name}.html (give it 1-2 min to deploy)`;
    } catch (error) {
        console.error(`[CREATE_PAGE] Error:`, error.message);
        return `Error creating page: ${error.message}`;
    }
}

async function createFeature(name, description) {
    console.log(`[CREATE_FEATURE] Starting: ${name}`);

    const MAX_RETRIES = 2;
    let jsAttempt = 0;
    let htmlAttempt = 0;
    let jsContent = null;
    let htmlContent = null;
    let jsValidation = null;
    let htmlValidation = null;

    try {
        // Generate JS feature/library/component with retry logic
        while (jsAttempt <= MAX_RETRIES) {
            jsAttempt++;

            const jsPrompt = `Create a JavaScript feature called "${name}".
Description: ${description}

Output clean, well-documented JavaScript with:
- Pure functions or component code (minimal dependencies)
- JSDoc comments for functions/methods
- Export as module or global object
- Practical, reusable implementation
- Handle edge cases and provide good defaults
${jsValidation && !jsValidation.isValid ? '\nPREVIOUS ATTEMPT HAD ISSUES - FIX THESE:\n' + buildValidationFeedback(jsValidation, 'JavaScript') : ''}

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

            jsContent = jsResponse.data.choices[0].message.content;
            jsContent = cleanMarkdownCodeBlocks(jsContent, 'javascript');

            // Validate JavaScript
            jsValidation = validateJSContent(jsContent);
            logEvent('CREATE_FEATURE', `JS Attempt ${jsAttempt}/${MAX_RETRIES + 1} - Valid: ${jsValidation.isValid}`);

            if (jsValidation.isValid || jsAttempt > MAX_RETRIES) {
                if (!jsValidation.isValid) {
                    logEvent('CREATE_FEATURE', `Proceeding with JS despite issues after ${MAX_RETRIES} retries`);
                    console.log(buildValidationFeedback(jsValidation, 'JavaScript'));
                }
                break;
            }

            logEvent('CREATE_FEATURE', `JS validation failed, retrying... Issues: ${jsValidation.issues.length}`);
        }

        // Generate demo HTML with retry logic
        const isGame = /game|play|arcade|puzzle|interactive/i.test(description);
        const context = { isGame };

        while (htmlAttempt <= MAX_RETRIES) {
            htmlAttempt++;

            const htmlPrompt = `Create an interactive demo page for "${name}" JavaScript feature.
Feature description: ${description}

Output a single HTML file that:
- Loads ${name}.js via <script src="${name}.js"></script>
- Provides interactive examples showing all capabilities
- Modern, polished UI with embedded CSS
- Clear documentation/instructions for users
- Include: <a href="../index.html" style="position:fixed;top:20px;left:20px;z-index:9999;text-decoration:none;background:rgba(102,126,234,0.9);color:white;padding:10px 20px;border-radius:25px;box-shadow:0 4px 10px rgba(0,0,0,0.2)">← Home</a> after <body>
${isGame ? '- CRITICAL FOR INTERACTIVE FEATURES: Include mobile touch controls if needed\n- Add responsive breakpoints @media (max-width: 768px) and (max-width: 480px)' : ''}
${htmlValidation && !htmlValidation.isValid ? '\nPREVIOUS ATTEMPT HAD ISSUES - FIX THESE:\n' + buildValidationFeedback(htmlValidation) : ''}

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

            htmlContent = htmlResponse.data.choices[0].message.content;
            htmlContent = cleanMarkdownCodeBlocks(htmlContent, 'html');
            htmlContent = ensureStylesheetInHTML(htmlContent);
            htmlContent = ensureHomeLinkInHTML(htmlContent);

            // Validate HTML
            htmlValidation = validateHTMLContent(htmlContent, context);
            logEvent('CREATE_FEATURE', `HTML Attempt ${htmlAttempt}/${MAX_RETRIES + 1} - Quality Score: ${htmlValidation.score}/100`);

            if (htmlValidation.isValid || htmlAttempt > MAX_RETRIES) {
                if (!htmlValidation.isValid) {
                    logEvent('CREATE_FEATURE', `Proceeding with HTML despite issues after ${MAX_RETRIES} retries`);
                    console.log(buildValidationFeedback(htmlValidation));
                }
                break;
            }

            logEvent('CREATE_FEATURE', `HTML validation failed, retrying... Issues: ${htmlValidation.issues.length}`);
        }

        await fs.mkdir('src', { recursive: true });
        const jsFileName = `src/${name}.js`;
        const htmlFileName = `src/${name}.html`;
        await fs.writeFile(jsFileName, jsContent);
        await fs.writeFile(htmlFileName, htmlContent);

        // Update index.html
        await updateIndexWithPage(name, description);

        // Auto-commit and push so feature is live before link is shared
        console.log(`[CREATE_FEATURE] Auto-pushing to remote...`);
        await gitWithTimeout(() => git.add([jsFileName, htmlFileName, 'projectmetadata.json']));
        await gitWithTimeout(() => git.commit(`add ${name} feature`));
        const status = await gitWithTimeout(() => git.status());
        const currentBranch = status.current || 'main';

        // Configure git remote with token authentication
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

        await gitWithTimeout(() => git.push('origin', currentBranch), CONFIG.PUSH_TIMEOUT);

        const qualityNote = htmlValidation.score >= 80 ? '✨ High quality' : htmlValidation.score >= 60 ? '✓ Good quality' : '⚠️ May need refinement';
        console.log(`[CREATE_FEATURE] Success + pushed: ${jsFileName}, ${htmlFileName} (Score: ${htmlValidation.score}/100)`);
        return `Created ${jsFileName} and ${htmlFileName}, pushed. ${qualityNote} (${htmlValidation.score}/100). Live demo: https://milwrite.github.io/javabot/src/${name}.html (give it 1-2 min to deploy)`;
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

        // Configure git remote with token authentication
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

// Tool: Update website styling
async function updateStyle(preset, description = '') {
    try {
        const stylePresets = {
            'noir-terminal': {
                name: 'Noir Terminal',
                colors: { primary: '#7ec8e3', accent: '#ff0000', secondary: '#00ffff', bg: '#0a0a0a' }
            },
            'neon-arcade': {
                name: 'Neon Arcade',
                colors: { primary: '#00ff00', accent: '#ff00ff', secondary: '#00ffff', bg: '#000' }
            },
            'dark-minimal': {
                name: 'Dark Minimal',
                colors: { primary: '#ffffff', accent: '#3498db', secondary: '#95a5a6', bg: '#1a1a1a' }
            },
            'retro-terminal': {
                name: 'Retro Terminal',
                colors: { primary: '#00ff41', accent: '#ff6b35', secondary: '#00ff41', bg: '#0a0a0a' }
            }
        };

        if (preset === 'custom' && description) {
            logEvent('UPDATE_STYLE', `Custom style requested: ${description}`);
            return `Custom style "${description}" noted. To apply it, I would need to edit page-theme.css with the new colors and effects. Want me to proceed?`;
        }

        if (!stylePresets[preset]) {
            return `Unknown preset "${preset}". Available: ${Object.keys(stylePresets).join(', ')}, custom`;
        }

        const selected = stylePresets[preset];
        logEvent('UPDATE_STYLE', `Selected ${preset} preset`);
        return `Style preset "${selected.name}" selected. Colors: primary ${selected.colors.primary}, accent ${selected.colors.accent}, bg ${selected.colors.bg}. To apply this across all pages, edit page-theme.css with these values.`;
    } catch (error) {
        console.error('Update style error:', error);
        return `Error updating style: ${error.message}`;
    }
}

// Tool: Build game using the pipeline
async function buildGameTool(title, prompt, type = 'auto') {
    try {
        logEvent('BUILD_GAME_TOOL', `Building: ${title}`);

        const triggerSource = {
            kind: 'tool',
            userId: 'ai-orchestrator',
            username: 'Bot Sportello'
        };

        const result = await runGamePipeline({
            userPrompt: `${title}: ${prompt}`,
            triggerSource,
            onStatusUpdate: async (msg) => {
                logEvent('BUILD_GAME_TOOL', msg);
            },
            preferredType: type
        });

        if (!result.ok) {
            return `Build failed: ${result.error}. Check build-logs/${result.buildId}.json for details.`;
        }

        // Commit and push
        const commitSuccess = await commitGameFiles(result);
        if (commitSuccess) {
            // Configure git remote with token authentication
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

            try {
                await git.push('origin', 'main');
            } catch (pushError) {
                console.error('Push error (non-fatal):', pushError);
            }
        }

        const scoreEmoji = result.testResult.score >= 80 ? '✨' : result.testResult.score >= 60 ? '✓' : '⚠️';
        return `${scoreEmoji} Built "${result.plan.metadata.title}"!\n\nType: ${result.plan.type}\nQuality: ${result.testResult.score}/100\nLive: ${result.liveUrl}\n\n${result.docs.releaseNotes}\n\n(Give it a minute or two to deploy to GitHub Pages)`;
    } catch (error) {
        console.error('Build game tool error:', error);
        return `Build pipeline error: ${error.message}`;
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
            },
            {
                type: 'function',
                function: {
                    name: 'set_model',
                    description: 'Switch the AI model used for responses. Available models: haiku (fast/cheap), sonnet (balanced), kimi (reasoning), gpt5 (latest OpenAI), gemini (Google)',
                    parameters: {
                        type: 'object',
                        properties: {
                            model: {
                                type: 'string',
                                description: 'Model preset name: haiku, sonnet, kimi, gpt5, or gemini',
                                enum: ['haiku', 'sonnet', 'kimi', 'gpt5', 'gemini']
                            }
                        },
                        required: ['model']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'update_style',
                    description: 'Update the website visual styling. Use preset themes or describe custom styling.',
                    parameters: {
                        type: 'object',
                        properties: {
                            preset: {
                                type: 'string',
                                description: 'Style preset: noir-terminal (current), neon-arcade, dark-minimal, retro-terminal, or "custom" for AI-generated',
                                enum: ['noir-terminal', 'neon-arcade', 'dark-minimal', 'retro-terminal', 'custom']
                            },
                            description: { type: 'string', description: 'For custom preset only: describe the desired style' }
                        },
                        required: ['preset']
                    }
                }
            },
            {
                type: 'function',
                function: {
                    name: 'build_game',
                    description: 'Build a complete game/content using the AI pipeline. Creates mobile-responsive content with automatic testing and deployment.',
                    parameters: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: 'Title for the game/content' },
                            prompt: { type: 'string', description: 'Description of what to build' },
                            type: {
                                type: 'string',
                                description: 'Content type: arcade-game, letter, recipe, infographic, story, log, parody, utility, visualization, or auto',
                                enum: ['arcade-game', 'letter', 'recipe', 'infographic', 'story', 'log', 'parody', 'utility', 'visualization', 'auto']
                            }
                        },
                        required: ['title', 'prompt']
                    }
                }
            }
        ];

        // Agentic loop - allow multiple rounds of tool calling
        const MAX_ITERATIONS = 10;
        let iteration = 0;
        let lastResponse;
        const editedFiles = new Set(); // Track files already edited to prevent redundant edits
        const searchResults = []; // Track web search results for context persistence

        while (iteration < MAX_ITERATIONS) {
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

            // If no tool calls, we're done
            if (!lastResponse.tool_calls || lastResponse.tool_calls.length === 0) {
                break;
            }

            logEvent('LLM', `Iteration ${iteration}: Processing ${lastResponse.tool_calls.length} tool calls`);

            // Execute all tool calls
            const toolResults = [];
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
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
                } else if (functionName === 'write_file') {
                    result = await writeFile(args.path, args.content);
                } else if (functionName === 'edit_file') {
                    // Prevent editing the same file multiple times
                    if (editedFiles.has(args.path)) {
                        result = `File ${args.path} was already edited in this conversation. Skipping redundant edit to save time.`;
                        logEvent('LLM', `Skipped redundant edit of ${args.path}`);
                    } else {
                        // Support both exact replacement (preferred) and AI-based instructions (fallback)
                        result = await editFile(args.path, args.old_string, args.new_string, args.instructions);
                        editedFiles.add(args.path);
                    }
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
                    // Store search results for context persistence
                    searchResults.push({ query: args.query, results: result });
                } else if (functionName === 'set_model') {
                    result = await setModel(args.model);
                } else if (functionName === 'update_style') {
                    result = await updateStyle(args.preset, args.description);
                } else if (functionName === 'build_game') {
                    result = await buildGameTool(args.title, args.prompt, args.type);
                }

                toolResults.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result
                });
            }

            // Add assistant message and tool results to conversation
            messages.push(lastResponse);
            messages.push(...toolResults);
        }

        if (iteration >= MAX_ITERATIONS) {
            logEvent('LLM', `Reached max iterations (${MAX_ITERATIONS})`);
        }

        const content = lastResponse?.content;
        if (!content) {
            logEvent('LLM', 'Empty response from AI');
            console.error('Last response:', JSON.stringify(lastResponse, null, 2));
        }

        // Return response with search context for history persistence
        return {
            text: content || '',
            searchContext: searchResults.length > 0 ? searchResults : null
        };
    } catch (error) {
        console.error('LLM Error:', error.response?.data || error.message);
        return { text: getBotResponse('errors'), searchContext: null };
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
        .setName('build-game')
        .setDescription('Build a complete game using AI-driven pipeline (Architect → Builder → Tester → Scribe)')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Game title (e.g., "Snake", "Space Maze")')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Describe what the game should do (mechanics, theme, features)')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Optional: game type hint')
                .setRequired(false)
                .addChoices(
                    { name: 'Auto-detect (default)', value: 'auto' },
                    { name: 'Arcade / 2D Game', value: 'arcade-2d' },
                    { name: 'Interactive Fiction', value: 'interactive-fiction' },
                    { name: 'Infographic / Visual', value: 'infographic' },
                    { name: 'Utility / App', value: 'utility' }
                )),

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
                    { name: 'Kimi K2 Exacto (Moonshot AI)', value: 'kimi' },
                    { name: 'GPT-5.1 Codex (Latest OpenAI)', value: 'gpt5' },
                    { name: 'Gemini 2.5 Pro (Google)', value: 'gemini' },
                    { name: 'GLM-4.6 Exacto (Z-AI)', value: 'glm' }
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
        .setName('build-puzzle')
        .setDescription('Generate interactive story riddle puzzle with p5.js visualization')
        .addStringOption(option =>
            option.setName('theme')
                .setDescription('Puzzle theme')
                .setRequired(true)
                .addChoices(
                    { name: 'Noir Detective', value: 'noir-detective' },
                    { name: 'Fantasy Quest', value: 'fantasy-quest' },
                    { name: 'Sci-Fi Mystery', value: 'sci-fi-mystery' }
                ))
        .addStringOption(option =>
            option.setName('difficulty')
                .setDescription('Difficulty level')
                .setRequired(false)
                .addChoices(
                    { name: 'Easy', value: 'easy' },
                    { name: 'Medium (default)', value: 'medium' },
                    { name: 'Hard', value: 'hard' }
                )),

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
            case 'build-game':
                await handleBuildGame(interaction);
                break;
            case 'build-puzzle':
                await handleBuildPuzzle(interaction);
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

        // Send thinking message
        console.log(`[MENTION] Sending thinking response to ${username}...`);
        thinkingMsg = await message.reply(getBotResponse('thinking'));
        console.log(`[MENTION] Thinking message sent successfully`);

        // Check if this is a game request - route to game pipeline
        if (isGameRequest(content)) {
            logEvent('MENTION', 'Detected game request - routing to game pipeline');

            try {
                await thinkingMsg.edit('📝 detected game request - firing up the game builder...');

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
                            await thinkingMsg.edit(msg);
                        } catch (err) {
                            console.error('Status update error:', err);
                        }
                    },
                    preferredType: 'auto'
                });

                if (!result.ok) {
                    await thinkingMsg.edit(`${getBotResponse('errors')}\n\nBuild failed: ${result.error}\n\nCheck \`build-logs/${result.buildId}.json\` for details.`);
                    return;
                }

                // Commit and push
                await thinkingMsg.edit('💾 committing to repo...');
                const commitSuccess = await commitGameFiles(result);

                if (commitSuccess) {
                    await thinkingMsg.edit('🚀 pushing to github pages...');

                    // Configure git remote with token authentication
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

                    try {
                        await git.push('origin', 'main');
                    } catch (pushError) {
                        console.error('Push error (non-fatal):', pushError);
                    }
                }

                // Success message
                const scoreEmoji = result.testResult.score >= 80 ? '✨' : result.testResult.score >= 60 ? '✓' : '⚠️';
                const successMsg = `${scoreEmoji} **${result.plan.metadata.title}** built and deployed!\n\n${result.docs.releaseNotes}\n\n🎮 **Play now:** ${result.liveUrl}\n\n📊 Quality: ${result.testResult.score}/100 | ⏱️ Build time: ${result.duration}\n\n*Give it a minute or two to deploy to GitHub Pages*`;

                await thinkingMsg.edit(successMsg);

                // Add to history
                addToHistory(username, content, false);
                addToHistory('Bot Sportello', successMsg, true);

                return; // Exit early - game pipeline handled everything
            } catch (gameError) {
                console.error('Game pipeline error in mention handler:', gameError);
                // Fall through to normal AI response if game pipeline fails
                await thinkingMsg.edit('hmm the game builder hit a snag... lemme try the regular chat flow...');
            }
        }

        // Build conversation context
        const conversationMessages = buildMessagesFromHistory(50);

        // Get AI response with full tool calling capabilities
        let llmResult = await getLLMResponse(content, conversationMessages);
        let response = llmResult.text;

        // Clean duplicate Bot Sportello prefixes
        response = cleanBotResponse(response);

        // Validate response is not empty
        if (!response || response.trim().length === 0) {
            response = getBotResponse('errors') + ' Got an empty response from the AI.';
            logEvent('MENTION', 'Empty AI response received');
        }

        // Add to history - include search context if any
        addToHistory(username, content, false);
        if (llmResult.searchContext) {
            const searchSummary = llmResult.searchContext.map(s =>
                `[Search: "${s.query}"]\n${s.results}`
            ).join('\n\n');
            addToHistory('Bot Sportello', `${searchSummary}\n\n${response}`, true);
        } else {
            addToHistory('Bot Sportello', response, true);
        }

        // Send response directly (no commit prompts in mentions)
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

    } catch (error) {
        console.error('❌ Mention handler error:', error);
        const errorDetails = error.response?.data || error.message || 'Unknown error';
        console.error('Error details:', errorDetails);

        try {
            // Try to edit thinking message with error, or send new error message
            const errorMsg = `${getBotResponse('errors')}\n\n*Error: ${error.message?.substring(0, 100)}*`;

            if (thinkingMsg && !thinkingMsg.deleted) {
                try {
                    await thinkingMsg.edit(errorMsg);
                    console.log(`[MENTION] Error message edited into thinking message`);
                } catch (editErr) {
                    console.warn(`[MENTION] Could not edit thinking message:`, editErr.message);
                    await message.reply(errorMsg);
                }
            } else {
                console.log(`[MENTION] Sending error as new reply (no thinking message)`);
                await message.reply(errorMsg);
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

async function handleAddPage(interaction) {
    await interaction.editReply(getBotResponse('thinking'));

    try {
        const name = sanitizeFileName(interaction.options.getString('name'));
        const description = validateInput(interaction.options.getString('description'), 1000);

        // Use the unified createPage function with validation and retry logic
        const result = await createPage(name, description);

        // Extract quality score if present in result message
        const scoreMatch = result.match(/\((\d+)\/100\)/);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : null;
        const qualityIndicator = score >= 80 ? '✨' : score >= 60 ? '✓' : '⚠️';

        const embed = new EmbedBuilder()
            .setTitle(`${qualityIndicator} Page Added`)
            .setDescription(getBotResponse('success') + '\n\n' + result)
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'File', value: `src/${name}.html`, inline: false },
                { name: 'Live URL', value: `https://milwrite.github.io/javabot/src/${name}.html`, inline: false },
                ...(score ? [{ name: 'Quality Score', value: `${score}/100`, inline: true }] : [])
            )
            .setColor(score >= 80 ? 0x00ff00 : score >= 60 ? 0x9b59b6 : 0xff9900)
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

        // Use the unified createFeature function with validation and retry logic
        const result = await createFeature(name, description);

        // Extract quality score if present in result message
        const scoreMatch = result.match(/\((\d+)\/100\)/);
        const score = scoreMatch ? parseInt(scoreMatch[1]) : null;
        const qualityIndicator = score >= 80 ? '✨' : score >= 60 ? '✓' : '⚠️';

        const embed = new EmbedBuilder()
            .setTitle(`${qualityIndicator} Feature Added`)
            .setDescription(getBotResponse('success') + '\n\n' + result)
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'Files', value: `src/${name}.js\nsrc/${name}.html`, inline: false },
                { name: 'Live Demo', value: `https://milwrite.github.io/javabot/src/${name}.html`, inline: false },
                ...(score ? [{ name: 'Quality Score', value: `${score}/100`, inline: true }] : [])
            )
            .setColor(score >= 80 ? 0x00ff00 : score >= 60 ? 0xf39c12 : 0xff9900)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Feature creation failed: ${error.message}`);
    }
}

async function handleBuildGame(interaction) {
    const title = interaction.options.getString('title');
    const prompt = interaction.options.getString('prompt');
    const type = interaction.options.getString('type') || 'auto';

    try {
        const userPrompt = `${title}\n\n${prompt}${type !== 'auto' ? `\n\nPreferred type: ${type}` : ''}`;
        const triggerSource = {
            kind: 'slash',
            userId: interaction.user.id,
            username: interaction.user.username
        };

        // Run the game pipeline with status updates
        const result = await runGamePipeline({
            userPrompt,
            triggerSource,
            onStatusUpdate: async (msg) => {
                try {
                    await interaction.editReply(msg);
                } catch (err) {
                    console.error('Status update error:', err);
                }
            },
            preferredType: type
        });

        if (!result.ok) {
            // Build failed
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Build Failed')
                .setDescription(result.error || 'Build failed after multiple attempts')
                .addFields(
                    { name: 'Title', value: title, inline: true },
                    { name: 'Build ID', value: result.buildId, inline: true },
                    { name: 'Build Log', value: `\`build-logs/${result.buildId}.json\``, inline: false }
                )
                .setColor(0xff0000)
                .setTimestamp();

            if (result.testResult && result.testResult.issues.length > 0) {
                const issuesList = result.testResult.issues
                    .slice(0, 5)
                    .map(issue => `• ${issue.message}`)
                    .join('\n');
                errorEmbed.addFields({ name: 'Issues Found', value: issuesList, inline: false });
            }

            await interaction.editReply({ content: '', embeds: [errorEmbed] });
            return;
        }

        // Success! Commit the files
        await interaction.editReply('💾 committing files to repo...');
        const commitSuccess = await commitGameFiles(result);

        if (commitSuccess) {
            await interaction.editReply('🚀 pushing to github pages...');

            // Configure git remote with token authentication
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

            try {
                await git.push('origin', 'main');
            } catch (pushError) {
                console.error('Push error (non-fatal):', pushError);
            }
        }

        // Build success embed with null-safe field values
        const successEmbed = new EmbedBuilder()
            .setTitle(`🎮 ${result.plan?.metadata?.title || 'New Content'}`)
            .setDescription(`${result.docs?.releaseNotes || 'Build completed successfully.'}\n\n${result.testResult?.score >= 80 ? '✨ High quality build!' : result.testResult?.score >= 60 ? '✓ Good build!' : '⚠️ Build passed with minor issues'}`)
            .addFields(
                { name: 'Type', value: result.plan?.type || 'content', inline: true },
                { name: 'Collection', value: result.docs?.metadata?.collection || 'unsorted', inline: true },
                { name: 'Quality Score', value: `${result.testResult?.score || 0}/100`, inline: true },
                { name: 'Files', value: result.buildResult?.files?.join('\n') || 'No files', inline: false },
                { name: 'Play Now', value: result.liveUrl || 'URL pending', inline: false },
                { name: 'Build Time', value: result.duration || 'Unknown', inline: true }
            )
            .setColor(result.testResult?.score >= 80 ? 0x00ff00 : 0xf39c12)
            .setFooter({ text: 'Give it a minute or two to deploy to GitHub Pages' })
            .setTimestamp();

        if (result.docs?.howToPlay) {
            successEmbed.addFields({ name: 'How to Play', value: result.docs.howToPlay, inline: false });
        }

        if (result.testResult?.warnings?.length > 0) {
            const warningsList = result.testResult.warnings
                .slice(0, 3)
                .map(w => `• ${w.message}`)
                .join('\n');
            successEmbed.addFields({ name: 'Minor Warnings', value: warningsList, inline: false });
        }

        await interaction.editReply({ content: '', embeds: [successEmbed] });

    } catch (error) {
        console.error('Build game error:', error);
        const errorMsg = getBotResponse('errors') + ` Build pipeline error: ${error.message}`;
        await interaction.editReply(errorMsg);
    }
}

// ===== PUZZLE SYSTEM =====
// Generate story riddle puzzles with p5.js visualization

async function handleBuildPuzzle(interaction) {
    const theme = interaction.options.getString('theme');
    const difficulty = interaction.options.getString('difficulty') || 'medium';

    await interaction.deferReply();

    try {
        await interaction.editReply(`${getBotResponse('thinking')} generating ${theme} puzzle...`);

        // Generate puzzle data
        const puzzleData = await generatePuzzleData(theme, difficulty);

        // Validate structure
        if (!validatePuzzleData(puzzleData)) {
            throw new Error('Generated puzzle failed validation');
        }

        // Create HTML file
        const fileName = `${theme.toLowerCase().replace(/\s+/g, '-')}-puzzle-${Date.now()}`;
        const htmlContent = generatePuzzleHTML(puzzleData, theme);

        // Write to src/
        const filePath = path.join(__dirname, 'src', `${fileName}.html`);
        await fs.writeFile(filePath, htmlContent);

        // Update metadata
        await updateIndexWithPage(fileName, `🧩 Story riddle puzzle: ${puzzleData.title}`);

        // Git commit
        await interaction.editReply(`${getBotResponse('thinking')} committing...`);
        await gitWithTimeout(() => git.add('.'));
        await gitWithTimeout(() => git.commit(`add ${theme} story riddle puzzle`));

        // Configure git remote with token authentication
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

        await gitWithTimeout(() => git.push('origin', 'main'), CONFIG.PUSH_TIMEOUT);

        // Success embed
        const liveUrl = `https://milwrite.github.io/javabot/src/${fileName}.html`;
        const embed = new EmbedBuilder()
            .setColor('#7ec8e3')
            .setTitle(`🧩 ${puzzleData.title}`)
            .setDescription(`**Theme:** ${theme}\n**Difficulty:** ${difficulty}\n**Nodes:** ${Object.keys(puzzleData.nodes).length}`)
            .setURL(liveUrl)
            .addFields({ name: '🎮 Play Now', value: `[Launch Puzzle](${liveUrl})` })
            .setFooter({ text: 'May take a minute to deploy to GitHub Pages' })
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });

    } catch (error) {
        console.error('Build puzzle error:', error);
        await interaction.editReply(`${getBotResponse('errors')} ${error.message}`);
    }
}

async function generatePuzzleData(theme, difficulty, maxRetries = 3) {
    // Theme guidelines for LLM
    const themeGuidelines = {
        'noir-detective': 'Film noir setting - shadowy, urban, mysterious. Riddles: light/shadow/sound/time/memory. Story: missing person mystery, jazz clubs, fedoras.',
        'fantasy-quest': 'High fantasy setting - medieval, magical. Riddles: nature/magic/ancient lore/artifacts. Story: dragon quest, magical artifacts, wizards.',
        'sci-fi-mystery': 'Hard sci-fi setting - space stations, AI, tech. Riddles: paradoxes/physics/code/AI consciousness. Story: AI crisis, anomalies, missions.'
    };

    const prompt = `Generate a branching narrative puzzle in JSON format.

THEME: ${theme}
DIFFICULTY: ${difficulty}
${themeGuidelines[theme]}

REQUIREMENTS:
- Generate 8-12 story nodes, 3-4 levels deep
- Each node must have: id, text (2-4 sentences), riddle object, children array (1-2 ids)
- Riddle object: question, answers (array of valid strings), hint
- Include 2-3 ending nodes (set children to empty array)
- All riddles must be solvable without external knowledge
- Story must be completable in 10-15 minutes
- Use this exact JSON structure - no additional fields:

{
  "title": "...",
  "theme": "${theme}",
  "difficulty": "${difficulty}",
  "startNode": "start",
  "nodes": {
    "node_id": {
      "id": "node_id",
      "text": "...",
      "riddle": {
        "question": "...",
        "answers": ["answer1", "answer2"],
        "hint": "..."
      },
      "children": ["child_id1"]
    }
  },
  "endings": {
    "good": {
      "text": "...",
      "isGoodEnding": true
    }
  }
}

Return ONLY valid JSON, no markdown or explanation.`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await axios.post(OPENROUTER_URL, {
                model: MODEL_PRESETS['sonnet'],
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 6000,
                temperature: 0.8
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: CONFIG.API_TIMEOUT
            });

            let content = response.data.choices[0].message.content.trim();
            // Clean markdown code blocks
            content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

            const puzzleData = JSON.parse(content);

            // Calculate node positions
            puzzleData.nodes = calculateNodePositions(puzzleData.nodes, puzzleData.startNode);

            if (validatePuzzleData(puzzleData)) {
                console.log(`✅ Puzzle generation successful on attempt ${attempt + 1}`);
                return puzzleData;
            }

            console.log(`⚠️ Attempt ${attempt + 1} failed validation, retrying...`);
        } catch (error) {
            console.error(`❌ Generation attempt ${attempt + 1} failed:`, error.message);
        }
    }

    throw new Error('Failed to generate valid puzzle after 3 attempts');
}

function calculateNodePositions(nodes, startId) {
    const positioned = {};
    const levels = {};

    // BFS to assign levels
    const queue = [[startId, 0]];
    const visited = new Set();

    while (queue.length > 0) {
        const [nodeId, level] = queue.shift();
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        if (!levels[level]) levels[level] = [];
        levels[level].push(nodeId);

        const node = nodes[nodeId];
        if (node.children && node.children.length > 0) {
            node.children.forEach(childId => {
                if (!visited.has(childId) && nodes[childId]) {
                    queue.push([childId, level + 1]);
                }
            });
        }
    }

    // Calculate positions (200px vertical spacing, 250px horizontal spacing)
    Object.keys(levels).forEach(level => {
        const nodesInLevel = levels[level];
        const levelNum = parseInt(level);
        const yPos = levelNum * 200;

        nodesInLevel.forEach((nodeId, index) => {
            const totalWidth = (nodesInLevel.length - 1) * 250;
            const xPos = nodesInLevel.length === 1 ? 0 : -totalWidth / 2 + index * 250;

            positioned[nodeId] = {
                ...nodes[nodeId],
                position: { x: xPos, y: yPos }
            };
        });
    });

    return positioned;
}

function validatePuzzleData(data) {
    // Check required fields
    if (!data.title || !data.nodes || !data.startNode) {
        console.error('Missing required top-level fields');
        return false;
    }

    // Check start node exists
    if (!data.nodes[data.startNode]) {
        console.error('Start node does not exist');
        return false;
    }

    // Check all nodes are valid
    for (const nodeId in data.nodes) {
        const node = data.nodes[nodeId];

        // Check required node fields
        if (!node.id || !node.text || !node.riddle) {
            console.error(`Node ${nodeId} missing required fields`);
            return false;
        }

        // Check riddle structure
        if (!node.riddle.question || !Array.isArray(node.riddle.answers) || node.riddle.answers.length === 0) {
            console.error(`Node ${nodeId} has invalid riddle`);
            return false;
        }

        // Validate children exist
        if (node.children && node.children.length > 0) {
            for (const childId of node.children) {
                if (!data.nodes[childId]) {
                    console.error(`Node ${nodeId} references non-existent child ${childId}`);
                    return false;
                }
            }
        }
    }

    // Check node count (8-12 nodes)
    const nodeCount = Object.keys(data.nodes).length;
    if (nodeCount < 8 || nodeCount > 12) {
        console.error(`Node count ${nodeCount} outside required range 8-12`);
        return false;
    }

    return true;
}

function generatePuzzleHTML(puzzleData, theme) {
    // Escape JSON for safe embedding in HTML
    const puzzleDataJson = JSON.stringify(puzzleData).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${puzzleData.title} - Story Riddle Puzzle</title>
    <link rel="stylesheet" href="../page-theme.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
    <style>
        body {
            padding: 20px 10px;
            overflow-x: auto;
            overflow-y: auto;
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
            padding-bottom: 50px;
        }

        .puzzle-header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 2px solid #7ec8e3;
            padding-bottom: 15px;
        }

        .puzzle-header h1 {
            margin: 0 0 5px 0;
            color: #7ec8e3;
            font-size: 1.8em;
        }

        .puzzle-subtitle {
            color: #00ffff;
            font-size: 0.9em;
            opacity: 0.8;
        }

        .stats {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }

        .stat-box {
            background: rgba(0, 255, 65, 0.1);
            border: 2px solid #00ff41;
            color: #7ec8e3;
            padding: 10px 15px;
            border-radius: 3px;
            font-size: 0.85em;
            min-width: 120px;
            text-align: center;
        }

        #p5-container {
            margin: 20px 0;
            display: flex;
            justify-content: center;
        }

        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(3px);
        }

        .modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background: #0a0a0a;
            border: 3px solid #7ec8e3;
            border-radius: 3px;
            padding: 30px;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 0 30px rgba(126, 200, 227, 0.3);
        }

        .modal-content h2 {
            color: #7ec8e3;
            margin: 0 0 15px 0;
            text-transform: uppercase;
            font-size: 1.3em;
        }

        .story-text {
            color: #7ec8e3;
            line-height: 1.6;
            margin-bottom: 20px;
            font-style: italic;
            opacity: 0.9;
        }

        .riddle-section {
            background: rgba(0, 255, 65, 0.05);
            border: 2px dashed #00ff41;
            padding: 15px;
            border-radius: 3px;
            margin-bottom: 20px;
        }

        .riddle-section h3 {
            color: #00ffff;
            margin: 0 0 10px 0;
            font-size: 1.1em;
        }

        .riddle-section p {
            color: #7ec8e3;
            margin: 0 0 15px 0;
            line-height: 1.5;
        }

        #answer {
            width: 100%;
            padding: 10px;
            margin-bottom: 10px;
            background: #1a1a1a;
            border: 2px solid #00ff41;
            color: #00ffff;
            border-radius: 3px;
            font-family: 'Courier Prime', monospace;
            font-size: 0.9em;
            box-sizing: border-box;
            min-height: 44px;
        }

        #answer:focus {
            outline: none;
            border-color: #00ffff;
            box-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
        }

        #hint {
            background: rgba(255, 200, 87, 0.1);
            border-left: 3px solid #ffc857;
            color: #ffc857;
            padding: 10px;
            margin-bottom: 10px;
            border-radius: 3px;
            font-size: 0.85em;
        }

        #feedback {
            min-height: 20px;
            margin-bottom: 10px;
            font-size: 0.9em;
        }

        #feedback.success {
            color: #00ff41;
        }

        #feedback.error {
            color: #ff0000;
        }

        .button-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }

        button {
            padding: 10px 20px;
            background: rgba(0, 255, 65, 0.2);
            border: 2px solid #00ff41;
            color: #00ff41;
            cursor: pointer;
            border-radius: 3px;
            font-family: 'Courier Prime', monospace;
            font-size: 0.9em;
            transition: all 0.2s;
            min-height: 44px;
            touch-action: manipulation;
        }

        button:hover {
            background: rgba(0, 255, 65, 0.4);
            box-shadow: 0 0 10px rgba(0, 255, 65, 0.5);
        }

        button:active {
            transform: scale(0.95);
        }

        .home-link {
            position: fixed;
            top: 10px;
            left: 10px;
            z-index: 999;
        }

        .info-panel {
            background: rgba(0, 255, 65, 0.05);
            border: 1px solid #00ff41;
            padding: 15px;
            border-radius: 3px;
            margin-top: 20px;
            color: #7ec8e3;
            font-size: 0.85em;
            line-height: 1.6;
        }

        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }

            .puzzle-header h1 {
                font-size: 1.5em;
            }

            .stats {
                gap: 10px;
                margin-bottom: 15px;
            }

            .modal-content {
                max-width: 90vw;
                padding: 20px;
                border-width: 2px;
            }

            #answer {
                font-size: 16px; /* Prevents zoom on iOS */
            }

            button {
                padding: 8px 16px;
                font-size: 0.85em;
            }
        }

        @media (max-width: 480px) {
            body {
                padding: 10px 5px;
            }

            .puzzle-header h1 {
                font-size: 1.3em;
            }

            .stat-box {
                padding: 8px 12px;
                font-size: 0.75em;
                min-width: 100px;
            }

            .modal-content {
                max-width: 95vw;
                padding: 15px;
            }

            .button-group {
                flex-direction: column;
            }

            button {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <a class="home-link" href="../index.html">← HOME</a>

    <div class="container">
        <div class="puzzle-header">
            <h1>🧩 ${puzzleData.title}</h1>
            <div class="puzzle-subtitle">Solve riddles to uncover the story...</div>
        </div>

        <div class="stats">
            <div class="stat-box">Theme: <strong>${theme}</strong></div>
            <div class="stat-box">Difficulty: <strong>${puzzleData.difficulty}</strong></div>
            <div class="stat-box">Progress: <span id="progress">0</span>/<span id="total">${Object.keys(puzzleData.nodes).length}</span></div>
        </div>

        <div id="p5-container"></div>

        <div class="info-panel">
            <strong>How to Play:</strong><br>
            • Click on any unlocked node (with a book 📖 icon) to read the story and face a riddle<br>
            • Answer the riddle correctly to unlock new paths and continue exploring<br>
            • Hints are available after 2 wrong answers<br>
            • Find the ending to complete your journey
        </div>
    </div>

    <!-- Modal for riddles -->
    <div class="modal" id="riddleModal">
        <div class="modal-content">
            <h2>📖 Story Point</h2>
            <div class="story-text" id="storyText"></div>
            <div class="riddle-section">
                <h3>🔮 Riddle:</h3>
                <p id="riddleQuestion"></p>
                <input type="text" id="answer" placeholder="Type your answer..." autocomplete="off">
                <div id="hint" style="display: none"><strong>💡 Hint:</strong> <span id="hintText"></span></div>
                <div id="feedback"></div>
                <div class="button-group">
                    <button onclick="showHint()">Hint</button>
                    <button onclick="submitAnswer()">Submit Answer</button>
                    <button onclick="closeModal()">Close</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Embed puzzle data
        const PUZZLE_DATA = JSON.parse(\`${puzzleDataJson}\`);

        // Game state
        let gameState = {
            unlockedNodes: [PUZZLE_DATA.startNode],
            currentNodeId: null,
            attempts: {},
            completedAt: null
        };

        // Load progress from localStorage
        function loadProgress() {
            const saved = localStorage.getItem('puzzle_progress');
            if (saved) {
                try {
                    gameState = JSON.parse(saved);
                } catch (e) {
                    console.error('Failed to load progress:', e);
                }
            }
        }

        // Save progress to localStorage
        function saveProgress() {
            localStorage.setItem('puzzle_progress', JSON.stringify(gameState));
            updateStats();
        }

        // Update stats display
        function updateStats() {
            document.getElementById('progress').textContent = gameState.unlockedNodes.length - 1;
        }

        // Show riddle modal
        function showRiddle(nodeId) {
            const node = PUZZLE_DATA.nodes[nodeId];
            if (!node) return;

            gameState.currentNodeId = nodeId;
            gameState.attempts[nodeId] = (gameState.attempts[nodeId] || 0);

            document.getElementById('storyText').textContent = node.text;
            document.getElementById('riddleQuestion').textContent = node.riddle.question;
            document.getElementById('answer').value = '';
            document.getElementById('feedback').textContent = '';
            document.getElementById('hint').style.display = 'none';
            document.getElementById('answer').focus();

            document.getElementById('riddleModal').classList.add('show');
        }

        // Show hint
        function showHint() {
            const node = PUZZLE_DATA.nodes[gameState.currentNodeId];
            document.getElementById('hintText').textContent = node.riddle.hint;
            document.getElementById('hint').style.display = 'block';
        }

        // Submit answer
        function submitAnswer() {
            const node = PUZZLE_DATA.nodes[gameState.currentNodeId];
            const userAnswer = document.getElementById('answer').value.trim().toLowerCase();
            const feedback = document.getElementById('feedback');

            gameState.attempts[gameState.currentNodeId]++;

            // Check if answer is correct (case-insensitive, trim whitespace)
            const isCorrect = node.riddle.answers.some(ans => ans.toLowerCase().trim() === userAnswer);

            if (isCorrect) {
                feedback.textContent = '✓ Correct! Unlocking new paths...';
                feedback.className = 'success';

                // Unlock children
                if (node.children && node.children.length > 0) {
                    node.children.forEach(childId => {
                        if (!gameState.unlockedNodes.includes(childId)) {
                            gameState.unlockedNodes.push(childId);
                        }
                    });
                }

                saveProgress();
                setTimeout(() => closeModal(), 1500);
            } else {
                feedback.textContent = '✗ Incorrect. Try again.';
                feedback.className = 'error';

                // Show hint after 2 attempts
                if (gameState.attempts[gameState.currentNodeId] >= 2) {
                    setTimeout(() => {
                        const hintBtn = document.querySelector('.button-group button:first-child');
                        hintBtn.textContent = 'Show Hint';
                    }, 500);
                }
            }
        }

        // Close modal
        function closeModal() {
            document.getElementById('riddleModal').classList.remove('show');
            gameState.currentNodeId = null;
        }

        // Close modal on background click
        document.getElementById('riddleModal').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
        });

        // p5.js sketch
        const sketchFunction = (p) => {
            let nodes = [];
            let edges = [];
            let offsetX = 0;
            let offsetY = 0;
            let zoom = 1;

            p.setup = function() {
                loadProgress();

                const containerWidth = Math.min(window.innerWidth - 40, 800);
                const containerHeight = Math.min(window.innerHeight - 300, 600);
                p.createCanvas(containerWidth, containerHeight);

                // Initialize nodes and edges from puzzle data
                Object.values(PUZZLE_DATA.nodes).forEach(node => {
                    nodes.push({
                        id: node.id,
                        x: node.position.x,
                        y: node.position.y,
                        radius: 40,
                        unlocked: gameState.unlockedNodes.includes(node.id),
                        isStart: node.id === PUZZLE_DATA.startNode
                    });
                });

                // Create edges
                Object.values(PUZZLE_DATA.nodes).forEach(node => {
                    if (node.children && node.children.length > 0) {
                        node.children.forEach(childId => {
                            edges.push({
                                from: node.id,
                                to: childId,
                                unlocked: gameState.unlockedNodes.includes(childId)
                            });
                        });
                    }
                });

                // Center view
                fitToCanvas();
            };

            p.draw = function() {
                p.background(10);

                p.push();
                p.translate(offsetX, offsetY);
                p.scale(zoom);

                // Draw edges first (so they appear behind nodes)
                edges.forEach(edge => {
                    drawEdge(edge);
                });

                // Draw nodes
                nodes.forEach(node => {
                    drawNode(node);
                });

                p.pop();
            };

            function drawEdge(edge) {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);

                if (!fromNode || !toNode) return;

                if (edge.unlocked) {
                    p.stroke('#00ffff');
                    p.strokeWeight(3);
                } else {
                    p.stroke('#7ec8e3');
                    p.strokeWeight(1);
                    p.setLineDash([5, 5]);
                }

                // Bezier curve for organic feel
                p.noFill();
                const cp1x = (fromNode.x + toNode.x) / 2;
                const cp1y = fromNode.y + 50;
                const cp2x = (fromNode.x + toNode.x) / 2;
                const cp2y = toNode.y - 50;

                p.bezier(
                    fromNode.x, fromNode.y,
                    cp1x, cp1y,
                    cp2x, cp2y,
                    toNode.x, toNode.y
                );

                if (edge.unlocked) {
                    // Draw arrow at end
                    const angle = Math.atan2(toNode.y - cp2y, toNode.x - cp2x);
                    const arrowSize = 10;
                    p.fill('#00ffff');
                    p.noStroke();
                    p.push();
                    p.translate(toNode.x - Math.cos(angle) * fromNode.radius, toNode.y - Math.sin(angle) * fromNode.radius);
                    p.rotate(angle);
                    p.triangle(0, -arrowSize / 2, -arrowSize, arrowSize / 2, 0, 0);
                    p.pop();
                }

                p.setLineDash([]);
            }

            function drawNode(node) {
                const isHovered = p.dist(p.mouseX - offsetX, p.mouseY - offsetY, node.x * zoom, node.y * zoom) < node.radius * zoom;

                if (node.unlocked) {
                    p.stroke('#00ffff');
                    p.strokeWeight(3);
                    p.fill(0, 255, 255, isHovered ? 30 : 15);
                } else {
                    p.stroke('#7ec8e3');
                    p.strokeWeight(2);
                    p.setLineDash([3, 3]);
                    p.fill(126, 200, 227, 10);
                }

                p.circle(node.x, node.y, node.radius * 2);
                p.setLineDash([]);

                // Draw icon
                p.fill(node.unlocked ? '#00ffff' : '#7ec8e3');
                p.noStroke();
                p.textAlign(p.CENTER, p.CENTER);
                p.textSize(20);
                if (node.isStart) {
                    p.text('⭐', node.x, node.y);
                } else if (node.unlocked) {
                    p.text('📖', node.x, node.y);
                } else {
                    p.text('🔒', node.x, node.y);
                }

                // Click detection
                if (isHovered && p.mouseIsPressed) {
                    if (node.unlocked && !gameState.currentNodeId) {
                        showRiddle(node.id);
                    }
                }
            }

            function fitToCanvas() {
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;

                nodes.forEach(node => {
                    minX = Math.min(minX, node.x);
                    maxX = Math.max(maxX, node.x);
                    minY = Math.min(minY, node.y);
                    maxY = Math.max(maxY, node.y);
                });

                const padding = 60;
                const width = maxX - minX + padding * 2;
                const height = maxY - minY + padding * 2;

                zoom = Math.min(
                    (p.width - 40) / width,
                    (p.height - 40) / height,
                    1.2
                );

                offsetX = p.width / 2 - (minX + maxX) / 2 * zoom;
                offsetY = p.height / 2 - (minY + maxY) / 2 * zoom;
            }

            p.windowResized = function() {
                if (document.querySelector('#p5-container')) {
                    const containerWidth = Math.min(window.innerWidth - 40, 800);
                    const containerHeight = Math.min(window.innerHeight - 300, 600);
                    p.resizeCanvas(containerWidth, containerHeight);
                    fitToCanvas();
                }
            };

            // Prevent default link dash behavior
            p.setLineDash = function(pattern) {
                // p5.js doesn't have built-in setLineDash, so we skip it
                // This is a no-op for now
            };
        };

        // Create p5 instance in instance mode
        const container = document.getElementById('p5-container');
        new p5(sketchFunction, container);

        // Update stats on load
        updateStats();
    </script>
</body>
</html>`;
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
            'kimi': 'Kimi K2 Exacto',
            'gpt5': 'GPT-5.1 Codex',
            'gemini': 'Gemini 2.5 Pro',
            'glm': 'GLM-4.6 Exacto'
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
        let llmResult = await getLLMResponse(userMessage, conversationMessages);
        let response = llmResult.text;

        // Clean duplicate Bot Sportello prefixes
        response = cleanBotResponse(response);

        // Add user message and bot response to history - include search context if any
        addToHistory(username, userMessage, false);
        if (llmResult.searchContext) {
            const searchSummary = llmResult.searchContext.map(s =>
                `[Search: "${s.query}"]\n${s.results}`
            ).join('\n\n');
            addToHistory('Bot Sportello', `${searchSummary}\n\n${response}`, true);
        } else {
            addToHistory('Bot Sportello', response, true);
        }

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

        // Configure git remote with token authentication
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
