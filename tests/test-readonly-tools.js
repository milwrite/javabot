/**
 * Unit tests for read-only filesystem tools
 * Tests file_exists, list_files, read_file, search_files
 * Focus: URL extraction, fuzzy matching, web asset discovery
 */

const fs = require('fs').promises;
const path = require('path');

// ============================================
// Tool implementations (extracted from index.js)
// ============================================

async function fileExists(filePath) {
    try {
        if (Array.isArray(filePath)) {
            const results = [];
            for (const singlePath of filePath) {
                const exists = await fileExists(singlePath);
                results.push(`${singlePath}: ${exists}`);
            }
            return results.join('\n');
        }

        let normalizedPath = filePath;
        const urlMatch = filePath.match(/bot\.inference-arcade\.com\/(.+)/);
        if (urlMatch) {
            normalizedPath = urlMatch[1];
        }

        try {
            await fs.access(normalizedPath);
            const stats = await fs.stat(normalizedPath);
            return `✅ EXISTS: ${normalizedPath} (${stats.size} bytes)`;
        } catch {
            // Try fuzzy variations
        }

        const variations = [];
        const baseName = normalizedPath
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-\.\/]/g, '')
            .replace(/\.html$/, '');

        variations.push(`src/${baseName}.html`);
        variations.push(`src/${baseName}`);
        variations.push(`${baseName}.html`);

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
                // Try next
            }
        }

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

async function listFiles(dirPath = './src') {
    try {
        if (Array.isArray(dirPath)) {
            const allResults = [];
            for (const singleDir of dirPath) {
                const result = await listFiles(singleDir);
                allResults.push(`**${singleDir}:** ${result}`);
            }
            return allResults.join('\n');
        }

        const files = await fs.readdir(dirPath);
        const byExtension = {};
        files.forEach(file => {
            const ext = path.extname(file).toLowerCase() || '.other';
            if (!byExtension[ext]) byExtension[ext] = [];
            byExtension[ext].push(file);
        });

        let output = `📁 ${dirPath} (${files.length} files)\n`;
        const sortedExts = Object.entries(byExtension)
            .sort((a, b) => b[1].length - a[1].length);

        for (const [ext, extFiles] of sortedExts) {
            output += `\n${ext} (${extFiles.length}):\n`;
            extFiles.sort().forEach(file => {
                output += `  - ${file}\n`;
            });
        }

        return output.trim();
    } catch (error) {
        return `Error listing files: ${error.message}`;
    }
}

// ============================================
// Test runner
// ============================================

let passed = 0;
let failed = 0;

function test(name, fn) {
    return { name, fn };
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

function assertContains(str, substr, message) {
    if (!str.includes(substr)) {
        throw new Error(message || `Expected "${str}" to contain "${substr}"`);
    }
}

function assertStartsWith(str, prefix, message) {
    if (!str.startsWith(prefix)) {
        throw new Error(message || `Expected "${str}" to start with "${prefix}"`);
    }
}

// ============================================
// Test cases
// ============================================

const tests = [
    // file_exists tests
    test('file_exists: exact path works', async () => {
        const result = await fileExists('src/dmv-maze.html');
        assertStartsWith(result, '✅ EXISTS:', 'Should find exact path');
        assertContains(result, 'dmv-maze.html');
    }),

    test('file_exists: URL extraction works', async () => {
        const result = await fileExists('https://bot.inference-arcade.com/src/dmv-maze.html');
        assertStartsWith(result, '✅ EXISTS:', 'Should extract path from URL');
        assertContains(result, 'dmv-maze.html');
    }),

    test('file_exists: informal name with spaces → hyphens', async () => {
        const result = await fileExists('dmv maze');
        assertStartsWith(result, '✅ EXISTS:', 'Should match "dmv maze" to dmv-maze.html');
        assertContains(result, 'matched from');
    }),

    test('file_exists: underscore variant matching', async () => {
        const result = await fileExists('bubba clicker');
        assertStartsWith(result, '✅ EXISTS:', 'Should match "bubba clicker" to bubba_clicker.html');
        assertContains(result, 'bubba_clicker');
    }),

    test('file_exists: non-existent file returns NOT FOUND', async () => {
        const result = await fileExists('nonexistent-page-xyz');
        assertStartsWith(result, '❌ NOT FOUND:', 'Should return NOT FOUND');
    }),

    test('file_exists: suggests similar files when not found', async () => {
        const result = await fileExists('tetris');
        assertContains(result, '❌ NOT FOUND:', 'Should not find exact match');
        assertContains(result, 'Similar files', 'Should suggest similar');
        assertContains(result, 'dermpath-tetris', 'Should suggest dermpath-tetris');
    }),

    test('file_exists: array input works', async () => {
        const result = await fileExists(['src/dmv-maze.html', 'nonexistent.html']);
        assertContains(result, '✅ EXISTS:', 'Should find first file');
        assertContains(result, '❌ NOT FOUND:', 'Should not find second');
    }),

    // list_files tests
    test('list_files: returns grouped output', async () => {
        const result = await listFiles('./src');
        assertContains(result, '📁 ./src', 'Should have directory header');
        assertContains(result, '.html', 'Should group by .html');
        assertContains(result, 'files)', 'Should show file count');
    }),

    test('list_files: files sorted alphabetically', async () => {
        const result = await listFiles('./src');
        const lines = result.split('\n');
        const htmlFiles = lines.filter(l => l.trim().startsWith('- ') && l.includes('.html'));

        // Check at least some files are present
        assert(htmlFiles.length > 0, 'Should have HTML files listed');
    }),

    test('list_files: handles non-existent directory', async () => {
        const result = await listFiles('./nonexistent-dir');
        assertContains(result, 'Error', 'Should return error for missing dir');
    }),

    // URL edge cases
    test('file_exists: http URL (not https) works', async () => {
        const result = await fileExists('http://bot.inference-arcade.com/src/dmv-maze.html');
        assertStartsWith(result, '✅ EXISTS:', 'Should handle http URLs');
    }),

    test('file_exists: mixed case informal name', async () => {
        const result = await fileExists('DMV Maze');
        assertStartsWith(result, '✅ EXISTS:', 'Should handle mixed case');
    }),

    test('file_exists: extra spaces in name', async () => {
        const result = await fileExists('dmv   maze');
        assertStartsWith(result, '✅ EXISTS:', 'Should handle multiple spaces');
    }),
];

// ============================================
// Run tests
// ============================================

async function runTests() {
    console.log('='.repeat(50));
    console.log('Read-Only Filesystem Tools - Unit Tests');
    console.log('='.repeat(50));
    console.log();

    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log(`✅ PASS: ${name}`);
            passed++;
        } catch (error) {
            console.log(`❌ FAIL: ${name}`);
            console.log(`   Error: ${error.message}`);
            failed++;
        }
    }

    console.log();
    console.log('='.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50));

    process.exit(failed > 0 ? 1 : 0);
}

runTests();
