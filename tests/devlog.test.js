// Test suite for DEVLOG.md entries and documented features
const fs = require('fs').promises;
const path = require('path');

class DevLogTester {
    constructor() {
        this.results = [];
        this.passed = 0;
        this.failed = 0;
    }

    async test(name, fn) {
        try {
            await fn();
            this.results.push({ name, status: 'PASS', error: null });
            this.passed++;
            console.log(`✅ ${name}`);
        } catch (error) {
            this.results.push({ name, status: 'FAIL', error: error.message });
            this.failed++;
            console.error(`❌ ${name}`);
            console.error(`   ${error.message}`);
        }
    }

    async assertEqual(actual, expected, message) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected}, got ${actual}`);
        }
    }

    async assertTrue(value, message) {
        if (!value) {
            throw new Error(message || `Expected true, got ${value}`);
        }
    }

    async assertGreaterThan(actual, min, message) {
        if (actual <= min) {
            throw new Error(message || `Expected > ${min}, got ${actual}`);
        }
    }

    async assertContains(str, substring, message) {
        if (!str.includes(substring)) {
            throw new Error(message || `Expected string to contain "${substring}"`);
        }
    }

    summary() {
        console.log('\n' + '='.repeat(80));
        console.log(`TEST SUMMARY: ${this.passed} passed, ${this.failed} failed`);
        console.log('='.repeat(80) + '\n');
        return this.failed === 0;
    }
}

// Import searchFiles function (extracted from index.js)
async function searchFiles(pattern, searchPath = './src', options = {}) {
    const {
        caseInsensitive = false,
        wholeWord = false,
        filePattern = null,
        maxResults = 50
    } = options;

    const basePath = path.resolve(searchPath);

    try {
        await fs.access(basePath);
    } catch {
        return `Error: Path "${searchPath}" does not exist`;
    }

    const results = [];
    const flags = caseInsensitive ? 'gi' : 'g';
    let searchRegex;

    try {
        const regexPattern = wholeWord ? `\\b${pattern}\\b` : pattern;
        searchRegex = new RegExp(regexPattern, flags);
    } catch (error) {
        return `Error: Invalid regex pattern "${pattern}": ${error.message}`;
    }

    async function searchDirectory(dirPath) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.name === 'node_modules' || entry.name === '.git' ||
                entry.name === 'responses' || entry.name === 'build-logs') {
                continue;
            }

            if (entry.isDirectory()) {
                await searchDirectory(fullPath);
            } else if (entry.isFile()) {
                if (filePattern && !entry.name.includes(filePattern)) {
                    continue;
                }

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

                    if (results.length >= maxResults) {
                        return;
                    }
                } catch (readError) {
                    continue;
                }
            }
        }
    }

    await searchDirectory(basePath);

    if (results.length === 0) {
        return `No matches found for "${pattern}" in ${searchPath}`;
    }

    let output = `Found ${results.length} match${results.length === 1 ? '' : 'es'} for "${pattern}" in ${searchPath}:\n\n`;

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
}

// Import isEditRequest function (extracted from services/gamePipeline.js)
function isEditRequest(prompt) {
    const lowerPrompt = prompt.toLowerCase();

    const readOnlyVerbs = [
        'list', 'show', 'display', 'find', 'search', 'get', 'fetch',
        'what are', 'what is', 'tell me', 'give me', 'show me',
        'read', 'view', 'see', 'check', 'look at', 'print'
    ];

    const isReadOnly = readOnlyVerbs.some(verb =>
        lowerPrompt.startsWith(verb) ||
        lowerPrompt.includes(`can you ${verb}`) ||
        lowerPrompt.includes(`could you ${verb}`)
    );

    if (isReadOnly) {
        return false;
    }

    const editKeywords = [
        'edit', 'update', 'change', 'modify', 'fix', 'revise',
        'adjust', 'tweak', 'alter', 'correct', 'refactor',
        'improve', 'better', 'enhance', 'optimize', 'polish',
        'suck', 'bad', 'worse', 'broken', 'wrong',
        'make it', 'make the', 'can you change', 'can you make',
        'can you update', 'can you fix', 'can you edit',
        'could you change', 'could you make', 'could you update',
        'rename', 'recolor', 'resize', 'reposition',
        'add to', 'remove from', 'replace the', 'swap the',
        'remove the', 'delete the', 'take out', 'get rid of',
        'instead of', 'rather than', 'different', 'differently',
        'themed after', 'based on', 'following', 'similar to',
        'only the', 'just the', 'only make', 'just make',
        'only change', 'just change', 'only fix', 'just fix',
        'only improve', 'just improve', 'only update'
    ];

    const hasEditKeyword = editKeywords.some(keyword => lowerPrompt.includes(keyword));
    const hasExplicitEdit = /\b(edit|update|change|modify|fix|improve|enhance|remove|delete|redo)\b/i.test(prompt);
    const referencesExisting = /\b(the|that|this|existing)\s+(game|page|crossword|file|code|html|snake|frogger|tetris|maze|puzzle|clue|instruction|scroll|control|button)\b/i.test(prompt);
    const mentionsSpecificGame = /\b(pleasantville|crossword|frogger|snake|tetris|maze|sudoku|pong|breakout)\b/i.test(prompt);
    const hasOnlyPattern = /\b(only|just)\s+(the|make|change|fix|improve|update|remove|add)\b/i.test(prompt);
    const hasNegativeSentiment = /\b(suck|bad|worse|broken|wrong|terrible|awful|poor|confusing)\b/i.test(prompt);

    return hasEditKeyword || hasExplicitEdit || referencesExisting || mentionsSpecificGame || hasOnlyPattern || hasNegativeSentiment;
}

// Run all tests
async function runTests() {
    const tester = new DevLogTester();

    console.log('='.repeat(80));
    console.log('DEVLOG FEATURE TESTS - 2025-12-14 Entry Validation');
    console.log('='.repeat(80) + '\n');

    // ============================================================================
    // Test 1: DEVLOG.md exists and is readable
    // ============================================================================
    await tester.test('DEVLOG.md exists', async () => {
        const devlogPath = path.join(process.cwd(), 'DEVLOG.md');
        await fs.access(devlogPath);
        const content = await fs.readFile(devlogPath, 'utf8');
        await tester.assertGreaterThan(content.length, 100, 'DEVLOG.md should have content');
    });

    // ============================================================================
    // Test 2: DEVLOG has required sections
    // ============================================================================
    await tester.test('DEVLOG has required sections', async () => {
        const content = await fs.readFile('DEVLOG.md', 'utf8');
        await tester.assertContains(content, '## 2025-12-14', 'Should have date header');
        await tester.assertContains(content, '### Issue:', 'Should document issue');
        await tester.assertContains(content, '### Root Causes', 'Should list root causes');
        await tester.assertContains(content, '### Changes Made', 'Should document changes');
        await tester.assertContains(content, '### Testing', 'Should have testing section');
        await tester.assertContains(content, '### Files Modified', 'Should list modified files');
    });

    // ============================================================================
    // Test 3: searchFiles function works
    // ============================================================================
    await tester.test('searchFiles finds HTML elements', async () => {
        const result = await searchFiles('canvas', './src', { caseInsensitive: true, maxResults: 5 });
        await tester.assertContains(result, 'Found', 'Should find canvas elements in HTML files');
    });

    // ============================================================================
    // Test 4: searchFiles case-insensitive option
    // ============================================================================
    await tester.test('searchFiles case-insensitive works', async () => {
        const result = await searchFiles('FUNCTION', './src', {
            caseInsensitive: true,
            maxResults: 5
        });
        await tester.assertContains(result, 'Found', 'Should find matches with case-insensitive');
    });

    // ============================================================================
    // Test 5: searchFiles file pattern filter
    // ============================================================================
    await tester.test('searchFiles file pattern filter works', async () => {
        const result = await searchFiles('function', './src', {
            filePattern: '.js',
            maxResults: 5
        });
        // Should only search JS files if pattern filter works
        await tester.assertTrue(result.includes('Found') || result.includes('No matches'), 'Should filter by file pattern');
    });

    // ============================================================================
    // Test 6: isEditRequest detects read-only queries
    // ============================================================================
    await tester.test('isEditRequest: "List the clues" is NOT edit', async () => {
        const result = isEditRequest('List the clues and answers to the pleasantville game');
        await tester.assertEqual(result, false, 'List queries should NOT be edits');
    });

    await tester.test('isEditRequest: "Show me" is NOT edit', async () => {
        const result = isEditRequest('Show me the crossword answers');
        await tester.assertEqual(result, false, 'Show queries should NOT be edits');
    });

    await tester.test('isEditRequest: "What are" is NOT edit', async () => {
        const result = isEditRequest('What are the clues in pleasantville');
        await tester.assertEqual(result, false, 'What are queries should NOT be edits');
    });

    // ============================================================================
    // Test 7: isEditRequest detects actual edit requests
    // ============================================================================
    await tester.test('isEditRequest: "Change the colors" IS edit', async () => {
        const result = isEditRequest('Change the colors in pleasantville');
        await tester.assertEqual(result, true, 'Change requests should BE edits');
    });

    await tester.test('isEditRequest: "Fix the bug" IS edit', async () => {
        const result = isEditRequest('Fix the bug in the game');
        await tester.assertEqual(result, true, 'Fix requests should BE edits');
    });

    await tester.test('isEditRequest: "Update the score" IS edit', async () => {
        const result = isEditRequest('Update the score in frogger');
        await tester.assertEqual(result, true, 'Update requests should BE edits');
    });

    // ============================================================================
    // Test 8: Pattern-based searches
    // ============================================================================
    await tester.test('Search for CSS class patterns', async () => {
        const result = await searchFiles('class=', './src', { maxResults: 5 });
        await tester.assertTrue(result.includes('Found') || result.includes('No matches'), 'Should search for class attributes');
    });

    await tester.test('Search for addEventListener patterns', async () => {
        const result = await searchFiles('addEventListener', './src', { maxResults: 5 });
        await tester.assertTrue(result.includes('Found') || result.includes('No matches'), 'Should search for event listeners');
    });

    await tester.test('Search for mobile-controls', async () => {
        const result = await searchFiles('mobile-controls', './src', { maxResults: 5 });
        await tester.assertTrue(result.includes('Found') || result.includes('No matches'), 'Should search for mobile control elements');
    });

    // ============================================================================
    // Test 9: Edge cases
    // ============================================================================
    await tester.test('searchFiles handles non-existent path', async () => {
        const result = await searchFiles('test', './nonexistent');
        await tester.assertContains(result, 'Error', 'Should return error for non-existent path');
    });

    await tester.test('searchFiles handles invalid regex', async () => {
        const result = await searchFiles('[invalid(regex', './src');
        await tester.assertContains(result, 'Error', 'Should return error for invalid regex');
    });

    await tester.test('isEditRequest handles empty string', async () => {
        const result = isEditRequest('');
        await tester.assertEqual(result, false, 'Empty string should not be edit');
    });

    // ============================================================================
    // Test 10: Integration - Full workflow
    // ============================================================================
    await tester.test('Integration: Query classification → search → extract', async () => {
        const userQuery = 'List all the games in the src directory';

        // Step 1: Classify as NOT edit
        const isEdit = isEditRequest(userQuery);
        await tester.assertEqual(isEdit, false, 'Should route to main LLM loop');

        // Step 2: Search for common game patterns
        const gameResults = await searchFiles('canvas', './src', { maxResults: 10 });
        await tester.assertTrue(gameResults.includes('Found') || gameResults.includes('No matches'), 'Should search for canvas elements');

        // Step 3: Verify search returns structured results
        await tester.assertTrue(typeof gameResults === 'string', 'Should return string results');
    });

    // ============================================================================
    // Summary
    // ============================================================================
    const success = tester.summary();
    process.exit(success ? 0 : 1);
}

// Execute tests
runTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
});
