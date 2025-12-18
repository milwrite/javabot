// Amtrak Journey Mini-Games
// Games for each major stop along the Zach & Cen journey

class AmtrakGames {
  constructor() {
    this.currentGame = null;
  }

  // PENN STATION - Subway Dash
  // Navigate through Penn Station avoiding crowds
  initPennStationGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Penn Station Dash</h3>
          <p>Navigate through the crowd to reach your platform!</p>
        </div>
        <canvas id="penn-canvas" width="400" height="300"></canvas>
        <div class="mobile-controls" id="penn-controls">
          <button class="control-btn" data-direction="up">↑</button>
          <div>
            <button class="control-btn" data-direction="left">←</button>
            <button class="control-btn" data-direction="down">↓</button>
            <button class="control-btn" data-direction="right">→</button>
          </div>
        </div>
        <div class="game-stats">
          <div class="stat-box">
            <span class="stat-label">Score</span>
            <span class="stat-number" id="penn-score">0</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Time</span>
            <span class="stat-number" id="penn-time">30</span>
          </div>
        </div>
        <button class="btn btn-primary" id="penn-restart">Restart Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    const canvas = document.getElementById('penn-canvas');
    const ctx = canvas.getContext('2d');
    
    let player = { x: canvas.width / 2, y: canvas.height - 40, width: 20, height: 20, speed: 5 };
    let score = 0;
    let timeLeft = 30;
    let gameActive = true;
    let crowds = [];
    let collectibles = [];

    // Initialize crowds (obstacles)
    for (let i = 0; i < 5; i++) {
      crowds.push({
        x: Math.random() * canvas.width,
        y: Math.random() * (canvas.height - 100),
        width: 40,
        height: 40,
        speedX: (Math.random() - 0.5) * 2,
        speedY: (Math.random() - 0.5) * 2
      });
    }

    // Initialize collectibles (coins/tickets)
    for (let i = 0; i < 8; i++) {
      collectibles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * (canvas.height - 100),
        radius: 5,
        collected: false
      });
    }

    const keys = {};

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      keys[e.key.toLowerCase()] = true;
    });
    document.addEventListener('keyup', (e) => {
      keys[e.key.toLowerCase()] = false;
    });

    // Mobile controls
    const controlButtons = document.querySelectorAll('#penn-controls .control-btn');
    controlButtons.forEach(btn => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const dir = btn.dataset.direction;
        if (dir === 'up') keys['arrowup'] = true;
        if (dir === 'left') keys['arrowleft'] = true;
        if (dir === 'down') keys['arrowdown'] = true;
        if (dir === 'right') keys['arrowright'] = true;
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        const dir = btn.dataset.direction;
        if (dir === 'up') keys['arrowup'] = false;
        if (dir === 'left') keys['arrowleft'] = false;
        if (dir === 'down') keys['arrowdown'] = false;
        if (dir === 'right') keys['arrowright'] = false;
      });
    });

    function updatePlayer() {
      if (keys['arrowup'] || keys['w']) player.y = Math.max(0, player.y - player.speed);
      if (keys['arrowdown'] || keys['s']) player.y = Math.min(canvas.height - player.height, player.y + player.speed);
      if (keys['arrowleft'] || keys['a']) player.x = Math.max(0, player.x - player.speed);
      if (keys['arrowright'] || keys['d']) player.x = Math.min(canvas.width - player.width, player.x + player.speed);
    }

    function updateCrowds() {
      crowds.forEach(crowd => {
        crowd.x += crowd.speedX;
        crowd.y += crowd.speedY;
        
        if (crowd.x < 0 || crowd.x + crowd.width > canvas.width) crowd.speedX *= -1;
        if (crowd.y < 0 || crowd.y + crowd.height > canvas.height - 50) crowd.speedY *= -1;
      });
    }

    function checkCollisions() {
      // Check collision with crowds
      crowds.forEach(crowd => {
        if (player.x < crowd.x + crowd.width &&
            player.x + player.width > crowd.x &&
            player.y < crowd.y + crowd.height &&
            player.y + player.height > crowd.y) {
          gameActive = false;
        }
      });

      // Check collectibles
      collectibles.forEach(item => {
        const dist = Math.hypot(player.x - item.x, player.y - item.y);
        if (dist < player.width + item.radius && !item.collected) {
          item.collected = true;
          score += 10;
        }
      });
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw grid background
      ctx.strokeStyle = '#7ec8e322';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < canvas.width; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
      }
      for (let i = 0; i < canvas.height; i += 20) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
      }

      // Draw goal zone
      ctx.fillStyle = '#7ec8e344';
      ctx.fillRect(0, 0, canvas.width, 30);
      ctx.fillStyle = '#7ec8e3';
      ctx.font = '12px Courier Prime';
      ctx.textAlign = 'center';
      ctx.fillText('PLATFORM', canvas.width / 2, 20);

      // Draw player
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(player.x, player.y, player.width, player.height);

      // Draw crowds
      ctx.fillStyle = '#ff000088';
      crowds.forEach(crowd => {
        ctx.fillRect(crowd.x, crowd.y, crowd.width, crowd.height);
      });

      // Draw collectibles
      ctx.fillStyle = '#00ffff';
      collectibles.forEach(item => {
        if (!item.collected) {
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    function gameLoop() {
      if (!gameActive) {
        ctx.fillStyle = '#ff0000aa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7ec8e3';
        ctx.font = 'bold 24px Courier Prime';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
        ctx.font = '16px Courier Prime';
        ctx.fillText('Final Score: ' + score, canvas.width / 2, canvas.height / 2 + 30);
        return;
      }

      updatePlayer();
      updateCrowds();
      checkCollisions();
      draw();

      document.getElementById('penn-score').textContent = score;
      document.getElementById('penn-time').textContent = timeLeft;

      requestAnimationFrame(gameLoop);
    }

    // Timer
    const timer = setInterval(() => {
      if (gameActive) {
        timeLeft--;
        if (timeLeft <= 0) {
          gameActive = false;
          clearInterval(timer);
        }
      }
    }, 1000);

    document.getElementById('penn-restart').addEventListener('click', () => {
      clearInterval(timer);
      this.initPennStationGame(containerId);
    });

    gameLoop();
  }

  // HUDSON VALLEY - Train Window Spotting
  // Click/tap on scenic objects as they pass by
  initHudsonValleyGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Hudson Valley Spotter</h3>
          <p>Click the scenic sights as they pass by your window!</p>
        </div>
        <div id="hudson-game" class="hudson-game-area"></div>
        <div class="game-stats">
          <div class="stat-box">
            <span class="stat-label">Spotted</span>
            <span class="stat-number" id="hudson-score">0</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Time</span>
            <span class="stat-number" id="hudson-time">45</span>
          </div>
        </div>
        <button class="btn btn-primary" id="hudson-restart">Restart Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    const gameArea = document.getElementById('hudson-game');
    gameArea.style.width = '100%';
    gameArea.style.height = '300px';
    gameArea.style.background = 'linear-gradient(to bottom, #87CEEB 0%, #E0F6FF 100%)';
    gameArea.style.position = 'relative';
    gameArea.style.overflow = 'hidden';
    gameArea.style.border = '3px solid #7ec8e3';
    gameArea.style.cursor = 'crosshair';

    let score = 0;
    let timeLeft = 45;
    let gameActive = true;

    const sights = [
      { emoji: '🏔️', label: 'Mountain' },
      { emoji: '🌲', label: 'Pine Tree' },
      { emoji: '🏠', label: 'Riverside Home' },
      { emoji: '⛵', label: 'Sailboat' },
      { emoji: '🦅', label: 'Bald Eagle' },
      { emoji: '🌉', label: 'Bridge' },
      { emoji: '🏰', label: 'Historic Estate' },
      { emoji: '🚤', label: 'Speedboat' }
    ];

    function createSight() {
      if (!gameActive) return;

      const sight = sights[Math.floor(Math.random() * sights.length)];
      const element = document.createElement('div');
      element.textContent = sight.emoji;
      element.style.position = 'absolute';
      element.style.fontSize = '48px';
      element.style.cursor = 'pointer';
      element.style.left = '-60px';
      element.style.top = Math.random() * (gameArea.clientHeight - 60) + 'px';
      element.style.userSelect = 'none';
      element.style.transition = 'none';

      let clicked = false;
      element.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!clicked) {
          clicked = true;
          score++;
          document.getElementById('hudson-score').textContent = score;
          element.style.opacity = '0.3';
          setTimeout(() => element.remove(), 200);
        }
      });

      element.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!clicked) {
          clicked = true;
          score++;
          document.getElementById('hudson-score').textContent = score;
          element.style.opacity = '0.3';
          setTimeout(() => element.remove(), 200);
        }
      });

      gameArea.appendChild(element);

      let pos = -60;
      const speed = 2 + Math.random() * 3;

      const moveInterval = setInterval(() => {
        if (!gameActive) {
          clearInterval(moveInterval);
          element.remove();
          return;
        }

        pos += speed;
        element.style.left = pos + 'px';

        if (pos > gameArea.clientWidth) {
          clearInterval(moveInterval);
          element.remove();
        }
      }, 30);
    }

    // Spawn sights regularly
    const spawnInterval = setInterval(() => {
      if (gameActive) createSight();
    }, 800);

    // Timer
    const timer = setInterval(() => {
      if (gameActive) {
        timeLeft--;
        document.getElementById('hudson-time').textContent = timeLeft;
        if (timeLeft <= 0) {
          gameActive = false;
          clearInterval(timer);
          clearInterval(spawnInterval);
        }
      }
    }, 1000);

    document.getElementById('hudson-restart').addEventListener('click', () => {
      clearInterval(timer);
      clearInterval(spawnInterval);
      gameArea.innerHTML = '';
      this.initHudsonValleyGame(containerId);
    });
  }

  // ALBANY - Capitol Quiz
  // Quick trivia about Albany's history
  initAlbanyGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const questions = [
      {
        question: "What year did Albany become the state capital?",
        options: ["1797", "1807", "1817", "1827"],
        correct: 1,
        fact: "Albany was officially named the capital in 1797!"
      },
      {
        question: "The Hudson River was named after which explorer?",
        options: ["Henry Hudson", "Robert Hudson", "James Hudson", "William Hudson"],
        correct: 0,
        fact: "Henry Hudson explored the river in 1609!"
      },
      {
        question: "What is Albany's nickname?",
        options: ["The Gateway", "The Cradle of American Democracy", "The Pearl", "The Empire"],
        correct: 1,
        fact: "Albany is called the Cradle of American Democracy!"
      },
      {
        question: "The New York State Capitol was completed in what year?",
        options: ["1879", "1889", "1899", "1909"],
        correct: 1,
        fact: "The stunning Capitol building took 32 years to complete!"
      }
    ];

    let currentQuestion = 0;
    let score = 0;
    let gameActive = true;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Albany History Quiz</h3>
          <p>Test your knowledge of the Capital City!</p>
        </div>
        <div id="albany-content">
          <div class="quiz-question">
            <h4 id="albany-question"></h4>
            <div id="albany-options" class="quiz-options"></div>
            <div id="albany-feedback" class="quiz-feedback"></div>
          </div>
        </div>
        <div class="game-stats">
          <div class="stat-box">
            <span class="stat-label">Score</span>
            <span class="stat-number" id="albany-score">0</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Question</span>
            <span class="stat-number" id="albany-question-num">1</span>
          </div>
        </div>
        <button class="btn btn-primary" id="albany-restart">Restart Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    function showQuestion() {
      if (currentQuestion >= questions.length) {
        showGameOver();
        return;
      }

      const q = questions[currentQuestion];
      document.getElementById('albany-question').textContent = q.question;
      document.getElementById('albany-feedback').innerHTML = '';

      const optionsDiv = document.getElementById('albany-options');
      optionsDiv.innerHTML = '';

      q.options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary quiz-option-btn';
        btn.textContent = option;
        btn.addEventListener('click', () => selectAnswer(index, q));
        optionsDiv.appendChild(btn);
      });

      document.getElementById('albany-question-num').textContent = currentQuestion + 1;
    }

    function selectAnswer(index, question) {
      const feedback = document.getElementById('albany-feedback');
      const buttons = document.querySelectorAll('.quiz-option-btn');

      buttons.forEach(btn => btn.disabled = true);

      if (index === question.correct) {
        score++;
        feedback.innerHTML = `<div style="color: #7ec8e3; font-weight: bold;">✓ Correct!</div><p>${question.fact}</p>`;
        document.getElementById('albany-score').textContent = score;
      } else {
        feedback.innerHTML = `<div style="color: #ff0000; font-weight: bold;">✗ Incorrect</div><p>${question.fact}</p>`;
      }

      setTimeout(() => {
        currentQuestion++;
        showQuestion();
      }, 2500);
    }

    function showGameOver() {
      gameActive = false;
      document.getElementById('albany-content').innerHTML = `
        <div class="game-over-modal">
          <h3>Quiz Complete!</h3>
          <p>Final Score: <span style="color: #7ec8e3; font-weight: bold;">${score}/${questions.length}</span></p>
          <p>${score === questions.length ? '🎉 Perfect Score!' : score >= 3 ? '🌟 Great Job!' : '📚 Keep Learning!'}</p>
        </div>
      `;
    }

    document.getElementById('albany-restart').addEventListener('click', () => {
      currentQuestion = 0;
      score = 0;
      gameActive = true;
      this.initAlbanyGame(containerId);
    });

    showQuestion();
  }

  // BINGHAMTON - Bridge Crossing
  // Timed platformer to cross the Susquehanna River
  initBinghamtonGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Susquehanna Crossing</h3>
          <p>Jump across the bridge platforms!</p>
        </div>
        <canvas id="binghamton-canvas" width="400" height="300"></canvas>
        <div class="mobile-controls" id="binghamton-controls">
          <button class="control-btn" data-action="jump">JUMP</button>
          <div>
            <button class="control-btn" data-direction="left">←</button>
            <button class="control-btn" data-direction="right">→</button>
          </div>
        </div>
        <div class="game-stats">
          <div class="stat-box">
            <span class="stat-label">Distance</span>
            <span class="stat-number" id="binghamton-distance">0</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Lives</span>
            <span class="stat-number" id="binghamton-lives">3</span>
          </div>
        </div>
        <button class="btn btn-primary" id="binghamton-restart">Restart Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    const canvas = document.getElementById('binghamton-canvas');
    const ctx = canvas.getContext('2d');

    let player = { x: canvas.width / 2 - 10, y: canvas.height - 60, width: 20, height: 20, velocityY: 0, jumping: false };
    let platforms = [];
    let distance = 0;
    let lives = 3;
    let gameActive = true;
    let gravity = 0.5;

    // Generate platforms
    function generatePlatforms() {
      platforms = [];
      for (let i = 0; i < 8; i++) {
        platforms.push({
          x: Math.random() * (canvas.width - 60),
          y: canvas.height - 60 - i * 60,
          width: 60,
          height: 12,
          moving: Math.random() > 0.5
        });
      }
    }

    generatePlatforms();

    const keys = {};

    document.addEventListener('keydown', (e) => {
      if (e.key === ' ') { e.preventDefault(); keys['space'] = true; }
      keys[e.key.toLowerCase()] = true;
    });
    document.addEventListener('keyup', (e) => {
      keys[e.key.toLowerCase()] = false;
    });

    const controlButtons = document.querySelectorAll('#binghamton-controls .control-btn');
    controlButtons.forEach(btn => {
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const dir = btn.dataset.direction;
        const action = btn.dataset.action;
        if (dir === 'left') keys['arrowleft'] = true;
        if (dir === 'right') keys['arrowright'] = true;
        if (action === 'jump') keys['space'] = true;
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        const dir = btn.dataset.direction;
        const action = btn.dataset.action;
        if (dir === 'left') keys['arrowleft'] = false;
        if (dir === 'right') keys['arrowright'] = false;
        if (action === 'jump') keys['space'] = false;
      });
    });

    function update() {
      // Horizontal movement
      if (keys['arrowleft'] || keys['a']) player.x = Math.max(0, player.x - 5);
      if (keys['arrowright'] || keys['d']) player.x = Math.min(canvas.width - player.width, player.x + 5);

      // Gravity and jumping
      player.velocityY += gravity;
      player.y += player.velocityY;

      // Jump
      if ((keys['space'] || keys['w']) && !player.jumping) {
        player.velocityY = -12;
        player.jumping = true;
      }

      // Platform collision
      let onPlatform = false;
      platforms.forEach(platform => {
        if (player.velocityY > 0 &&
            player.y + player.height <= platform.y + 5 &&
            player.y + player.height + player.velocityY >= platform.y &&
            player.x + player.width > platform.x &&
            player.x < platform.x + platform.width) {
          player.velocityY = 0;
          player.y = platform.y - player.height;
          player.jumping = false;
          onPlatform = true;
          distance = Math.max(distance, Math.floor((canvas.height - platform.y) / 60));
        }

        // Move platforms
        if (platform.moving) {
          platform.x += Math.sin(Date.now() / 500 + platform.y) * 1.5;
          platform.x = Math.max(0, Math.min(canvas.width - platform.width, platform.x));
        }
      });

      // Fall detection
      if (player.y > canvas.height) {
        lives--;
        if (lives <= 0) {
          gameActive = false;
        } else {
          player.y = canvas.height - 60;
          player.velocityY = 0;
        }
      }

      document.getElementById('binghamton-distance').textContent = distance;
      document.getElementById('binghamton-lives').textContent = lives;
    }

    function draw() {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Water background
      ctx.fillStyle = '#0044ff44';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Platforms
      ctx.fillStyle = '#7ec8e3';
      platforms.forEach(platform => {
        ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
      });

      // Player
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(player.x, player.y, player.width, player.height);

      // UI
      ctx.fillStyle = '#00ffff';
      ctx.font = '12px Courier Prime';
      ctx.fillText('SUSQUEHANNA RIVER', 10, 20);
    }

    function gameLoop() {
      if (!gameActive) {
        ctx.fillStyle = '#ff0000aa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#7ec8e3';
        ctx.font = 'bold 24px Courier Prime';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2);
        ctx.font = '16px Courier Prime';
        ctx.fillText('Distance: ' + distance, canvas.width / 2, canvas.height / 2 + 30);
        return;
      }

      update();
      draw();
      requestAnimationFrame(gameLoop);
    }

    document.getElementById('binghamton-restart').addEventListener('click', () => {
      distance = 0;
      lives = 3;
      gameActive = true;
      player = { x: canvas.width / 2 - 10, y: canvas.height - 60, width: 20, height: 20, velocityY: 0, jumping: false };
      generatePlatforms();
      gameLoop();
    });

    gameLoop();
  }

  // SYRACUSE - Salt Mining Clicker
  // Click to collect salt from the famous salt mines
  initSyracuseGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Salt Mine Collector</h3>
          <p>Click the salt crystals to collect them! Buy upgrades to go faster.</p>
        </div>
        <div class="game-content">
          <div class="salt-display">
            <div class="salt-counter">
              <span id="syracuse-salt">0</span>
              <span class="salt-label">SALT</span>
            </div>
            <button id="syracuse-click-btn" class="salt-click-btn">⛏️ MINE</button>
          </div>
          <div class="upgrades-section">
            <h4>Upgrades</h4>
            <div id="syracuse-upgrades" class="upgrades-grid"></div>
          </div>
        </div>
        <button class="btn btn-primary" id="syracuse-restart">Reset Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    let salt = 0;
    let clickPower = 1;
    let autoMineRate = 0;

    const upgrades = [
      { name: 'Better Pickaxe', cost: 10, effect: () => clickPower += 1, bought: false },
      { name: 'Auto Miner', cost: 50, effect: () => autoMineRate += 0.5, bought: false },
      { name: 'Industrial Drill', cost: 200, effect: () => clickPower *= 2, bought: false },
      { name: 'Crystal Detector', cost: 500, effect: () => autoMineRate *= 2, bought: false }
    ];

    const clickBtn = document.getElementById('syracuse-click-btn');
    clickBtn.addEventListener('click', () => {
      salt += clickPower;
      document.getElementById('syracuse-salt').textContent = Math.floor(salt);
      clickBtn.style.transform = 'scale(0.95)';
      setTimeout(() => clickBtn.style.transform = 'scale(1)', 100);
    });

    function renderUpgrades() {
      const upgradesDiv = document.getElementById('syracuse-upgrades');
      upgradesDiv.innerHTML = '';

      upgrades.forEach((upgrade, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn upgrade-btn';
        btn.disabled = salt < upgrade.cost || upgrade.bought;
        btn.innerHTML = `
          <div class="upgrade-name">${upgrade.name}</div>
          <div class="upgrade-cost">${upgrade.cost} salt</div>
        `;
        btn.addEventListener('click', () => {
          if (salt >= upgrade.cost && !upgrade.bought) {
            salt -= upgrade.cost;
            upgrade.bought = true;
            upgrade.effect();
            document.getElementById('syracuse-salt').textContent = Math.floor(salt);
            renderUpgrades();
          }
        });
        upgradesDiv.appendChild(btn);
      });
    }

    // Auto mining
    setInterval(() => {
      if (autoMineRate > 0) {
        salt += autoMineRate;
        document.getElementById('syracuse-salt').textContent = Math.floor(salt);
      }
    }, 1000);

    document.getElementById('syracuse-restart').addEventListener('click', () => {
      salt = 0;
      clickPower = 1;
      autoMineRate = 0;
      upgrades.forEach(u => u.bought = false);
      document.getElementById('syracuse-salt').textContent = '0';
      renderUpgrades();
    });

    renderUpgrades();
  }

  // ROCHESTER - Final Station Quiz
  // Trivia about Rochester to celebrate arrival
  initRochesterGame(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const questions = [
      {
        question: "Rochester was once known as the 'Flour Milling Capital' of what?",
        options: ["America", "The World", "New York", "The Northeast"],
        correct: 0,
        fact: "Rochester was called the 'Flour Milling Capital of America' in the 1800s!"
      },
      {
        question: "What famous company was founded in Rochester in 1880?",
        options: ["Kodak", "Xerox", "IBM", "Bausch & Lomb"],
        correct: 0,
        fact: "Kodak was founded by George Eastman in Rochester!"
      },
      {
        question: "The Genesee River flows through Rochester to what Great Lake?",
        options: ["Lake Michigan", "Lake Ontario", "Lake Erie", "Lake Huron"],
        correct: 1,
        fact: "The Genesee River flows into Lake Ontario!"
      },
      {
        question: "What is Rochester's nickname?",
        options: ["The Flower City", "The Image City", "The Flour City", "The Garden City"],
        correct: 1,
        fact: "Rochester is called the 'Image City' - home of photography!"
      },
      {
        question: "What famous suffragist was born in Rochester?",
        options: ["Susan B. Anthony", "Elizabeth Cady Stanton", "Lucretia Mott", "Lucy Stone"],
        correct: 0,
        fact: "Susan B. Anthony, a leader in the women's suffrage movement, was born in Rochester!"
      }
    ];

    let currentQuestion = 0;
    let score = 0;

    const gameHtml = `
      <div class="game-wrapper">
        <div class="game-header">
          <h3>Rochester Welcome Quiz</h3>
          <p>Test your knowledge of your final destination!</p>
        </div>
        <div id="rochester-content">
          <div class="quiz-question">
            <h4 id="rochester-question"></h4>
            <div id="rochester-options" class="quiz-options"></div>
            <div id="rochester-feedback" class="quiz-feedback"></div>
          </div>
        </div>
        <div class="game-stats">
          <div class="stat-box">
            <span class="stat-label">Score</span>
            <span class="stat-number" id="rochester-score">0</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Question</span>
            <span class="stat-number" id="rochester-question-num">1</span>
          </div>
        </div>
        <button class="btn btn-primary" id="rochester-restart">Restart Game</button>
      </div>
    `;

    container.innerHTML = gameHtml;

    function showQuestion() {
      if (currentQuestion >= questions.length) {
        showGameOver();
        return;
      }

      const q = questions[currentQuestion];
      document.getElementById('rochester-question').textContent = q.question;
      document.getElementById('rochester-feedback').innerHTML = '';

      const optionsDiv = document.getElementById('rochester-options');
      optionsDiv.innerHTML = '';

      q.options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary quiz-option-btn';
        btn.textContent = option;
        btn.addEventListener('click', () => selectAnswer(index, q));
        optionsDiv.appendChild(btn);
      });

      document.getElementById('rochester-question-num').textContent = currentQuestion + 1;
    }

    function selectAnswer(index, question) {
      const feedback = document.getElementById('rochester-feedback');
      const buttons = document.querySelectorAll('.quiz-option-btn');

      buttons.forEach(btn => btn.disabled = true);

      if (index === question.correct) {
        score++;
        feedback.innerHTML = `<div style="color: #7ec8e3; font-weight: bold;">✓ Correct!</div><p>${question.fact}</p>`;
        document.getElementById('rochester-score').textContent = score;
      } else {
        feedback.innerHTML = `<div style="color: #ff0000; font-weight: bold;">✗ Incorrect</div><p>${question.fact}</p>`;
      }

      setTimeout(() => {
        currentQuestion++;
        showQuestion();
      }, 2500);
    }

    function showGameOver() {
      document.getElementById('rochester-content').innerHTML = `
        <div class="game-over-modal">
          <h3>🎉 Welcome to Rochester! 🎉</h3>
          <p>Final Score: <span style="color: #7ec8e3; font-weight: bold;">${score}/${questions.length}</span></p>
          <p>${score === questions.length ? '🌟 Expert Guide!' : score >= 4 ? '🎯 Great Navigator!' : '📚 Enjoy Your Stay!'}</p>
          <p style="margin-top: 20px; font-size: 14px;">Thanks for traveling with Zach & Cen!</p>
        </div>
      `;
    }

    document.getElementById('rochester-restart').addEventListener('click', () => {
      currentQuestion = 0;
      score = 0;
      this.initRochesterGame(containerId);
    });

    showQuestion();
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AmtrakGames;
}
