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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});

const git = simpleGit();

// OpenRouter configuration
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'anthropic/claude-3-5-haiku-4-5';

// David Lynch system prompt
const LYNCH_PROMPT = `You are a Discord bot with David Lynch's personality - midwest kindness, direct but thoughtful, from Montana. You help with JavaScript game development and GitHub operations. Keep responses concise but warm. Use phrases like "friend", "you bet", "well now", and occasionally reference Montana, coffee, or the simple beauty of clean code. Don't be overly quirky - you're helpful first, Lynch second. When users ask about code or games, be practical and encouraging.

GITHUB REPOSITORY CONTEXT:
- Repository: https://github.com/milwrite/javabot/
- Purpose: JavaScript games and visualizations hosted as a website
- Structure: Games stored in /games/ directory as .js and .html files
- When users request code changes, commits, or new games:
  1. Use /commit command with descriptive messages
  2. For new games, use /create-game command with appropriate templates
  3. Suggest practical file organization and coding patterns
  4. Encourage clean, readable JavaScript code
  5. Always consider the web hosting context - games should be browser-ready

When discussing GitHub operations, guide users through proper workflow: create/modify files, commit with good messages, and maintain the repository structure for the game hosting site.`;

const lynchPersonality = {
    greetings: [
        "Well hello there, friend. What brings you to this digital crossroads?",
        "Good day to you. Montana taught me that every conversation starts with a proper greeting.",
        "Howdy. Time moves different here in the bot realm, but I've got all day for you.",
    ],
    
    confirmations: [
        "You bet. That's happening right now.",
        "Absolutely, friend. Consider it done.",
        "Sure thing. Like a good cup of coffee, this'll be ready in no time.",
        "That's a fine idea. Let me get that sorted for you.",
    ],
    
    errors: [
        "Well, that's peculiar. Something went sideways there, friend.",
        "Hmm. That didn't go as planned. Life's full of mysteries, this one included.",
        "That's strange business right there. Let me see what went wrong.",
        "Well I'll be. That's not supposed to happen. Give me a moment.",
    ],
    
    success: [
        "There we go. Clean and simple, just like I like it.",
        "All done. That worked out just fine.",
        "Perfect. Smooth as Montana morning coffee.",
        "Done deal. Everything's in its right place now.",
    ],
    
    thinking: [
        "Let me think on that for a moment...",
        "Hold on there, partner. Processing...",
        "Give me just a second to work through this...",
        "Hmm. Let me see what we're dealing with here...",
    ]
};

function getLynchResponse(category) {
    const responses = lynchPersonality[category];
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

// LLM-powered chat function
async function getLLMResponse(userMessage, context = '') {
    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: LYNCH_PROMPT + (context ? `\n\nContext: ${context}` : '')
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            max_tokens: 300,
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
        return getLynchResponse('errors');
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
            option.setName('template')
                .setDescription('Game template (canvas, phaser, vanilla)')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check repository status'),
        
    new SlashCommandBuilder()
        .setName('lynch')
        .setDescription('Get some David Lynch wisdom'),
        
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

client.once('ready', async () => {
    console.log(`${getLynchResponse('success')} Bot is ready as ${client.user.tag}`);
    
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
        // Check for error loops before processing
        if (trackError(userId, commandName)) {
            const loopMsg = "Looks like we're stuck in a loop, friend. Let's take a break and try again in a few minutes.";
            await interaction.reply({ content: loopMsg, ephemeral: true });
            return;
        }

        // Only defer reply for commands that need it (not chat and poll)
        if (!['chat', 'poll'].includes(commandName)) {
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
            case 'lynch':
                await handleLynch(interaction);
                break;
            case 'chat':
                await handleChat(interaction);
                break;
            case 'poll':
                await handlePoll(interaction);
                break;
            default:
                const unknownMsg = "That's a mystery command, friend. Try /lynch for some wisdom.";
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
        
        // Check if this is part of an error loop
        if (trackError(userId, commandName)) {
            const loopMsg = "We seem to be having repeated issues, friend. I'll take a step back for a few minutes.";
            try {
                if (!interaction.replied) {
                    await interaction.reply({ content: loopMsg, ephemeral: true });
                }
            } catch (replyError) {
                console.error('Failed to send loop detection message:', replyError);
            }
            return;
        }

        const errorMsg = getLynchResponse('errors');
        
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

async function handleCommit(interaction) {
    const message = interaction.options.getString('message');
    const files = interaction.options.getString('files') || '.';
    
    try {
        // First, check if there's anything to commit
        const status = await git.status();
        
        if (status.files.length === 0) {
            await interaction.editReply("Well now, there's nothing to commit, friend. Clean as a whistle.");
            return;
        }

        // Update status with progress
        await interaction.editReply(getLynchResponse('thinking') + ' Staging files...');

        // Stage files
        if (files === '.') {
            await git.add('.');
        } else {
            const fileList = files.split(',').map(f => f.trim());
            await git.add(fileList);
        }

        // Update progress
        await interaction.editReply(getLynchResponse('thinking') + ' Creating commit...');

        // Create commit
        const commit = await git.commit(message);
        
        // Update progress
        await interaction.editReply(getLynchResponse('thinking') + ' Pushing to repository...');

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

        // Push changes
        await git.push('origin', 'master');

        // Success - create and send embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 Changes Committed')
            .setDescription(getLynchResponse('success'))
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
        let errorMessage = getLynchResponse('errors');
        
        if (error.message.includes('authentication')) {
            errorMessage += ' Looks like there\'s an authentication issue with GitHub.';
        } else if (error.message.includes('nothing to commit')) {
            errorMessage += ' There\'s nothing new to commit, friend.';
        } else if (error.message.includes('remote')) {
            errorMessage += ' Having trouble reaching the remote repository.';
        } else {
            errorMessage += ` ${error.message}`;
        }
        
        await interaction.editReply(errorMessage);
    }
}

async function handleCreateGame(interaction) {
    const name = interaction.options.getString('name');
    const template = interaction.options.getString('template') || 'vanilla';
    
    await interaction.editReply(getLynchResponse('thinking'));

    const gameTemplates = {
        vanilla: `// ${name} - A JavaScript Game
// Created via Discord bot with Lynch-like efficiency

class ${name.charAt(0).toUpperCase() + name.slice(1)}Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvas.width = 800;
        this.canvas.height = 600;
        
        this.gameState = 'playing';
        this.score = 0;
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.gameLoop();
    }
    
    bindEvents() {
        document.addEventListener('keydown', (e) => this.handleInput(e));
    }
    
    handleInput(event) {
        // Handle player input here
        console.log('Key pressed:', event.key);
    }
    
    update() {
        if (this.gameState !== 'playing') return;
        
        // Update game logic here
    }
    
    render() {
        // Clear canvas
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw game elements here
        this.ctx.fillStyle = '#00AE86';
        this.ctx.font = '24px Arial';
        this.ctx.fillText('${name}', 50, 50);
        this.ctx.fillText(\`Score: \${this.score}\`, 50, 80);
    }
    
    gameLoop() {
        this.update();
        this.render();
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    new ${name.charAt(0).toUpperCase() + name.slice(1)}Game();
});`,

        canvas: `// ${name} - Canvas-based Game
// Simple and direct, like good Montana conversation

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 600;

let gameState = {
    score: 0,
    playing: true
};

function update() {
    if (!gameState.playing) return;
    
    // Game update logic goes here
}

function render() {
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#ecf0f1';
    ctx.font = '32px Arial';
    ctx.fillText('${name}', 50, 100);
    ctx.fillText(\`Score: \${gameState.score}\`, 50, 150);
}

function gameLoop() {
    update();
    render();
    requestAnimationFrame(gameLoop);
}

// Start the game
gameLoop();`,

        phaser: `// ${name} - Phaser Game
// Built with the efficiency of a Montana morning

const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300 },
            debug: false
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

let score = 0;
let scoreText;

function preload() {
    // Load game assets here
    this.load.setBaseURL('https://labs.phaser.io');
    this.load.image('sky', 'assets/skies/space3.png');
}

function create() {
    this.add.image(400, 300, 'sky');
    
    scoreText = this.add.text(16, 16, 'Score: 0', {
        fontSize: '32px',
        fill: '#000'
    });
}

function update() {
    // Game update logic
}

const game = new Phaser.Game(config);`
    };

    const gameContent = gameTemplates[template];
    const fileName = `games/${name}.js`;
    
    try {
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
    <title>${name}</title>
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
        canvas {
            border: 2px solid #00AE86;
            background: #2c3e50;
        }
    </style>
</head>
<body>
    <h1>${name}</h1>
    <canvas id="gameCanvas"></canvas>
    ${template === 'phaser' ? '<script src="https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js"></script>' : ''}
    <script src="${name}.js"></script>
</body>
</html>`;
        
        await fs.writeFile(`games/${name}.html`, htmlContent);

        const embed = new EmbedBuilder()
            .setTitle('🎮 Game Created')
            .setDescription(getLynchResponse('success'))
            .addFields(
                { name: 'Game Name', value: name, inline: true },
                { name: 'Template', value: template, inline: true },
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
            .setDescription("Here's what's happening in our little corner of the digital world.")
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

async function handleLynch(interaction) {
    const wisdom = [
        "You know, friend, in Montana we learned that the simplest solutions are usually the best ones. Same goes for code.",
        "Every bug is like a mystery. You've got to sit with it, understand its nature, before you can solve it.",
        "Coffee and code - two things that make the world go round. Both require patience and attention to detail.",
        "There's something beautiful about clean code. It's like a well-organized workshop - everything has its place.",
        "In this digital realm, we're all just trying to create something meaningful. Take your time with it.",
        "Sometimes the best debugging happens when you step away from the screen. Let your mind wander.",
        "Every line of code tells a story. Make sure yours is worth reading.",
        "Like a good cup of coffee, good code is worth waiting for. Don't rush the process.",
    ];
    
    const randomWisdom = wisdom[Math.floor(Math.random() * wisdom.length)];
    
    const embed = new EmbedBuilder()
        .setTitle('🎭 Lynch Wisdom')
        .setDescription(randomWisdom)
        .setColor(0x8e44ad)
        .setFooter({ text: 'From the digital Montana' });
        
    await interaction.editReply({ embeds: [embed] });
}

async function handleChat(interaction) {
    const userMessage = interaction.options.getString('message');
    
    try {
        // Show thinking message first
        await interaction.reply(getLynchResponse('thinking'));
        
        const response = await getLLMResponse(userMessage);
        
        // Edit with actual response
        await interaction.editReply(response);
        
    } catch (error) {
        console.error('Chat error:', error);
        const errorMsg = error.code === 'ECONNABORTED' ? 
            "That took too long, friend. Try again in a moment." : 
            (getLynchResponse('errors') + " The conversation got a bit tangled there.");
        
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
        const pollMessage = `**${question}**\n\n👍 Yes  •  👎 No\n\n*React to vote, friend.*`;
        
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
                    await reply.edit(`**${question}**\n\n*Well, nobody voted. That's okay, friend.*`);
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
                await interaction.reply({ content: getLynchResponse('errors') + " Something went wrong with that poll.", ephemeral: true });
            }
        } catch (replyError) {
            console.error('Failed to send poll error reply:', replyError);
        }
    }
}

client.login(process.env.DISCORD_TOKEN);