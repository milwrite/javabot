/**
 * Amtrak Journey Games
 * Mini-games for each major stop along the route
 */

// ============= PENN STATION GAME: Ticket Punch =============
class TicketPunchGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.tickets = [];
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
  }

  setupGame() {
    // Create tickets
    for (let i = 0; i < 5; i++) {
      this.tickets.push({
        x: Math.random() * (this.canvas.width - 60),
        y: Math.random() * (this.canvas.height - 60),
        width: 60,
        height: 40,
        punched: false,
        rotation: Math.random() * 0.3
      });
    }

    // Touch events
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e));

    this.gameLoop();
    this.startTimer();
  }

  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.checkHit(x, y);
  }

  handleTouch(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.touches[0].clientX - rect.left;
    const y = e.touches[0].clientY - rect.top;
    this.checkHit(x, y);
  }

  checkHit(x, y) {
    for (let ticket of this.tickets) {
      if (!ticket.punched && 
          x > ticket.x && x < ticket.x + ticket.width &&
          y > ticket.y && y < ticket.y + ticket.height) {
        ticket.punched = true;
        this.score++;
      }
    }
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Punched ${this.score} tickets!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Punch Tickets: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Draw tickets
    for (let ticket of this.tickets) {
      this.ctx.save();
      this.ctx.translate(ticket.x + ticket.width/2, ticket.y + ticket.height/2);
      this.ctx.rotate(ticket.rotation);

      if (ticket.punched) {
        this.ctx.fillStyle = '#ff0000';
        this.ctx.globalAlpha = 0.5;
      } else {
        this.ctx.fillStyle = '#00ffff';
      }

      this.ctx.fillRect(-ticket.width/2, -ticket.height/2, ticket.width, ticket.height);
      this.ctx.strokeStyle = '#00ff41';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(-ticket.width/2, -ticket.height/2, ticket.width, ticket.height);

      if (ticket.punched) {
        this.ctx.fillStyle = '#ff0000';
        this.ctx.globalAlpha = 1;
        this.ctx.fillText('✓', -8, 5);
      }

      this.ctx.restore();
    }

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// ============= HUDSON VALLEY GAME: Apple Catch =============
class AppleCatchGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    this.basket = { x: 0, y: 0, width: 60, height: 40 };
    this.apples = [];
    this.keys = {};

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
    this.basket.x = this.canvas.width / 2 - 30;
    this.basket.y = this.canvas.height - 60;
  }

  setupGame() {
    // Keyboard controls
    document.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      if (e.key === 'ArrowLeft') this.moveBasket(-15);
      if (e.key === 'ArrowRight') this.moveBasket(15);
    });

    // Touch controls
    const leftBtn = document.getElementById('apple-left');
    const rightBtn = document.getElementById('apple-right');
    if (leftBtn) leftBtn.addEventListener('touchstart', () => this.moveBasket(-15));
    if (rightBtn) rightBtn.addEventListener('touchstart', () => this.moveBasket(15));

    this.spawnApple();
    this.gameLoop();
    this.startTimer();
  }

  moveBasket(delta) {
    this.basket.x += delta;
    this.basket.x = Math.max(0, Math.min(this.basket.x, this.canvas.width - this.basket.width));
  }

  spawnApple() {
    if (this.gameActive) {
      this.apples.push({
        x: Math.random() * (this.canvas.width - 20),
        y: -20,
        width: 20,
        height: 20,
        vx: (Math.random() - 0.5) * 3,
        vy: 3 + Math.random() * 2
      });
      setTimeout(() => this.spawnApple(), 600);
    }
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Caught ${this.score} apples!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Apples: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Update and draw apples
    for (let i = this.apples.length - 1; i >= 0; i--) {
      let apple = this.apples[i];
      apple.y += apple.vy;
      apple.x += apple.vx;

      // Check collision with basket
      if (apple.y + apple.height > this.basket.y &&
          apple.y < this.basket.y + this.basket.height &&
          apple.x + apple.width > this.basket.x &&
          apple.x < this.basket.x + this.basket.width) {
        this.score++;
        this.apples.splice(i, 1);
        continue;
      }

      // Remove if off screen
      if (apple.y > this.canvas.height) {
        this.apples.splice(i, 1);
        continue;
      }

      // Draw apple
      this.ctx.fillStyle = '#ff0000';
      this.ctx.beginPath();
      this.ctx.arc(apple.x + apple.width/2, apple.y + apple.height/2, apple.width/2, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw basket
    this.ctx.fillStyle = '#00ffff';
    this.ctx.fillRect(this.basket.x, this.basket.y, this.basket.width, this.basket.height);
    this.ctx.strokeStyle = '#00ff41';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(this.basket.x, this.basket.y, this.basket.width, this.basket.height);

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// ============= ALBANY GAME: Capitol Climber =============
class CapitolClimberGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    this.player = { x: 0, y: 0, width: 20, height: 20, vy: 0 };
    this.platforms = [];
    this.keys = {};

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
    this.player.x = this.canvas.width / 2 - 10;
    this.player.y = this.canvas.height - 50;
  }

  setupGame() {
    // Create platforms
    for (let i = 0; i < 8; i++) {
      this.platforms.push({
        x: Math.random() * (this.canvas.width - 80),
        y: this.canvas.height - (i + 1) * 50,
        width: 80,
        height: 15
      });
    }

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.player.x -= 15;
      if (e.key === 'ArrowRight') this.player.x += 15;
    });

    // Touch controls
    const leftBtn = document.getElementById('climb-left');
    const rightBtn = document.getElementById('climb-right');
    if (leftBtn) leftBtn.addEventListener('touchstart', () => { this.player.x -= 15; });
    if (rightBtn) rightBtn.addEventListener('touchstart', () => { this.player.x += 15; });

    this.gameLoop();
    this.startTimer();
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Reached height ${this.score}!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Height: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Physics
    this.player.vy += 0.3; // gravity
    this.player.y += this.player.vy;

    // Boundary
    this.player.x = Math.max(0, Math.min(this.player.x, this.canvas.width - this.player.width));

    // Platform collision
    for (let platform of this.platforms) {
      if (this.player.vy > 0 &&
          this.player.y + this.player.height >= platform.y &&
          this.player.y + this.player.height <= platform.y + platform.height + 5 &&
          this.player.x + this.player.width > platform.x &&
          this.player.x < platform.x + platform.width) {
        this.player.vy = -12;
        this.score++;
      }
    }

    // Game over if fell
    if (this.player.y > this.canvas.height) {
      this.gameActive = false;
      document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Reached height ${this.score}!`;
    }

    // Draw platforms
    this.ctx.fillStyle = '#00ffff';
    for (let platform of this.platforms) {
      this.ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
    }

    // Draw player
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(this.player.x, this.player.y, this.player.width, this.player.height);

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// ============= BINGHAMTON GAME: Carousel Spin =============
class CarouselSpinGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    this.rotation = 0;
    this.targetRotation = 0;
    this.horses = 8;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
    this.centerX = this.canvas.width / 2;
    this.centerY = this.canvas.height / 2;
    this.radius = 80;
  }

  setupGame() {
    // Click to spin
    this.canvas.addEventListener('click', () => this.spin());
    this.canvas.addEventListener('touchstart', () => this.spin());

    this.gameLoop();
    this.startTimer();
  }

  spin() {
    if (this.gameActive) {
      this.targetRotation += (Math.random() * 4 + 2) * Math.PI;
      this.score++;
    }
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Spun ${this.score} times!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Spins: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Smooth rotation
    this.rotation += (this.targetRotation - this.rotation) * 0.05;

    // Draw carousel
    this.ctx.save();
    this.ctx.translate(this.centerX, this.centerY);
    this.ctx.rotate(this.rotation);

    for (let i = 0; i < this.horses; i++) {
      const angle = (i / this.horses) * Math.PI * 2;
      const x = Math.cos(angle) * this.radius;
      const y = Math.sin(angle) * this.radius;

      this.ctx.fillStyle = '#00ffff';
      this.ctx.beginPath();
      this.ctx.arc(x, y, 12, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = '#ff0000';
      this.ctx.font = '10px Courier Prime';
      this.ctx.fillText('🐴', x - 5, y + 4);
    }

    this.ctx.restore();

    // Draw center
    this.ctx.fillStyle = '#00ff41';
    this.ctx.beginPath();
    this.ctx.arc(this.centerX, this.centerY, 15, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw instruction
    this.ctx.fillStyle = '#00ffff';
    this.ctx.font = '12px Courier Prime';
    this.ctx.fillText('TAP TO SPIN', this.centerX - 40, this.centerY + 100);

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// ============= SYRACUSE GAME: Salt Collector =============
class SaltCollectorGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    this.bucket = { x: 0, y: 0, width: 50, height: 40 };
    this.saltCrystals = [];
    this.keys = {};

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
    this.bucket.x = this.canvas.width / 2 - 25;
    this.bucket.y = this.canvas.height - 60;
  }

  setupGame() {
    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.bucket.x -= 15;
      if (e.key === 'ArrowRight') this.bucket.x += 15;
    });

    // Touch
    const leftBtn = document.getElementById('salt-left');
    const rightBtn = document.getElementById('salt-right');
    if (leftBtn) leftBtn.addEventListener('touchstart', () => { this.bucket.x -= 15; });
    if (rightBtn) rightBtn.addEventListener('touchstart', () => { this.bucket.x += 15; });

    this.spawnSalt();
    this.gameLoop();
    this.startTimer();
  }

  spawnSalt() {
    if (this.gameActive) {
      this.saltCrystals.push({
        x: Math.random() * (this.canvas.width - 12),
        y: -12,
        width: 12,
        height: 12,
        vy: 2 + Math.random() * 3
      });
      setTimeout(() => this.spawnSalt(), 400);
    }
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Collected ${this.score} salt crystals!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Salt: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Boundary
    this.bucket.x = Math.max(0, Math.min(this.bucket.x, this.canvas.width - this.bucket.width));

    // Update and draw salt
    for (let i = this.saltCrystals.length - 1; i >= 0; i--) {
      let salt = this.saltCrystals[i];
      salt.y += salt.vy;

      // Collision
      if (salt.y + salt.height > this.bucket.y &&
          salt.y < this.bucket.y + this.bucket.height &&
          salt.x + salt.width > this.bucket.x &&
          salt.x < this.bucket.x + this.bucket.width) {
        this.score++;
        this.saltCrystals.splice(i, 1);
        continue;
      }

      if (salt.y > this.canvas.height) {
        this.saltCrystals.splice(i, 1);
        continue;
      }

      // Draw salt crystal
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(salt.x, salt.y, salt.width, salt.height);
      this.ctx.strokeStyle = '#00ffff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(salt.x, salt.y, salt.width, salt.height);
    }

    // Draw bucket
    this.ctx.fillStyle = '#ff0000';
    this.ctx.fillRect(this.bucket.x, this.bucket.y, this.bucket.width, this.bucket.height);
    this.ctx.strokeStyle = '#00ff41';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(this.bucket.x, this.bucket.y, this.bucket.width, this.bucket.height);

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// ============= ROCHESTER GAME: Flour Milling =============
class FlourMillingGame {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.score = 0;
    this.gameActive = true;
    this.gameTime = 30;
    this.timeLeft = this.gameTime;
    this.millRotation = 0;
    this.grains = [];
    this.flourCount = 0;

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    this.setupGame();
  }

  resizeCanvas() {
    this.canvas.width = Math.min(this.canvas.offsetWidth, 500);
    this.canvas.height = 400;
    this.centerX = this.canvas.width / 2;
    this.centerY = this.canvas.height / 2;
  }

  setupGame() {
    // Click to mill
    this.canvas.addEventListener('click', () => this.addGrain());
    this.canvas.addEventListener('touchstart', () => this.addGrain());

    this.gameLoop();
    this.startTimer();
  }

  addGrain() {
    if (this.gameActive) {
      this.grains.push({
        rotation: Math.random() * Math.PI * 2,
        life: 30
      });
    }
  }

  startTimer() {
    const timer = setInterval(() => {
      if (this.gameActive) {
        this.timeLeft--;
        if (this.timeLeft <= 0) {
          this.gameActive = false;
          clearInterval(timer);
          document.getElementById('game-status').innerHTML = `<strong>Game Over!</strong> Milled ${this.score} grains!`;
        }
      }
    }, 1000);
  }

  gameLoop() {
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw title
    this.ctx.fillStyle = '#00ff41';
    this.ctx.font = 'bold 16px Courier Prime';
    this.ctx.fillText(`Flour: ${this.score}`, 10, 25);
    this.ctx.fillText(`Time: ${this.timeLeft}s`, this.canvas.width - 120, 25);

    // Update mill
    this.millRotation += 0.1;

    // Draw mill
    this.ctx.save();
    this.ctx.translate(this.centerX, this.centerY);

    // Mill body
    this.ctx.fillStyle = '#00ffff';
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 60, 0, Math.PI * 2);
    this.ctx.fill();

    // Mill blades
    this.ctx.rotate(this.millRotation);
    this.ctx.fillStyle = '#ff0000';
    for (let i = 0; i < 4; i++) {
      this.ctx.rotate(Math.PI / 2);
      this.ctx.fillRect(-10, 40, 20, 30);
    }

    this.ctx.restore();

    // Update and draw grains
    for (let i = this.grains.length - 1; i >= 0; i--) {
      let grain = this.grains[i];
      grain.life--;

      if (grain.life <= 0) {
        this.score++;
        this.grains.splice(i, 1);
      } else {
        // Draw grain being milled
        const x = Math.cos(grain.rotation) * 40;
        const y = Math.sin(grain.rotation) * 40;
        this.ctx.fillStyle = '#ffff00';
        this.ctx.beginPath();
        this.ctx.arc(this.centerX + x, this.centerY + y, 4, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // Draw instruction
    this.ctx.fillStyle = '#00ffff';
    this.ctx.font = '12px Courier Prime';
    this.ctx.fillText('TAP TO MILL', this.centerX - 40, this.centerY + 110);

    if (this.gameActive) {
      requestAnimationFrame(() => this.gameLoop());
    }
  }

  getScore() {
    return this.score;
  }
}

// Export for use
window.AmtrakGames = {
  TicketPunchGame,
  AppleCatchGame,
  CapitolClimberGame,
  CarouselSpinGame,
  SaltCollectorGame,
  FlourMillingGame
};
