const Anthropic = require("@anthropic-ai/sdk");

/**
 * Frog Whack-a-Mole Game
 * A whack-a-mole style game featuring the wide-eyed surprised frog meme.
 * Frogs pop up randomly in a grid of holes, player clicks/taps them to score points.
 */

const client = new Anthropic();

/**
 * Game configuration and state management
 */
const gameState = {
  score: 0,
  timeRemaining: 0,
  gameActive: false,
  difficulty: "normal",
  activeFrogs: new Set(),
  gridSize: 9,
  gameStartTime: null,
  gameEndTime: null,
};

/**
 * Difficulty settings
 */
const difficultySettings = {
  easy: {
    duration: 60,
    spawnRate: 1000,
    frogVisibleTime: 2000,
  },
  normal: {
    duration: 45,
    spawnRate: 700,
    frogVisibleTime: 1500,
  },
  hard: {
    duration: 30,
    spawnRate: 400,
    frogVisibleTime: 1000,
  },
  insane: {
    duration: 20,
    spawnRate: 200,
    frogVisibleTime: 600,
  },
};

/**
 * Initialize the game with specified difficulty
 * @param {string} difficulty - Game difficulty level (easy, normal, hard, insane)
 * @returns {Promise<void>}
 */
async function initializeGame(difficulty = "normal") {
  gameState.difficulty = difficulty;
  gameState.score = 0;
  gameState.gameActive = true;
  gameState.activeFrogs.clear();
  gameState.gameStartTime = Date.now();

  const settings = difficultySettings[difficulty];
  gameState.timeRemaining = settings.duration;

  console.log(`🐸 Frog Whack-a-Mole Game Started!`);
  console.log(`Difficulty: ${difficulty}`);
  console.log(`Duration: ${settings.duration} seconds`);
  console.log(`Grid Size: ${gameState.gridSize} holes`);
  console.log("---");

  // Use Claude to generate fun game commentary
  const message = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Generate a fun, short (2-3 sentences) game start message for a whack-a-mole game with frogs at ${difficulty} difficulty. Be playful and encouraging!`,
      },
    ],
  });

  const commentary = message.content[0].text;
  console.log(`Game Commentary: ${commentary}`);
  console.log("---");
}

/**
 * Spawn a frog at a random hole
 * @returns {number} The hole index where the frog spawned
 */
function spawnFrog() {
  const holeIndex = Math.floor(Math.random() * gameState.gridSize);

  if (!gameState.activeFrogs.has(holeIndex)) {
    gameState.activeFrogs.add(holeIndex);

    const settings = difficultySettings[gameState.difficulty];

    // Auto-remove frog after visible time
    setTimeout(() => {
      if (gameState.activeFrogs.has(holeIndex)) {
        gameState.activeFrogs.delete(holeIndex);
        console.log(`🕳️  Frog escaped from hole ${holeIndex + 1}!`);
      }
    }, settings.frogVisibleTime);

    console.log(`🐸 Frog appeared in hole ${holeIndex + 1}!`);
    return holeIndex;
  }

  return -1; // Hole already occupied
}

/**
 * Handle frog being whacked
 * @param {number} holeIndex - The index of the hole being whacked
 * @returns {boolean} True if a frog was successfully whacked
 */
function whackFrog(holeIndex) {
  if (!gameState.gameActive) {
    console.log("Game is not active!");
    return false;
  }

  if (holeIndex < 0 || holeIndex >= gameState.gridSize) {
    console.log(`Invalid hole index: ${holeIndex}`);
    return false;
  }

  if (gameState.activeFrogs.has(holeIndex)) {
    gameState.activeFrogs.delete(holeIndex);
    gameState.score += 10;
    console.log(`✨ HIT! Score: ${gameState.score}`);
    return true;
  }

  console.log(`❌ Miss! No frog in hole ${holeIndex + 1}`);
  return false;
}

/**
 * Update game timer and check if game should end
 * @returns {boolean} True if game is still active
 */
function updateTimer() {
  if (!gameState.gameActive) {
    return false;
  }

  const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
  const settings = difficultySettings[gameState.difficulty];
  gameState.timeRemaining = Math.max(0, settings.duration - elapsed);

  if (gameState.timeRemaining <= 0) {
    endGame();
    return false;
  }

  return true;
}

/**
 * End the game and display results
 * @returns {Promise<void>}
 */
async function endGame() {
  gameState.gameActive = false;
  gameState.gameEndTime = Date.now();
  gameState.activeFrogs.clear();

  const finalScore = gameState.score;
  const difficulty = gameState.difficulty;

  console.log("---");
  console.log(`⏰ Time's up!`);
  console.log(`🎯 Final Score: ${finalScore}`);
  console.log(`Difficulty: ${difficulty}`);

  // Use Claude to generate game end commentary
  const message = await client.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Generate a fun, short (2-3 sentences) game end message for a whack-a-mole game with frogs. The player scored ${finalScore} points on ${difficulty} difficulty. Be encouraging and maybe make a frog-related pun!`,
      },
    ],
  });

  const endCommentary = message.content[0].text;
  console.log(`Game Commentary: ${endCommentary}`);
  console.log("---");
}

/**
 * Get current game status
 * @returns {Object} Current game state
 */
function getGameStatus() {
  return {
    score: gameState.score,
    timeRemaining: gameState.timeRemaining,
    gameActive: gameState.gameActive,
    difficulty: gameState.difficulty,
    activeFrogs: Array.from(gameState.activeFrogs),
    gridSize: gameState.gridSize,
  };
}

/**
 * Simulate a game round
 * @param {string} difficulty - Game difficulty level
 * @returns {Promise<void>}
 */
async function simulateGameRound(difficulty = "normal") {
  await initializeGame(difficulty);

  const settings = difficultySettings[difficulty];
  let spawnInterval;
  let updateInterval;

  return new Promise((resolve) => {
    // Spawn frogs at regular intervals
    spawnInterval = setInterval(() => {
      if (gameState.gameActive) {
        spawnFrog();
      }
    }, settings.spawnRate);

    // Update timer
    updateInterval = setInterval(() => {
      if (!updateTimer()) {
        clearInterval(spawnInterval);
        clearInterval(updateInterval);
        resolve();
      }
    }, 1000);

    // Simulate random whacks
    const whackInterval = setInterval(() => {
      if (gameState.gameActive && gameState.activeFrogs.size > 0) {
        const frogsArray = Array.from(gameState.activeFrogs);
        const randomFrog =
          frogsArray[Math.floor(Math.random() * frogsArray.length)];
        whackFrog(randomFrog);
      }
    }, 300);

    // Clean up whack interval when game ends
    setTimeout(() => {
      clearInterval(whackInterval);
    }, settings.duration * 1000 + 1000);
  });
}

/**
 * Main function to demonstrate the game
 */
async function main() {
  console.log("🐸 Welcome to Frog Whack-a-Mole! 🐸");
  console.log("=====================================");
  console.log();

  // Test easy difficulty
  console.log("Testing EASY difficulty...");
  console.log();
  await simulateGameRound("easy");
  console.log();

  // Small delay between rounds
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test hard difficulty
  console.log("Testing HARD difficulty...");
  console.log();
  await simulateGameRound("hard");
  console.log();

  console.log("=====================================");
  console.log("🎮 Game demonstration complete!");
}

// Run the main function
main().catch(console.error);

// Export for module usage
module.exports = {
  initializeGame,
  spawnFrog,
  whackFrog,
  updateTimer,
  endGame,
  getGameStatus,
  simulateGameRound,
  difficultySettings,
  gameState,
};