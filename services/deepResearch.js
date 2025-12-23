/**
 * Deep Research Service
 * Uses Perplexity Sonar Deep Research via OpenRouter for comprehensive research with citations
 */

const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEP_RESEARCH_MODEL = 'perplexity/sonar-deep-research';
const DEEP_RESEARCH_TIMEOUT = 180000; // 3 minutes

/**
 * Execute deep research query via Perplexity Sonar Deep Research
 * @param {string} query - Research query
 * @param {object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback for long-running queries
 * @returns {object} - { content: string, citations: array, usage: object }
 */
async function deepResearch(query, options = {}) {
    const { onProgress } = options;

    // Set up progress interval (every 30 seconds)
    let progressInterval = null;
    let elapsedSeconds = 0;

    if (onProgress) {
        progressInterval = setInterval(() => {
            elapsedSeconds += 30;
            onProgress(`still researching... (${elapsedSeconds}s elapsed)`);
        }, 30000);
    }

    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: DEEP_RESEARCH_MODEL,
            messages: [{
                role: 'user',
                content: `Research the following topic comprehensively. Provide detailed analysis with sources and citations:\n\n${query}`
            }],
            max_tokens: 8000,
            temperature: 0.3,
            provider: { data_collection: 'deny' } // ZDR enforcement
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/milwrite/javabot',
                'X-Title': 'Bot Sportello Deep Research'
            },
            timeout: DEEP_RESEARCH_TIMEOUT
        });

        // Clear progress interval
        if (progressInterval) clearInterval(progressInterval);

        const message = response.data.choices[0].message;
        const { cleanContent, citations } = extractCitations(message.content);

        return {
            content: cleanContent,
            citations: citations,
            usage: response.data.usage
        };
    } catch (error) {
        if (progressInterval) clearInterval(progressInterval);
        throw error;
    }
}

/**
 * Extract citations from Perplexity response
 * Citations appear as URLs inline or at end of response
 * @param {string} content - Response content
 * @returns {object} - { cleanContent: string, citations: array }
 */
function extractCitations(content) {
    const urlPattern = /https?:\/\/[^\s\]\)]+/g;
    const citations = [];

    // Extract unique URLs as citations
    let match;
    while ((match = urlPattern.exec(content)) !== null) {
        // Clean trailing punctuation from URLs
        let url = match[0].replace(/[.,;:!?\)]+$/, '');
        if (!citations.includes(url)) {
            citations.push(url);
        }
    }

    // Keep content as-is (Perplexity formats it well)
    let cleanContent = content
        .replace(/\n{4,}/g, '\n\n\n') // Normalize excessive line breaks
        .trim();

    return { cleanContent, citations };
}

/**
 * Format deep research results for Discord embed
 * @param {object} result - Raw result from deepResearch()
 * @param {string} query - Original query
 * @returns {object} - { embed: EmbedBuilder, fullText: string }
 */
function formatForDiscord(result, query) {
    const maxDescLength = 3500; // Leave room for sources field
    let description = result.content;
    let wasTruncated = false;

    if (description.length > maxDescLength) {
        description = description.substring(0, maxDescLength) + '...';
        wasTruncated = true;
    }

    const embed = new EmbedBuilder()
        .setTitle(`Deep Research: ${query.substring(0, 80)}${query.length > 80 ? '...' : ''}`)
        .setDescription(description)
        .setColor(0x7B68EE) // Medium purple for research
        .setTimestamp();

    // Add sources field (up to 10 citations)
    if (result.citations && result.citations.length > 0) {
        const citationsText = result.citations
            .slice(0, 10)
            .map((c, i) => `**[${i + 1}]** ${c.substring(0, 80)}${c.length > 80 ? '...' : ''}`)
            .join('\n');

        embed.addFields({
            name: `Sources (${result.citations.length} found)`,
            value: citationsText.substring(0, 1024), // Field value max
            inline: false
        });
    }

    // Add truncation notice if needed
    if (wasTruncated) {
        embed.addFields({
            name: 'Note',
            value: 'Response truncated. Full report saved to file.',
            inline: true
        });
    }

    return {
        embed,
        fullText: result.content
    };
}

module.exports = {
    deepResearch,
    formatForDiscord,
    extractCitations,
    DEEP_RESEARCH_MODEL,
    DEEP_RESEARCH_TIMEOUT
};
