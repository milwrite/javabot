#!/usr/bin/env node

// Standalone GUI server for testing dashboard without running the bot
const BotGUIServer = require('./gui-server.js');

const port = process.env.GUI_PORT || 3001;
console.log('Starting standalone GUI server...');

const guiServer = new BotGUIServer(port);

guiServer.start().then(() => {
    console.log('\n✅ GUI Server is running!');
    console.log(`📊 Open http://localhost:${port} to view the dashboard`);
    console.log('📋 Press Ctrl+C to stop the server\n');
}).catch(err => {
    console.error('Failed to start GUI server:', err);
    process.exit(1);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down GUI server...');
    guiServer.stop().then(() => {
        console.log('Server stopped.');
        process.exit(0);
    });
});
