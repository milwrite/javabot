// agents/gameArchitect.js
// Game planning agent - analyzes user request and creates implementation plan

const { callSonnet, extractJSON } = require('../services/llmClient');

/**
 * Plan a game based on user prompt
 * @param {object} options - Planning options
 * @param {string} options.userPrompt - User's game request
 * @param {string} options.recentPatternsSummary - Summary of recent build issues
 * @param {string} options.preferredType - Optional type hint ('arcade', 'if', 'infographic', 'auto')
 * @returns {object} Game plan
 */
async function planGame({ userPrompt, recentPatternsSummary, preferredType = 'auto' }) {
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

    const response = await callSonnet({
        role: 'architect',
        messages,
        model: 'sonnet',
        temperature: 0.7
    });

    try {
        const plan = extractJSON(response.content);

        // Validate plan structure
        if (!plan.slug || !plan.type || !plan.files || !plan.metadata) {
            throw new Error('Plan missing required fields');
        }

        console.log(`📋 Plan created: ${plan.metadata.title} (${plan.type})`);
        console.log(`   Files: ${plan.files.join(', ')}`);
        console.log(`   Collection: ${plan.metadata.collection}`);

        return plan;
    } catch (error) {
        console.error('Failed to parse architect response:', error);
        throw new Error(`Architect planning failed: ${error.message}`);
    }
}

module.exports = { planGame };
