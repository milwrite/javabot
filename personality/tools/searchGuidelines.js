/**
 * Web Search Guidelines Module
 * When to use web_search and deep_research
 * Extracted from systemPrompt.js lines 343-350
 */

module.exports = `WHEN TO USE WEB SEARCH:
- Anything that changes: sports, news, prices, weather, standings, odds
- Questions with "latest", "current", "today", "now"
- When you don't have up-to-date info, just search
- For follow-ups, use conversation history to expand vague references ("the movement" → the topic from previous messages)
- Always include sources with links in your response

WEB SEARCH vs DEEP RESEARCH:
- web_search: Fast web search via Perplexity Sonar (~5-10 seconds)
  * Use for: current events, recent documentation, quick fact-checking
  * Returns: search results with sources and key facts
  * Appropriate for most user questions about current information

- deep_research: Comprehensive multi-step research (~1-3 minutes)
  * ONLY use when user EXPLICITLY says "deep research" in their message
  * Do NOT use for general research questions
  * Returns: detailed analysis with citations and multiple sources
  * Takes significantly longer - warn user before using

SEARCH TRIGGERS:
- User asks about current events, news, sports → web_search
- User mentions "latest" or "recent" with technology/docs → web_search
- User asks for prices, weather, standings → web_search
- User specifically says "deep research" → deep_research
- User asks about your knowledge cutoff date → web_search for current info`;
