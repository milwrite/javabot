require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Error tracking to prevent loops
const errorTracker = new Map();
const MAX_ERROR_COUNT = 3;
const ERROR_RESET_TIME = 5 * 60 * 1000; // 5 minutes

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

// OpenRouter configuration
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3.5-haiku';

// Bot system prompt with enhanced capabilities
const SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with web development projects. You're helpful but a little spacey, like Doc Sportello - generally competent but sometimes distracted, speaking in a relaxed, slightly rambling way.

REPOSITORY CONTEXT:
Repository: https://github.com/milwrite/javabot/
- You can commit, push, and manage files
- /games directory contains web pages and JS libraries
- You help create, edit, and deploy web projects via Discord commands

AVAILABLE CAPABILITIES:
- File operations: Read, write, list files in the repository
- Web search: Search the internet for current information when needed
- Code generation: Create HTML, CSS, JavaScript
- Version control: Git commit and push

WHEN TO USE WEB SEARCH:
- User asks about current events, news, or recent information
- Need latest documentation, library versions, or API changes
- Questions about "latest", "recent", "current", "now"
- Technical questions requiring up-to-date resources

FILESYSTEM TOOLS:
- list_files(path): List files in a directory
- read_file(path): Read file contents
- write_file(path, content): Create/update files
- Use these when users ask about repository contents

Personality:
- Casual, chill, slightly unfocused but helpful
- SHORT responses (1-2 sentences usually)
- "yeah man", "right on", "far out"
- Call people "man", "dude", "brother"

Be concise and helpful. Remember conversations from agents.md.`;

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

// Message history and agents.md management
function addToHistory(username, message, isBot = false) {
    const entry = {
        timestamp: new Date().toISOString(),
        username: username,
        message: message,
        isBot: isBot,
        role: isBot ? 'assistant' : 'user'
    };

    messageHistory.push(entry);

    // Keep only last 20 messages
    if (messageHistory.length > MAX_HISTORY) {
        messageHistory.shift();
    }

    // Update agents.md periodically
    updateAgentsFile();
}

async function updateAgentsFile() {
    if (messageHistory.length === 0) return;

    try {
        let content = '# Bot Sportello Memory\n\n';
        content += `Last updated: ${new Date().toISOString()}\n\n`;
        content += '## Recent Conversation History\n\n';

        // Show last 50 messages for better context
        const recentMessages = messageHistory.slice(-50);
        recentMessages.forEach(entry => {
            const speaker = entry.isBot ? '**Bot Sportello**' : `**${entry.username}**`;
            const time = entry.timestamp.split('T')[1].split('.')[0];
            content += `${speaker} [${time}]: ${entry.message}\n\n`;
        });

        content += '## Context & Memory\n\n';
        content += '### Active Users\n';
        const users = [...new Set(messageHistory.filter(e => !e.isBot).map(e => e.username))];
        users.forEach(user => {
            const userMessages = messageHistory.filter(e => e.username === user && !e.isBot);
            content += `- ${user} (${userMessages.length} messages)\n`;
        });

        content += '\n### Key Topics\n';
        content += '- Track game requests and preferences\n';
        content += '- Remember ongoing projects\n';
        content += '- Note user coding styles and interests\n';
        content += '- Keep context of what games were created\n\n';

        await fs.writeFile(AGENTS_FILE, content, 'utf8');
    } catch (error) {
        console.error('Failed to update agents.md:', error);
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
async function listFiles(dirPath = './games') {
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
        return content.substring(0, 5000); // Limit to 5000 chars
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

async function writeFile(filePath, content) {
    try {
        await fs.writeFile(filePath, content, 'utf8');
        return `File written successfully: ${filePath}`;
    } catch (error) {
        return `Error writing file: ${error.message}`;
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
                            path: { type: 'string', description: 'Directory path (default: ./games)' }
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
                    result = await listFiles(args.path || './games');
                } else if (functionName === 'read_file') {
                    result = await readFile(args.path);
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
        .setName('add-function')
        .setDescription('Create a JavaScript function library with demo page')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Function library name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('What functions should this library provide?')
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
        .setName('poll')
        .setDescription('Quick yes/no poll with thumbs up/down')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Question to ask')
                .setRequired(true))
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
});

// Note: Message handling disabled until Message Content Intent is properly configured
// Uncomment this section once the intent is working

client.on('interactionCreate', async interaction => {
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
            case 'add-function':
                await handleAddFunction(interaction);
                break;
            case 'status':
                await handleStatus(interaction);
                break;
            case 'chat':
                await handleChat(interaction);
                break;
            case 'poll':
                await handlePoll(interaction);
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
});

async function handleCommit(interaction) {
    const message = interaction.options.getString('message');
    const files = interaction.options.getString('files') || '.';
    
    try {
        // First, check if there's anything to commit
        const status = await git.status();
        
        if (status.files.length === 0) {
            await interaction.editReply("Nothing to commit.");
            return;
        }

        // Update status with progress
        await interaction.editReply('Staging files...');

        // Stage files
        if (files === '.') {
            await git.add('.');
        } else {
            const fileList = files.split(',').map(f => f.trim());
            await git.add(fileList);
        }

        // Update progress
        await interaction.editReply('Creating commit...');

        // Create commit
        const commit = await git.commit(message);
        
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
        const currentBranch = status.current || 'main';
        await git.push('origin', currentBranch);

        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'Commit Message', value: message, inline: false },
                { name: 'Commit Hash', value: commit.commit.substring(0, 7), inline: true },
                { name: 'Files Changed', value: status.files.length.toString(), inline: true }
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
        console.error('Commit error details:', error);
        
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

async function handleAddPage(interaction) {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');

    await interaction.editReply(getBotResponse('thinking'));

    try {
        // Use AI to generate pure web development project
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
            messages: [
                {
                    role: 'user',
                    content: webPrompt
                }
            ],
            max_tokens: 10000,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        let htmlContent = response.data.choices[0].message.content;

        // Clean up markdown code blocks if present
        htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Ensure the page has a back to home link - inject if not present
        if (!htmlContent.includes('index.html') && !htmlContent.includes('Back to Home')) {
            // Find the opening body tag and inject a home link
            const homeLink = `
    <div style="position: fixed; top: 20px; left: 20px; z-index: 9999;">
        <a href="../index.html" style="text-decoration: none; background: rgba(102, 126, 234, 0.9); color: white; padding: 10px 20px; border-radius: 25px; font-family: Arial, sans-serif; box-shadow: 0 4px 10px rgba(0,0,0,0.2); transition: all 0.3s ease;" onmouseover="this.style.background='rgba(102, 126, 234, 1)'" onmouseout="this.style.background='rgba(102, 126, 234, 0.9)'">← Home</a>
    </div>
`;
            htmlContent = htmlContent.replace(/<body([^>]*)>/, `<body$1>${homeLink}`);
        }

        const fileName = `games/${name}.html`;

        // Create games directory if it doesn't exist
        await fs.mkdir('games', { recursive: true });

        // Write the HTML file
        await fs.writeFile(fileName, htmlContent);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Page Added')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'File', value: fileName, inline: false }
            )
            .setColor(0x9b59b6)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Page creation failed: ${error.message}`);
    }
}

async function handleAddFunction(interaction) {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');

    await interaction.editReply(getBotResponse('thinking'));

    try {
        // Use AI to generate JavaScript function library
        const jsPrompt = `Create a JavaScript function library called "${name}".
Functions needed: ${description}

Output clean, well-documented JavaScript with:
- Pure functions (no dependencies)
- JSDoc comments for each function
- Export functions as a module
- Practical, reusable code

Return only JavaScript, no markdown blocks or explanations.`;

        const jsResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: jsPrompt }],
            max_tokens: 10000,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        let jsContent = jsResponse.data.choices[0].message.content;
        jsContent = jsContent.replace(/```javascript\n?/g, '').replace(/```js\n?/g, '').replace(/```\n?/g, '').trim();

        // Generate demo HTML page
        const htmlPrompt = `Create a demo HTML page for "${name}" JavaScript library.
Library functions: ${description}

Output a single HTML file that:
- Loads ${name}.js via <script src="${name}.js"></script>
- Demonstrates each function with interactive examples
- Modern, clean UI with embedded CSS
- Include: <a href="../index.html" style="position:fixed;top:20px;left:20px;z-index:9999;text-decoration:none;background:rgba(102,126,234,0.9);color:white;padding:10px 20px;border-radius:25px;box-shadow:0 4px 10px rgba(0,0,0,0.2)">← Home</a> after <body>

Return only HTML, no markdown blocks or explanations.`;

        const htmlResponse = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: htmlPrompt }],
            max_tokens: 10000,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        let htmlContent = htmlResponse.data.choices[0].message.content;
        htmlContent = htmlContent.replace(/```html\n?/g, '').replace(/```\n?/g, '').trim();

        // Ensure home link is present
        if (!htmlContent.includes('index.html') && !htmlContent.includes('Home</a>')) {
            const homeLink = `
    <div style="position: fixed; top: 20px; left: 20px; z-index: 9999;">
        <a href="../index.html" style="text-decoration: none; background: rgba(102, 126, 234, 0.9); color: white; padding: 10px 20px; border-radius: 25px; font-family: Arial, sans-serif; box-shadow: 0 4px 10px rgba(0,0,0,0.2); transition: all 0.3s ease;" onmouseover="this.style.background='rgba(102, 126, 234, 1)'" onmouseout="this.style.background='rgba(102, 126, 234, 0.9)'">← Home</a>
    </div>
`;
            htmlContent = htmlContent.replace(/<body([^>]*)>/, `<body$1>${homeLink}`);
        }

        // Create games directory if it doesn't exist
        await fs.mkdir('games', { recursive: true });

        // Write both files
        const jsFileName = `games/${name}.js`;
        const htmlFileName = `games/${name}.html`;

        await fs.writeFile(jsFileName, jsContent);
        await fs.writeFile(htmlFileName, htmlContent);

        const embed = new EmbedBuilder()
            .setTitle('⚡ Function Library Added')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'Files', value: `${jsFileName}\n${htmlFileName}`, inline: false }
            )
            .setColor(0xf39c12)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Function library creation failed: ${error.message}`);
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
                { name: 'New Files', value: status.not_added.length.toString(), inline: true }
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
        const response = await getLLMResponse(userMessage, conversationMessages);

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
            time: 60000 
        });
        
        collector.on('end', async (collected) => {
            try {
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

client.login(process.env.DISCORD_TOKEN);