// Test script for search_files functionality
const fs = require('fs').promises;
const path = require('path');

async function searchFiles(pattern, searchPath = './src', options = {}) {
    try {
        const {
            caseInsensitive = false,
            wholeWord = false,
            filePattern = null,
            maxResults = 50
        } = options;

        const basePath = path.resolve(searchPath);

        // Check if path exists
        try {
            await fs.access(basePath);
        } catch {
            return `Error: Path "${searchPath}" does not exist`;
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

        // Format results
        let output = `Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}" in ${searchPath}:\n\n`;

        // Group by file
        const byFile = {};
        results.forEach(result => {
            if (!byFile[result.file]) {
                byFile[result.file] = [];
            }
            byFile[result.file].push(result);
        });

        Object.keys(byFile).forEach(file => {
            output += `${file}:\n`;
            byFile[file].forEach(match => {
                output += `  Line ${match.line}: ${match.content}\n`;
            });
            output += '\n';
        });

        return output.trim();
    } catch (error) {
        console.error('Search files error:', error);
        return `Error searching files: ${error.message}`;
    }
}

// Run tests
async function runTests() {
    console.log('=== Testing search_files function ===\n');

    // Test 1: Search for common HTML elements
    console.log('TEST 1: Search for "canvas" (case-insensitive)');
    const result1 = await searchFiles('canvas', './src', { caseInsensitive: true, maxResults: 5 });
    console.log(result1);
    console.log('\n' + '='.repeat(80) + '\n');

    // Test 2: Search for JavaScript patterns
    console.log('TEST 2: Search for "addEventListener"');
    const result2 = await searchFiles('addEventListener', './src', { maxResults: 5 });
    console.log(result2);
    console.log('\n' + '='.repeat(80) + '\n');

    // Test 3: File pattern filtering
    console.log('TEST 3: Search for "function" in .js files only');
    const result3 = await searchFiles('function', './src', { filePattern: '.js', maxResults: 5 });
    console.log(result3);
    console.log('\n' + '='.repeat(80) + '\n');

    // Test 4: Whole word matching
    console.log('TEST 4: Search for whole word "game"');
    const result4 = await searchFiles('game', './src', { wholeWord: true, maxResults: 5 });
    console.log(result4);
    console.log('\n');
}

runTests().catch(console.error);
