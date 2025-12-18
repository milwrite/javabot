// GUI Patches for index.js
// This file contains patches to add GUI logging to index.js without heavily modifying the original

const BotGUIServer = require('./gui-server.js');

let guiServer = null;

// Initialize GUI server
function initializeGUIServer(port = 3001) {
    if (!process.env.NO_GUI) {
        guiServer = new BotGUIServer(port);
        return guiServer.start().catch(err => {
            console.error('Failed to start GUI server:', err);
            guiServer = null;
        });
    }
    return Promise.resolve();
}

// Wrap existing functions to add logging
function wrapWithLogging(originalFunctions) {
    const wrapped = {};
    
    // Wrap listFiles
    if (originalFunctions.listFiles) {
        wrapped.listFiles = async function(path) {
            if (guiServer) guiServer.logToolCall('list_files', { path }, null, null);
            try {
                const result = await originalFunctions.listFiles(path);
                if (guiServer) guiServer.logToolCall('list_files', { path }, result, null);
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('list_files', { path }, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap readFile
    if (originalFunctions.readFile) {
        wrapped.readFile = async function(path) {
            if (guiServer) {
                guiServer.logToolCall('read_file', { path }, null, null);
                guiServer.logFileChange('read', path, null, null);
            }
            try {
                const result = await originalFunctions.readFile(path);
                if (guiServer) guiServer.logToolCall('read_file', { path }, result, null);
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('read_file', { path }, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap writeFile
    if (originalFunctions.writeFile) {
        wrapped.writeFile = async function(path, content) {
            if (guiServer) guiServer.logToolCall('write_file', { path, content }, null, null);
            try {
                const result = await originalFunctions.writeFile(path, content);
                if (guiServer) {
                    guiServer.logToolCall('write_file', { path, content }, result, null);
                    guiServer.logFileChange('create', path, content, null);
                }
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('write_file', { path, content }, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap editFile
    if (originalFunctions.editFile) {
        wrapped.editFile = async function(path, oldString, newString, instructions) {
            const args = { path, oldString, newString, instructions };
            if (guiServer) guiServer.logToolCall('edit_file', args, null, null);
            try {
                const result = await originalFunctions.editFile(path, oldString, newString, instructions);
                if (guiServer) {
                    guiServer.logToolCall('edit_file', args, result, null);
                    guiServer.logFileChange('edit', path, newString || instructions, oldString);
                }
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('edit_file', args, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap createPage
    if (originalFunctions.createPage) {
        wrapped.createPage = async function(name, description) {
            const args = { name, description };
            if (guiServer) guiServer.logToolCall('create_page', args, null, null);
            try {
                const result = await originalFunctions.createPage(name, description);
                if (guiServer) guiServer.logToolCall('create_page', args, result, null);
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('create_page', args, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap createFeature
    if (originalFunctions.createFeature) {
        wrapped.createFeature = async function(name, description) {
            const args = { name, description };
            if (guiServer) guiServer.logToolCall('create_feature', args, null, null);
            try {
                const result = await originalFunctions.createFeature(name, description);
                if (guiServer) guiServer.logToolCall('create_feature', args, result, null);
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('create_feature', args, null, error.message);
                throw error;
            }
        };
    }
    
    // Wrap commitChanges
    if (originalFunctions.commitChanges) {
        wrapped.commitChanges = async function(message, files) {
            const args = { message, files };
            if (guiServer) {
                guiServer.logToolCall('commit_changes', args, null, null);
                guiServer.logGitOperation('commit', { message, files });
            }
            try {
                const result = await originalFunctions.commitChanges(message, files);
                if (guiServer) guiServer.logToolCall('commit_changes', args, result, null);
                return result;
            } catch (error) {
                if (guiServer) guiServer.logToolCall('commit_changes', args, null, error.message);
                throw error;
            }
        };
    }
    
    // Return wrapped functions along with originals for any we didn't wrap
    return { ...originalFunctions, ...wrapped };
}

// Wrap getLLMResponse to add agent loop tracking
function wrapGetLLMResponse(originalGetLLMResponse) {
    return async function(userMessage, conversationMessages = [], discordContext = {}) {
        let agentLoop = null;
        
        if (guiServer) {
            agentLoop = guiServer.startAgentLoop(
                userMessage.substring(0, 100),
                discordContext.user || 'Unknown',
                discordContext.channel || 'Unknown'
            );
        }
        
        try {
            const result = await originalGetLLMResponse(userMessage, conversationMessages);
            
            if (guiServer && agentLoop) {
                guiServer.endAgentLoop(result?.text || 'Completed', null);
            }
            
            return result;
        } catch (error) {
            if (guiServer && agentLoop) {
                guiServer.endAgentLoop(null, error.message);
            }
            throw error;
        }
    };
}

// Helper to inject iteration tracking
function trackIteration(iteration, toolsUsed) {
    if (guiServer) {
        guiServer.updateAgentLoop(iteration, toolsUsed);
    }
}

// Helper to log discord events
function logDiscordEvent(eventType, data) {
    if (guiServer) {
        guiServer.logDiscordEvent(eventType, data);
    }
}

// Helper to log AI responses
function logAIResponse(model, prompt, response, tokens) {
    if (guiServer) {
        guiServer.logAIResponse(model, prompt, response, tokens);
    }
}

module.exports = {
    initializeGUIServer,
    wrapWithLogging,
    wrapGetLLMResponse,
    trackIteration,
    logDiscordEvent,
    logAIResponse,
    getGUIServer: () => guiServer
};