/**
 * Module Validation Script
 * Tests that all prompt modules export valid strings and assemblers work correctly
 */

const path = require('path');
const fs = require('fs');

// ANSI color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function validateModule(modulePath, expectedType = 'string') {
  try {
    const fullPath = path.join(__dirname, '..', modulePath);

    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${modulePath}` };
    }

    const module = require(fullPath);

    if (expectedType === 'string' && typeof module !== 'string') {
      return { success: false, error: `Expected string, got ${typeof module}` };
    }

    if (expectedType === 'object' && typeof module !== 'object') {
      return { success: false, error: `Expected object, got ${typeof module}` };
    }

    // Check for empty strings
    if (expectedType === 'string' && module.trim().length === 0) {
      return { success: false, error: 'Module exports empty string' };
    }

    // Calculate approximate line count (for reporting)
    const lineCount = expectedType === 'string' ? module.split('\n').length : 'N/A';

    return { success: true, lineCount, length: typeof module === 'string' ? module.length : 'N/A' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function runTests(category) {
  const tests = {
    core: [
      { path: 'core/identity.js', type: 'string', expectedLines: '~50' },
      { path: 'core/capabilities.js', type: 'string', expectedLines: '~40' },
      { path: 'core/repository.js', type: 'string', expectedLines: '~60' }
    ],
    tools: [
      { path: 'tools/toolCatalog.js', type: 'object', expectedLines: '~100' },
      { path: 'tools/fileOperations.js', type: 'string', expectedLines: '~60' },
      { path: 'tools/gitOperations.js', type: 'string', expectedLines: '~40' },
      { path: 'tools/searchGuidelines.js', type: 'string', expectedLines: '~30' }
    ],
    content: [
      { path: 'content/designSystem.js', type: 'string', expectedLines: '~80' },
      { path: 'content/cssClasses.js', type: 'string', expectedLines: '~60' },
      { path: 'content/mobilePatterns.js', type: 'string', expectedLines: '~70' },
      { path: 'content/pageStructure.js', type: 'string', expectedLines: '~80' },
      { path: 'content/components.js', type: 'string', expectedLines: '~50' }
    ],
    specialized: [
      { path: 'specialized/routing.js', type: 'string', expectedLines: '~60' },
      { path: 'specialized/editing.js', type: 'string', expectedLines: '~50' },
      { path: 'specialized/agentRoles.js', type: 'object', expectedLines: '~200' }
    ],
    assemblers: [
      { path: 'assemblers/index.js', type: 'object', expectedLines: '~150' }
    ]
  };

  const categoriesToTest = category ? [category] : Object.keys(tests);
  let totalTests = 0;
  let passedTests = 0;

  log(`\n${'='.repeat(60)}`, 'cyan');
  log('   Module Validation Tests', 'cyan');
  log(`${'='.repeat(60)}\n`, 'cyan');

  categoriesToTest.forEach(cat => {
    if (!tests[cat]) {
      log(`Unknown category: ${cat}`, 'red');
      return;
    }

    log(`\n[${ cat.toUpperCase()}]`, 'yellow');
    log(`${'─'.repeat(60)}`, 'dim');

    tests[cat].forEach(test => {
      totalTests++;
      const result = validateModule(test.path, test.type);

      if (result.success) {
        passedTests++;
        const lineInfo = test.type === 'string' ? ` (${result.lineCount} lines, ${test.expectedLines} expected)` : '';
        log(`✓ ${test.path}${lineInfo}`, 'green');
      } else {
        log(`✗ ${test.path}`, 'red');
        log(`  └─ ${result.error}`, 'red');
      }
    });
  });

  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`Results: ${passedTests}/${totalTests} tests passed`, passedTests === totalTests ? 'green' : 'yellow');
  log(`${'='.repeat(60)}\n`, 'cyan');

  // Test assemblers if they exist
  if (category === 'assemblers' || !category) {
    log('\nTesting assembler functions...', 'yellow');
    try {
      const assemblers = require('../assemblers/index.js');
      const assemblerFunctions = [
        'assembleFullAgent',
        'assembleRouter',
        'assembleEditMode',
        'assembleChat',
        'assembleArchitect',
        'assembleBuilder',
        'assembleTester',
        'assembleScribe'
      ];

      assemblerFunctions.forEach(funcName => {
        if (typeof assemblers[funcName] === 'function') {
          try {
            const result = assemblers[funcName]();
            if (typeof result === 'string' && result.length > 0) {
              const lines = result.split('\n').length;
              log(`✓ ${funcName}() → ${lines} lines`, 'green');
            } else {
              log(`✗ ${funcName}() returned invalid result`, 'red');
            }
          } catch (error) {
            log(`✗ ${funcName}() threw error: ${error.message}`, 'red');
          }
        } else {
          log(`✗ ${funcName} not found or not a function`, 'red');
        }
      });
    } catch (error) {
      log(`Failed to load assemblers: ${error.message}`, 'red');
    }
  }

  return passedTests === totalTests;
}

// CLI usage
const category = process.argv[2]; // core, tools, content, specialized, assemblers
const allPassed = runTests(category);
process.exit(allPassed ? 0 : 1);
