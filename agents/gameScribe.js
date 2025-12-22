// agents/gameScribe.js
// Documentation agent - generates metadata and release notes

const { callLLM, extractJSON } = require('../services/llmClient');
const fs = require('fs').promises;
const path = require('path');

/**
 * Generate documentation and metadata for game
 * @param {object} options - Documentation options
 * @param {object} options.plan - Original plan
 * @param {object} options.buildResult - Build result
 * @param {object} options.testResult - Test result
 * @param {string} options.buildId - Build ID
 * @param {Function} options.onStatusUpdate - Optional callback for progress updates
 * @returns {object} Documentation { metadata, releaseNotes, howToPlay }
 */
async function documentGame({ plan, buildResult, testResult, buildId, onStatusUpdate = null }) {
    console.log(`📝 Scribe generating docs...`);

    const messages = [
        {
            role: 'user',
            content: `Generate documentation for: ${plan.metadata.title}

Type: ${plan.contentType || plan.type || 'unknown'}
Features: ${(plan.features || plan.mechanics || []).join(', ')}
Files: ${plan.files.join(', ')}
Test score: ${testResult.score}/100

Generate:
1. Refined metadata entry for projectmetadata.json
2. Short release notes (2-3 sentences) in Bot Sportello's casual voice
3. Optional brief "How to play" instructions if this is a game

Return as JSON.`
        }
    ];

    const response = await callLLM({
        role: 'scribe',
        messages,
        model: 'glm',
        temperature: 0.8, // Slightly higher for creative captions
        onHeartbeat: onStatusUpdate
    });

    try {
        const docs = extractJSON(response.content);

        // Ensure metadata has required fields
        const metadata = {
            title: docs.metadata?.title || plan.metadata.title,
            icon: docs.metadata?.icon || plan.metadata.icon,
            description: docs.metadata?.description || plan.metadata.description,
            collection: plan.metadata.collection
        };

        console.log(`✅ Documentation complete`);
        console.log(`   Caption: "${metadata.description}"`);

        return {
            metadata,
            releaseNotes: docs.releaseNotes || `built ${plan.metadata.title} - check it out`,
            howToPlay: docs.howToPlay || null,
            buildId
        };
    } catch (error) {
        console.error('Failed to parse scribe response:', error);
        // Fallback to plan metadata
        return {
            metadata: plan.metadata,
            releaseNotes: `built ${plan.metadata.title} - should work smooth`,
            howToPlay: null,
            buildId
        };
    }
}

/**
 * Update projectmetadata.json with new game entry
 * @param {string} slug - Game slug (filename without extension)
 * @param {object} metadata - Metadata object
 * @returns {boolean} Success
 */
async function updateProjectMetadata(slug, metadata) {
    const metadataPath = path.join(__dirname, '..', 'projectmetadata.json');

    try {
        // Read existing metadata
        const content = await fs.readFile(metadataPath, 'utf8');
        const data = JSON.parse(content);

        // Ensure structure exists
        if (!data.projects) data.projects = {};
        if (!data.collections) data.collections = {};

        // Add/update project entry
        data.projects[slug] = {
            title: metadata.title,
            icon: metadata.icon,
            description: metadata.description,
            collection: metadata.collection,
            hidden: false
        };

        // Write back
        await fs.writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf8');

        console.log(`✅ Updated projectmetadata.json: ${slug} → ${metadata.collection}`);
        return true;
    } catch (error) {
        console.error('Failed to update projectmetadata.json:', error);
        return false;
    }
}

module.exports = {
    documentGame,
    updateProjectMetadata
};
