/**
 * Image Generator Service - Nano Banana Pro (Gemini 3 Pro Image Preview)
 *
 * Uses OpenRouter API with Zero Data Retention (ZDR) enforcement.
 * Images are saved to src/gallery/ and metadata tracked in gallery.json.
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { OPENROUTER_URL } = require('../../config/models');
const { pushFileViaAPI, getExistingFileSha } = require('../gitHelper');

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-3-pro-image-preview';

const GALLERY_DIR = path.join(__dirname, '../../src/gallery');
const GALLERY_JSON = path.join(GALLERY_DIR, 'gallery.json');

/**
 * Generate an image using Nano Banana Pro
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - Generation options
 * @param {string} options.aspectRatio - Aspect ratio (1:1, 3:4, 4:3, 16:9)
 * @param {string} options.imageSize - Resolution (1K, 2K, 4K)
 * @returns {Promise<{success: boolean, imageBase64?: string, textResponse?: string, error?: string}>}
 */
async function generateImage(prompt, options = {}) {
    const { aspectRatio = '1:1', imageSize = '1K' } = options;

    console.log(`[IMAGE] Generating: "${prompt.substring(0, 50)}..." (${aspectRatio})`);

    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            modalities: ['image', 'text'],
            image_config: {
                aspect_ratio: aspectRatio,
                image_size: imageSize
            },
            provider: { data_collection: 'deny' }  // ZDR enforced
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/milwrite/javabot',
                'X-Title': 'Bot Sportello Image Generator'
            },
            timeout: 120000  // 2 minutes for image generation
        });

        const message = response.data.choices?.[0]?.message;

        if (!message?.images?.[0]) {
            console.log('[IMAGE] No image in response:', JSON.stringify(response.data).substring(0, 200));
            return {
                success: false,
                error: 'No image generated - model may have declined the prompt',
                textResponse: message?.content
            };
        }

        // Extract base64 from data URL
        const imageUrl = message.images[0].image_url?.url || message.images[0];
        const base64Match = imageUrl.match(/base64,(.+)$/);

        if (!base64Match) {
            return { success: false, error: 'Invalid image format in response' };
        }

        console.log('[IMAGE] Generation successful');
        return {
            success: true,
            imageBase64: base64Match[1],
            textResponse: message.content
        };

    } catch (error) {
        const status = error.response?.status;
        const errorMsg = error.response?.data?.error?.message || error.message;

        console.error(`[IMAGE] Error ${status}: ${errorMsg}`);

        if (status === 402) {
            return { success: false, error: 'Insufficient credits for image generation' };
        }
        if (status === 429) {
            return { success: false, error: 'Rate limited - try again in a moment' };
        }

        return { success: false, error: errorMsg };
    }
}

/**
 * Generate a slug from prompt text
 * @param {string} prompt - The prompt text
 * @returns {string} - Slugified version (first 4 words)
 */
function slugify(prompt) {
    return prompt
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .slice(0, 4)
        .join('-')
        .substring(0, 40);
}

/**
 * Save image to gallery and update metadata
 * @param {string} imageBase64 - Base64-encoded image data
 * @param {string} prompt - Original prompt
 * @param {Object} metadata - Additional metadata
 * @param {string} metadata.aspectRatio - Aspect ratio used
 * @param {string} metadata.author - Discord username
 * @returns {Promise<{filename: string, galleryEntry: Object}>}
 */
async function saveToGallery(imageBase64, prompt, metadata = {}) {
    const timestamp = Date.now();
    const slug = slugify(prompt);
    const filename = `${slug}-${timestamp}.png`;
    const filepath = path.join(GALLERY_DIR, filename);

    // Ensure gallery directory exists
    await fs.mkdir(GALLERY_DIR, { recursive: true });

    // Save image locally
    await fs.writeFile(filepath, Buffer.from(imageBase64, 'base64'));
    console.log(`[IMAGE] Saved locally: ${filename}`);

    // Create gallery entry
    const entry = {
        id: `img_${timestamp}`,
        filename,
        prompt: prompt.substring(0, 200),
        aspectRatio: metadata.aspectRatio || '1:1',
        timestamp: new Date().toISOString(),
        author: metadata.author || 'unknown'
    };

    // Update gallery.json
    let gallery = { images: [] };
    try {
        const existing = await fs.readFile(GALLERY_JSON, 'utf-8');
        gallery = JSON.parse(existing);
    } catch (e) {
        // File doesn't exist yet, use empty gallery
    }

    gallery.images.push(entry);
    await fs.writeFile(GALLERY_JSON, JSON.stringify(gallery, null, 2));

    // Push to GitHub
    try {
        await pushImageToGitHub(filename, imageBase64);
        await pushGalleryJsonToGitHub(gallery);
        console.log(`[IMAGE] Pushed to GitHub: ${filename}`);
    } catch (error) {
        console.error('[IMAGE] GitHub push failed:', error.message);
        // Don't fail the whole operation - local save succeeded
    }

    return { filename, galleryEntry: entry };
}

/**
 * Push image file to GitHub
 */
async function pushImageToGitHub(filename, base64Content) {
    const repoPath = `src/gallery/${filename}`;
    const sha = await getExistingFileSha(repoPath);

    await pushFileViaAPI(
        repoPath,
        base64Content,
        `add gallery image: ${filename}`,
        sha,
        true  // isBase64
    );
}

/**
 * Push gallery.json to GitHub
 */
async function pushGalleryJsonToGitHub(gallery) {
    const repoPath = 'src/gallery/gallery.json';
    const content = JSON.stringify(gallery, null, 2);
    const sha = await getExistingFileSha(repoPath);

    await pushFileViaAPI(
        repoPath,
        Buffer.from(content).toString('base64'),
        'update gallery metadata',
        sha,
        true
    );
}

/**
 * Get recent gallery entries
 * @param {number} limit - Max entries to return
 * @returns {Promise<Array>}
 */
async function getGalleryEntries(limit = 12) {
    try {
        const data = await fs.readFile(GALLERY_JSON, 'utf-8');
        const gallery = JSON.parse(data);
        return gallery.images.slice(-limit).reverse();
    } catch (e) {
        return [];
    }
}

module.exports = {
    generateImage,
    saveToGallery,
    getGalleryEntries
};
