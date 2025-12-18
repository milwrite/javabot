# Test Suite - Bot Sportello

## Overview
Automated tests validating features documented in DEVLOG.md entries.

## Running Tests

```bash
# Run full test suite (devlog features)
npm test

# Run search-specific tests
npm run test:search

# Run markdown formatting tests
npm run test:format
```

## Test Files

### `devlog.test.js`
Validates the 2025-12-14 DEVLOG entry features:

**DEVLOG Structure Tests:**
- ✅ DEVLOG.md exists and is readable
- ✅ Contains required sections (Issue, Root Causes, Changes Made, Testing, Files Modified)

**searchFiles Function Tests:**
- ✅ Finds HTML elements in source files
- ✅ Case-insensitive search works
- ✅ File pattern filtering works
- ✅ Handles non-existent paths gracefully
- ✅ Handles invalid regex patterns gracefully

**isEditRequest Classification Tests:**
- ✅ Read-only verbs (list, show, display, find, search) → NOT edit
- ✅ Edit verbs (change, fix, update, modify) → IS edit
- ✅ Game name mentions with read-only context → NOT edit
- ✅ Empty strings handled correctly

**Pattern Search Tests:**
- ✅ Searches for CSS class patterns
- ✅ Searches for event listener patterns
- ✅ Searches for mobile-control elements

**Integration Test:**
- ✅ Full workflow: Query → Classify → Search → Extract

**Total:** 18 tests

### `markdown-format.test.js`
Validates markdown formatting improvements for Discord rendering:

**Formatting Rules Tests:**
- ✅ Headers get blank lines before and after
- ✅ Lists get blank line before items
- ✅ Code blocks get blank lines before and after
- ✅ Bold sections get spacing
- ✅ Multiple blank lines collapsed to max 2

**Cleanup Tests:**
- ✅ Bot Sportello prefix removal
- ✅ Empty/null input handling

**Integration Test:**
- ✅ Complex multi-section response formatting

**Total:** 8 tests

## Test Coverage

### Features Covered
1. **File Search (`searchFiles`)** - Lines 910-1026 in index.js
2. **Request Classification (`isEditRequest`)** - Lines 217-268 in services/gamePipeline.js
3. **Read-only Detection** - Lines 220-234 in services/gamePipeline.js
4. **Tool Integration** - Main LLM loop and edit loop tool handlers

### Expected Behavior
All tests should pass (18/18). Any failures indicate:
- DEVLOG.md missing required sections
- `searchFiles` implementation broken
- `isEditRequest` classification broken
- Source file structure changed

## Adding New Tests

When adding a new DEVLOG entry with features:

1. Add new test section to `devlog.test.js`:
```javascript
await tester.test('Your feature description', async () => {
    // Test implementation
    await tester.assertEqual(actual, expected, 'Error message');
});
```

2. Run tests to verify:
```bash
npm test
```

3. Update this README with new test count and coverage

## Test Framework

Custom lightweight test framework (`DevLogTester` class):
- `test(name, fn)` - Run async test function
- `assertEqual(actual, expected, msg)` - Assert equality
- `assertTrue(value, msg)` - Assert truthy
- `assertGreaterThan(actual, min, msg)` - Assert > comparison
- `assertContains(str, substring, msg)` - Assert substring present
- `summary()` - Print pass/fail summary

## CI/CD Integration

To add to CI pipeline:
```yaml
- name: Run tests
  run: npm test
```

Tests exit with code 0 (success) or 1 (failure) for CI compatibility.
