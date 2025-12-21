// tests/edit-tool.test.js
// Test suite for the edit_file tool functionality

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Core edit logic extracted for testing
 * Mirrors the exact replacement logic from editFile() in index.js
 */
function performExactReplacement(content, oldString, newString) {
    // Count occurrences
    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
        throw new Error('String not found in file. The exact string to replace was not found. Make sure to use the EXACT string from the file, including all whitespace and indentation.');
    }

    if (occurrences > 1) {
        throw new Error(`String appears ${occurrences} times in file. The old_string must be unique. Provide more context (surrounding lines) to make it unique, or use replace_all mode.`);
    }

    return content.replace(oldString, newString);
}

/**
 * Validates edit parameters
 */
function validateEditParams(oldString, newString, instructions) {
    if (oldString !== null && newString !== null) {
        return 'exact';
    }
    if (instructions !== null) {
        return 'ai';
    }
    throw new Error('Must provide either (old_string + new_string) OR instructions');
}

// Test helper: create temp file
async function createTempFile(content, extension = 'html') {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'edit-test-'));
    const tempFile = path.join(tempDir, `test.${extension}`);
    await fs.writeFile(tempFile, content, 'utf8');
    return { tempDir, tempFile };
}

// Test helper: cleanup temp files
async function cleanupTemp(tempDir) {
    try {
        const files = await fs.readdir(tempDir);
        for (const file of files) {
            await fs.unlink(path.join(tempDir, file));
        }
        await fs.rmdir(tempDir);
    } catch (e) {
        // Ignore cleanup errors
    }
}

// ============================================
// TEST CASES
// ============================================

const EXACT_REPLACEMENT_TESTS = [
    {
        name: 'Simple single-line replacement',
        content: '<h1>Hello World</h1>',
        oldString: 'Hello World',
        newString: 'Goodbye World',
        expected: '<h1>Goodbye World</h1>'
    },
    {
        name: 'Multi-line content with single replacement',
        content: `<div>
    <p>First paragraph</p>
    <p>Second paragraph</p>
</div>`,
        oldString: 'First paragraph',
        newString: 'Updated paragraph',
        expected: `<div>
    <p>Updated paragraph</p>
    <p>Second paragraph</p>
</div>`
    },
    {
        name: 'Replace with empty string (deletion)',
        content: 'line1\nline2\nline3',
        oldString: '\nline2',
        newString: '',
        expected: 'line1\nline3'
    },
    {
        name: 'Replace empty with content (insertion)',
        content: '<div></div>',
        oldString: '><',
        newString: '><p>New content</p><',
        expected: '<div><p>New content</p></div>'
    },
    {
        name: 'Preserve indentation exactly',
        content: '    const x = 1;\n    const y = 2;',
        oldString: '    const x = 1;',
        newString: '    const x = 42;',
        expected: '    const x = 42;\n    const y = 2;'
    },
    {
        name: 'Replace with special regex characters',
        content: 'Price: $100.00',
        oldString: '$100.00',
        newString: '$200.00',
        expected: 'Price: $200.00'
    },
    {
        name: 'Replace multiline block',
        content: `function old() {
    return 'old';
}

function other() {}`,
        oldString: `function old() {
    return 'old';
}`,
        newString: `function new() {
    return 'new';
}`,
        expected: `function new() {
    return 'new';
}

function other() {}`
    },
    {
        name: 'CSS property replacement',
        content: '.btn { color: red; background: blue; }',
        oldString: 'color: red;',
        newString: 'color: green;',
        expected: '.btn { color: green; background: blue; }'
    },
    {
        name: 'HTML attribute replacement',
        content: '<a href="old.html" class="link">Click</a>',
        oldString: 'href="old.html"',
        newString: 'href="new.html"',
        expected: '<a href="new.html" class="link">Click</a>'
    },
    {
        name: 'Replace with newlines',
        content: '<script>alert("hi");</script>',
        oldString: 'alert("hi");',
        newString: 'console.log("hello");\nconsole.log("world");',
        expected: '<script>console.log("hello");\nconsole.log("world");</script>'
    }
];

const ERROR_CASES = [
    {
        name: 'String not found',
        content: '<h1>Hello World</h1>',
        oldString: 'Goodbye Moon',
        newString: 'Test',
        expectedError: 'String not found'
    },
    {
        name: 'String appears twice (non-unique)',
        content: '<p>hello</p><p>hello</p>',
        oldString: 'hello',
        newString: 'hi',
        expectedError: 'appears 2 times'
    },
    {
        name: 'String appears three times',
        content: 'abc abc abc',
        oldString: 'abc',
        newString: 'xyz',
        expectedError: 'appears 3 times'
    },
    {
        name: 'Whitespace mismatch (tabs vs spaces)',
        content: '\tindented with tab',
        oldString: '    indented with tab',
        newString: 'fixed',
        expectedError: 'String not found'
    },
    {
        name: 'Case sensitivity',
        content: 'Hello World',
        oldString: 'hello world',
        newString: 'test',
        expectedError: 'String not found'
    },
    {
        name: 'Trailing whitespace in search (not in file)',
        content: 'exact match only',
        oldString: 'exact match only ',
        newString: 'fixed',
        expectedError: 'String not found'
    }
];

const PARAMETER_VALIDATION_TESTS = [
    {
        name: 'Exact mode: both old and new provided',
        oldString: 'old',
        newString: 'new',
        instructions: null,
        expectedMode: 'exact'
    },
    {
        name: 'AI mode: only instructions provided',
        oldString: null,
        newString: null,
        instructions: 'Make the title red',
        expectedMode: 'ai'
    },
    {
        name: 'Error: nothing provided',
        oldString: null,
        newString: null,
        instructions: null,
        expectedError: 'Must provide either'
    },
    {
        name: 'Error: only old_string provided',
        oldString: 'old',
        newString: null,
        instructions: null,
        expectedError: 'Must provide either'
    },
    {
        name: 'Error: only new_string provided',
        oldString: null,
        newString: 'new',
        instructions: null,
        expectedError: 'Must provide either'
    }
];

// ============================================
// TEST RUNNER
// ============================================

async function runExactReplacementTests() {
    console.log('\n=== Testing Exact String Replacement ===\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const test of EXACT_REPLACEMENT_TESTS) {
        try {
            const result = performExactReplacement(test.content, test.oldString, test.newString);

            if (result === test.expected) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else {
                failed++;
                failures.push({
                    ...test,
                    actual: result
                });
                console.log(`  ❌ ${test.name}`);
                console.log(`     Expected: ${JSON.stringify(test.expected).slice(0, 60)}...`);
                console.log(`     Got:      ${JSON.stringify(result).slice(0, 60)}...`);
            }
        } catch (error) {
            failed++;
            failures.push({
                ...test,
                error: error.message
            });
            console.log(`  ❌ ${test.name} (threw unexpectedly)`);
            console.log(`     Error: ${error.message}`);
        }
    }

    return { passed, failed, failures, total: EXACT_REPLACEMENT_TESTS.length };
}

async function runErrorCaseTests() {
    console.log('\n=== Testing Error Cases ===\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const test of ERROR_CASES) {
        try {
            performExactReplacement(test.content, test.oldString, test.newString);
            // Should have thrown
            failed++;
            failures.push({
                ...test,
                error: 'Did not throw expected error'
            });
            console.log(`  ❌ ${test.name} (should have thrown)`);
        } catch (error) {
            if (error.message.includes(test.expectedError)) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else {
                failed++;
                failures.push({
                    ...test,
                    actualError: error.message
                });
                console.log(`  ❌ ${test.name}`);
                console.log(`     Expected error containing: "${test.expectedError}"`);
                console.log(`     Got: "${error.message}"`);
            }
        }
    }

    return { passed, failed, failures, total: ERROR_CASES.length };
}

async function runParameterValidationTests() {
    console.log('\n=== Testing Parameter Validation ===\n');

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const test of PARAMETER_VALIDATION_TESTS) {
        try {
            const mode = validateEditParams(test.oldString, test.newString, test.instructions);

            if (test.expectedError) {
                failed++;
                failures.push({
                    ...test,
                    error: 'Should have thrown'
                });
                console.log(`  ❌ ${test.name} (should have thrown)`);
            } else if (mode === test.expectedMode) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else {
                failed++;
                failures.push({
                    ...test,
                    actualMode: mode
                });
                console.log(`  ❌ ${test.name}`);
                console.log(`     Expected mode: ${test.expectedMode}, Got: ${mode}`);
            }
        } catch (error) {
            if (test.expectedError && error.message.includes(test.expectedError)) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else if (test.expectedError) {
                failed++;
                console.log(`  ❌ ${test.name}`);
                console.log(`     Expected error containing: "${test.expectedError}"`);
                console.log(`     Got: "${error.message}"`);
            } else {
                failed++;
                failures.push({
                    ...test,
                    error: error.message
                });
                console.log(`  ❌ ${test.name} (threw unexpectedly)`);
            }
        }
    }

    return { passed, failed, failures, total: PARAMETER_VALIDATION_TESTS.length };
}

async function runFileIntegrationTests() {
    console.log('\n=== Testing File Integration ===\n');

    let passed = 0;
    let failed = 0;
    const tests = [
        {
            name: 'HTML file read and write',
            content: '<!DOCTYPE html><html><body><h1>Test</h1></body></html>',
            oldString: '<h1>Test</h1>',
            newString: '<h1>Updated</h1>',
            extension: 'html'
        },
        {
            name: 'JavaScript file edit',
            content: 'const config = { debug: false };',
            oldString: 'debug: false',
            newString: 'debug: true',
            extension: 'js'
        },
        {
            name: 'CSS file edit',
            content: ':root { --primary: #ff0000; }',
            oldString: '--primary: #ff0000',
            newString: '--primary: #00ff00',
            extension: 'css'
        },
        {
            name: 'Large file (10KB+)',
            content: 'x'.repeat(10000) + 'MARKER' + 'y'.repeat(10000),
            oldString: 'MARKER',
            newString: 'REPLACED',
            extension: 'txt'
        }
    ];

    for (const test of tests) {
        let tempDir;
        try {
            const { tempDir: td, tempFile } = await createTempFile(test.content, test.extension);
            tempDir = td;

            // Read file
            const content = await fs.readFile(tempFile, 'utf8');

            // Perform replacement
            const updated = performExactReplacement(content, test.oldString, test.newString);

            // Write back
            await fs.writeFile(tempFile, updated, 'utf8');

            // Verify
            const verified = await fs.readFile(tempFile, 'utf8');

            if (verified.includes(test.newString) && !verified.includes(test.oldString)) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else {
                failed++;
                console.log(`  ❌ ${test.name} (verification failed)`);
            }
        } catch (error) {
            failed++;
            console.log(`  ❌ ${test.name}`);
            console.log(`     Error: ${error.message}`);
        } finally {
            if (tempDir) await cleanupTemp(tempDir);
        }
    }

    return { passed, failed, total: tests.length };
}

async function runEdgeCaseTests() {
    console.log('\n=== Testing Edge Cases ===\n');

    let passed = 0;
    let failed = 0;

    const edgeCases = [
        {
            name: 'Empty newString (complete deletion)',
            content: 'keep this remove this keep this too',
            oldString: ' remove this',
            newString: '',
            expected: 'keep this keep this too'
        },
        {
            name: 'Unicode characters',
            content: '<p>Hello 世界 🌍</p>',
            oldString: '世界',
            newString: 'World',
            expected: '<p>Hello World 🌍</p>'
        },
        {
            name: 'Emoji replacement',
            content: 'Status: 🔴',
            oldString: '🔴',
            newString: '🟢',
            expected: 'Status: 🟢'
        },
        {
            name: 'Regex special chars in content',
            content: 'Match: a.*b?c+d$e^f',
            oldString: 'a.*b?c+d$e^f',
            newString: 'replaced',
            expected: 'Match: replaced'
        },
        {
            name: 'Very long single-line replacement',
            content: 'a'.repeat(1000),
            oldString: 'a'.repeat(1000),
            newString: 'b'.repeat(1000),
            expected: 'b'.repeat(1000)
        },
        {
            name: 'Windows line endings (CRLF)',
            content: 'line1\r\nline2\r\nline3',
            oldString: 'line2',
            newString: 'updated',
            expected: 'line1\r\nupdated\r\nline3'
        },
        {
            name: 'Mixed line endings',
            content: 'line1\nline2\r\nline3',
            oldString: 'line2',
            newString: 'updated',
            expected: 'line1\nupdated\r\nline3'
        },
        {
            name: 'Replace at exact start of file',
            content: 'START rest of content',
            oldString: 'START',
            newString: 'BEGIN',
            expected: 'BEGIN rest of content'
        },
        {
            name: 'Replace at exact end of file',
            content: 'content at END',
            oldString: 'END',
            newString: 'FINISH',
            expected: 'content at FINISH'
        }
    ];

    for (const test of edgeCases) {
        try {
            const result = performExactReplacement(test.content, test.oldString, test.newString);

            if (result === test.expected) {
                passed++;
                console.log(`  ✅ ${test.name}`);
            } else {
                failed++;
                console.log(`  ❌ ${test.name}`);
                console.log(`     Expected: ${JSON.stringify(test.expected).slice(0, 50)}...`);
                console.log(`     Got:      ${JSON.stringify(result).slice(0, 50)}...`);
            }
        } catch (error) {
            failed++;
            console.log(`  ❌ ${test.name} (threw unexpectedly)`);
            console.log(`     Error: ${error.message}`);
        }
    }

    return { passed, failed, total: edgeCases.length };
}

// ============================================
// MAIN
// ============================================

async function runTests() {
    console.log('🧪 Edit Tool Test Suite');
    console.log('========================');

    const results = [];

    results.push(await runExactReplacementTests());
    results.push(await runErrorCaseTests());
    results.push(await runParameterValidationTests());
    results.push(await runFileIntegrationTests());
    results.push(await runEdgeCaseTests());

    // Summary
    const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
    const totalTests = results.reduce((sum, r) => sum + r.total, 0);

    console.log('\n=== Summary ===');
    console.log(`Total: ${totalPassed}/${totalTests} passed`);
    console.log(`Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);

    if (totalFailed > 0) {
        console.log(`\n❌ ${totalFailed} test(s) failed`);
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed!');
    }
}

// Run tests if executed directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('Test suite error:', error);
        process.exit(1);
    });
}

module.exports = {
    runTests,
    performExactReplacement,
    validateEditParams,
    EXACT_REPLACEMENT_TESTS,
    ERROR_CASES,
    PARAMETER_VALIDATION_TESTS
};
