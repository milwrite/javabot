/**
 * Web Scraper Service
 * Fetches and extracts clean text from URLs for context grounding in deep research
 * Uses cheerio for lightweight HTML parsing (no headless browser needed)
 */

const axios = require('axios');

const SCRAPE_TIMEOUT = 30000; // 30 seconds
const MAX_CONTENT_LENGTH = 10000; // Max characters to extract

/**
 * Fetch URL and extract clean text content
 * @param {string} url - Target URL to scrape
 * @param {object} options - Configuration options
 * @param {number} options.timeout - Request timeout in ms (default: 30000)
 * @param {number} options.maxLength - Max characters to return (default: 10000)
 * @returns {Promise<object>} - { success: boolean, text: string, title: string, error?: string }
 */
async function scrapeURL(url, options = {}) {
    const { timeout = SCRAPE_TIMEOUT, maxLength = MAX_CONTENT_LENGTH } = options;

    try {
        // Validate URL format
        const urlObj = new URL(url);

        // Fetch HTML content
        const response = await axios.get(url, {
            timeout,
            headers: {
                'User-Agent': 'Bot Sportello (Deep Research Context Scraper)'
            },
            maxContentLength: 5000000 // 5MB max response size
        });

        if (response.status !== 200) {
            return {
                success: false,
                error: `HTTP ${response.status}`
            };
        }

        // Extract text from HTML
        const extracted = extractText(response.data);

        // Clean and truncate text
        const cleanedText = cleanText(extracted.text, maxLength);

        return {
            success: true,
            text: cleanedText,
            title: extracted.title || urlObj.hostname
        };
    } catch (error) {
        // Determine error type
        let errorMsg = 'unknown error';

        if (error.code === 'ENOTFOUND') {
            errorMsg = 'invalid URL';
        } else if (error.code === 'ECONNREFUSED') {
            errorMsg = 'connection refused';
        } else if (error.code === 'ECONNRESET') {
            errorMsg = 'connection reset';
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
            errorMsg = 'timeout (took too long)';
        } else if (error.response?.status === 404) {
            errorMsg = '404 not found';
        } else if (error.response?.status === 403) {
            errorMsg = '403 forbidden';
        } else if (error.response?.status === 503) {
            errorMsg = '503 service unavailable';
        } else if (error.message.includes('getaddrinfo')) {
            errorMsg = 'DNS resolution failed';
        } else if (error.message.includes('ERR_TLS')) {
            errorMsg = 'SSL certificate error';
        }

        console.log(`[WEB_SCRAPER] Scrape failed for ${url}: ${errorMsg} (${error.message})`);

        return {
            success: false,
            error: errorMsg
        };
    }
}

/**
 * Extract meaningful text from HTML using cheerio
 * @param {string} html - Raw HTML content
 * @returns {object} - { text: string, title: string }
 */
function extractText(html) {
    // Cheerio must be required here to avoid npm error if not installed
    let cheerio;
    try {
        cheerio = require('cheerio');
    } catch (e) {
        console.error('[WEB_SCRAPER] cheerio not installed. Run: npm install cheerio');
        throw new Error('cheerio dependency missing');
    }

    const $ = cheerio.load(html);

    // Extract title
    let title = $('title').text().trim();
    if (!title) {
        title = $('h1').first().text().trim();
    }

    // Remove script, style, nav, footer elements
    $('script, style, noscript, meta, link, nav, footer').remove();

    // Try to extract from semantic content elements
    let text = '';

    // Priority 1: article element
    const article = $('article').text();
    if (article.trim().length > 100) {
        text = article;
    }

    // Priority 2: main element
    if (!text) {
        const main = $('main').text();
        if (main.trim().length > 100) {
            text = main;
        }
    }

    // Priority 3: div with class "content"
    if (!text) {
        const content = $('[class*="content"]').first().text();
        if (content.trim().length > 100) {
            text = content;
        }
    }

    // Priority 4: div with id "content"
    if (!text) {
        const idContent = $('#content').text();
        if (idContent.trim().length > 100) {
            text = idContent;
        }
    }

    // Fallback: use body text
    if (!text) {
        text = $('body').text();
    }

    return {
        text: text.trim(),
        title: title
    };
}

/**
 * Clean and normalize extracted text
 * Removes excessive whitespace, normalizes line breaks, truncates to max length
 * @param {string} text - Raw extracted text
 * @param {number} maxLength - Maximum characters to return
 * @returns {string} - Cleaned text
 */
function cleanText(text, maxLength = MAX_CONTENT_LENGTH) {
    // Normalize whitespace
    let cleaned = text
        .replace(/\r\n/g, '\n')           // Normalize line endings
        .replace(/\t/g, ' ')              // Convert tabs to spaces
        .replace(/  +/g, ' ')             // Collapse multiple spaces
        .replace(/\n\n\n+/g, '\n\n')      // Collapse multiple blank lines
        .trim();

    // Truncate to max length while preserving sentence boundaries
    if (cleaned.length > maxLength) {
        // Try to truncate at a sentence boundary
        let truncated = cleaned.substring(0, maxLength);

        // Find last period, question mark, or exclamation mark
        const lastPunct = Math.max(
            truncated.lastIndexOf('.'),
            truncated.lastIndexOf('?'),
            truncated.lastIndexOf('!')
        );

        // If we found punctuation, truncate there
        if (lastPunct > maxLength * 0.8) {
            truncated = cleaned.substring(0, lastPunct + 1);
        } else {
            // Otherwise, find last space to avoid cutting words
            const lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > 0) {
                truncated = cleaned.substring(0, lastSpace);
            }
        }

        return truncated + '\n\n[text truncated...]';
    }

    return cleaned;
}

/**
 * Extract domain name from URL for display
 * @param {string} url - Full URL
 * @returns {string} - Clean domain name
 */
function extractDomain(url) {
    try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return domain;
    } catch {
        return url.split('/')[2] || url;
    }
}

module.exports = {
    scrapeURL,
    extractText,
    cleanText,
    extractDomain,
    SCRAPE_TIMEOUT,
    MAX_CONTENT_LENGTH
};
