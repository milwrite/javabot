// services/filesystem.js
// Filesystem tools for AI function calling - list, read, write, edit, search

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Import from shared config
const { MODEL_PRESETS, OPENROUTER_URL } = require('../config/models');
const { pushFileViaAPI } = require('./gitHelper');

// Default config values (can be overridden via options)
const DEFAULTS = {
    FILE_READ_LIMIT: 5000,
    AI_TEMPERATURE: 0.7
};

/**
 * Clean markdown code blocks from AI-generated content
 * @param {string} content - Content to clean
 * @param {string} type - File type (html, js, css)
 * @returns {string} Cleaned content
 */
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

/**
 * List files in a directory, grouped by extension
 * @param {string|string[]} dirPath - Directory path(s) to list
 * @returns {Promise<string>} Formatted file listing
 */
async function listFiles(dirPath = './src') {
    try {
        // Handle multiple directories (array input)
        if (Array.isArray(dirPath)) {
            const allResults = [];

            for (const singleDir of dirPath) {
                const result = await listFiles(singleDir);
                if (!result.startsWith('Error')) {
                    allResults.push(`**${singleDir}:** ${result}`);
                } else {
                    allResults.push(`**${singleDir}:** ${result}`);
                }
            }

            return allResults.join('\n');
        }

        const files = await fs.readdir(dirPath);

        // Return structured, searchable format instead of flat comma-separated list
        // Group by extension for easier navigation
        const byExtension = {};
        files.forEach(file => {
            const ext = path.extname(file).toLowerCase() || '.other';
            if (!byExtension[ext]) byExtension[ext] = [];
            byExtension[ext].push(file);
        });

        // Build searchable output with file count
        let output = `📁 ${dirPath} (${files.length} files)\n`;

        // Sort extensions by frequency (most common first)
        const sortedExts = Object.entries(byExtension)
            .sort((a, b) => b[1].length - a[1].length);

        for (const [ext, extFiles] of sortedExts) {
            output += `\n${ext} (${extFiles.length}):\n`;
            // Sort files alphabetically for easy scanning
            extFiles.sort().forEach(file => {
                output += `  - ${file}\n`;
            });
        }

        return output.trim();
    } catch (error) {
        return `Error listing files: ${error.message}`;
    }
}

/**
 * Check if a file exists at the given path
 * Fast existence check without reading content
 * Supports: URLs, informal names ("Peanut city" → src/peanut-city.html), and exact paths
 * @param {string|string[]} filePath - File path(s) to check
 * @returns {Promise<string>} Existence status
 */
async function fileExists(filePath) {
    try {
        // Handle multiple files (array input)
        if (Array.isArray(filePath)) {
            const results = [];
            for (const singlePath of filePath) {
                const exists = await fileExists(singlePath);
                results.push(`${singlePath}: ${exists}`);
            }
            return results.join('\n');
        }

        // Normalize path - handle URLs from bot.inference-arcade.com
        let normalizedPath = filePath;
        const urlMatch = filePath.match(/bot\.inference-arcade\.com\/(.+)/);
        if (urlMatch) {
            normalizedPath = urlMatch[1];
            console.log(`[FILE_EXISTS] Extracted path from URL: ${normalizedPath}`);
        }

        // Try exact path first
        try {
            await fs.access(normalizedPath);
            const stats = await fs.stat(normalizedPath);
            return `✅ EXISTS: ${normalizedPath} (${stats.size} bytes)`;
        } catch {
            // Exact path not found - try fuzzy variations
        }

        // Generate fuzzy variations for informal names
        const variations = [];
        const baseName = normalizedPath
            .toLowerCase()
            .replace(/\s+/g, '-')           // "Peanut City" → "peanut-city"
            .replace(/[^a-z0-9\-\.\/]/g, '') // Remove special chars
            .replace(/\.html$/, '');         // Remove .html if present

        // Try common patterns
        variations.push(`src/${baseName}.html`);
        variations.push(`src/${baseName}`);
        variations.push(`${baseName}.html`);

        // Also try with underscores instead of hyphens
        const underscoreVersion = baseName.replace(/-/g, '_');
        if (underscoreVersion !== baseName) {
            variations.push(`src/${underscoreVersion}.html`);
        }

        for (const variation of variations) {
            try {
                await fs.access(variation);
                const stats = await fs.stat(variation);
                return `✅ EXISTS: ${variation} (${stats.size} bytes) [matched from "${filePath}"]`;
            } catch {
                // Try next variation
            }
        }

        // If still not found, suggest similar files
        try {
            const srcFiles = await fs.readdir('./src');
            const searchTerm = baseName.replace(/-/g, '').replace(/_/g, '');
            const similar = srcFiles.filter(f => {
                const normalized = f.toLowerCase().replace(/-/g, '').replace(/_/g, '').replace('.html', '').replace('.js', '');
                return normalized.includes(searchTerm) || searchTerm.includes(normalized);
            }).slice(0, 5);

            if (similar.length > 0) {
                return `❌ NOT FOUND: ${filePath}\n💡 Similar files in src/: ${similar.join(', ')}`;
            }
        } catch {
            // Can't read src dir
        }

        return `❌ NOT FOUND: ${filePath}`;
    } catch (error) {
        return `❌ NOT FOUND: ${filePath} (error: ${error.message})`;
    }
}

/**
 * Read file contents with URL/path normalization
 * @param {string|string[]} filePath - File path(s) to read
 * @param {Object} options - Options
 * @param {number} options.fileReadLimit - Max chars to read (default: 5000)
 * @param {Function} options.onFileChange - Callback for logging file changes
 * @returns {Promise<string>} File contents or error message
 */
async function readFile(filePath, options = {}) {
    const { fileReadLimit = DEFAULTS.FILE_READ_LIMIT, onFileChange } = options;

    try {
        // Handle multiple files (array input)
        if (Array.isArray(filePath)) {
            const allResults = [];
            let totalChars = 0;

            for (const singleFile of filePath) {
                if (totalChars >= fileReadLimit) {
                    allResults.push(`**[Truncated]** - File limit reached`);
                    break;
                }

                const result = await readFile(singleFile, options);
                const remaining = fileReadLimit - totalChars;

                if (!result.startsWith('Error')) {
                    const truncated = result.length > remaining ? result.substring(0, remaining) : result;
                    allResults.push(`**${singleFile}:**\n${truncated}`);
                    totalChars += truncated.length;
                } else {
                    allResults.push(`**${singleFile}:** ${result}`);
                }
            }

            return allResults.join('\n\n---\n\n');
        }

        // Normalize path - handle URLs from bot.inference-arcade.com
        let normalizedPath = filePath;
        const urlMatch = filePath.match(/bot\.inference-arcade\.com\/(.+)/);
        if (urlMatch) {
            normalizedPath = urlMatch[1];
            console.log(`[READ_FILE] Extracted path from URL: ${normalizedPath}`);
        }

        // Try reading the file with automatic path resolution
        let content;
        const pathsToTry = [normalizedPath];

        // If path doesn't start with src/, try adding src/ prefix
        if (!normalizedPath.startsWith('src/') && !normalizedPath.startsWith('./src/')) {
            pathsToTry.push(`src/${normalizedPath}`);
            // If no extension, try .html
            if (!normalizedPath.includes('.')) {
                pathsToTry.push(`src/${normalizedPath}.html`);
            }
        }

        // If path starts with src/, also try without src/ prefix (for root files like projectmetadata.json)
        if (normalizedPath.startsWith('src/')) {
            pathsToTry.push(normalizedPath.replace(/^src\//, ''));
        }

        let lastError;
        for (const tryPath of pathsToTry) {
            try {
                content = await fs.readFile(tryPath, 'utf8');
                if (tryPath !== normalizedPath) {
                    console.log(`[READ_FILE] Resolved ${normalizedPath} -> ${tryPath}`);
                }
                normalizedPath = tryPath;
                break;
            } catch (e) {
                lastError = e;
            }
        }

        if (!content) {
            return `Error reading file: ${lastError.message}. Tried: ${pathsToTry.join(', ')}`;
        }

        const truncatedContent = content.substring(0, fileReadLimit);

        // Log file read to GUI dashboard
        if (onFileChange) {
            onFileChange('read', normalizedPath, truncatedContent);
        }

        return truncatedContent;
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

/**
 * Write a file and auto-push to GitHub
 * @param {string} filePath - Path to write
 * @param {string} content - Content to write
 * @param {Object} options - Options
 * @param {Function} options.onFileChange - Callback for logging file changes
 * @returns {Promise<string>} Success message or error
 */
async function writeFile(filePath, content, options = {}) {
    const { onFileChange } = options;

    try {
        // Create directory if it doesn't exist
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        // Write the file
        await fs.writeFile(filePath, content, 'utf8');
        console.log(`[WRITE_FILE] Written: ${filePath} (${content.length} bytes)`);

        // Log file creation to GUI dashboard
        if (onFileChange) {
            onFileChange('create', filePath, content);
        }

        // Auto-commit and push via GitHub API so file is live before link is shared
        console.log(`[WRITE_FILE] Auto-pushing to remote via GitHub API...`);
        const fileName = path.basename(filePath);
        const commitMessage = `add ${fileName}`;

        try {
            const sha = await pushFileViaAPI(filePath, content, commitMessage, 'main');
            console.log(`[WRITE_FILE] Pushed: ${commitMessage} (${sha?.slice(0,7) || 'no-sha'})`);
            return `File written and pushed: ${filePath} (${content.length} bytes) - now live at https://bot.inference-arcade.com/${filePath}`;
        } catch (pushErr) {
            console.error('[WRITE_FILE_PUSH]', pushErr.message);
            throw pushErr;
        }
    } catch (error) {
        console.error(`[WRITE_FILE] Error:`, error.message);
        return `Error writing file: ${error.message}`;
    }
}

/**
 * Edit a file using exact string replacement or AI-based editing
 * @param {string} filePath - Path to edit
 * @param {string|null} oldString - String to replace (exact mode)
 * @param {string|null} newString - Replacement string (exact mode)
 * @param {string|null} instructions - AI instructions (AI mode)
 * @param {Array|null} replacements - Batch replacements [{old, new, replace_all}]
 * @param {Object} options - Options
 * @param {number} options.aiTemperature - AI temperature (default: 0.7)
 * @param {Function} options.onFileChange - Callback for logging file changes
 * @returns {Promise<string>} Success message or error
 */
async function editFile(filePath, oldString = null, newString = null, instructions = null, replacements = null, options = {}) {
    const { aiTemperature = DEFAULTS.AI_TEMPERATURE, onFileChange } = options;
    // Anchor-range options (optional)
    const startMarker = options.start_marker;
    const endMarker = options.end_marker;
    const newBlock = options.new_block;
    const includeMarkers = !!options.include_markers;
    const lineStart = Number.isInteger(options.line_start) ? options.line_start : null;
    const lineEnd = Number.isInteger(options.line_end) ? options.line_end : null;
    const startTime = Date.now();
    console.log(`[EDIT_FILE] Starting edit for: ${filePath}`);

    try {
        // Path resolution - same logic as readFile
        let resolvedPath = filePath;
        const pathsToTry = [filePath];

        // If path starts with src/, also try without src/ prefix (for root files like projectmetadata.json)
        if (filePath.startsWith('src/')) {
            pathsToTry.push(filePath.replace(/^src\//, ''));
        }
        // If path doesn't start with src/, try adding src/ prefix
        if (!filePath.startsWith('src/') && !filePath.startsWith('./src/')) {
            pathsToTry.push(`src/${filePath}`);
        }

        let currentContent;
        let lastError;
        for (const tryPath of pathsToTry) {
            try {
                currentContent = await fs.readFile(tryPath, 'utf-8');
                if (tryPath !== filePath) {
                    console.log(`[EDIT_FILE] Resolved ${filePath} -> ${tryPath}`);
                }
                resolvedPath = tryPath;
                break;
            } catch (e) {
                lastError = e;
            }
        }

        if (!currentContent) {
            throw lastError;
        }

        // Update filePath to resolved path for write operations
        filePath = resolvedPath;
        const fileSize = (currentContent.length / 1024).toFixed(1);
        console.log(`[EDIT_FILE] File size: ${fileSize}KB`);

        let updatedContent;
        let changeDescription;

        // Mode 0: Batch replacement (FASTEST - multiple edits in one call)
        if (replacements !== null && Array.isArray(replacements) && replacements.length > 0) {
            console.log(`[EDIT_FILE] Using batch replacement mode (${replacements.length} replacements)`);

            updatedContent = currentContent;
            const results = [];

            for (let i = 0; i < replacements.length; i++) {
                // Accept both 'old'/'new' (preferred) AND 'old_string'/'new_string' (common LLM mistake)
                const oldStr = replacements[i].old ?? replacements[i].old_string;
                const newStr = replacements[i].new ?? replacements[i].new_string;
                const replaceAll = replacements[i].replace_all;

                if (!oldStr || newStr === undefined) {
                    throw new Error(`Batch edit ${i + 1}: missing 'old'/'new' (or 'old_string'/'new_string') property`);
                }

                const occurrences = updatedContent.split(oldStr).length - 1;

                if (occurrences === 0) {
                    throw new Error(`Batch edit ${i + 1}/${replacements.length} failed: string not found: "${oldStr.slice(0, 50)}..."`);
                }

                if (occurrences > 1 && !replaceAll) {
                    throw new Error(`Batch edit ${i + 1}/${replacements.length} failed: string appears ${occurrences} times. Use replace_all: true or provide more context.`);
                }

                updatedContent = replaceAll ? updatedContent.split(oldStr).join(newStr) : updatedContent.replace(oldStr, newStr);
                results.push(`${i + 1}. ${oldStr.length}→${newStr.length}${replaceAll ? ` (×${occurrences})` : ''}`);
            }

            changeDescription = `Batch replaced ${replacements.length} strings: ${results.join(', ')}`;
            const batchTime = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[EDIT_FILE] Batch replacement completed in ${batchTime}s`);

        // Mode 1: Exact string replacement (FAST - preferred method)
        } else if (oldString !== null && newString !== null) {
            console.log(`[EDIT_FILE] Using exact string replacement mode`);

            // Count occurrences of old_string
            const occurrences = currentContent.split(oldString).length - 1;

            if (occurrences === 0) {
                // Diagnostic logging for debugging
                console.error(`[EDIT_FILE] String not found diagnostic:`);
                console.error(`  Search string length: ${oldString.length} chars`);
                console.error(`  Search string (escaped): ${JSON.stringify(oldString).slice(0, 300)}`);

                // Check if match exists with normalized whitespace
                const normalized = oldString.replace(/\s+/g, ' ').trim();
                if (currentContent.replace(/\s+/g, ' ').includes(normalized)) {
                    console.error(`  HINT: Match exists with different whitespace!`);
                }
                // Fallback: whitespace-tolerant unique match (strict)
                const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const tokens = oldString.split(/\s+/).filter(Boolean).map(escapeRegex);
                if (tokens.length >= 2) {
                    const pattern = tokens.join('\\s+');
                    let regex;
                    try {
                        regex = new RegExp(pattern, 'gs');
                    } catch (reErr) {
                        console.error(`[EDIT_FILE] Whitespace-tolerant regex build failed: ${reErr.message}`);
                        throw new Error(`String not found in file. Tried a whitespace-tolerant match but failed to build regex.`);
                    }

                    const matches = currentContent.match(regex) || [];
                    if (matches.length === 1) {
                        // Unique tolerant match: apply replacement
                        updatedContent = currentContent.replace(regex, () => newString);
                        changeDescription = `Replaced (whitespace-tolerant) ${oldString.length} → ${newString.length} chars`;
                        const replacementTime = ((Date.now() - startTime) / 1000).toFixed(2);
                        console.log(`[EDIT_FILE] Exact not found; applied whitespace-tolerant replacement in ${replacementTime}s`);
                    } else if (matches.length > 1) {
                        throw new Error(`String not found exactly. A whitespace-tolerant match appears ${matches.length} times; please provide more unique context or use replace_all.`);
                    } else {
                        throw new Error(`String not found in file. The exact string to replace was not found, and no whitespace-tolerant match was found either.`);
                    }
                } else {
                    throw new Error(`String not found in file. The exact string to replace was not found. Make sure to use the EXACT string from the file, including all whitespace and indentation.`);
                }
            }

            if (occurrences > 1) {
                throw new Error(`String appears ${occurrences} times in file. The old_string must be unique. Provide more context (surrounding lines) to make it unique, or use replace_all mode.`);
            }

            // Perform the replacement
            if (!updatedContent) { // Not set by whitespace-tolerant fallback
                updatedContent = currentContent.replace(oldString, newString);
                changeDescription = `Replaced exact string (${oldString.length} → ${newString.length} chars)`;
            }

            const replacementTime = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`[EDIT_FILE] Exact replacement completed in ${replacementTime}s`);

        // Mode 1b: Anchor-range replacement (deterministic multi-line edits)
        } else if ((startMarker && endMarker && typeof newBlock === 'string') || (lineStart && lineEnd && typeof newBlock === 'string')) {
            console.log('[EDIT_FILE] Using anchor-range replacement mode');
            // Prefer marker-based when provided
            if (startMarker && endMarker) {
                const firstIdx = currentContent.indexOf(startMarker);
                const lastIdx = currentContent.lastIndexOf(startMarker);
                if (firstIdx === -1) {
                    throw new Error(`Start marker not found: "${startMarker.slice(0, 80)}"`);
                }
                if (firstIdx !== lastIdx) {
                    throw new Error('Start marker appears multiple times; provide a more specific marker.');
                }
                const endFirst = currentContent.indexOf(endMarker);
                const endLast = currentContent.lastIndexOf(endMarker);
                if (endFirst === -1) {
                    throw new Error(`End marker not found: "${endMarker.slice(0, 80)}"`);
                }
                if (endFirst !== endLast) {
                    throw new Error('End marker appears multiple times; provide a more specific marker.');
                }
                const startIdx = firstIdx;
                const endIdx = endFirst;
                if (endIdx < startIdx) {
                    throw new Error('End marker appears before start marker.');
                }
                let replaceStart = includeMarkers ? startIdx : startIdx + startMarker.length;
                let replaceEnd = includeMarkers ? endIdx + endMarker.length : endIdx;
                if (replaceStart < 0 || replaceEnd > currentContent.length || replaceStart > replaceEnd) {
                    throw new Error('Computed replacement range is invalid.');
                }
                updatedContent = currentContent.slice(0, replaceStart) + newBlock + currentContent.slice(replaceEnd);
                changeDescription = `Replaced block between markers${includeMarkers ? ' (including markers)' : ''}`;
            } else {
                // Line-range replacement (1-based inclusive)
                const lines = currentContent.split('\n');
                if (!lineStart || !lineEnd || lineStart < 1 || lineEnd < lineStart || lineEnd > lines.length) {
                    throw new Error('Invalid line range for replacement.');
                }
                const insertLines = newBlock.split('\n');
                lines.splice(lineStart - 1, lineEnd - lineStart + 1, ...insertLines);
                updatedContent = lines.join('\n');
                changeDescription = `Replaced lines ${lineStart}-${lineEnd}`;
            }

        // Mode 2: AI-based editing (SLOW - fallback for complex changes)
        } else if (instructions !== null) {
            console.log(`[EDIT_FILE] Using AI-based editing mode (slow fallback)`);

            // Use Kimi-fast for edits - faster than thinking model
            const editModel = MODEL_PRESETS['kimi-fast'];
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
                temperature: aiTemperature,
                provider: { data_collection: 'deny' } // ZDR enforcement
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

        // Log file edit to GUI dashboard
        if (onFileChange) {
            onFileChange('edit', filePath, updatedContent, currentContent);
        }

        // Auto-commit and push so changes are live before link is shared
        console.log(`[EDIT_FILE] Auto-pushing to remote...`);
        const fileName = path.basename(filePath);
        const commitMessage = `update ${fileName}`;

        // Push via GitHub API
        try {
            const sha = await pushFileViaAPI(filePath, updatedContent, commitMessage, 'main');
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`[EDIT_FILE] Pushed: ${filePath} (${sha?.slice(0,7) || 'no-sha'}) in ${totalTime}s`);
            return `File edited and pushed: ${filePath}. ${changeDescription} - now live`;
        } catch (apiErr) {
            const detail = apiErr.response?.data?.message || apiErr.message;
            console.error(`[EDIT_FILE] Push failed: ${detail}`, apiErr.response?.data || '');
            return `Error editing file: GitHub push failed - ${detail}`;
        }
    } catch (error) {
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`[EDIT_FILE] Error after ${totalTime}s:`, error.message);
        return `Error editing file: ${error.message}`;
    }
}

/**
 * Search within a single file for text patterns
 * @param {string} pattern - Regex pattern to search
 * @param {string} filePath - File to search
 * @param {Object} options - Search options
 * @returns {Promise<string>} Search results
 */
async function searchSingleFile(pattern, filePath, options = {}) {
    const {
        caseInsensitive = false,
        wholeWord = false,
        maxResults = 50
    } = options;

    const results = [];
    const flags = caseInsensitive ? 'gi' : 'g';
    let searchRegex;

    try {
        const regexPattern = wholeWord ? `\\b${pattern}\\b` : pattern;
        searchRegex = new RegExp(regexPattern, flags);
    } catch (error) {
        return `Error: Invalid regex pattern "${pattern}": ${error.message}`;
    }

    try {
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n');
        const relativePath = path.relative(process.cwd(), filePath);

        lines.forEach((line, index) => {
            if (searchRegex.test(line)) {
                results.push({
                    file: relativePath,
                    line: index + 1,
                    content: line.trim()
                });

                // Stop if we hit max results
                if (results.length >= maxResults) {
                    return;
                }
            }
        });

        if (results.length === 0) {
            return `No matches found for "${pattern}" in ${relativePath}`;
        }

        // Format results
        let output = `**Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}" in ${relativePath}**\n\n`;

        results.forEach(result => {
            output += `**Line ${result.line}:** ${result.content}\n`;
        });

        return output.trim();
    } catch (error) {
        return `Error reading file ${filePath}: ${error.message}`;
    }
}

/**
 * Search files for text patterns (like grep)
 * Supports regex, case-insensitive, file filtering
 * @param {string} pattern - Regex pattern to search
 * @param {string|string[]} searchPath - Path(s) to search
 * @param {Object} options - Search options
 * @returns {Promise<string>} Search results
 */
async function searchFiles(pattern, searchPath = './src', options = {}) {
    try {
        const {
            caseInsensitive = false,
            wholeWord = false,
            filePattern = null,
            maxResults = 50
        } = options;

        // Handle multiple paths (array input)
        if (Array.isArray(searchPath)) {
            const allResults = [];
            let totalMatches = 0;

            for (const singlePath of searchPath) {
                if (totalMatches >= maxResults) break;

                const result = await searchFiles(pattern, singlePath, {
                    ...options,
                    maxResults: maxResults - totalMatches
                });

                if (!result.startsWith('Error:') && !result.startsWith('No matches')) {
                    allResults.push(result);
                    // Count matches from this result
                    const matches = (result.match(/\*\*Line \d+:\*\*/g) || []).length;
                    totalMatches += matches;
                }
            }

            if (allResults.length === 0) {
                return `No matches found for "${pattern}" in ${searchPath.length} files`;
            }

            return allResults.join('\n\n');
        }

        const basePath = path.resolve(searchPath);

        // Check if path exists
        try {
            await fs.access(basePath);
        } catch {
            return `Error: Path "${searchPath}" does not exist`;
        }

        // Check if the path is a file instead of directory
        const stats = await fs.stat(basePath);
        if (stats.isFile()) {
            // If it's a file, search within that specific file
            return await searchSingleFile(pattern, basePath, options);
        }

        const results = [];
        const flags = caseInsensitive ? 'gi' : 'g';
        let searchRegex;

        try {
            // If wholeWord, add word boundaries
            const regexPattern = wholeWord ? `\\b${pattern}\\b` : pattern;
            searchRegex = new RegExp(regexPattern, flags);
        } catch (error) {
            return `Error: Invalid regex pattern "${pattern}": ${error.message}`;
        }

        // Recursive file search
        async function searchDirectory(dirPath) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);

                // Skip node_modules, .git, etc.
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'responses' || entry.name === 'build-logs') {
                    continue;
                }

                if (entry.isDirectory()) {
                    await searchDirectory(fullPath);
                } else if (entry.isFile()) {
                    // Filter by file pattern if provided
                    if (filePattern && !entry.name.includes(filePattern)) {
                        continue;
                    }

                    // Only search text files
                    const ext = path.extname(entry.name).toLowerCase();
                    const textExtensions = ['.html', '.js', '.css', '.txt', '.md', '.json', '.xml', '.svg'];
                    if (!textExtensions.includes(ext)) {
                        continue;
                    }

                    try {
                        const content = await fs.readFile(fullPath, 'utf8');
                        const lines = content.split('\n');

                        lines.forEach((line, index) => {
                            if (searchRegex.test(line)) {
                                const relativePath = path.relative(process.cwd(), fullPath);
                                results.push({
                                    file: relativePath,
                                    line: index + 1,
                                    content: line.trim()
                                });
                            }
                        });

                        // Stop if we hit max results
                        if (results.length >= maxResults) {
                            return;
                        }
                    } catch (readError) {
                        // Skip files that can't be read as text
                        continue;
                    }
                }
            }
        }

        await searchDirectory(basePath);

        if (results.length === 0) {
            return `No matches found for "${pattern}" in ${searchPath}`;
        }

        // Format results with better markdown
        let output = `**Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}"**\n\n`;

        // Group by file
        const byFile = {};
        results.forEach(result => {
            if (!byFile[result.file]) {
                byFile[result.file] = [];
            }
            byFile[result.file].push(result);
        });

        Object.keys(byFile).forEach(file => {
            output += `### ${file}\n\n`;
            byFile[file].forEach(match => {
                output += `**Line ${match.line}:** \`${match.content}\`\n\n`;
            });
        });

        return output.trim();
    } catch (error) {
        console.error('Search files error:', error);
        return `Error searching files: ${error.message}`;
    }
}

module.exports = {
    listFiles,
    fileExists,
    readFile,
    writeFile,
    editFile,
    searchFiles,
    searchSingleFile,
    cleanMarkdownCodeBlocks,
    DEFAULTS
};
