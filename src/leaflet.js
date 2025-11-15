import Anthropic from "@anthropic-ai/sdk";

/**
 * Leaflet Feature - Embed Leaflet functionality in running map
 * This module provides AI-powered assistance for working with Leaflet maps
 */

const client = new Anthropic();

/**
 * Initialize the leaflet feature with multi-turn conversation support
 * @returns {Object} Leaflet feature object with methods
 */
function createLeafletFeature() {
  const conversationHistory = [];

  /**
   * Process user query about Leaflet maps with AI assistance
   * @param {string} userMessage - User's question or request about Leaflet
   * @returns {Promise<string>} AI response with Leaflet guidance
   */
  async function processLeafletQuery(userMessage) {
    conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: `You are an expert Leaflet.js map library assistant. Help users create, configure, and troubleshoot Leaflet maps.
        
Provide:
- Practical code examples
- Best practices for map setup
- Solutions for common issues
- Performance optimization tips
- Integration guidance with other libraries

When providing code, ensure it's clean, well-commented, and follows Leaflet conventions.`,
      messages: conversationHistory,
    });

    const assistantMessage =
      response.content[0].type === "text" ? response.content[0].text : "";

    conversationHistory.push({
      role: "assistant",
      content: assistantMessage,
    });

    return assistantMessage;
  }

  /**
   * Get conversation history for context
   * @returns {Array} Array of conversation messages
   */
  function getHistory() {
    return conversationHistory;
  }

  /**
   * Clear conversation history for fresh start
   */
  function clearHistory() {
    conversationHistory.length = 0;
  }

  /**
   * Generate a Leaflet map implementation based on requirements
   * @param {Object} requirements - Map requirements object
   * @returns {Promise<string>} Generated Leaflet code
   */
  async function generateMapImplementation(requirements) {
    const prompt = `Generate a complete Leaflet map implementation with the following requirements:
- Center: ${requirements.center || "[51.505, -0.09]"}
- Zoom: ${requirements.zoom || "13"}
- Tile layer: ${requirements.tileLayer || "OpenStreetMap"}
- Features: ${requirements.features?.join(", ") || "basic map"}
- Markers: ${requirements.markers ? "Yes, with clustering" : "No"}

Provide production-ready code with proper error handling and comments.`;

    return processLeafletQuery(prompt);
  }

  /**
   * Troubleshoot a Leaflet map issue
   * @param {string} issue - Description of the map issue
   * @param {string} errorMessage - Error message if available
   * @returns {Promise<string>} Troubleshooting guidance
   */
  async function troubleshootMapIssue(issue, errorMessage = "") {
    const prompt = `I'm having an issue with my Leaflet map: ${issue}${
      errorMessage ? `\n\nError message: ${errorMessage}` : ""
    }

Please help me debug and fix this issue.`;

    return processLeafletQuery(prompt);
  }

  /**
   * Get optimization suggestions for a Leaflet map
   * @param {Object} mapConfig - Current map configuration
   * @returns {Promise<string>} Optimization recommendations
   */
  async function optimizeMapPerformance(mapConfig) {
    const prompt = `I have a Leaflet map with the following configuration:
${JSON.stringify(mapConfig, null, 2)}

Please provide optimization suggestions to improve performance, especially for:
- Large datasets
- Mobile devices
- Multiple layers
- Real-time updates`;

    return processLeafletQuery(prompt);
  }

  return {
    processLeafletQuery,
    generateMapImplementation,
    troubleshootMapIssue,
    optimizeMapPerformance,
    getHistory,
    clearHistory,
  };
}

/**
 * Main execution function demonstrating the leaflet feature
 */
async function main() {
  console.log("🗺️ Leaflet Feature - Map Assistance System\n");
  console.log("=".repeat(50));

  const leaflet = createLeafletFeature();

  try {
    // Example 1: Generate a basic map implementation
    console.log("\n📍 Generating Leaflet map implementation...\n");
    const mapCode = await leaflet.generateMapImplementation({
      center: "[40.7128, -74.006]",
      zoom: "12",
      tileLayer: "OpenStreetMap",
      features: ["markers", "popup", "zoom controls"],
      markers: true,
    });
    console.log("Generated Map Code:\n");
    console.log(mapCode);

    // Example 2: Ask for troubleshooting help
    console.log("\n" + "=".repeat(50));
    console.log("\n🔧 Troubleshooting map issue...\n");
    const troubleshootingHelp = await leaflet.troubleshootMapIssue(
      "My markers are not showing up on the map",
      "TypeError: Cannot read property 'addLayer' of undefined"
    );
    console.log("Troubleshooting Response:\n");
    console.log(troubleshootingHelp);

    // Example 3: Get performance optimization tips
    console.log("\n" + "=".repeat(50));
    console.log("\n⚡ Getting performance optimization suggestions...\n");
    const optimizationTips = await leaflet.optimizeMapPerformance({
      markerCount: 5000,
      layers: 3,
      updateFrequency: "real-time",
      targetDevices: ["mobile", "desktop"],
    });
    console.log("Optimization Suggestions:\n");
    console.log(optimizationTips);

    // Example 4: Follow-up question in conversation
    console.log("\n" + "=".repeat(50));
    console.log("\n💬 Follow-up question in conversation...\n");
    const followUp = await leaflet.processLeafletQuery(
      "How can I add custom icons to the markers?"
    );
    console.log("Follow-up Response:\n");
    console.log(followUp);

    // Show conversation history
    console.log("\n" + "=".repeat(50));
    console.log("\n📋 Conversation History Summary:");
    const history = leaflet.getHistory();
    console.log(`Total messages exchanged: ${history.length}`);
    console.log(
      "Messages:",
      history.map((msg) => `${msg.role}: ${msg.content.substring(0, 50)}...`)
    );
  } catch (error) {
    console.error("Error:", error.message);
    throw error;
  }
}

main();

export { createLeafletFeature };