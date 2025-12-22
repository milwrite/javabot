// agents/gameArchitect.js
// Game planning agent - analyzes user request and creates implementation plan

const { callLLM, extractJSON } = require('../services/llmClient');

/**
 * Plan a game based on user prompt
 * @param {object} options - Planning options
 * @param {string} options.userPrompt - User's game request
 * @param {string} options.recentPatternsSummary - Summary of recent build issues
 * @param {string} options.preferredType - Optional type hint ('arcade', 'if', 'infographic', 'auto')
 * @param {Function} options.onStatusUpdate - Optional callback for progress updates
 * @returns {object} Game plan
 */
async function planGame({ userPrompt, recentPatternsSummary, preferredType = 'auto', onStatusUpdate = null }) {
    console.log('🏗️  Architect analyzing request...');

    const messages = [
        {
            role: 'user',
            content: `User request: ${userPrompt}

${preferredType !== 'auto' ? `Preferred type: ${preferredType}` : ''}

Recent patterns and issues to avoid:
${recentPatternsSummary}

Plan a simple, mobile-first game/page that satisfies this request. Return a complete JSON plan.`
        }
    ];

    const response = await callLLM({
        role: 'architect',
        messages,
        model: 'glm',
        temperature: 0.7,
        onHeartbeat: onStatusUpdate
    });

    try {
        const plan = extractJSON(response.content);

        // Validate plan structure (support both contentType and type for compatibility)
        const contentType = plan.contentType || plan.type;
        if (!plan.slug || !contentType || !plan.files || !plan.metadata) {
            throw new Error('Plan missing required fields (slug, contentType/type, files, metadata)');
        }

        // Normalize to contentType field
        if (!plan.contentType && plan.type) {
            plan.contentType = plan.type;
        }

        console.log(`📋 Plan created: ${plan.metadata.title} (${plan.contentType})`);
        console.log(`   Files: ${plan.files.join(', ')}`);
        console.log(`   Collection: ${plan.metadata.collection}`);

        return plan;
    } catch (error) {
        console.error('Failed to parse architect response:', error);
        throw new Error(`Architect planning failed: ${error.message}`);
    }
}

module.exports = { planGame };
