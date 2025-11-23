const Anthropic = require("@anthropic-ai/sdk");

/**
 * Double Dragon Beat-em-up Game Engine
 * A noir terminal aesthetic arcade beat-em-up game with mobile touch controls
 */

const client = new Anthropic();

/**
 * Game state manager
 * @typedef {Object} GameState
 * @property {number} score - Current player score
 * @property {number} health - Player health (0-100)
 * @property {number} combo - Current combo counter
 * @property {number} wave - Current enemy wave
 * @property {Array} enemies - Array of active enemies
 * @property {Object} player - Player object with position and state
 * @property {boolean} isGameOver - Game over flag
 * @property {boolean} isGameStarted - Game started flag
 */

class DoubleDragonGame {
  /**
   * Initialize the Double Dragon Beat-em-up game
   * @param {Object} options - Game configuration options
   */
  constructor(options = {}) {
    this.gameState = {
      score: 0,
      health: 100,
      combo: 0,
      wave: 1,
      enemies: [],
      player: {
        x: 50,
        y: 80,
        width: 5,
        height: 8,
        isJumping: false,
        velocityY: 0,
        direction: 1,
        isAttacking: false,
        attackCooldown: 0,
      },
      isGameOver: false,
      isGameStarted: false,
      gameTime: 0,
      lastSpawnTime: 0,
      difficultyMultiplier: 1,
    };

    this.gameConfig = {
      canvasWidth: 100,
      canvasHeight: 100,
      gravity: 0.6,
      jumpPower: 15,
      playerSpeed: 2,
      enemySpeed: 1,
      attackRange: 8,
      attackDamage: 10,
      spawnRate: 2000,
      comboTimeout: 3000,
      ...options,
    };

    this.inputState = {
      moveLeft: false,
      moveRight: false,
      jump: false,
      punch: false,
    };

    this.lastComboTime = 0;
    this.conversationHistory = [];
  }

  /**
   * Update player position based on input
   */
  updatePlayerMovement() {
    const player = this.gameState.player;

    if (this.inputState.moveLeft && player.x > 0) {
      player.x -= this.gameConfig.playerSpeed;
      player.direction = -1;
    }
    if (this.inputState.moveRight && player.x < this.gameConfig.canvasWidth - player.width) {
      player.x += this.gameConfig.playerSpeed;
      player.direction = 1;
    }

    if (this.inputState.jump && !player.isJumping) {
      player.isJumping = true;
      player.velocityY = -this.gameConfig.jumpPower;
    }

    if (player.isJumping) {
      player.velocityY += this.gameConfig.gravity;
      player.y += player.velocityY;

      if (player.y >= 80) {
        player.y = 80;
        player.isJumping = false;
        player.velocityY = 0;
      }
    }

    if (this.inputState.punch && player.attackCooldown <= 0) {
      player.isAttacking = true;
      player.attackCooldown = 500;
      this.handlePlayerAttack();
    }

    if (player.attackCooldown > 0) {
      player.attackCooldown -= 16;
    }
  }

  /**
   * Handle player punch attack
   */
  handlePlayerAttack() {
    const player = this.gameState.player;
    const attackX = player.x + (player.direction > 0 ? player.width : -this.gameConfig.attackRange);

    for (let enemy of this.gameState.enemies) {
      const distance = Math.abs(enemy.x - attackX);
      if (distance < this.gameConfig.attackRange && Math.abs(enemy.y - player.y) < 10) {
        enemy.health -= this.gameConfig.attackDamage;
        this.gameState.score += 10;
        this.updateCombo();

        if (enemy.health <= 0) {
          this.gameState.enemies = this.gameState.enemies.filter((e) => e !== enemy);
          this.gameState.score += 50;
        }
      }
    }

    setTimeout(() => {
      player.isAttacking = false;
    }, 100);
  }

  /**
   * Update combo counter
   */
  updateCombo() {
    const currentTime = Date.now();
    if (currentTime - this.lastComboTime > this.gameConfig.comboTimeout) {
      this.gameState.combo = 0;
    }
    this.gameState.combo += 1;
    this.lastComboTime = currentTime;

    if (this.gameState.combo > 1) {
      this.gameState.score += this.gameState.combo * 5;
    }
  }

  /**
   * Spawn enemy wave
   */
  spawnEnemyWave() {
    const currentTime = Date.now();
    if (currentTime - this.gameState.lastSpawnTime < this.gameConfig.spawnRate) {
      return;
    }

    const enemyCount = Math.min(2 + this.gameState.wave, 5);
    for (let i = 0; i < enemyCount; i++) {
      const enemy = {
        x: Math.random() > 0.5 ? 5 : this.gameConfig.canvasWidth - 10,
        y: 80,
        width: 4,
        height: 8,
        health: 30 * this.gameState.difficultyMultiplier,
        maxHealth: 30 * this.gameState.difficultyMultiplier,
        speed: this.gameConfig.enemySpeed * this.gameState.difficultyMultiplier,
        attackCooldown: 0,
        type: Math.random() > 0.7 ? "heavy" : "normal",
      };
      this.gameState.enemies.push(enemy);
    }

    this.gameState.lastSpawnTime = currentTime;
  }

  /**
   * Update enemy AI and behavior
   */
  updateEnemies() {
    const player = this.gameState.player;

    for (let enemy of this.gameState.enemies) {
      const distanceToPlayer = player.x - enemy.x;

      if (Math.abs(distanceToPlayer) > 2) {
        enemy.x += Math.sign(distanceToPlayer) * enemy.speed;
      } else {
        if (enemy.attackCooldown <= 0) {
          this.gameState.health -= 5;
          this.gameState.combo = 0;
          enemy.attackCooldown = 1000;
        }
      }

      if (enemy.attackCooldown > 0) {
        enemy.attackCooldown -= 16;
      }
    }

    if (this.gameState.enemies.length === 0 && this.gameState.isGameStarted) {
      this.gameState.wave += 1;
      this.gameState.difficultyMultiplier = 1 + this.gameState.wave * 0.2;
      this.gameState.health = Math.min(100, this.gameState.health + 20);
    }
  }

  /**
   * Update game state
   */
  update() {
    if (!this.gameState.isGameStarted || this.gameState.isGameOver) {
      return;
    }

    this.gameState.gameTime += 16;
    this.updatePlayerMovement();
    this.spawnEnemyWave();
    this.updateEnemies();

    if (this.gameState.health <= 0) {
      this.gameState.isGameOver = true;
    }
  }

  /**
   * Render game state as ASCII art
   * @returns {string} ASCII representation of game state
   */
  render() {
    let output = "\n";
    output += "╔════════════════════════════════════════════════════════════════════════════════════════════════════╗\n";
    output += "║                        ▓▓▓▓▓  DOUBLE DRAGON BEAT-EM-UP  ▓▓▓▓▓                                      ║\n";
    output += "╚════════════════════════════════════════════════════════════════════════════════════════════════════╝\n\n";

    output += "┌────────────────────────────────────────────────────────────────────────────────────────────────────┐\n";

    const canvas = this.createCanvas();
    output += canvas;

    output += "└────────────────────────────────────────────────────────────────────────────────────────────────────┘\n\n";

    output += "╔════════════════════════════════════════════════════════════════════════════════════════════════════╗\n";
    output += `║ SCORE: ${String(this.gameState.score).padEnd(8)} │ HEALTH: ${this.renderHealthBar()} │ COMBO: ${String(this.gameState.combo).padEnd(3)} │ WAVE: ${this.gameState.wave}                                          ║\n`;
    output += "╚════════════════════════════════════════════════════════════════════════════════════════════════════╝\n";

    return output;
  }

  /**
   * Create canvas representation
   * @returns {string} Canvas ASCII art
   */
  createCanvas() {
    let canvas = "";
    const width = this.gameConfig.canvasWidth;
    const height = this.gameConfig.canvasHeight;

    for (let y = 0; y < height; y++) {
      canvas += "│";
      for (let x = 0; x < width; x++) {
        let char = " ";

        const player = this.gameState.player;
        if (
          x >= player.x &&
          x < player.x + player.width &&
          y >= player.y &&
          y < player.y + player.height
        ) {
          char = player.isAttacking ? "✊" : "█";
        }

        for (let enemy of this.gameState.enemies) {
          if (x >= enemy.x && x < enemy.x + enemy.width && y >= enemy.y && y < enemy.y + enemy.height) {
            char = enemy.type === "heavy" ? "▓" : "▒";
          }
        }

        if (y === height - 1) {
          char = "═";
        }

        canvas += char;
      }
      canvas += "│\n";
    }

    return canvas;
  }

  /**
   * Render health bar
   * @returns {string} Health bar representation
   */
  renderHealthBar() {
    const health = Math.max(0, this.gameState.health);
    const barLength = 20;
    const filledLength = Math.round((health / 100) * barLength);
    const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
    return `${bar} ${health.toFixed(0)}%`;
  }

  /**
   * Handle input from user
   * @param {string} input - User input command
   */
  handleInput(input) {
    const cmd = input.toLowerCase().trim();

    switch (cmd) {
      case "left":
        this.inputState.moveLeft = true;
        break;
      case "right":
        this.inputState.moveRight = true;
        break;
      case "jump":
        this.inputState.jump = true;
        break;
      case "punch":
        this.inputState.punch = true;
        break;
      case "start":
        if (!this.gameState.isGameStarted) {
          this.gameState.isGameStarted = true;
        }
        break;
      case "reset":
        this.resetGame();
        break;
    }

    setTimeout(() => {
      this.inputState.moveLeft = false;
      this.inputState.moveRight = false;
      this.inputState.jump = false;
      this.inputState.punch = false;
    }, 100);
  }

  /**
   * Reset game to initial state
   */
  resetGame() {
    this.gameState = {
      score: 0,
      health: 100,
      combo: 0,
      wave: 1,
      enemies: [],
      player: {
        x: 50,
        y: 80,
        width: 5,
        height: 8,
        isJumping: false,
        velocityY: 0,
        direction: 1,
        isAttacking: false,
        attackCooldown: 0,
      },
      isGameOver: false,
      isGameStarted: false,
      gameTime: 0,
      lastSpawnTime: 0,
      difficultyMultiplier: 1,
    };
  }

  /**
   * Get game status summary
   * @returns {string} Game status text
   */
  getGameStatus() {
    if (!this.gameState.isGameStarted) {
      return "GAME NOT STARTED - Type 'start' to begin";
    }
    if (this.gameState.isGameOver) {
      return `GAME OVER - Final Score: ${this.gameState.score} - Type 'reset' to play again`;
    }
    return `WAVE ${this.gameState.wave} - Enemies: ${this.gameState.enemies.length}`;
  }
}

/**
 * Main game loop and CLI interface
 */
async function runGame() {
  const game = new DoubleDragonGame();
  const conversationHistory = [];

  console.clear();
  console.log(game.render());
  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("CONTROLS: left | right | jump | punch | start | reset");
  console.log("CHAT: Type any message to chat with the game AI");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════\n");

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const gameLoop = setInterval(() => {
    game.update();
    console.clear();
    console.log(game.render());
    console.log(`\nSTATUS: ${game.getGameStatus()}`);
    console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════");
  }, 16);

  const askQuestion = () => {
    rl.question("> ", async (input) => {
      if (input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
        clearInterval(gameLoop);
        rl.close();
        return;
      }

      const isGameCommand = [
        "left",
        "right",
        "jump",
        "punch",
        "start",
        "reset",
      ].includes(input.toLowerCase());

      if (isGameCommand) {
        game.handleInput(input);
      } else {
        conversationHistory.push({
          role: "user",
          content: input,
        });

        const systemPrompt = `You are a noir-themed arcade game AI narrator for a Double Dragon Beat-em-up game. 
The player is currently in Wave ${game.gameState.wave} with a score of ${game.gameState.score} and health at ${game.gameState.health}%.
Respond in character as a cynical arcade game narrator with noir dialogue. Keep responses brief (1-2 sentences).
Reference the game state when appropriate. Use gaming and noir terminology.`;

        try {
          const response = await client.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 150,
            system: systemPrompt,
            messages: conversationHistory,
          });

          const assistantMessage = response.content[0].text;
          conversationHistory.push({
            role: "assistant",
            content: assistantMessage,
          });

          console.log(`\n🎮 ARCADE AI: ${assistantMessage}\n`);
        } catch (error) {
          console.log("\n⚠️  Connection error - continue playing\n");
        }
      }

      askQuestion();
    });
  };

  askQuestion();
}

runGame().catch(console.error);