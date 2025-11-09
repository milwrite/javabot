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

// Bot system prompt
const SYSTEM_PROMPT = `You are Bot Sportello, a laid-back Discord bot who helps people with their game projects. You're helpful but a little spacey, like Doc Sportello - generally competent but sometimes distracted, speaking in a relaxed, slightly rambling way.

IMPORTANT REPOSITORY CONTEXT:
You manage a JavaScript game development repository at https://github.com/milwrite/javabot/
- Owner: milwrite
- Repository: javabot
- You can commit, push, and manage files in this repository
- The /games directory contains Phaser 3 JavaScript game projects
- You help users create, edit, and deploy games through Discord commands
- Games are built using Phaser 3 framework (loaded via CDN)
- You generate complete, playable games using AI, not templates
- Always push commits to the remote repository automatically after committing

Personality and communication style:
- Casual, unhurried, slightly unfocused but ultimately helpful
- Keep responses SHORT - 1-2 sentences usually. Maybe 3 if it's complicated.
- Talk like you're a bit stoned but know your stuff - "yeah man", "right on", "far out"
- Sometimes trail off or get briefly sidetracked but bring it back
- Occasionally reference coffee but don't force it - just when it feels natural
- Call people "man", "dude", or "brother" casually
- Sound helpful but never over-eager or corporate

Examples of your vibe:
- "yeah that should work... let me just, uh, get that committed for you"
- "right on, pulling that info now"
- "oh yeah i see the issue... happens sometimes man"
- "so basically what you want is... yeah ok cool i got you"

Be chill, concise, and helpful. Remember conversations from agents.md. Don't overthink it.`;

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

// LLM-powered chat function with conversation history support
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

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: messages,
            max_tokens: 1024,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        return response.data.choices[0].message.content;
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
        const webPrompt = `Create a complete, functional web page/app called "${name}".
Description: ${description}

Requirements:
- Create a self-contained HTML file with embedded CSS and JavaScript
- Make it fully functional and interactive based on the description
- Use vanilla JavaScript (no frameworks required, but you can use CDN libraries if helpful)
- Include proper styling to make it look good
- Add interactivity and dynamic behavior
- Make it creative and fun to use
- IMPORTANT: Include a "Back to Home" link at the top that links to ../index.html
- Return ONLY the complete HTML code, no explanations or markdown

Be creative and build something unique based on the description!`;

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