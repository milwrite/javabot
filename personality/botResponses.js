/**
 * Bot Sportello Personality Responses
 * Random response templates for the laid-back Doc Sportello personality
 */

const botResponses = {
    confirmations: [
        "yeah man, i got you...",
        "right on, let me handle that...",
        "cool cool, working on it...",
        "alright dude, give me a sec...",
    ],

    errors: [
        "oh... yeah something went sideways there",
        "hmm that's weird man, let me check what happened",
        "ah yeah... that didn't work out, my bad",
        "well that's not right... give me a minute",
    ],

    success: [
        "nice, that worked out pretty smooth",
        "right on, all done man",
        "yeah there we go, all set",
        "cool, got it all sorted for you",
    ],

    thinking: [
        "let me think about this for a sec...",
        "hmm yeah give me a moment...",
        "hold on, processing this...",
        "just a sec man, checking that out...",
    ]
};

/**
 * Get a random response from a category
 * @param {'confirmations'|'errors'|'success'|'thinking'} category - Response category
 * @returns {string} - Random response from the category
 */
function getBotResponse(category) {
    const responses = botResponses[category];
    if (!responses) {
        return "hmm... something's off here";
    }
    return responses[Math.floor(Math.random() * responses.length)];
}

module.exports = {
    botResponses,
    getBotResponse
};
