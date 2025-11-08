#!/usr/bin/env node

console.log('[TEST] Starting bot test...');

try {
    console.log('[TEST] Loading dotenv...');
    require('dotenv').config();
    console.log('[TEST] Dotenv loaded');

    console.log('[TEST] Loading discord.js...');
    const { Client, GatewayIntentBits } = require('discord.js');
    console.log('[TEST] Discord.js loaded');

    console.log('[TEST] Creating client...');
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.MessageContent,
        ],
    });
    console.log('[TEST] Client created');

    client.once('ready', () => {
        console.log(`[TEST] ✓ Bot is ready as ${client.user.tag}`);
        console.log('[TEST] Bot is successfully connected!');
        process.exit(0);
    });

    client.on('error', (error) => {
        console.error('[TEST] Client error:', error);
    });

    console.log('[TEST] Attempting login...');
    console.log('[TEST] Token length:', process.env.DISCORD_TOKEN ? process.env.DISCORD_TOKEN.length : 'NO TOKEN');

    client.login(process.env.DISCORD_TOKEN)
        .then(() => console.log('[TEST] Login promise resolved'))
        .catch(error => {
            console.error('[TEST] Login failed:', error.message);
            process.exit(1);
        });

    console.log('[TEST] Login initiated, waiting for ready event...');

} catch (error) {
    console.error('[TEST] Error:', error);
    process.exit(1);
}
