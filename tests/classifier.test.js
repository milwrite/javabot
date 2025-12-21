// tests/classifier.test.js
// Test suite for LLM-based request classifier

const { classifyRequest, fallbackClassification } = require('../services/requestClassifier');

/**
 * Test cases for request classification
 */
const TEST_CASES = [
    // CREATE_NEW cases
    {
        prompt: 'produce a tarot reading of ace of cups, ace of wands, and 2 of pentacles and make it a webpage',
        expected: 'CREATE_NEW',
        description: 'Tarot reading webpage creation'
    },
    {
        prompt: 'create a new snake game with mobile controls',
        expected: 'CREATE_NEW',
        description: 'New game creation'
    },
    {
        prompt: 'build me a recipe page for chocolate cake',
        expected: 'CREATE_NEW',
        description: 'Recipe page creation'
    },
    {
        prompt: 'generate an infographic about climate change',
        expected: 'CREATE_NEW',
        description: 'Infographic generation'
    },
    
    // EDIT_EXISTING cases
    {
        prompt: 'edit the crossword puzzle to fix the clues',
        expected: 'EDIT_EXISTING',
        description: 'Edit existing crossword'
    },
    {
        prompt: 'update the snake game to have better controls',
        expected: 'EDIT_EXISTING',
        description: 'Update existing game'
    },
    {
        prompt: 'fix the broken button in the calculator',
        expected: 'EDIT_EXISTING',
        description: 'Fix existing feature'
    },
    {
        prompt: 'change the color scheme of that page',
        expected: 'EDIT_EXISTING',
        description: 'Modify existing page'
    },
    
    // READ_ONLY cases
    {
        prompt: 'what are the current features in the app?',
        expected: 'READ_ONLY',
        description: 'Query about features'
    },
    {
        prompt: 'show me all the games we have',
        expected: 'READ_ONLY',
        description: 'List existing content'
    },
    {
        prompt: 'find the crossword puzzle clues',
        expected: 'READ_ONLY',
        description: 'Search for information'
    },
    {
        prompt: 'list the files in the src directory',
        expected: 'READ_ONLY',
        description: 'Directory listing'
    },
    {
        prompt: 'list previous 3 commit messages',
        expected: 'READ_ONLY',
        description: 'Git history query (not a commit action)'
    },
    {
        prompt: 'show commit history',
        expected: 'READ_ONLY',
        description: 'Git log request'
    },
    {
        prompt: 'search git log for peanuts',
        expected: 'READ_ONLY',
        description: 'Search commit history'
    },
    {
        prompt: 'what was the last commit?',
        expected: 'READ_ONLY',
        description: 'Recent commit query'
    },

    // COMMIT cases (actual commit actions)
    {
        prompt: 'commit this game',
        expected: 'COMMIT',
        description: 'Commit action with target'
    },
    {
        prompt: 'save this and push changes',
        expected: 'COMMIT',
        description: 'Save and push action'
    },
    {
        prompt: 'make a commit with message "fixed bug"',
        expected: 'COMMIT',
        description: 'Explicit commit action'
    },
    
    // CONVERSATION cases
    {
        prompt: 'hello how are you?',
        expected: 'CONVERSATION',
        description: 'Greeting'
    },
    {
        prompt: 'thanks for your help!',
        expected: 'CONVERSATION',
        description: 'Thanks'
    },
    {
        prompt: 'that looks great',
        expected: 'CONVERSATION',
        description: 'General comment'
    },
    {
        prompt: 'cool beans man',
        expected: 'CONVERSATION',
        description: 'Casual chat'
    }
];

/**
 * Run tests for fallback classification (keyword-based)
 */
async function testFallbackClassification() {
    console.log('\n=== Testing Fallback Classification ===\n');
    
    let passed = 0;
    let failed = 0;
    const failures = [];
    
    for (const testCase of TEST_CASES) {
        const result = fallbackClassification(testCase.prompt);
        const success = result.type === testCase.expected;
        
        if (success) {
            passed++;
            console.log(`✅ ${testCase.description}`);
            console.log(`   "${testCase.prompt.substring(0, 50)}..."`);
            console.log(`   Expected: ${testCase.expected}, Got: ${result.type}\n`);
        } else {
            failed++;
            failures.push(testCase);
            console.log(`❌ ${testCase.description}`);
            console.log(`   "${testCase.prompt.substring(0, 50)}..."`);
            console.log(`   Expected: ${testCase.expected}, Got: ${result.type}\n`);
        }
    }
    
    console.log('\n=== Fallback Classification Results ===');
    console.log(`Passed: ${passed}/${TEST_CASES.length}`);
    console.log(`Failed: ${failed}/${TEST_CASES.length}`);
    console.log(`Success Rate: ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);
    
    if (failures.length > 0) {
        console.log('\nFailed cases:');
        failures.forEach(f => {
            console.log(`  - "${f.prompt.substring(0, 60)}..." (expected: ${f.expected})`);
        });
    }
    
    return { passed, failed, total: TEST_CASES.length };
}

/**
 * Run tests for LLM classification (requires API key)
 */
async function testLLMClassification() {
    console.log('\n=== Testing LLM Classification ===\n');
    
    if (!process.env.OPENROUTER_API_KEY) {
        console.log('⚠️  SKIPPED: No OPENROUTER_API_KEY found');
        return { passed: 0, failed: 0, total: 0, skipped: true };
    }
    
    let passed = 0;
    let failed = 0;
    const failures = [];
    
    // Test only a subset to avoid excessive API calls
    const llmTestCases = TEST_CASES.slice(0, 4);
    
    for (const testCase of llmTestCases) {
        try {
            const result = await classifyRequest(testCase.prompt, {
                model: 'anthropic/claude-3-haiku-20240307'
            });
            
            const success = result.type === testCase.expected;
            
            if (success) {
                passed++;
                console.log(`✅ ${testCase.description} (via ${result.method})`);
            } else {
                failed++;
                failures.push(testCase);
                console.log(`❌ ${testCase.description}`);
                console.log(`   Expected: ${testCase.expected}, Got: ${result.type}`);
            }
        } catch (error) {
            console.log(`⚠️  Error testing "${testCase.prompt.substring(0, 30)}...": ${error.message}`);
            failed++;
        }
    }
    
    console.log('\n=== LLM Classification Results ===');
    console.log(`Tested: ${llmTestCases.length} cases (subset)`);
    console.log(`Passed: ${passed}/${llmTestCases.length}`);
    console.log(`Failed: ${failed}/${llmTestCases.length}`);
    
    return { passed, failed, total: llmTestCases.length };
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('🧪 Request Classifier Test Suite');
    console.log('================================');
    
    const fallbackResults = await testFallbackClassification();
    const llmResults = await testLLMClassification();
    
    console.log('\n=== Overall Results ===');
    console.log(`Fallback: ${fallbackResults.passed}/${fallbackResults.total} passed`);
    
    if (!llmResults.skipped) {
        console.log(`LLM: ${llmResults.passed}/${llmResults.total} passed`);
    } else {
        console.log(`LLM: Skipped (no API key)`);
    }
    
    const totalPassed = fallbackResults.passed + (llmResults.passed || 0);
    const totalTests = fallbackResults.total + (llmResults.total || 0);
    const overallSuccess = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0;
    
    console.log(`\nOverall Success Rate: ${overallSuccess}%`);
    
    // Exit with error code if tests failed
    if (fallbackResults.failed > 0 || llmResults.failed > 0) {
        process.exit(1);
    }
}

// Run tests if executed directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('Test suite error:', error);
        process.exit(1);
    });
}

module.exports = { runTests, TEST_CASES };