#!/usr/bin/env node

// Test script for GUI server
const BotGUIServer = require('./gui-server.js');

console.log('Starting GUI test server...');

const guiServer = new BotGUIServer(3001);

// Start the server
guiServer.start().then(() => {
    console.log('\n✅ GUI Server is running!');
    console.log('📊 Open http://localhost:3001 to view the dashboard\n');
    
    // Simulate some logging
    setTimeout(() => {
        console.log('Simulating tool calls and file changes...\n');
        
        // Log some test events
        guiServer.log('info', 'Bot started successfully', { version: '1.0.0' });
        guiServer.log('debug', 'Connecting to Discord', { token: 'HIDDEN' });
        
        // Simulate tool calls
        guiServer.logToolCall('list_files', { path: './src' }, 'file1.html\nfile2.js\nfile3.css', null);
        guiServer.logToolCall('read_file', { path: 'src/example.html' }, '<html>...</html>', null);
        guiServer.logToolCall('write_file', { path: 'src/new.html', content: '<html>New page</html>' }, 'File created successfully', null);
        
        // Simulate file changes
        guiServer.logFileChange('create', 'src/new-page.html', '<html>New content</html>', null);
        guiServer.logFileChange('edit', 'src/existing.js', 'const updated = true;', 'const updated = false;');
        guiServer.logFileChange('read', 'index.html', null, null);
        
        // Simulate an agent loop
        const loop = guiServer.startAgentLoop('/chat Build me a game', 'testuser', '#general');
        
        setTimeout(() => {
            guiServer.updateAgentLoop(1, ['list_files', 'read_file']);
            
            setTimeout(() => {
                guiServer.updateAgentLoop(2, ['create_page']);
                
                setTimeout(() => {
                    guiServer.endAgentLoop('Successfully created game at https://example.com/game.html', null);
                    
                    // Log more events
                    guiServer.log('info', 'Game created successfully', { url: 'https://example.com/game.html' });
                    guiServer.log('error', 'Failed to commit changes', { error: 'Authentication failed' });
                    guiServer.logToolCall('commit_changes', { message: 'Add new game', files: ['.'] }, null, 'Authentication error');
                    
                }, 1000);
            }, 1000);
        }, 1000);
        
    }, 2000);
    
    // Keep the server running
    console.log('Press Ctrl+C to stop the server\n');
    
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