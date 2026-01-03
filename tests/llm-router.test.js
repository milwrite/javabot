// tests/llm-router.test.js
// Test suite for llmRouter.js routing logic

const { patternRoute } = require('../services/llmRouter');

/**
 * Extract the fallbackRouting logic for testing
 * Mirrors the implementation in services/llmRouter.js
 */
function fallbackRouting(userMessage, context = {}) {
    const lower = userMessage.toLowerCase();

    // Extract file path if present (handles multiple formats)
    const urlMatch = userMessage.match(/bot\.inference-arcade\.com\/([^\s]+)/i);
    const srcMatch = userMessage.match(/src\/([^\s]+\.(?:html|js|css))/i);
    // Informal file references like "part3.html" or "peanut-city.html" (no src/ prefix)
    const informalMatch = userMessage.match(/\b([\w][\w-]*\.(?:html|js|css))\b/i);
    // Priority: explicit src/ > URL > informal reference (prepend src/ for .html)
    const extractedPath = srcMatch ? `src/${srcMatch[1]}`
        : (urlMatch ? urlMatch[1]
        : (informalMatch && informalMatch[1].endsWith('.html') ? `src/${informalMatch[1]}` : null));

    // Determine intent and build plan
    let plan = {
        intent: 'chat',
        toolSequence: [],
        parameterHints: {},
        contextNeeded: [],
        confidence: 0.6,
        reasoning: 'Fallback pattern matching',
        clarifyFirst: false,
        clarifyQuestion: null,
        expectedIterations: 1,
        method: 'fallback'
    };

    // Structural transformation intent (e.g., "follow same design as", "match structure of")
    if (/\b(follow|match|same\s+(design|structure|format|layout)|like|similar\s+to)\b/i.test(lower) && extractedPath) {
        const refMatch = lower.match(/(?:like|as|to)\s+(\w[\w-]*\.html)/i);
        const refPath = refMatch ? `src/${refMatch[1]}` : null;

        plan.intent = 'create';
        plan.toolSequence = refPath
            ? ['file_exists', 'read_file', 'read_file', 'write_file']
            : ['file_exists', 'read_file', 'write_file'];
        plan.parameterHints = {
            file_exists: { path: extractedPath },
            read_file: { paths: refPath ? [extractedPath, refPath] : [extractedPath] },
            write_file: { path: extractedPath },
            note: 'Structural transformation - read file(s), then write_file with new structure'
        };
        plan.expectedIterations = refPath ? 4 : 3;
        plan.reasoning = refPath
            ? `Structural transformation: ${extractedPath} → match ${refPath}`
            : `Structural transformation: ${extractedPath}`;
    }
    // Edit intent (targeted changes, not structural overhaul)
    else if (/\b(edit|change|replace|update|fix|modify)\b/.test(lower) && extractedPath) {
        plan.intent = 'edit';
        plan.toolSequence = ['file_exists', 'read_file', 'edit_file'];
        plan.parameterHints = {
            file_exists: { path: extractedPath },
            read_file: { path: extractedPath },
            edit_file: { path: extractedPath }
        };
        plan.expectedIterations = 3;
        plan.reasoning = `Edit request with explicit path: ${extractedPath}`;
    }
    // Create intent
    else if (/\b(create|build|make|generate|new)\b/.test(lower)) {
        plan.intent = 'create';
        plan.toolSequence = ['list_files', 'write_file'];
        plan.expectedIterations = 2;
        plan.reasoning = 'Content creation request';
    }
    // Commit intent
    else if (/\b(commit|push|save|deploy)\b/.test(lower)) {
        plan.intent = 'commit';
        plan.toolSequence = ['get_repo_status', 'commit_changes'];
        plan.expectedIterations = 2;
        plan.reasoning = 'Git commit request';
    }
    // Read/list intent
    else if (/\b(list|show|find|search|what|read)\b/.test(lower)) {
        if (extractedPath) {
            plan.intent = 'read';
            plan.toolSequence = ['file_exists', 'read_file'];
            plan.parameterHints = {
                file_exists: { path: extractedPath },
                read_file: { path: extractedPath }
            };
            plan.expectedIterations = 2;
        } else if (/\b(search|find|grep)\b/.test(lower)) {
            plan.intent = 'search';
            plan.toolSequence = ['search_files'];
            plan.expectedIterations = 1;
        } else {
            plan.intent = 'read';
            plan.toolSequence = ['list_files'];
            plan.expectedIterations = 1;
        }
        plan.reasoning = 'Read/search request';
    }
    // Web search
    else if (/\b(latest|current|recent|news|what is|who is)\b/.test(lower)) {
        plan.intent = 'search';
        plan.toolSequence = ['web_search'];
        plan.expectedIterations = 1;
        plan.reasoning = 'Web search for current information';
    }
    // Default to chat
    else {
        plan.reasoning = 'General conversation, no specific tools needed';
    }

    return plan;
}

// ============================================
// TEST CASES
// ============================================

const PATH_EXTRACTION_TESTS = [
    {
        name: 'Explicit src/ path',
        message: 'edit src/peanut-city.html',
        expectedPath: 'src/peanut-city.html'
    },
    {
        name: 'URL with full domain (with read intent)',
        message: 'read bot.inference-arcade.com/src/game.html',
        expectedPath: 'src/game.html'
    },
    {
        name: 'Informal file reference (no src/ prefix)',
        message: 'update part3.html',
        expectedPath: 'src/part3.html'
    },
    {
        name: 'Informal file with hyphens',
        message: 'edit krispy-peaks-affair.html',
        expectedPath: 'src/krispy-peaks-affair.html'
    },
    {
        name: 'Informal file with underscores',
        message: 'update peanut_city.html',
        expectedPath: 'src/peanut_city.html'
    },
    {
        name: 'No file reference',
        message: 'hello how are you',
        expectedPath: null
    },
    {
        name: 'JS file (should not auto-prepend src)',
        message: 'check config.js',
        expectedPath: null // .js files don't get src/ prepended
    },
    {
        name: 'CSS file (should not auto-prepend src)',
        message: 'check style.css',
        expectedPath: null // .css files don't get src/ prepended
    }
];

const STRUCTURAL_TRANSFORMATION_TESTS = [
    {
        name: 'Follow same design as reference',
        message: 'update part3.html to follow the same design as peanut-city.html',
        expectedIntent: 'create',
        expectedToolSequence: ['file_exists', 'read_file', 'read_file', 'write_file'],
        expectedRefPath: 'src/peanut-city.html'
    },
    {
        name: 'Match structure of another file',
        message: 'make krispy-peaks.html match the structure like peanut-city.html',
        expectedIntent: 'create',
        expectedToolSequence: ['file_exists', 'read_file', 'read_file', 'write_file']
    },
    {
        name: 'Similar to reference',
        message: 'update story.html to be similar to peanut-city.html',
        expectedIntent: 'create',
        expectedToolSequence: ['file_exists', 'read_file', 'read_file', 'write_file']
    },
    {
        name: 'Same layout without reference',
        message: 'update part3.html to have the same layout',
        expectedIntent: 'create',
        expectedToolSequence: ['file_exists', 'read_file', 'write_file']
    },
    {
        name: 'Like another file',
        message: 'make game.html like snake.html',
        expectedIntent: 'create',
        expectedToolSequence: ['file_exists', 'read_file', 'read_file', 'write_file']
    }
];

const EDIT_INTENT_TESTS = [
    {
        name: 'Simple edit request',
        message: 'edit src/game.html',
        expectedIntent: 'edit',
        expectedToolSequence: ['file_exists', 'read_file', 'edit_file']
    },
    {
        name: 'Change request with informal path',
        message: 'change the title in snake.html',
        expectedIntent: 'edit',
        expectedToolSequence: ['file_exists', 'read_file', 'edit_file']
    },
    {
        name: 'Fix request',
        message: 'fix the bug in game.html',
        expectedIntent: 'edit',
        expectedToolSequence: ['file_exists', 'read_file', 'edit_file']
    },
    {
        name: 'Update request without structure keywords',
        message: 'update the color in style.html',
        expectedIntent: 'edit',
        expectedToolSequence: ['file_exists', 'read_file', 'edit_file']
    },
    {
        name: 'Modify request',
        message: 'modify the header in page.html',
        expectedIntent: 'edit',
        expectedToolSequence: ['file_exists', 'read_file', 'edit_file']
    }
];

const CHAT_FALLBACK_TESTS = [
    {
        name: 'Simple greeting',
        message: 'hello',
        expectedIntent: 'chat'
    },
    {
        name: 'Question without file context',
        message: 'how do I use this bot?',
        expectedIntent: 'chat'
    },
    {
        name: 'Unclear request',
        message: 'can you help me with something',
        expectedIntent: 'chat'
    }
];

const CREATE_INTENT_TESTS = [
    {
        name: 'Create new page',
        message: 'create a new game page',
        expectedIntent: 'create',
        expectedToolSequence: ['list_files', 'write_file']
    },
    {
        name: 'Build something',
        message: 'build me a snake game',
        expectedIntent: 'create'
    },
    {
        name: 'Generate content',
        message: 'generate a new story',
        expectedIntent: 'create'
    },
    {
        name: 'Make a new feature',
        message: 'make a calculator app',
        expectedIntent: 'create'
    }
];

// Pronoun resolution tests - uses actual patternRoute from llmRouter.js
const PRONOUN_RESOLUTION_TESTS = [
    // Repairs
    { name: 'fix it', message: 'fix it', expectedIntent: 'edit' },
    { name: 'it is broken', message: 'it is broken', expectedIntent: 'edit' },
    { name: 'the game has a bug', message: 'the game has a buggy animation', expectedIntent: 'edit' },
    { name: 'debug the page', message: 'debug the page', expectedIntent: 'edit' },
    { name: 'patch that error', message: 'patch that error', expectedIntent: 'edit' },

    // Enhancements (style/design - the original failure case)
    { name: 'give it a vibe', message: 'give it that noir arcade vibe', expectedIntent: 'edit' },
    { name: 'add styling to it', message: 'add some styling to it', expectedIntent: 'edit' },
    { name: 'make it darker', message: 'make it darker', expectedIntent: 'edit' },
    { name: 'apply theme to the page', message: 'apply a dark theme to the page', expectedIntent: 'edit' },
    { name: 'style the game', message: 'style the game', expectedIntent: 'edit' },
    { name: 'turn it into something', message: 'turn it into a noir page', expectedIntent: 'edit' },

    // Refinements
    { name: 'improve it', message: 'improve it', expectedIntent: 'edit' },
    { name: 'polish the page', message: 'polish the page', expectedIntent: 'edit' },
    { name: 'tweak it', message: 'tweak it a bit', expectedIntent: 'edit' },
    { name: 'simplify the game', message: 'simplify the game', expectedIntent: 'edit' },
    { name: 'clean it up', message: 'clean it up', expectedIntent: 'edit' },
    { name: 'optimize that', message: 'optimize that', expectedIntent: 'edit' },

    // Size/Scale
    { name: 'make it bigger', message: 'make it bigger', expectedIntent: 'edit' },
    { name: 'resize the page', message: 'resize the page', expectedIntent: 'edit' },
    { name: 'expand it', message: 'expand it', expectedIntent: 'edit' },

    // Removal
    { name: 'remove the header from it', message: 'remove the header from it', expectedIntent: 'edit' },
    { name: 'hide that element', message: 'hide that element', expectedIntent: 'edit' },
    { name: 'trim the page', message: 'trim the page', expectedIntent: 'edit' },

    // Movement
    { name: 'center it', message: 'center it', expectedIntent: 'edit' },
    { name: 'move the button on the page', message: 'move the button on the page', expectedIntent: 'edit' },
    { name: 'align that', message: 'align that', expectedIntent: 'edit' },
    { name: 'swap the sections in it', message: 'swap the sections in it', expectedIntent: 'edit' }
];

// ============================================
// TEST RUNNER
// ============================================

function runPathExtractionTests() {
    console.log('\n=== Testing Path Extraction ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of PATH_EXTRACTION_TESTS) {
        const plan = fallbackRouting(test.message);
        const extractedPath = plan.parameterHints.file_exists?.path ||
                              plan.parameterHints.read_file?.path ||
                              null;

        if (extractedPath === test.expectedPath) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            console.log(`     Expected: ${test.expectedPath}`);
            console.log(`     Got: ${extractedPath}`);
        }
    }

    return { passed, failed, total: PATH_EXTRACTION_TESTS.length };
}

function runStructuralTransformationTests() {
    console.log('\n=== Testing Structural Transformation Routing ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of STRUCTURAL_TRANSFORMATION_TESTS) {
        const plan = fallbackRouting(test.message);
        let testPassed = true;
        const errors = [];

        if (plan.intent !== test.expectedIntent) {
            testPassed = false;
            errors.push(`Intent: expected '${test.expectedIntent}', got '${plan.intent}'`);
        }

        if (test.expectedToolSequence) {
            const actualSeq = JSON.stringify(plan.toolSequence);
            const expectedSeq = JSON.stringify(test.expectedToolSequence);
            if (actualSeq !== expectedSeq) {
                testPassed = false;
                errors.push(`Tools: expected ${expectedSeq}, got ${actualSeq}`);
            }
        }

        if (test.expectedRefPath) {
            const paths = plan.parameterHints.read_file?.paths || [];
            if (!paths.includes(test.expectedRefPath)) {
                testPassed = false;
                errors.push(`Ref path: expected ${test.expectedRefPath} in ${JSON.stringify(paths)}`);
            }
        }

        if (testPassed) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            errors.forEach(e => console.log(`     ${e}`));
        }
    }

    return { passed, failed, total: STRUCTURAL_TRANSFORMATION_TESTS.length };
}

function runEditIntentTests() {
    console.log('\n=== Testing Edit Intent Routing ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of EDIT_INTENT_TESTS) {
        const plan = fallbackRouting(test.message);
        let testPassed = true;
        const errors = [];

        if (plan.intent !== test.expectedIntent) {
            testPassed = false;
            errors.push(`Intent: expected '${test.expectedIntent}', got '${plan.intent}'`);
        }

        if (test.expectedToolSequence) {
            const actualSeq = JSON.stringify(plan.toolSequence);
            const expectedSeq = JSON.stringify(test.expectedToolSequence);
            if (actualSeq !== expectedSeq) {
                testPassed = false;
                errors.push(`Tools: expected ${expectedSeq}, got ${actualSeq}`);
            }
        }

        if (testPassed) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            errors.forEach(e => console.log(`     ${e}`));
        }
    }

    return { passed, failed, total: EDIT_INTENT_TESTS.length };
}

function runChatFallbackTests() {
    console.log('\n=== Testing Chat Fallback ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of CHAT_FALLBACK_TESTS) {
        const plan = fallbackRouting(test.message);

        if (plan.intent === test.expectedIntent && plan.toolSequence.length === 0) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            console.log(`     Expected intent: ${test.expectedIntent}, got: ${plan.intent}`);
            console.log(`     Expected empty toolSequence, got: ${JSON.stringify(plan.toolSequence)}`);
        }
    }

    return { passed, failed, total: CHAT_FALLBACK_TESTS.length };
}

function runCreateIntentTests() {
    console.log('\n=== Testing Create Intent ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of CREATE_INTENT_TESTS) {
        const plan = fallbackRouting(test.message);

        if (plan.intent === test.expectedIntent) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            console.log(`     Expected: ${test.expectedIntent}, got: ${plan.intent}`);
        }
    }

    return { passed, failed, total: CREATE_INTENT_TESTS.length };
}

// Pronoun resolution tests - uses actual patternRoute with recentFiles context
function runPronounResolutionTests() {
    console.log('\n=== Testing Pronoun Resolution (with recentFile context) ===\n');

    let passed = 0;
    let failed = 0;

    // Simulate context with a recent file (as if user just created a page)
    const context = {
        recentFiles: ['src/enlightenment-breathing.html']
    };

    for (const test of PRONOUN_RESOLUTION_TESTS) {
        const plan = patternRoute(test.message, context);

        if (plan.intent === test.expectedIntent) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            console.log(`     Message: "${test.message}"`);
            console.log(`     Expected: ${test.expectedIntent}, got: ${plan.intent}`);
        }
    }

    return { passed, failed, total: PRONOUN_RESOLUTION_TESTS.length };
}

// Special regression tests for the original failure
function runRegressionTests() {
    console.log('\n=== Regression Tests (Original Failures) ===\n');

    let passed = 0;
    let failed = 0;

    const regressionCases = [
        {
            name: 'Original failure case: update part3.html to follow same design as peanut_city.html',
            message: 'update part3.html to follow the same design and structure as peanut_city.html but with different colors',
            assertions: [
                { check: plan => plan.intent === 'create', desc: 'Intent should be create (not edit or chat)' },
                { check: plan => plan.toolSequence.includes('write_file'), desc: 'Should use write_file' },
                { check: plan => !plan.toolSequence.includes('edit_file'), desc: 'Should NOT use edit_file' },
                { check: plan => plan.parameterHints.file_exists?.path === 'src/part3.html', desc: 'Should extract part3.html path' }
            ]
        },
        {
            name: 'Similar case: make krispy-peaks-affair.html like peanut-city.html',
            message: 'make krispy-peaks-affair.html similar to peanut-city.html',
            assertions: [
                { check: plan => plan.intent === 'create', desc: 'Intent should be create' },
                { check: plan => plan.parameterHints.read_file?.paths?.includes('src/peanut-city.html'), desc: 'Should include peanut-city.html as reference' }
            ]
        }
    ];

    for (const test of regressionCases) {
        const plan = fallbackRouting(test.message);
        let allPassed = true;
        const failures = [];

        for (const assertion of test.assertions) {
            if (!assertion.check(plan)) {
                allPassed = false;
                failures.push(assertion.desc);
            }
        }

        if (allPassed) {
            passed++;
            console.log(`  ✅ ${test.name}`);
        } else {
            failed++;
            console.log(`  ❌ ${test.name}`);
            failures.forEach(f => console.log(`     - ${f}`));
            console.log(`     Plan: ${JSON.stringify({ intent: plan.intent, toolSequence: plan.toolSequence })}`);
        }
    }

    return { passed, failed, total: regressionCases.length };
}

// ============================================
// MAIN
// ============================================

async function runTests() {
    console.log('🧪 LLM Router Test Suite');
    console.log('========================');

    const results = [];

    results.push(runPathExtractionTests());
    results.push(runStructuralTransformationTests());
    results.push(runEditIntentTests());
    results.push(runChatFallbackTests());
    results.push(runCreateIntentTests());
    results.push(runPronounResolutionTests());
    results.push(runRegressionTests());

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
    fallbackRouting,
    PATH_EXTRACTION_TESTS,
    STRUCTURAL_TRANSFORMATION_TESTS,
    EDIT_INTENT_TESTS
};
