/**
 * Buffalo Bills QB Game - A football throwing game with mobile controls
 * Features angle/power sliders, score tracking, and difficulty levels
 */

const billsQBGame = (() => {
  // Game configuration
  const config = {
    canvasWidth: 800,
    canvasHeight: 600,
    ballRadius: 8,
    receiverRadius: 12,
    billsBlue: '#00338D',
    billsRed: '#C60C30',
    billsWhite: '#FFFFFF',
    ballSpeed: 5,
    gravity: 0.15,
    maxPower: 100,
    minPower: 20,
    difficulty: {
      easy: { receiverSpeed: 1.5, spawnRate: 2000, timeLimit: 60 },
      medium: { receiverSpeed: 2.5, spawnRate: 1500, timeLimit: 45 },
      hard: { receiverSpeed: 3.5, spawnRate: 1000, timeLimit: 30 }
    }
  };

  let gameState = {
    isRunning: false,
    score: 0,
    highScore: localStorage.getItem('billsQBHighScore') || 0,
    timeRemaining: 0,
    currentDifficulty: 'medium',
    angle: 45,
    power: 50,
    balls: [],
    receivers: [],
    catches: 0,
    misses: 0,
    startTime: 0,
    lastSpawnTime: 0
  };

  let canvas = null;
  let ctx = null;
  let gameLoopId = null;

  /**
   * Initialize the game canvas and event listeners
   * @param {string} canvasId - The ID of the canvas element
   * @returns {void}
   */
  const init = (canvasId) => {
    canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.error(`Canvas with ID "${canvasId}" not found`);
      return;
    }

    ctx = canvas.getContext('2d');

    // Set canvas size based on window
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Setup touch and mouse controls
    setupControls();

    // Draw initial UI
    drawUI();
  };

  /**
   * Resize canvas to fit window while maintaining aspect ratio
   * @returns {void}
   */
  const resizeCanvas = () => {
    const maxWidth = Math.min(window.innerWidth - 20, 800);
    const aspectRatio = config.canvasHeight / config.canvasWidth;
    canvas.width = maxWidth;
    canvas.height = maxWidth * aspectRatio;
  };

  /**
   * Setup touch and mouse event listeners
   * @returns {void}
   */
  const setupControls = () => {
    const angleSlider = document.getElementById('angleSlider');
    const powerSlider = document.getElementById('powerSlider');
    const throwButton = document.getElementById('throwButton');
    const difficultySelect = document.getElementById('difficultySelect');
    const startButton = document.getElementById('startButton');

    if (angleSlider) {
      angleSlider.addEventListener('input', (e) => {
        gameState.angle = parseInt(e.target.value);
        updateSliderDisplay();
      });
    }

    if (powerSlider) {
      powerSlider.addEventListener('input', (e) => {
        gameState.power = parseInt(e.target.value);
        updateSliderDisplay();
      });
    }

    if (throwButton) {
      throwButton.addEventListener('click', throwBall);
    }

    if (difficultySelect) {
      difficultySelect.addEventListener('change', (e) => {
        gameState.currentDifficulty = e.target.value;
      });
    }

    if (startButton) {
      startButton.addEventListener('click', startGame);
    }

    // Touch controls for mobile
    canvas.addEventListener('touchstart', handleTouchStart);
    canvas.addEventListener('touchmove', handleTouchMove);
  };

  /**
   * Update slider display values
   * @returns {void}
   */
  const updateSliderDisplay = () => {
    const angleDisplay = document.getElementById('angleDisplay');
    const powerDisplay = document.getElementById('powerDisplay');

    if (angleDisplay) {
      angleDisplay.textContent = `${gameState.angle}°`;
    }
    if (powerDisplay) {
      powerDisplay.textContent = `${gameState.power}%`;
    }
  };

  /**
   * Handle touch start event
   * @param {TouchEvent} e - The touch event
   * @returns {void}
   */
  const handleTouchStart = (e) => {
    if (!gameState.isRunning) return;
    e.preventDefault();
  };

  /**
   * Handle touch move event for angle adjustment
   * @param {TouchEvent} e - The touch event
   * @returns {void}
   */
  const handleTouchMove = (e) => {
    if (!gameState.isRunning) return;
    e.preventDefault();

    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    // Calculate angle from touch position
    const centerX = canvas.width / 2;
    const centerY = canvas.height - 50;
    const dx = x - centerX;
    const dy = y - centerY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    gameState.angle = Math.max(15, Math.min(165, angle + 90));
    updateSliderDisplay();
  };

  /**
   * Start a new game
   * @returns {void}
   */
  const startGame = () => {
    const difficulty = config.difficulty[gameState.currentDifficulty];
    gameState.isRunning = true;
    gameState.score = 0;
    gameState.catches = 0;
    gameState.misses = 0;
    gameState.timeRemaining = difficulty.timeLimit;
    gameState.balls = [];
    gameState.receivers = [];
    gameState.startTime = Date.now();
    gameState.lastSpawnTime = Date.now();

    // Hide start button and show game controls
    const startButton = document.getElementById('startButton');
    const gameControls = document.getElementById('gameControls');
    if (startButton) startButton.style.display = 'none';
    if (gameControls) gameControls.style.display = 'block';

    // Start game loop
    if (gameLoopId) cancelAnimationFrame(gameLoopId);
    gameLoop();
  };

  /**
   * End the current game
   * @returns {void}
   */
  const endGame = () => {
    gameState.isRunning = false;

    // Update high score
    if (gameState.score > gameState.highScore) {
      gameState.highScore = gameState.score;
      localStorage.setItem('billsQBHighScore', gameState.highScore);
    }

    // Show results
    const resultDiv = document.getElementById('gameResult');
    if (resultDiv) {
      resultDiv.innerHTML = `
        <h2>Game Over!</h2>
        <p>Final Score: ${gameState.score}</p>
        <p>Catches: ${gameState.catches} | Misses: ${gameState.misses}</p>
        <p>High Score: ${gameState.highScore}</p>
      `;
      resultDiv.style.display = 'block';
    }

    // Show start button
    const startButton = document.getElementById('startButton');
    const gameControls = document.getElementById('gameControls');
    if (startButton) startButton.style.display = 'block';
    if (gameControls) gameControls.style.display = 'none';
  };

  /**
   * Throw a football with current angle and power
   * @returns {void}
   */
  const throwBall = () => {
    if (!gameState.isRunning || gameState.balls.length > 0) return;

    const angleRad = (gameState.angle * Math.PI) / 180;
    const speed = (gameState.power / 100) * config.ballSpeed;

    const ball = {
      x: canvas.width / 2,
      y: canvas.height - 50,
      vx: Math.cos(angleRad) * speed,
      vy: -Math.sin(angleRad) * speed,
      radius: config.ballRadius,
      active: true
    };

    gameState.balls.push(ball);
  };

  /**
   * Spawn a new receiver at a random position
   * @returns {void}
   */
  const spawnReceiver = () => {
    const difficulty = config.difficulty[gameState.currentDifficulty];
    const now = Date.now();

    if (now - gameState.lastSpawnTime < difficulty.spawnRate) {
      return;
    }

    gameState.lastSpawnTime = now;

    const receiver = {
      x: Math.random() * (canvas.width - 100) + 50,
      y: Math.random() * (canvas.height * 0.6) + 50,
      vx: (Math.random() - 0.5) * difficulty.receiverSpeed * 2,
      vy: (Math.random() - 0.5) * difficulty.receiverSpeed * 2,
      radius: config.receiverRadius,
      caught: false
    };

    gameState.receivers.push(receiver);
  };

  /**
   * Update ball physics and position
   * @param {Object} ball - The ball object to update
   * @returns {void}
   */
  const updateBall = (ball) => {
    ball.vy += config.gravity;
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Remove ball if it goes out of bounds
    if (
      ball.x < 0 ||
      ball.x > canvas.width ||
      ball.y < 0 ||
      ball.y > canvas.height
    ) {
      ball.active = false;
      gameState.misses++;
    }
  };

  /**
   * Update receiver position and boundaries
   * @param {Object} receiver - The receiver object to update
   * @returns {void}
   */
  const updateReceiver = (receiver) => {
    receiver.x += receiver.vx;
    receiver.y += receiver.vy;

    // Bounce off walls
    if (receiver.x - receiver.radius < 0 || receiver.x + receiver.radius > canvas.width) {
      receiver.vx *= -1;
      receiver.x = Math.max(receiver.radius, Math.min(canvas.width - receiver.radius, receiver.x));
    }

    if (receiver.y - receiver.radius < 0 || receiver.y + receiver.radius > canvas.height) {
      receiver.vy *= -1;
      receiver.y = Math.max(receiver.radius, Math.min(canvas.height - receiver.radius, receiver.y));
    }
  };

  /**
   * Check collision between ball and receiver
   * @param {Object} ball - The ball object
   * @param {Object} receiver - The receiver object
   * @returns {boolean} - True if collision detected
   */
  const checkCollision = (ball, receiver) => {
    const dx = ball.x - receiver.x;
    const dy = ball.y - receiver.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < ball.radius + receiver.radius;
  };

  /**
   * Main game loop
   * @returns {void}
   */
  const gameLoop = () => {
    // Update time
    const elapsed = (Date.now() - gameState.startTime) / 1000;
    const difficulty = config.difficulty[gameState.currentDifficulty];
    gameState.timeRemaining = Math.max(0, difficulty.timeLimit - elapsed);

    if (gameState.timeRemaining <= 0) {
      endGame();
      return;
    }

    // Spawn receivers
    spawnReceiver();

    // Update balls
    gameState.balls.forEach((ball) => {
      updateBall(ball);
    });

    // Update receivers
    gameState.receivers.forEach((receiver) => {
      updateReceiver(receiver);
    });

    // Check collisions
    gameState.balls.forEach((ball) => {
      gameState.receivers.forEach((receiver) => {
        if (!receiver.caught && checkCollision(ball, receiver)) {
          receiver.caught = true;
          ball.active = false;
          gameState.score += 10;
          gameState.catches++;
        }
      });
    });

    // Remove inactive objects
    gameState.balls = gameState.balls.filter((b) => b.active);
    gameState.receivers = gameState.receivers.filter((r) => !r.caught);

    // Draw everything
    draw();

    // Continue loop
    gameLoopId = requestAnimationFrame(gameLoop);
  };

  /**
   * Draw the game scene
   * @returns {void}
   */
  const draw = () => {
    // Clear canvas
    ctx.fillStyle = '#E8E8E8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw field gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#90EE90');
    gradient.addColorStop(1, '#228B22');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.8);

    // Draw sky
    ctx.fillStyle = '#87CEEB';
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.2);

    // Draw quarterback position
    drawQuarterback();

    // Draw receivers
    gameState.receivers.forEach((receiver) => {
      drawReceiver(receiver);
    });

    // Draw balls
    gameState.balls.forEach((ball) => {
      drawBall(ball);
    });

    // Draw UI
    drawUI();
  };

  /**
   * Draw the quarterback figure
   * @returns {void}
   */
  const drawQuarterback = () => {
    const x = canvas.width / 2;
    const y = canvas.height - 50;

    // Body
    ctx.fillStyle = config.billsBlue;
    ctx.fillRect(x - 8, y - 20, 16, 25);

    // Head
    ctx.fillStyle = '#FFDBAC';
    ctx.beginPath();
    ctx.arc(x, y - 25, 8, 0, Math.PI * 2);
    ctx.fill();

    // Arm pointing in throw direction
    const angleRad = (gameState.angle * Math.PI) / 180;
    const armLength = 15;
    const armX = x + Math.cos(angleRad) * armLength;
    const armY = y - 15 + Math.sin(angleRad) * armLength;

    ctx.strokeStyle = '#FFDBAC';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y - 15);
    ctx.lineTo(armX, armY);
    ctx.stroke();
  };

  /**
   * Draw a receiver
   * @param {Object} receiver - The receiver object to draw
   * @returns {void}
   */
  const drawReceiver = (receiver) => {
    // Body
    ctx.fillStyle = config.billsRed;
    ctx.beginPath();
    ctx.arc(receiver.x, receiver.y, receiver.radius, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = config.billsBlue;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Number
    ctx.fillStyle = config.billsWhite;
    ctx.font = 'bold 8px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R', receiver.x, receiver.y);
  };

  /**
   * Draw a football
   * @param {Object} ball - The ball object to draw
   * @returns {void}
   */
  const drawBall = (ball) => {
    ctx.fillStyle = '#8B4513';
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, ball.radius * 1.5, ball.radius, 0, 0, Math.PI * 2);
    ctx.fill();

    // Laces
    ctx.strokeStyle = config.billsWhite;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ball.x - ball.radius * 0.5, ball.y - ball.radius * 0.3);
    ctx.lineTo(ball.x - ball.radius * 0.5, ball.y + ball.radius * 0.3);
    ctx.stroke();
  };

  /**
   * Draw UI elements
   * @returns {void}
   */
  const drawUI = () => {
    const padding = 10;
    const lineHeight = 20;

    // Score
    ctx.fillStyle = config.billsBlue;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${gameState.score}`, padding, padding + lineHeight);

    // High Score
    ctx.font = '14px Arial';
    ctx.fillText(`High Score: ${gameState.highScore}`, padding, padding + lineHeight * 2);

    // Time
    if (gameState.isRunning) {
      ctx.font = 'bold 16px Arial';
      ctx.fillText(`Time: ${Math.ceil(gameState.timeRemaining)}s`, padding, padding + lineHeight * 3);
    }

    // Stats
    ctx.font = '12px Arial';
    ctx.fillText(`Catches: ${gameState.catches} | Misses: ${gameState.misses}`, padding, canvas.height - padding);

    // Angle and Power indicator
    if (gameState.isRunning) {
      const indicatorX = canvas.width - 120;
      const indicatorY = canvas.height - 40;

      ctx.fillStyle = config.billsBlue;
      ctx.font = '12px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(`Angle: ${gameState.angle}°`, indicatorX + 100, indicatorY);
      ctx.fillText(`Power: ${gameState.power}%`, indicatorX + 100, indicatorY + 20);
    }
  };

  /**
   * Get current game state
   * @returns {Object} - Current game state
   */
  const getGameState = () => {
    return { ...gameState };
  };

  /**
   * Reset game state
   * @returns {void}
   */
  const resetGame = () => {
    gameState = {
      isRunning: false,
      score: 0,
      highScore: gameState.highScore,
      timeRemaining: 0,
      currentDifficulty: 'medium',
      angle: 45,
      power: 50,
      balls: [],
      receivers: [],
      catches: 0,
      misses: 0,
      startTime: 0,
      lastSpawnTime: 0
    };

    if (gameLoopId) {
      cancelAnimationFrame(gameLoopId);
    }

    drawUI();
  };

  // Public API
  return {
    init,
    startGame,
    endGame,
    throwBall,
    resetGame,
    getGameState,
    setDifficulty: (difficulty) => {
      if (config.difficulty[difficulty]) {
        gameState.currentDifficulty = difficulty;
      }
    }
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = billsQBGame;
}

// Create HTML structure if needed
document.addEventListener('DOMContentLoaded', () => {
  const gameContainer = document.getElementById('gameContainer');
  if (gameContainer && !document.getElementById('gameCanvas')) {
    gameContainer.innerHTML = `
      <div style="max-width: 800px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
        <h1 style="color: #00338D; text-align: center;">Buffalo Bills QB Game</h1>
        <canvas id="gameCanvas" style="border: 3px solid #00338D; display: block; margin: 20px auto; background: #87CEEB;"></canvas>
        
        <div id="gameControls" style="display: none; margin: 20px 0; padding: 15px; background: #f0f0f0; border-radius: 8px;">
          <div style="margin-bottom: 15px;">
            <label for="angleSlider" style="color: #00338D; font-weight: bold;">Throw Angle: <span id="angleDisplay">45°</span></label>
            <input type="range" id="angleSlider" min="15" max="165" value="45" style="width: 100%; margin-top: 5px;">
          </div>
          
          <div style="margin-bottom: 15px;">
            <label for="powerSlider" style="color: #C60C30; font-weight: bold;">Throw Power: <span id="powerDisplay">50%</span></label>
            <input type="range" id="powerSlider" min="20" max="100" value="50" style="width: 100%; margin-top: 5px;">
          </div>
          
          <button id="throwButton" style="width: 100%; padding: 10px; background: #C60C30; color: white; border: none; border-radius: 4px; font-weight: bold; font-size: 16px; cursor: pointer;">THROW!</button>
        </div>
        
        <div style="margin: 20px 0; padding: 15px; background: #f0f0f0; border-radius: 8px;">
          <label for="difficultySelect" style="color: #00338D; font-weight: bold;">Difficulty:</label>
          <select id="difficultySelect" style="margin-left: 10px; padding: 5px;">
            <option value="easy">Easy</option>
            <option value="medium" selected>Medium</option>
            <option value="hard">Hard</option>
          </select>
          
          <button id="startButton" style="float: right; padding: 10px 20px; background: #00338D; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Start Game</button>
          <div style="clear: both;"></div>
        </div>
        
        <div id="gameResult" style="display: none; margin: 20px 0; padding: 20px; background: #00338D; color: white; border-radius: 8px; text-align: center;"></div>
      </div>
    `;

    billsQBGame.init('gameCanvas');
  }
});