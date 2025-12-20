# OpenRouter Reasoning Config Parameter Conflict

**Date**: 2025-12-20
**Status**: Resolved
**Commit**: c3e29e3

## Symptoms

```
LLM: Client error 400: Only one of "reasoning.effort" and "reasoning.max_tokens" can be specified
```

Followed by:
```
Cannot read properties of undefined (reading '0')
```

The second error occurred because the API returned an error response instead of valid choices, and the code tried to access `response.data.choices[0]` on undefined.

## Root Cause

In `index.js` lines 638-643, the `REASONING_CONFIG` object specified **both** `effort` and `max_tokens` for Claude and Kimi models:

```javascript
// BEFORE (broken)
'anthropic/claude-haiku-4.5': { enabled: true, effort: 'low', max_tokens: 1024 },
'anthropic/claude-sonnet-4.5': { enabled: true, effort: 'low', max_tokens: 1024 },
'moonshotai/kimi-k2-thinking': { enabled: true, effort: 'low', max_tokens: 2048 },
```

OpenRouter's API only allows **one** of these parameters, not both.

## Fix

Removed `max_tokens` and the unused `enabled` property, keeping only `effort`:

```javascript
// AFTER (fixed)
'anthropic/claude-haiku-4.5': { effort: 'low' },
'anthropic/claude-sonnet-4.5': { effort: 'low' },
'google/gemini-2.5-pro': { effort: 'low' },
'moonshotai/kimi-k2-thinking': { effort: 'low' },
```

## Technical Notes

OpenRouter's extended thinking/reasoning API supports two mutually exclusive approaches:

1. **`effort`** (`low`/`medium`/`high`) - Let the model dynamically decide its reasoning token budget
2. **`max_tokens`** (integer) - Explicitly cap reasoning tokens to a fixed number

Using `effort` is generally preferred as it allows the model to scale reasoning based on task complexity.

## Files Changed

- `index.js`: `REASONING_CONFIG` object (lines 636-650)
