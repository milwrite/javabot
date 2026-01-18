# Issue 001: Context Cache Returning Partial Data

**Status**: Fixed
**Date**: 2025-01-05
**Severity**: High

## Symptoms

- LLM receiving only 1 message of context instead of 10
- Bot responses lacked awareness of recent conversation history
- Context appeared to work intermittently (worked when cache was "full", failed on fresh channels)

## Root Cause

The `DiscordContextManager.upsertMessage()` method created cache entries with a fresh timestamp even when the cache only contained 1 message. The `fetchChannelHistory()` method checked `Date.now() - cached.timestamp < TTL` to determine freshness, causing it to return incomplete data.

**Bug flow:**
1. New message arrives → `upsertMessage(message)` called
2. No prior cache exists → creates `{ data: [message], timestamp: Date.now() }`
3. `buildContextForChannel()` called immediately after
4. `fetchChannelHistory()` checks TTL → cache appears "fresh" (just created)
5. Returns 1-message cache instead of fetching full 10-message history

**Secondary issues found:**
- Dual context systems (`messageHistory` array + `DiscordContextManager.cache`) never synchronized
- No race condition prevention for concurrent Discord API fetches
- Unbounded cache growth (no size limit)
- Missing null check for emoji names in reaction formatting

## Fix

### 1. Partial Flag Pattern

Added `partial` boolean to cache entries. Caches created by `upsertMessage()` are marked `partial: true`. The `fetchChannelHistory()` method ignores partial caches:

```javascript
// Return cache only if FULL (not partial) AND fresh
if (cached && !cached.partial && Date.now() - cached.timestamp < CONFIG.DISCORD_CACHE_TTL) {
    return cached.data;
}
```

### 2. Race Condition Prevention

Added `pendingFetches` Map to deduplicate concurrent requests:

```javascript
if (this.pendingFetches.has(cacheKey)) {
    return this.pendingFetches.get(cacheKey); // Share in-flight promise
}
```

### 3. Memory Bounds

Added LRU eviction at 50 cached channels via `_enforceCacheLimit()`.

### 4. Legacy System Removal

Removed unused `messageHistory` array, `MAX_HISTORY` constant, `addToHistory()` function, and 10 call sites.

## Files Changed

- `index.js`: Rewrote `DiscordContextManager` class (lines 384-608), removed legacy code
- `CLAUDE.md`: Updated "Message History System" documentation

## Verification

Console logs now show cache status:
- `[CONTEXT] Created partial cache for #channel (1 message)`
- `[CONTEXT] Fetching 10 messages from #channel (partial cache)`
- `[CONTEXT] Cached 10 messages for #channel (full)`
- `[CONTEXT] Using cached history for #channel (10 messages, full)`

## Lessons Learned

When implementing TTL-based caching where data can be incrementally built, distinguish between "recently touched" and "complete data". A simple timestamp isn't sufficient when partial data can make a cache entry appear fresh.
