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
const MAX_HISTORY = 20;
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
        let content = '# Recent Conversation Context\n\n';
        content += 'This file contains the last 20 messages from the Discord server to provide context for ongoing conversations.\n\n';
        content += '## Recent Messages\n\n';
        
        messageHistory.forEach(entry => {
            const speaker = entry.isBot ? '**JavaBot**' : `**${entry.username}**`;
            content += `${speaker} (${entry.timestamp.split('T')[1].split('.')[0]}): ${entry.message}\n\n`;
        });
        
        content += '## Key Findings & Patterns\n\n';
        content += '- Monitor for recurring topics or questions\n';
        content += '- Note individual preferences and communication styles\n';
        content += '- Track ongoing projects or conversations\n';
        content += '- Remember who is working on what\n\n';
        
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
function buildMessagesFromHistory(maxMessages = 10) {
    // Get last N messages (default 10 to keep context manageable)
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
        .setName('create-game')
        .setDescription('Create a new JavaScript game file')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Game name')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Brief description of what the game does')
                .setRequired(true)),
                
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check repository status'),
        
        
    new SlashCommandBuilder()
        .setName('chat')
        .setDescription('Have a conversation with Lynch-powered AI')
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
            case 'create-game':
                await handleCreateGame(interaction);
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
            } else if (!interaction.replied) {
                await interaction.reply({ content: errorMsg, ephemeral: true });
            } else {
                // If we already replied, we can't reply again, so just log it
                console.error('Could not send error message - interaction already handled');
            }
        } catch (replyError) {
            console.error('Failed to send error reply:', replyError);
        }
    }
});

// Message tracking for conversation context
client.on('messageCreate', async message => {
    console.log(`Message received: ${message.author.username} (bot: ${message.author.bot}) in channel: ${message.channel.id}`);
    console.log(`Configured CHANNEL_IDS: ${CHANNEL_IDS.join(', ')}`);
    console.log(`Message content: "${message.content}"`);

    // Ignore bot messages (including our own)
    if (message.author.bot) {
        console.log('Ignoring bot message');
        return;
    }

    // Only track messages from designated channels (if CHANNEL_IDS is configured)
    if (CHANNEL_IDS.length > 0 && !CHANNEL_IDS.includes(message.channel.id)) {
        console.log(`Ignoring message - wrong channel. Expected one of: ${CHANNEL_IDS.join(', ')}, Got: ${message.channel.id}`);
        return;
    }

    // Add message to conversation history
    console.log(`Adding to history: ${message.author.username}: ${message.content}`);
    addToHistory(message.author.username, message.content, false);

    console.log(`Successfully tracked message from ${message.author.username}`);
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

async function handleCreateGame(interaction) {
    const name = interaction.options.getString('name');
    const description = interaction.options.getString('description');

    await interaction.editReply(getBotResponse('thinking'));

    try {
        // Read example game for reference
        const exampleCode = await fs.readFile('./games/example.js', 'utf8');

        // Use AI to generate the game code using Phaser
        const gamePrompt = `Create a complete, working Phaser 3 game called "${name}".
Description: ${description}

Requirements:
- Use Phaser 3 framework (it will be loaded via CDN in the HTML)
- Create a fully playable game with actual game logic (not just a template)
- Include proper Phaser config, scenes (preload, create, update)
- Make it fun and functional based on the description
- Add score tracking if relevant
- Include player controls (keyboard or mouse as appropriate)
- Use Phaser's built-in physics, sprites, and game objects
- Keep it simple but playable - basic shapes/graphics are fine
- Return ONLY the JavaScript code, no explanations or markdown

Here's a reference example of a working Phaser 3 game structure to follow:

\`\`\`javascript
${exampleCode}
\`\`\`

Follow this pattern but create a different game based on the description above.`;

        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [
                {
                    role: 'user',
                    content: gamePrompt
                }
            ],
            max_tokens: 4000,
            temperature: 0.7
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        let gameContent = response.data.choices[0].message.content;

        // Clean up markdown code blocks if present
        gameContent = gameContent.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();

        const fileName = `games/${name}.js`;

        // Create games directory if it doesn't exist
        await fs.mkdir(path.dirname(fileName), { recursive: true });
        
        // Write the game file
        await fs.writeFile(fileName, gameContent);
        
        // Also create an HTML file
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name} - ${description}</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #1a1a1a;
            color: #fff;
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
    </style>
</head>
<body>
    <h1>${name}</h1>
    <p>${description}</p>
    <div id="game"></div>
    <script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>
    <script src="${name}.js"></script>
</body>
</html>`;
        
        await fs.writeFile(`games/${name}.html`, htmlContent);

        const embed = new EmbedBuilder()
            .setTitle('🎮 Game Created')
            .setDescription(getBotResponse('success'))
            .addFields(
                { name: 'Game Name', value: name, inline: true },
                { name: 'Description', value: description, inline: false },
                { name: 'Files', value: `${fileName}\ngames/${name}.html`, inline: false }
            )
            .setColor(0x9b59b6)
            .setTimestamp();

        await interaction.editReply({ content: '', embeds: [embed] });

    } catch (error) {
        throw new Error(`Game creation failed: ${error.message}`);
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

        // Build conversation messages array from history (last 10 exchanges, excluding current message)
        const conversationMessages = buildMessagesFromHistory(10);

        // Get response with proper conversation context
        const response = await getLLMResponse(userMessage, conversationMessages);

        // Add user message and bot response to history after successful response
        addToHistory(username, userMessage, false);
        addToHistory('JavaBot', response, true);

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